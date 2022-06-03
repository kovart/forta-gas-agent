import lodash from 'lodash';
import dayjs from 'dayjs';
import isSameOrBefore from 'dayjs/plugin/isSameOrBefore';
import { createInterpolator } from 'range-interpolator';
// @ts-ignore
import KalmanFilter from 'kalmanjs';
// @ts-ignore
import zodiac from 'zodiac-ts';
import { AnalyserConfig, AnalyserTransaction } from '../types';
import { Analyser } from './analyser';

dayjs.extend(isSameOrBefore);

export type HoltWintersAnalyserConfig = AnalyserConfig & {
  alpha?: number;
  gamma?: number;
  delta?: number;
  trainingCycles: number;
  seasonLength: number;
};

export class HoltWintersAnalyser extends Analyser<AnalyserTransaction> {
  public static readonly Key: string = 'holt-winters';

  public config: HoltWintersAnalyserConfig;
  public forecast: { data: number[]; fromTimestamp: number; toTimeStamp: number } | null = null;

  private readonly Step = {
    dateFormat: 'DD/MM/YYYY HH',
    format: (timestamp: number) => dayjs.unix(timestamp).format(this.Step.dateFormat),
    add: (amount: number, timestamp: number) => this.Step.get(timestamp).add(amount, 'hour'),
    subtract: (amount: number, timestamp: number) =>
      this.Step.get(timestamp).subtract(amount, 'hour'),
    get: (timestamp: number) => dayjs.unix(timestamp).set('minutes', 0).set('seconds', 0),
    diff: (timestamp1: number, timestamp2: number) =>
      this.Step.get(timestamp1).diff(this.Step.get(timestamp2), 'hour'),
  };

  constructor(config: HoltWintersAnalyserConfig) {
    super('Holt Winters Analyser');

    if (!config) {
      throw new Error(`${this.name} requires initial config`);
    }

    this.config = { ...config };
  }

  public async isAnomaly(transaction: AnalyserTransaction) {
    const negativeResult = { isAnomaly: false };

    if (!this.forecast) return negativeResult;
    if (!transaction.priorityFeePerGas) return negativeResult;

    const index =
      this.Step.diff(transaction.timestamp, this.forecast.fromTimestamp) + this.config.seasonLength;

    // if transaction was before the forecast
    if (index < this.config.seasonLength) return negativeResult;

    // if transaction is far away from the last the forecast data
    if (index >= this.forecast.data.length) {
      return negativeResult;
    }

    const predictedValue = this.forecast.data[index];
    const actualValue = transaction.priorityFeePerGas;

    if (actualValue > predictedValue * (1 + this.config.changeRate)) {
      return {
        isAnomaly: true,
        expected: predictedValue,
        actual: actualValue,
      };
    }

    return negativeResult;
  }

  public async train(data: AnalyserTransaction[]): Promise<{
    success: boolean;
    preparedData: (number | null)[];
    filteredData: number[];
    interpolatedData: number[];
    timestamps: number[];
  }> {
    const negativeResult = {
      success: false,
      preparedData: [],
      filteredData: [],
      interpolatedData: [],
      timestamps: [],
    };

    if (data.length < this.minTrainingData) return negativeResult;

    const { data: preparedData, timestamps } = this.prepareTrainingData(data);

    if (preparedData.length < this.minTrainingData) return negativeResult;

    const interpolatedData = this.interpolateMissingValues(preparedData);
    const filteredData = this.filterNoise(interpolatedData);

    const { alpha = 0, gamma = 0, delta = 0, seasonLength, trainingCycles } = this.config;
    const forecast = new zodiac.HoltWintersSmoothing(
      filteredData,
      alpha,
      gamma,
      delta,
      seasonLength,
      true,
    );

    if (trainingCycles > 0) {
      const params = forecast.optimizeParameters(trainingCycles);
      this.config = { ...this.config, ...params };
    }

    this.forecast = {
      data: forecast.predict(),
      fromTimestamp: timestamps[this.config.seasonLength],
      toTimeStamp: this.Step.add(
        this.config.seasonLength,
        timestamps[timestamps.length - 1],
      ).unix(),
    };

    return {
      success: true,
      preparedData,
      interpolatedData,
      filteredData,
      timestamps,
    };
  }

  private prepareTrainingData(data: AnalyserTransaction[]): {
    data: (number | null)[];
    timestamps: number[];
  } {
    data = data.slice();

    data.sort((a, b) => a.timestamp - b.timestamp);

    const groupsByDay = lodash.groupBy(data, (item) => this.Step.format(item.timestamp));

    const fromDay = this.Step.get(data[0].timestamp);
    const toDay = this.Step.get(data[data.length - 1].timestamp);

    let preparedData: { value: number | null; timestamp: number }[] = [];

    for (let date = fromDay; date.isSameOrBefore(toDay); date = this.Step.add(1, date.unix())) {
      const dateKey = this.Step.format(date.unix());
      const values = (groupsByDay[dateKey] || []).filter(
        (v) => typeof v.priorityFeePerGas === 'number',
      );

      if (values.length === 0) {
        preparedData.push({ value: null, timestamp: date.unix() });
        continue;
      }

      const biggestItem = lodash.maxBy(values, (i) => i.priorityFeePerGas);

      preparedData.push({ value: biggestItem!.priorityFeePerGas!, timestamp: date.unix() });
    }

    const startIndex = preparedData.findIndex((value) => value);
    const endIndex =
      preparedData.length -
      preparedData
        .slice()
        .reverse()
        .findIndex((value) => value);

    preparedData = preparedData.slice(startIndex, endIndex);

    if (preparedData.length === 0) return { data: [], timestamps: [] };

    return {
      data: preparedData.map((v) => v.value),
      timestamps: preparedData.map((v) => v.timestamp),
    };
  }

  private interpolateMissingValues(data: (number | null)[]): number[] {
    data = data.slice();

    let startIndex = null;
    let endIndex = null;
    for (let i = 0; i < data.length; i++) {
      if (!data[i]) {
        if (!startIndex) startIndex = i;
      } else {
        if (!startIndex) continue;

        endIndex = i;
        const fromValue: number = data[startIndex - 1]!;
        const toValue: number = data[endIndex]!;

        const interpolate = createInterpolator({
          inputRange: [startIndex - 1, endIndex],
          outputRange: [fromValue, toValue],
          easing: (t) => Math.pow(t, 5),
        });

        for (let x = startIndex - 1; x < endIndex; x++) {
          data[x] = interpolate(x);
        }

        startIndex = null;
        endIndex = null;
      }
    }

    return data as number[];
  }

  private filterNoise(data: number[], params: { R?: number; Q?: number } = {}) {
    const kalmanFilter = new KalmanFilter({ R: params.R ?? 0.1, Q: params.Q ?? 6 });

    return data.map((v) => kalmanFilter.filter(v));
  }

  public get minTrainingData() {
    return this.config.seasonLength * 2;
  }

  public get key() {
    return HoltWintersAnalyser.Key;
  }
}
