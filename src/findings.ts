import BigNumber from 'bignumber.js';
import { Finding, FindingSeverity, FindingType } from 'forta-agent';

export const createFinding = (
  analyserKey: string,
  analyserName: string,
  contractAddress: string,
  expectedPriorityFeePerGas: number, // gwei
  actualPriorityFeePerGas: number, // gwei
  senderAddress: string,
) => {
  const formatValue = (val: number | BigNumber) => new BigNumber(val).toFormat(2);

  const diffPercent = new BigNumber(actualPriorityFeePerGas)
    .minus(expectedPriorityFeePerGas)
    .div(expectedPriorityFeePerGas)
    .abs()
    .multipliedBy(100);

  return Finding.from({
    alertId: `KOVART-ANOMALOUS-PRIORITY-FEE-` + analyserKey.toUpperCase(),
    name: 'High Priority Fee',
    description: `${analyserName}: Priority fee ${formatValue(
      actualPriorityFeePerGas,
    )}Gwei is ${formatValue(diffPercent)}% greater than expected`,
    severity: FindingSeverity.Medium,
    type: FindingType.Suspicious,
    addresses: [contractAddress, senderAddress],
    metadata: {
      sender: senderAddress.toLowerCase(),
      actualPriorityFeePerGas: actualPriorityFeePerGas.toString(),
      expectedPriorityFeePerGas: Math.round(expectedPriorityFeePerGas).toString(),
    },
  });
};
