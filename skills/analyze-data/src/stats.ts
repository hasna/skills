import type { ColumnStats } from './types';

export function detectDataType(values: any[]): ColumnStats['dataType'] {
  const nonNullValues = values.filter(v => v !== null && v !== undefined && v !== '');
  if (nonNullValues.length === 0) return 'string';

  let numericCount = 0;
  let dateCount = 0;
  let booleanCount = 0;

  for (const value of nonNullValues.slice(0, 100)) {
    if (typeof value === 'number' || !isNaN(Number(value))) {
      numericCount++;
    }
    if (value === true || value === false || value === 'true' || value === 'false') {
      booleanCount++;
    }
    if (!isNaN(Date.parse(String(value)))) {
      dateCount++;
    }
  }

  const total = Math.min(nonNullValues.length, 100);

  if (numericCount / total > 0.8) return 'numeric';
  if (booleanCount / total > 0.8) return 'boolean';
  if (dateCount / total > 0.8) return 'date';
  if (numericCount > 0 && numericCount < total * 0.8) return 'mixed';

  return 'string';
}

export function calculateStats(values: number[]): Partial<ColumnStats> {
  if (values.length === 0) return {};

  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;

  // Basic stats
  const sum = sorted.reduce((acc, val) => acc + val, 0);
  const mean = sum / n;

  const median = n % 2 === 0
    ? (sorted[n / 2 - 1] + sorted[n / 2]) / 2
    : sorted[Math.floor(n / 2)];

  // Mode
  const frequency: Record<number, number> = {};
  sorted.forEach(val => {
    frequency[val] = (frequency[val] || 0) + 1;
  });
  const maxFreq = Math.max(...Object.values(frequency));
  const modes = Object.keys(frequency)
    .filter(key => frequency[Number(key)] === maxFreq)
    .map(Number);
  const mode = modes.length === sorted.length ? undefined : (modes.length === 1 ? modes[0] : modes);

  // Variance and standard deviation
  const squaredDiffs = sorted.map(val => Math.pow(val - mean, 2));
  const variance = squaredDiffs.reduce((acc, val) => acc + val, 0) / n;
  const stdDev = Math.sqrt(variance);

  // Quartiles
  const q1 = sorted[Math.floor(n * 0.25)];
  const q2 = median;
  const q3 = sorted[Math.floor(n * 0.75)];

  // Skewness and kurtosis
  const cubedDiffs = sorted.map(val => Math.pow((val - mean) / stdDev, 3));
  const skewness = cubedDiffs.reduce((acc, val) => acc + val, 0) / n;

  const fourthDiffs = sorted.map(val => Math.pow((val - mean) / stdDev, 4));
  const kurtosis = fourthDiffs.reduce((acc, val) => acc + val, 0) / n - 3;

  return {
    mean: roundTo(mean, 4),
    median: roundTo(median, 4),
    mode,
    stdDev: roundTo(stdDev, 4),
    variance: roundTo(variance, 4),
    min: sorted[0],
    max: sorted[n - 1],
    range: sorted[n - 1] - sorted[0],
    q1: roundTo(q1, 4),
    q2: roundTo(q2, 4),
    q3: roundTo(q3, 4),
    skewness: roundTo(skewness, 4),
    kurtosis: roundTo(kurtosis, 4),
  };
}

export function calculatePercentiles(values: number[], percentiles: number[]): Record<number, number> {
  const sorted = [...values].sort((a, b) => a - b);
  const result: Record<number, number> = {};

  percentiles.forEach(p => {
    const index = (p / 100) * (sorted.length - 1);
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    const fraction = index - lower;

    result[p] = sorted[lower] + fraction * (sorted[upper] - sorted[lower]);
  });

  return result;
}

export function detectOutliers(values: number[], q1: number, q3: number): number[] {
  const iqr = q3 - q1;
  const lowerBound = q1 - 1.5 * iqr;
  const upperBound = q3 + 1.5 * iqr;

  return values.filter(val => val < lowerBound || val > upperBound);
}

export function calculateCorrelation(x: number[], y: number[]): number {
  const n = Math.min(x.length, y.length);
  if (n === 0) return 0;

  const meanX = x.reduce((acc, val) => acc + val, 0) / n;
  const meanY = y.reduce((acc, val) => acc + val, 0) / n;

  let numerator = 0;
  let sumXSquared = 0;
  let sumYSquared = 0;

  for (let i = 0; i < n; i++) {
    const dx = x[i] - meanX;
    const dy = y[i] - meanY;
    numerator += dx * dy;
    sumXSquared += dx * dx;
    sumYSquared += dy * dy;
  }

  const denominator = Math.sqrt(sumXSquared * sumYSquared);
  return denominator === 0 ? 0 : numerator / denominator;
}

export function roundTo(value: number, decimals: number): number {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

// ============================================================================
