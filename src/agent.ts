import {
  Finding,
  getEthersBatchProvider,
  HandleBlock,
  HandleTransaction,
  TransactionEvent,
} from 'forta-agent';
import { providers } from 'ethers';
import BigNumber from 'bignumber.js';
import LRU from 'lru-cache';
import { Analyser } from './analysers/analyser';
import { HoltWintersAnalyser } from './analysers/holt-winters';
import { AgentConfig, AnalyserTransaction, AnalyserClass, DataContainer } from './types';
import { createFinding } from './findings';

const data: DataContainer = {} as any;
const agentConfig: AgentConfig = require('../agent-config.json');
const Analysers = [HoltWintersAnalyser];

const provideInitialize = (
  data: DataContainer,
  agentConfig: AgentConfig,
  Analysers: AnalyserClass[],
  provider: providers.JsonRpcProvider,
) => {
  return async () => {
    data.provider = provider;
    // normalize addresses
    data.contracts = agentConfig.contracts.map((c) => ({
      ...c,
      address: c.address.toLowerCase(),
    }));
    data.blocksCache = new LRU({
      max: 50, // 50 blocks in cache
      ttl: 1000 * 60 * 15 /* 15min */,
      fetchMethod: async (blockNumber: number) => {
        try {
          return await data.provider.getBlock(blockNumber);
        } catch {
          return null;
        }
      },
    });
    data.analysersByContract = {};
    data.transactionsByContract = {};
    data.isTrainedByContract = {};

    for (const { address: contractAddress, analysers: contractAnalysers = [] } of data.contracts) {
      const analysers: Analyser<AnalyserTransaction>[] = [];

      for (const { key, config } of [...agentConfig.analysers, ...contractAnalysers]) {
        const Analyser = Analysers.find((a) => a.Key === key);
        if (Analyser) {
          const analyser = new Analyser(config);
          analysers.push(analyser);
        }
      }

      data.transactionsByContract[contractAddress] = [];
      data.analysersByContract[contractAddress] = analysers;
      data.isTrainedByContract[contractAddress] = true;
    }

    data.maxTrainingData = agentConfig.maxTrainingData;
    data.isInitialized = true;
  };
};

const provideHandleTransaction = (data: DataContainer): HandleTransaction => {
  return async (txEvent: TransactionEvent) => {
    if (!data.isInitialized) {
      throw new Error('Dependencies are not initialized');
    }

    const findings: Finding[] = [];
    const contractAddress = txEvent.to?.toLowerCase();
    const block = await data.blocksCache.fetch(txEvent.blockNumber);

    if (!block) {
      console.error('Cannot fetch block data');
      return findings;
    }

    if (!block.baseFeePerGas) return findings;

    if (!contractAddress || !data.contracts.find(({ address }) => address === contractAddress)) {
      return findings;
    }

    const tx = await data.provider.getTransaction(txEvent.hash);

    if (!tx || !tx.maxPriorityFeePerGas || !tx.maxFeePerGas) return findings;

    // https://eips.ethereum.org/EIPS/eip-1559
    // Since the value can exceed the maximum JS Number value, we denominate it from wei to gwei
    const priorityFeePerGas = BigNumber.min(
      new BigNumber(tx.maxPriorityFeePerGas.toHexString()),
      new BigNumber(tx.maxFeePerGas.toHexString()).minus(
        new BigNumber(block.baseFeePerGas.toHexString()),
      ),
    ).div(1e9);

    const trainingTransaction: AnalyserTransaction = {
      timestamp: txEvent.timestamp,
      priorityFeePerGas: priorityFeePerGas.toNumber(),
    };

    const analysers = data.analysersByContract[contractAddress];

    if (analysers.length === 0) return findings;

    for (const analyser of analysers) {
      const { isAnomaly, expected, actual } = await analyser.isAnomaly(trainingTransaction);
      if (isAnomaly) {
        findings.push(
          createFinding(
            analyser.key,
            analyser.name,
            contractAddress,
            expected!,
            actual!,
            txEvent.from,
          ),
        );
      }
    }

    data.transactionsByContract[contractAddress].push(trainingTransaction);
    data.isTrainedByContract[contractAddress] = false;

    return findings;
  };
};

const provideHandleBlock = (data: DataContainer): HandleBlock => {
  return async () => {
    if (!data.isInitialized) {
      throw new Error('Dependencies are not initialized');
    }

    for (const { address: contractAddress } of data.contracts) {
      let transactions = data.transactionsByContract[contractAddress] || [];
      const analysers = data.analysersByContract[contractAddress] || [];

      if (transactions.length === 0 || analysers.length === 0) continue;

      if (data.isTrainedByContract[contractAddress]) continue;

      if (transactions.length > data.maxTrainingData) {
        data.transactionsByContract[contractAddress] = transactions = transactions.slice(
          -data.maxTrainingData,
        );
      }

      for (const analyser of analysers) {
        await analyser.train(transactions);
      }

      data.isTrainedByContract[contractAddress] = true;
    }

    return [];
  };
};

export default {
  initialize: provideInitialize(data, agentConfig, Analysers, getEthersBatchProvider()),
  handleTransaction: provideHandleTransaction(data),
  handleBlock: provideHandleBlock(data),

  provideInitialize,
  provideHandleTransaction,
  provideHandleBlock,
};
