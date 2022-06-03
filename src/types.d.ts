import { Block } from '@ethersproject/abstract-provider';
import { providers } from 'ethers';
import { Analyser } from './analysers/analyser';

type AnalyserClass = { new (...args: any[]): any; Key: string };

export type AnalyserTransaction = {
  timestamp: number;
  priorityFeePerGas: number;
};

export type AnalyserConfig = {
  [x: string]: string | number | object;
  changeRate: number;
}

export type AnalyserItemConfig = {
  key: string; // agent name
  config?: AnalyserConfig;
};

export type ContractConfig = {
  name: string;
  address: string;
  analysers?: AnalyserItemConfig[];
};

export type AgentConfig = {
  contracts: ContractConfig[];
  analysers: AnalyserItemConfig[];
  maxTrainingData: number;
};

export type DataContainer = {
  isInitialized: boolean;
  contracts: ContractConfig[];
  analysersByContract: { [addr: string]: Analyser<AnalyserTransaction>[] };
  transactionsByContract: { [addr: string]: AnalyserTransaction[] };
  isTrainedByContract: { [addr: string]: boolean };
  maxTrainingData: number;
  blocksCache: {
    fetch: (blockNumber: number) => Promise<Block | undefined>;
  };
  provider: providers.JsonRpcProvider;
};
