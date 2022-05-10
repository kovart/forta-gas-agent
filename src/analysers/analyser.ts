// This abstract class was designed to allow transactions
// to be checked with multiple analysers (Exponential Moving Average, ARIMA, Deep Learning, etc..).
// In addition, we can even use the same analysers,
// but with different strategies, configurations.

export abstract class Analyser<T> {
  public static readonly Key: string;

  protected constructor(public readonly name: string) {}

  public abstract train(data: T[]): Promise<{ success: boolean; [x: string]: any }>;

  public abstract isAnomaly(
    transaction: T,
  ): Promise<{ isAnomaly: boolean; expected?: number; actual?: number }>;

  public abstract get key(): string;
}
