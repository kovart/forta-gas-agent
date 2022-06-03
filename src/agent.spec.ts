import { createAddress, TestBlockEvent, TestTransactionEvent } from 'forta-agent-tools/lib/tests';
import { HandleBlock, HandleTransaction } from 'forta-agent';
import { BigNumber as EthersBigNumber } from 'ethers';

import agent from './agent';
import { AgentConfig, ContractConfig, DataContainer } from './types';
import { createFinding } from './findings';

const { provideInitialize, provideHandleBlock, provideHandleTransaction } = agent;

type MockDataContainer = Omit<jest.MockedObject<DataContainer>, 'blocksCache'> & {
  blocksCache: { fetch: jest.Mock };
};

const createMockDataContainer = (provider: any, contracts: ContractConfig[]): MockDataContainer => {
  const data: MockDataContainer = {
    provider,
    contracts,
    blocksCache: { fetch: jest.fn() },
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
  const contract1: ContractConfig = { address: createAddress('0x1'), name: 'Test Contract 1' };
  const contract2: ContractConfig = { address: createAddress('0x2'), name: 'Test Contract 2' };
  const contract3: ContractConfig = { address: createAddress('0x3'), name: 'Test Contract 3' };

  // simplified version
  const createAnalyserClass = (key: string) =>
    class {
      constructor(public config: any) {}
      static Key = key;
    };

  beforeEach(() => {
    resetMockProvider(mockProvider);
    resetMockAnalyser(mockAnalyser);
  });

  describe('initialize()', () => {
    it('initializes correctly', async () => {
      const Analyser1 = createAnalyserClass('analyser1');
      const Analyser2 = createAnalyserClass('analyser2');
      const Analyser3 = createAnalyserClass('analyser3');

      const contracts = [
        contract1,
        {
          ...contract2,
          analysers: [
            {
              key: Analyser3.Key,
              config: { changeRate: 3, a: 'a3', b: 'b3' },
            },
          ],
        },
      ];

      const data: DataContainer = {} as any;
      const agentConfig: AgentConfig = {
        analysers: [
          { key: Analyser1.Key, config: { changeRate: 1, a: 'a1', b: 'b1' } },
          { key: Analyser2.Key, config: { changeRate: 2, a: 'a2', b: 'b2' } },
        ],
        contracts: contracts,
        maxTrainingData: 12345678,
      };

      await provideInitialize(
        data,
        agentConfig,
        [Analyser1, Analyser2, Analyser3],
        mockProvider as any,
      )();

      expect(data.isInitialized).toStrictEqual(true);
      expect(data.contracts).toStrictEqual([contracts[0], contracts[1]]);
      expect(data.maxTrainingData).toStrictEqual(agentConfig.maxTrainingData);
      expect(data.provider).toStrictEqual(mockProvider);
      expect(data.isTrainedByContract[contracts[0].address]).toStrictEqual(true);
      expect(data.isTrainedByContract[contracts[1].address]).toStrictEqual(true);
      expect(data.transactionsByContract[contracts[0].address]).toHaveLength(0);
      expect(data.transactionsByContract[contracts[1].address]).toHaveLength(0);
      expect(data.analysersByContract[contracts[0].address][0]).toBeInstanceOf(Analyser1);
      expect(data.analysersByContract[contracts[0].address][1]).toBeInstanceOf(Analyser2);
      expect(data.analysersByContract[contracts[1].address][0]).toBeInstanceOf(Analyser1);
      expect(data.analysersByContract[contracts[1].address][1]).toBeInstanceOf(Analyser2);
      expect(data.analysersByContract[contracts[1].address][2]).toBeInstanceOf(Analyser3);
      expect((data.analysersByContract[contracts[1].address][2] as any).config).toStrictEqual(
        contracts[1].analysers![0].config,
      );
    });

    it('implements blocks cache correctly', async () => {
      const Analyser = createAnalyserClass('analyser');
      const data: DataContainer = {} as any;
      const agentConfig: AgentConfig = {
        analysers: [{ key: Analyser.Key, config: { changeRate: 1 } }],
        contracts: [contract1, contract2],
        maxTrainingData: 12345678,
      };

      await provideInitialize(data, agentConfig, [Analyser], mockProvider as any)();

      const block1 = { number: 1 };
      const block2 = { number: 2 };

      mockProvider.getBlock.mockImplementation((number) => {
        if (number === block1.number) return block1;
        if (number === block2.number) return block2;
      });

      expect(await data.blocksCache.fetch(block1.number)).toStrictEqual(block1);
      expect(await data.blocksCache.fetch(block1.number)).toStrictEqual(block1);
      expect(mockProvider.getBlock).toBeCalledTimes(1);
      expect(await data.blocksCache.fetch(block2.number)).toStrictEqual(block2);
      expect(await data.blocksCache.fetch(block2.number)).toStrictEqual(block2);
      expect(mockProvider.getBlock).toBeCalledTimes(2);
    });
  });

  describe('handleBlock()', () => {
    let data: MockDataContainer;
    let handleBlock: HandleBlock;
    let blockEvent: TestBlockEvent;

    beforeEach(() => {
      data = createMockDataContainer(mockProvider, []);
      handleBlock = provideHandleBlock(data);
      blockEvent = new TestBlockEvent();
    });

    it("doesn't train analysers if there are no training transactions", async () => {
      data.contracts = [contract1];
      data.analysersByContract[contract1.address] = [mockAnalyser];
      data.transactionsByContract[contract1.address] = [];

      await handleBlock(blockEvent);

      expect(mockAnalyser.train).toBeCalledTimes(0);
    });

    it("doesn't train analysers if contract has no new transactions", async () => {
      data.contracts = [contract1];
      data.analysersByContract[contract1.address] = [mockAnalyser];
      data.transactionsByContract[contract1.address] = [{ timestamp: 1, priorityFeePerGas: 1 }];
      data.isTrainedByContract[contract1.address] = true;

      await handleBlock(blockEvent);

      expect(mockAnalyser.train).toBeCalledTimes(0);
    });

    it('trains analysers if contract has new transactions', async () => {
      data.contracts = [contract1];
      data.analysersByContract[contract1.address] = [mockAnalyser];
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
      data.analysersByContract[contract1.address] = [mockAnalyser11, mockAnalyser12];
      data.analysersByContract[contract2.address] = [mockAnalyser2];
      data.analysersByContract[contract3.address] = [mockAnalyser3];
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
      data.analysersByContract[contract1.address] = [mockAnalyser];
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
    let data: MockDataContainer;
    let txEvent: TestTransactionEvent;
    let handleTransaction: HandleTransaction;

    const mockBlock = {
      number: 12345,
      timestamp: 222222,
      baseFeePerGas: EthersBigNumber.from(1234),
    };

    beforeEach(() => {
      resetMockProvider(mockProvider);
      resetMockAnalyser(mockAnalyser);
      data = createMockDataContainer(mockProvider, []);
      data.blocksCache.fetch.mockResolvedValue(mockBlock);
      handleTransaction = provideHandleTransaction(data);
      txEvent = new TestTransactionEvent();
      txEvent.setBlock(mockBlock.number);
    });

    it('skips transaction to non-specified contract', async () => {
      data.contracts = [contract1, contract2];
      data.analysersByContract[contract1.address] = [mockAnalyser];
      data.analysersByContract[contract2.address] = [mockAnalyser];

      txEvent.setTo(contract3.address);

      await handleTransaction(txEvent);

      expect(mockProvider.getBlock).toBeCalledTimes(0);
      expect(mockProvider.getTransaction).toBeCalledTimes(0);
    });

    it('skips transaction if block has no baseFeePerGas', async () => {
      data.contracts = [contract1];
      data.analysersByContract[contract1.address] = [mockAnalyser];
      data.blocksCache.fetch.mockResolvedValue({ ...mockBlock, baseFeePerGas: null });

      txEvent.setTo(contract1.address);

      await handleTransaction(txEvent);

      expect(mockProvider.getTransaction).toBeCalledTimes(0);
    });

    it('skips transaction without maxPriorityFeePerGas or maxFeePerGas', async () => {
      data.contracts = [contract1];
      data.analysersByContract[contract1.address] = [mockAnalyser];

      txEvent.setTo(contract1.address);
      mockProvider.getTransaction.mockResolvedValueOnce({
        maxPriorityFeePerGas: null,
        maxFeePerGas: EthersBigNumber.from(1234),
      });

      await handleTransaction(txEvent);

      expect(mockAnalyser.isAnomaly).toBeCalledTimes(0);

      mockProvider.getTransaction.mockResolvedValueOnce({
        maxPriorityFeePerGas: EthersBigNumber.from(1234),
        maxFeePerGas: null,
      });

      await handleTransaction(txEvent);

      expect(mockAnalyser.isAnomaly).toBeCalledTimes(0);
    });

    it('adds new training record correctly', async () => {
      data.contracts = [contract1];
      data.transactionsByContract[contract1.address] = [];
      data.isTrainedByContract[contract1.address] = true;
      data.analysersByContract[contract1.address] = [mockAnalyser];

      txEvent.setTo(contract1.address);
      txEvent.setHash('HASH1');
      txEvent.setTimestamp(mockBlock.timestamp);
      data.blocksCache.fetch.mockResolvedValue({
        ...mockBlock,
        baseFeePerGas: EthersBigNumber.from(100).mul(1e9),
      });
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
      data.analysersByContract[contract1.address] = [mockAnalyser];

      txEvent.setTo(contract1.address);
      data.blocksCache.fetch.mockResolvedValue({
        ...mockBlock,
        baseFeePerGas: EthersBigNumber.from(100),
      });
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
      data.blocksCache.fetch.mockResolvedValue({
        ...mockBlock,
        baseFeePerGas: EthersBigNumber.from(100)
      });
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
      data.blocksCache.fetch.mockResolvedValue({
        ...mockBlock,
        baseFeePerGas: EthersBigNumber.from(100)
      })
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
