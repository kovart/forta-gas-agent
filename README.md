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
1. Group the data by hours (13:00, 14:00, 15:00, ...)
2. Choose the maximal values of  `priorityFeePerGas` for each group
3. Interpolate the values for the empty hours using the easy function **f(x) = x^5**
4. Reduce noise values with Kalman filter
5. Create the forecast with [Holt-Winters algorithm](https://otexts.com/fpp2/holt-winters.html)
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
- Values interpolation (missing values in the intervals)
- Noise values filtering to improve prediction accuracy
- Demo server with real-world data and prediction results

## Alerts

- KOVART-ANOMALOUS-PRIORITY-FEE-HOLT-WINTERS
  - Fired when a transaction actual `priorityFeePerGas` is greater the predicted by more than 300%
  - Severity is always set to "medium"
  - Type is always set to "suspicious"
  - metadata:
    - `sender` - sender address
    - `actualPriorityFeePerGas` - actual value
    - `expectedPriorityFeePerGas` - predicted value

## Test Data

The agent behaviour can be checked in the [demo project](./research).

Since [default config](./agent-config.json) contains Ronin Bridge contract, 
the following command catch [the Ronin Hack](https://forta.org/blog/ronin-hack/):

```bash
npm run range 14342885..14442835
```
