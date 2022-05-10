// @ts-ignore
import Plotly from 'plotly.js-dist';
// @ts-ignore
import roninBridgeTransactions from './data/ronin-bridge.csv';
// @ts-ignore
import rainbowBridgeTransactions from './data/rainbow-bridge.csv';
// @ts-ignore
import umbriaBridgeTransactions from './data/umbria-bridge.csv';
// @ts-ignore
import multichainBridgeTransactions from './data/multichain-bridge.csv';
import { HoltWintersAnalyser } from '../../src/analysers/holt-winters';
import { AnalyserTransaction } from '../../src/types';

function addChart(
  title: string,
  charts: { data: (number | null)[]; name: string; color: string }[],
) {
  const chartId = title.toLowerCase().replace(/\s+/g, '-').replace(/:/g, '');

  const sectionEl = document.createElement('section');
  const titleEl = document.createElement('h2');
  const chartEl = document.createElement('div');

  titleEl.innerText = title;
  chartEl.id = chartId;

  sectionEl.appendChild(titleEl);
  sectionEl.appendChild(chartEl);
  document.body.appendChild(sectionEl);

  const plotlyData = [];

  for (const chart of charts) {
    const x = Array(chart.data.length)
      .fill(0)
      .map((_, i) => i);

    plotlyData.push({
      x,
      y: chart.data,
      type: 'scatter',
      mode: 'lines+markers',
      line: { color: chart.color },
      name: chart.name,
    });
  }

  Plotly.newPlot(chartId, plotlyData);

  return chartId;
}

async function displayAnalysis(title: string, transactions: any[]) {
  const analyzer = new HoltWintersAnalyser({
    seasonLength: 20,
    trainingCycles: 20,
    changeRate: 3,
  });

  const trainingData: AnalyserTransaction[] = transactions.map((t) => ({
    timestamp: Number(t.block_time),
    priorityFeePerGas: Number(t.priority_fee_per_gas),
  }));

  const { preparedData, interpolatedData, filteredData, timestamps } = await analyzer.train(
    trainingData,
  );

  const predictedData = analyzer.forecast!.data!;

  addChart(`${title}: Original data`, [{ name: 'Original', data: preparedData, color: 'red' }]);
  addChart(`${title}: Interpolated`, [
    { name: 'Interpolated', data: interpolatedData, color: 'green' },
    { name: 'Original', data: preparedData, color: 'red' },
  ]);
  addChart(`${title}: Filtered`, [
    { name: 'Before', data: preparedData, color: 'red' },
    { name: 'After', data: filteredData, color: 'green' },
  ]);
  addChart(`${title}: Predicted`, [{ name: 'Predicted', data: predictedData, color: 'green' }]);
  addChart(`${title}: Comparison`, [
    { name: 'Original', data: preparedData, color: 'red' },
    { name: 'Predicted', data: predictedData, color: 'green' },
  ]);

  const suspiciousData = await Promise.all(
    preparedData.map(async (v, i) => {
      if (v == null) return null;
      const { isAnomaly } = await analyzer.isAnomaly({
        timestamp: timestamps[i],
        priorityFeePerGas: v,
      });
      return isAnomaly ? v : null;
    }),
  );

  addChart(`${title}: Anomalous values`, [
    { name: 'Original', data: preparedData, color: 'green' },
    { name: 'Anomalies', data: suspiciousData, color: 'red' },
  ]);
}

async function initialize() {
  await displayAnalysis('Rainbow Bridge', rainbowBridgeTransactions);
  await displayAnalysis('Umbria Bridge', umbriaBridgeTransactions);
  await displayAnalysis('Ronin Bridge', roninBridgeTransactions);

  // too complicated task
  // await displayAnalysis('Multichain Bridge', multichainBridgeTransactions);
}


initialize()