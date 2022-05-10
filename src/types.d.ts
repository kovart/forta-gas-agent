import { Block } from '@ethersproject/abstract-provider';
import { providers } from 'ethers';
import { Analyser } from './analysers/analyser';

type AnalyserClass = { new (...args: any[]): any; Key: string };

export type AnalyserTransaction = {
  timestamp: number;
  priorityFeePerGas?: number;
};

export type AnalyserConfig = {
  key: string;
  config?: {
    [x: string]: any;
    sensitivity: number;
  };
};

export type ContractConfig = {
  name: string;
  address: string;
  analysers?: AnalyserConfig[];
};

export type AgentConfig = {
  contracts: ContractConfig[];
  analysers: AnalyserConfig[];
  maxTrainingData: number;
};

export type DependencyContainer = {
  isInitialized: boolean;
  contracts: ContractConfig[];
  analysersByContract: { [addr: string]: Analyser<AnalyserTransaction>[] };
  transactionsByContract: { [addr: string]: AnalyserTransaction[] };
  isTrainedByContract: { [addr: string]: boolean };
  maxTrainingData: number;
  currentBlock: Block | null;
  provider: providers.JsonRpcProvider;
};
