# Forta Anomalous Gas Usage Agent

## Description

<p align="center">
  <img alt="Ronin Bridge gas usage" src="./blob/ronin-bridge.png">
</p>

This agent helps to detect unusual high gas usage for the specified protocols.
At the moment, the agent analyses only the value of `priorityFeePerGas` ([EIPS-1559](https://eips.ethereum.org/EIPS/eip-1559)),
which is calculated according the following formula:

```
priorityFeePerGas = min(transaction.maxPriorityFeePerGas, transaction.maxFeePerGas - block.baseFeePerGas)
```

The main analyser `holt-winters` works with the following algorithm: 
1. Group the data by hours _(13:00, 14:00, 15:00, ...)_
2. Choose the maximal values of `priorityFeePerGas` for each group
3. Interpolate the values for the empty hours using the easy function **f(x) = x^5**
4. Reduce noise values with Kalman filter
5. Create the forecast with [Holt-Winters method](https://otexts.com/fpp2/holt-winters.html)
6. Measure deviation of real and expected values
7. If the deviation is greater than the `changeRate` then fire an alert

The Holt-Winters analyser starts checking transactions as soon as it has enough training data,
which it collects during 2 (seasons) * 7 (days) * 24 (hours) = 332 hours.

---

The agent has a fairly powerful system of working with analysers, but at the moment, only one is available (Holt-Winters).
It is possible to use the same analysers, but with different parameters. For example, you can initialize the Moving Avarage analysers with different order parameters.

---

To see live how the algorithm works with different protocols and data, see [research folder](./research).
The demo server can be started with the command:

```bash
cd ./research/
npm run start
```

## Supported Chains

EVM-compatible chains that support [EIPS-1559](https://eips.ethereum.org/EIPS/eip-1559).

## Features

- Support for multiple analysers
- Support for protocol-specific configurations
- Values interpolation for contracts with irregular transactions
- Noise values filtering to improve prediction accuracy
- Demo server with real-world data and prediction results

## Analysers

### Holt-Winters

**Key:** "holt-winters"

#### Configuration

- `alpha` сoefficient for the level smoothing Defau _(optional)_ &nbsp;|&nbsp; Default: **0**
- `gamma` сoefficient for the trend smoothing _(optional)_ &nbsp;|&nbsp; Default: **0**
- `delta` сoefficient for the seasonal smoothing _(optional)_ &nbsp;|&nbsp; Default: **0**
- `changeRate` minimum difference rate after which the value is considered anomalous, e.g. 0.5 = 50%, 3 = 300% _(required)_ &nbsp;|&nbsp; Default: **3**
- `trainingCycles` number of iterations for selecting optimal сoefficients _(required)_ &nbsp;|&nbsp; Default: **20**
- `seasonLength` number of values per season _(required)_ &nbsp;|&nbsp; Default: 7 (days) \* 24 (hours) = **168** (hours)

## Alerts

- KOVART-ANOMALOUS-PRIORITY-FEE-HOLT-WINTERS
  - Fired when a transaction actual `priorityFeePerGas` is greater the predicted by more than 300%
  - Severity is always set to "medium"
  - Type is always set to "suspicious"
  - metadata:
    - `sender` sender address
    - `actualPriorityFeePerGas` actual value
    - `expectedPriorityFeePerGas` predicted value

## Test Data

The agent behaviour can be checked in the [demo project](./research).

Since [default config](./agent-config.json) contains Ronin Bridge contract, 
the following command catch [the Ronin Hack](https://forta.org/blog/ronin-hack/):

```bash
npm run range 14342885..14442835
```
