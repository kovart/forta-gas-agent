import { createAddress, TestBlockEvent, TestTransactionEvent } from 'forta-agent-tools/lib/tests';
import { HandleBlock, HandleTransaction } from 'forta-agent';
import { BigNumber as EthersBigNumber } from 'ethers';
import BigNumber from 'bignumber.js';

import agent from './agent';
import { ContractConfig, DependencyContainer } from './types';
import { createFinding } from './findings';

const { provideHandleBlock, provideHandleTransaction } = agent;

const createMockDependencyContainer = (
  provider: any,
  contracts: ContractConfig[],
): DependencyContainer => {
  const data: DependencyContainer = {
    provider,
    contracts,
    currentBlock: null,
    isTrainedByContract: {},
    transactionsByContract: {},
    analysersByContract: {},
    maxTrainingData: 12345,
    isInitialized: true,
  };

  for (const contract of contracts) {
    data.isTrainedByContract[contract.address] = true;
    data.transactionsByContract[contract.address] = [];
    data.analysersByContract[contract.address] = [];
  }

  return data;
};

const createMockProvider = () => ({
  getBlock: jest.fn(),
  getTransaction: jest.fn(),
});

const resetMockProvider = (provider: any) => {
  provider.getTransaction.mockReset();
  provider.getBlock.mockReset();
};

const createMockAnalyser = (key = 'analyser-mock', name = 'Analyser name') => ({
  key,
  name,
  train: jest.fn(),
  isAnomaly: jest.fn(),
});

const resetMockAnalyser = (analyser: any) => {
  analyser.train.mockReset();
  analyser.isAnomaly.mockReset();
};

describe('High Priority Fee Agent', () => {
  const mockProvider = createMockProvider();
  const mockAnalyser = createMockAnalyser();
  const contract1 = { address: createAddress('0x1'), name: 'Test Contract 1' };
  const contract2 = { address: createAddress('0x2'), name: 'Test Contract 2' };
  const contract3 = { address: createAddress('0x3'), name: 'Test Contract 3' };

  beforeEach(() => {
    resetMockProvider(mockProvider);
    resetMockAnalyser(mockAnalyser);
  });

  describe('handleBlock()', () => {
    let data: DependencyContainer;
    let handleBlock: HandleBlock;
    let blockEvent: TestBlockEvent;

    beforeEach(() => {
      data = createMockDependencyContainer(mockProvider, []);
      handleBlock = provideHandleBlock(data);
      blockEvent = new TestBlockEvent();
    });

    it('caches current block for next handleTransaction() calls', async () => {
      const block = { number: 1234 };
      blockEvent.setNumber(block.number);
      mockProvider.getBlock.mockResolvedValue(block);

      await handleBlock(blockEvent);

      expect(data.currentBlock).toStrictEqual(block);
      expect(mockProvider.getBlock).toHaveBeenNthCalledWith(1, block.number);
    });

    it("doesn't train analysers if there are no training transactions", async () => {
      data.contracts = [contract1];
      data.analysersByContract[contract1.address] = [mockAnalyser] as any;
      data.transactionsByContract[contract1.address] = [];

      await handleBlock(blockEvent);

      expect(mockAnalyser.train).toBeCalledTimes(0);
    });

    it("doesn't train analysers if contract has no new transactions", async () => {
      data.contracts = [contract1];
      data.analysersByContract[contract1.address] = [mockAnalyser] as any;
      data.transactionsByContract[contract1.address] = [{ timestamp: 1, priorityFeePerGas: 1 }];
      data.isTrainedByContract[contract1.address] = true;

      await handleBlock(blockEvent);

      expect(mockAnalyser.train).toBeCalledTimes(0);
    });

    it('trains analysers if contract has new transactions', async () => {
      data.contracts = [contract1];
      data.analysersByContract[contract1.address] = [mockAnalyser] as any;
      data.transactionsByContract[contract1.address] = [{ timestamp: 1, priorityFeePerGas: 1 }];
      data.isTrainedByContract[contract1.address] = false;

      await handleBlock(blockEvent);

      expect(mockAnalyser.train).toBeCalledTimes(1);
      expect(data.isTrainedByContract[contract1.address]).toStrictEqual(true);
    });

    it('trains multiple analysers for multiple contracts if they have new transactions', async () => {
      const mockAnalyser11 = createMockAnalyser();
      const mockAnalyser12 = createMockAnalyser();
      const mockAnalyser2 = createMockAnalyser();
      const mockAnalyser3 = createMockAnalyser();

      data.contracts = [contract1, contract2, contract3];
      data.analysersByContract[contract1.address] = [mockAnalyser11, mockAnalyser12] as any;
      data.analysersByContract[contract2.address] = [mockAnalyser2] as any;
      data.analysersByContract[contract3.address] = [mockAnalyser3] as any;
      data.transactionsByContract[contract1.address] = [{ timestamp: 1, priorityFeePerGas: 1 }];
      data.transactionsByContract[contract2.address] = [{ timestamp: 1, priorityFeePerGas: 1 }];
      data.transactionsByContract[contract3.address] = [{ timestamp: 1, priorityFeePerGas: 1 }];
      data.isTrainedByContract[contract1.address] = false;
      data.isTrainedByContract[contract2.address] = false;
      data.isTrainedByContract[contract3.address] = true;

      await handleBlock(blockEvent);

      expect(mockAnalyser11.train).toBeCalledTimes(1);
      expect(mockAnalyser12.train).toBeCalledTimes(1);
      expect(data.isTrainedByContract[contract1.address]).toStrictEqual(true);

      expect(mockAnalyser2.train).toBeCalledTimes(1);
      expect(data.isTrainedByContract[contract2.address]).toStrictEqual(true);

      expect(mockAnalyser3.train).toBeCalledTimes(0);
      expect(data.isTrainedByContract[contract2.address]).toStrictEqual(true);
    });

    it('limits training transactions', async () => {
      data.contracts = [contract1];
      data.analysersByContract[contract1.address] = [mockAnalyser] as any;
      data.transactionsByContract[contract1.address] = [
        { timestamp: 1, priorityFeePerGas: 1 },
        { timestamp: 2, priorityFeePerGas: 2 },
        { timestamp: 3, priorityFeePerGas: 3 },
      ];
      data.isTrainedByContract[contract1.address] = false;
      data.maxTrainingData = 2;

      await handleBlock(blockEvent);

      expect(data.transactionsByContract[contract1.address]).toHaveLength(data.maxTrainingData);
    });
  });

  describe('handleTransaction()', () => {
    let data: DependencyContainer;
    let txEvent: TestTransactionEvent;
    let handleTransaction: HandleTransaction;

    beforeEach(() => {
      resetMockProvider(mockProvider);
      resetMockAnalyser(mockAnalyser);
      data = createMockDependencyContainer(mockProvider, []) as any;
      data.currentBlock = {
        number: 12345,
        timestamp: 222222,
        baseFeePerGas: EthersBigNumber.from(1234),
      } as any;
      handleTransaction = provideHandleTransaction(data);
      txEvent = new TestTransactionEvent();
      txEvent.setBlock(data.currentBlock!.number);
    });

    it('skips transaction to non-specified contract', async () => {
      data.contracts = [contract1, contract2];
      data.analysersByContract[contract1.address] = [mockAnalyser] as any;
      data.analysersByContract[contract2.address] = [mockAnalyser] as any;

      txEvent.setTo(contract3.address);

      await handleTransaction(txEvent);

      expect(mockProvider.getTransaction).toBeCalledTimes(0);
    });

    it('skips transaction if block has no baseFeePerGas', async () => {
      data.contracts = [contract1];
      data.analysersByContract[contract1.address] = [mockAnalyser] as any;
      data.currentBlock = { ...data.currentBlock, baseFeePerGas: null } as any;

      txEvent.setTo(contract1.address);

      await handleTransaction(txEvent);

      expect(mockProvider.getTransaction).toBeCalledTimes(0);
    });

    it('skips transaction without maxPriorityFeePerGas or maxFeePerGas', async () => {
      data.contracts = [contract1];
      data.analysersByContract[contract1.address] = [mockAnalyser] as any;

      txEvent.setTo(contract1.address);
      mockProvider.getTransaction.mockResolvedValueOnce({
        maxPriorityFeePerGas: null,
        maxFeePerGas: 1234,
      });

      await handleTransaction(txEvent);

      expect(mockAnalyser.isAnomaly).toBeCalledTimes(0);

      mockProvider.getTransaction.mockResolvedValueOnce({
        maxPriorityFeePerGas: 1234,
        maxFeePerGas: null,
      });

      await handleTransaction(txEvent);

      expect(mockAnalyser.isAnomaly).toBeCalledTimes(0);
    });

    it('adds new training record correctly', async () => {
      data.contracts = [contract1];
      data.transactionsByContract[contract1.address] = [];
      data.isTrainedByContract[contract1.address] = true;
      data.analysersByContract[contract1.address] = [mockAnalyser] as any;

      txEvent.setTo(contract1.address);
      txEvent.setHash('HASH1');
      txEvent.setTimestamp(data.currentBlock!.timestamp);
      data.currentBlock = {
        ...data.currentBlock,
        baseFeePerGas: EthersBigNumber.from(100).mul(1e9),
      } as any;
      mockProvider.getTransaction.mockResolvedValueOnce({
        maxPriorityFeePerGas: EthersBigNumber.from(300).mul(1e9),
        maxFeePerGas: EthersBigNumber.from(300).mul(1e9),
      });
      mockAnalyser.isAnomaly.mockResolvedValue({ isAnomaly: false });

      await handleTransaction(txEvent);

      expect(mockProvider.getTransaction).toHaveBeenNthCalledWith(1, txEvent.hash);
      expect(data.transactionsByContract[contract1.address]).toContainEqual({
        timestamp: txEvent.timestamp,
        priorityFeePerGas: 200,
      });
      expect(data.isTrainedByContract[contract1.address]).toStrictEqual(false);

      // ------------------

      mockProvider.getTransaction.mockReset();
      mockProvider.getTransaction.mockResolvedValueOnce({
        maxPriorityFeePerGas: EthersBigNumber.from(300).mul(1e9),
        maxFeePerGas: EthersBigNumber.from(500).mul(1e9),
      });
      txEvent.setHash('HASH2');
      data.isTrainedByContract[contract1.address] = true;
      data.transactionsByContract[contract1.address] = [];

      await handleTransaction(txEvent);

      expect(mockProvider.getTransaction).toHaveBeenNthCalledWith(1, txEvent.hash);
      expect(data.transactionsByContract[contract1.address]).toContainEqual({
        timestamp: txEvent.timestamp,
        priorityFeePerGas: 300,
      });
      expect(data.isTrainedByContract[contract1.address]).toStrictEqual(false);
    });

    it('return empty findings if analyser returns isAnomaly = false', async () => {
      data.contracts = [contract1];
      data.transactionsByContract[contract1.address] = [];
      data.analysersByContract[contract1.address] = [mockAnalyser] as any;

      txEvent.setTo(contract1.address);
      data.currentBlock = { ...data.currentBlock, baseFeePerGas: EthersBigNumber.from(100) } as any;
      mockProvider.getTransaction.mockResolvedValueOnce({
        maxPriorityFeePerGas: EthersBigNumber.from(300),
        maxFeePerGas: EthersBigNumber.from(300),
      });
      mockAnalyser.isAnomaly.mockResolvedValueOnce({ isAnomaly: false });

      const findings = await handleTransaction(txEvent);

      expect(findings).toStrictEqual([]);
      expect(mockAnalyser.isAnomaly).toHaveBeenCalledTimes(1);
    });

    it('returns a finding if analyser returns isAnomaly = true', async () => {
      const sender = createAddress('0x999');
      const expected = 100;
      const actual = 200;

      data.contracts = [contract1];
      data.transactionsByContract[contract1.address] = [];
      data.analysersByContract[contract1.address] = [mockAnalyser] as any;

      txEvent.setFrom(sender);
      txEvent.setTo(contract1.address);
      data.currentBlock = { ...data.currentBlock, baseFeePerGas: EthersBigNumber.from(100) } as any;
      mockProvider.getTransaction.mockResolvedValueOnce({
        maxPriorityFeePerGas: EthersBigNumber.from(300),
        maxFeePerGas: EthersBigNumber.from(300),
      });
      mockAnalyser.isAnomaly.mockResolvedValueOnce({ isAnomaly: true, expected, actual });

      const findings = await handleTransaction(txEvent);

      expect(findings).toStrictEqual([
        createFinding(
          mockAnalyser.key,
          mockAnalyser.name,
          contract1.address,
          expected,
          actual,
          sender,
        ),
      ]);
      expect(mockAnalyser.isAnomaly).toHaveBeenCalledTimes(1);
    });

    it('returns multiple findings', async () => {
      const sender = createAddress('0x999');
      const expected = 100;
      const actual = 200;

      const mockAnalyser1 = createMockAnalyser('a-1', 'Analyser 1');
      const mockAnalyser2 = createMockAnalyser('a-2', 'Analyser 2');

      data.contracts = [contract1];
      data.transactionsByContract[contract1.address] = [];
      data.analysersByContract[contract1.address] = [mockAnalyser1, mockAnalyser2] as any;

      txEvent.setFrom(sender);
      txEvent.setTo(contract1.address);
      data.currentBlock = { ...data.currentBlock, baseFeePerGas: EthersBigNumber.from(100) } as any;
      mockProvider.getTransaction.mockResolvedValueOnce({
        maxPriorityFeePerGas: EthersBigNumber.from(300),
        maxFeePerGas: EthersBigNumber.from(300),
      });

      mockAnalyser1.isAnomaly.mockResolvedValueOnce({ isAnomaly: true, expected, actual });
      mockAnalyser2.isAnomaly.mockResolvedValueOnce({ isAnomaly: true, expected, actual });

      const findings = await handleTransaction(txEvent);

      expect(findings).toStrictEqual([
        createFinding(
          mockAnalyser1.key,
          mockAnalyser1.name,
          contract1.address,
          expected,
          actual,
          sender,
        ),
        createFinding(
          mockAnalyser2.key,
          mockAnalyser2.name,
          contract1.address,
          expected,
          actual,
          sender,
        ),
      ]);
      expect(mockAnalyser1.isAnomaly).toHaveBeenCalledTimes(1);
      expect(mockAnalyser2.isAnomaly).toHaveBeenCalledTimes(1);
    });
  });
});
