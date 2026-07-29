import { readFileSync, statSync } from 'fs';
import { basename, extname } from 'path';

import { parseCSV, parseJSON } from './parsers';
import { log } from './logger';
import {
  calculateCorrelation,
  calculatePercentiles,
  calculateStats,
  detectDataType,
  detectOutliers,
  formatBytes,
  roundTo,
} from './stats';
import type { AnalysisOptions, AnalysisReport, ColumnStats } from './types';

function analyzeColumn(columnName: string, values: any[], options: AnalysisOptions): ColumnStats {
  const dataType = detectDataType(values);
  const nonNullValues = values.filter(v => v !== null && v !== undefined && v !== '');
  const nullCount = values.length - nonNullValues.length;

  const uniqueValues = new Set(nonNullValues);
  const stats: ColumnStats = {
    name: columnName,
    dataType,
    count: values.length,
    nullCount,
    nullPercentage: roundTo((nullCount / values.length) * 100, 2),
    uniqueCount: uniqueValues.size,
    uniquePercentage: roundTo((uniqueValues.size / nonNullValues.length) * 100, 2),
    sampleValues: nonNullValues.slice(0, 5),
  };

  // Numeric analysis
  if (dataType === 'numeric') {
    const numericValues = nonNullValues.map(Number).filter(v => !isNaN(v));
    Object.assign(stats, calculateStats(numericValues));

    if (options.percentiles.length > 0) {
      stats.percentiles = calculatePercentiles(numericValues, options.percentiles);
    }

    if (options.outliers && stats.q1 !== undefined && stats.q3 !== undefined) {
      stats.outliers = detectOutliers(numericValues, stats.q1, stats.q3);
    }
  }

  // String analysis
  if (dataType === 'string') {
    const lengths = nonNullValues.map(v => String(v).length);
    stats.avgLength = roundTo(lengths.reduce((a, b) => a + b, 0) / lengths.length, 2);
    stats.minLength = Math.min(...lengths);
    stats.maxLength = Math.max(...lengths);
  }

  // Distribution (for categorical data)
  if (uniqueValues.size <= 50) {
    const distribution: Record<string, number> = {};
    nonNullValues.forEach(val => {
      const key = String(val);
      distribution[key] = (distribution[key] || 0) + 1;
    });
    stats.distribution = distribution;

    const topValues = Object.entries(distribution)
      .map(([value, count]) => ({
        value,
        count,
        percentage: roundTo((count / nonNullValues.length) * 100, 2),
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    stats.topValues = topValues;
  }

  return stats;
}

function analyzeCorrelations(data: any[], numericColumns: string[]): {
  matrix: number[][];
  pairs: Array<{ col1: string; col2: string; correlation: number }>;
} {
  const n = numericColumns.length;
  const matrix: number[][] = Array(n).fill(0).map(() => Array(n).fill(0));
  const pairs: Array<{ col1: string; col2: string; correlation: number }> = [];

  for (let i = 0; i < n; i++) {
    for (let j = i; j < n; j++) {
      if (i === j) {
        matrix[i][j] = 1;
      } else {
        const col1Values = data.map(row => Number(row[numericColumns[i]])).filter(v => !isNaN(v));
        const col2Values = data.map(row => Number(row[numericColumns[j]])).filter(v => !isNaN(v));

        const correlation = calculateCorrelation(col1Values, col2Values);
        matrix[i][j] = roundTo(correlation, 4);
        matrix[j][i] = roundTo(correlation, 4);

        if (Math.abs(correlation) > 0.5) {
          pairs.push({
            col1: numericColumns[i],
            col2: numericColumns[j],
            correlation: roundTo(correlation, 4),
          });
        }
      }
    }
  }

  pairs.sort((a, b) => Math.abs(b.correlation) - Math.abs(a.correlation));

  return { matrix, pairs };
}

function detectTrends(data: any[], columnStats: ColumnStats[]): {
  detected: boolean;
  patterns: string[];
  insights: string[];
} {
  const patterns: string[] = [];
  const insights: string[] = [];

  // Check for time-series columns
  const dateColumns = columnStats.filter(col => col.dataType === 'date');
  const numericColumns = columnStats.filter(col => col.dataType === 'numeric');

  if (dateColumns.length > 0 && numericColumns.length > 0) {
    patterns.push('Time-series data detected');
    insights.push('Consider visualizing trends over time');
  }

  // Check for monotonic trends
  numericColumns.forEach(col => {
    if (col.skewness && Math.abs(col.skewness) > 1) {
      patterns.push(`${col.name} shows ${col.skewness > 0 ? 'positive' : 'negative'} skew`);
    }
  });

  return {
    detected: patterns.length > 0,
    patterns,
    insights,
  };
}

function generateVisualizationRecommendations(columnStats: ColumnStats[]): Array<{
  column: string;
  chartType: string;
  reason: string;
}> {
  const recommendations: Array<{ column: string; chartType: string; reason: string }> = [];

  columnStats.forEach(col => {
    if (col.dataType === 'numeric') {
      if (col.uniqueCount > 20) {
        recommendations.push({
          column: col.name,
          chartType: 'Histogram',
          reason: 'Shows distribution of continuous numeric values',
        });
      } else {
        recommendations.push({
          column: col.name,
          chartType: 'Bar Chart',
          reason: 'Shows distribution of discrete numeric values',
        });
      }
    } else if (col.dataType === 'string' && col.uniqueCount <= 20) {
      recommendations.push({
        column: col.name,
        chartType: 'Pie Chart / Bar Chart',
        reason: 'Shows category distribution',
      });
    } else if (col.dataType === 'date') {
      recommendations.push({
        column: col.name,
        chartType: 'Line Chart',
        reason: 'Shows trends over time',
      });
    }
  });

  return recommendations;
}

function calculateDataQuality(columnStats: ColumnStats[], data: any[]): {
  totalCells: number;
  missingCells: number;
  missingPercentage: number;
  duplicateRows: number;
  duplicatePercentage: number;
  dataQualityScore: number;
  issues: string[];
} {
  const totalCells = data.length * columnStats.length;
  const missingCells = columnStats.reduce((sum, col) => sum + col.nullCount, 0);
  const missingPercentage = roundTo((missingCells / totalCells) * 100, 2);

  // Detect duplicates
  const rowStrings = data.map(row => JSON.stringify(row));
  const uniqueRows = new Set(rowStrings);
  const duplicateRows = data.length - uniqueRows.size;
  const duplicatePercentage = roundTo((duplicateRows / data.length) * 100, 2);

  // Quality issues
  const issues: string[] = [];

  if (missingPercentage > 10) {
    issues.push(`High missing data rate: ${missingPercentage}%`);
  }

  if (duplicateRows > 0) {
    issues.push(`${duplicateRows} duplicate rows found`);
  }

  columnStats.forEach(col => {
    if (col.dataType === 'mixed') {
      issues.push(`Column "${col.name}" has mixed data types`);
    }
    if (col.nullPercentage > 50) {
      issues.push(`Column "${col.name}" has ${col.nullPercentage}% missing values`);
    }
  });

  // Calculate quality score (0-100)
  let score = 100;
  score -= Math.min(missingPercentage * 2, 30);
  score -= Math.min(duplicatePercentage * 1.5, 20);
  score -= Math.min(issues.length * 5, 30);

  return {
    totalCells,
    missingCells,
    missingPercentage,
    duplicateRows,
    duplicatePercentage,
    dataQualityScore: Math.max(0, Math.round(score)),
    issues,
  };
}

function generateInsights(report: AnalysisReport): string[] {
  const insights: string[] = [];

  // Dataset size insights
  if (report.overview.rowCount < 100) {
    insights.push('Small dataset - consider collecting more data for robust analysis');
  } else if (report.overview.rowCount > 10000) {
    insights.push('Large dataset - suitable for machine learning applications');
  }

  // Data quality insights
  if (report.quality.dataQualityScore >= 90) {
    insights.push('Excellent data quality - ready for analysis');
  } else if (report.quality.dataQualityScore >= 70) {
    insights.push('Good data quality - minor cleaning recommended');
  } else {
    insights.push('Data quality issues detected - cleaning required before analysis');
  }

  // Column insights
  const numericCols = report.columns.filter(col => col.dataType === 'numeric');
  const categoricalCols = report.columns.filter(col => col.dataType === 'string' && (col.uniqueCount || 0) <= 20);

  if (numericCols.length > 3) {
    insights.push(`${numericCols.length} numeric columns - suitable for correlation and regression analysis`);
  }

  if (categoricalCols.length > 0) {
    insights.push(`${categoricalCols.length} categorical columns - consider segmentation analysis`);
  }

  // Correlation insights
  if (report.correlationPairs && report.correlationPairs.length > 0) {
    const strongPairs = report.correlationPairs.filter(p => Math.abs(p.correlation) > 0.7);
    if (strongPairs.length > 0) {
      insights.push(`${strongPairs.length} strong correlations found - potential feature engineering opportunities`);
    }
  }

  // Outlier insights
  const colsWithOutliers = report.columns.filter(col => col.outliers && col.outliers.length > 0);
  if (colsWithOutliers.length > 0) {
    insights.push(`Outliers detected in ${colsWithOutliers.length} columns - review for data errors or special cases`);
  }

  return insights;
}

// ============================================================================

export async function analyzeData(filePath: string, options: AnalysisOptions): Promise<AnalysisReport> {
  const startTime = Date.now();

  // Read file
  if (options.verbose) {
    log(`Reading file: ${filePath}`);
  }

  const fileStats = statSync(filePath);
  const fileExt = extname(filePath).toLowerCase();
  const content = readFileSync(filePath, 'utf-8');

  // Parse data
  let data: any[];
  if (fileExt === '.csv') {
    data = parseCSV(content);
  } else if (fileExt === '.json') {
    data = parseJSON(content);
  } else {
    throw new Error(`Unsupported file type: ${fileExt}`);
  }

  // Apply sampling
  if (options.sample && data.length > options.sample) {
    if (options.verbose) {
      log(`Sampling first ${options.sample} rows out of ${data.length}`);
    }
    data = data.slice(0, options.sample);
  }

  if (data.length === 0) {
    throw new Error('No data found in file');
  }

  // Get column names
  const columnNames = Object.keys(data[0]);

  if (options.verbose) {
    log(`Analyzing ${data.length} rows and ${columnNames.length} columns...`);
  }

  // Analyze each column
  const columnStats: ColumnStats[] = columnNames.map(colName => {
    const values = data.map(row => row[colName]);
    return analyzeColumn(colName, values, options);
  });

  // Correlation analysis
  let correlations: number[][] | undefined;
  let correlationPairs: Array<{ col1: string; col2: string; correlation: number }> | undefined;

  if (options.correlations) {
    const numericColumns = columnStats
      .filter(col => col.dataType === 'numeric')
      .map(col => col.name);

    if (numericColumns.length >= 2) {
      if (options.verbose) {
        log(`Calculating correlations for ${numericColumns.length} numeric columns...`);
      }
      const corrResult = analyzeCorrelations(data, numericColumns);
      correlations = corrResult.matrix;
      correlationPairs = corrResult.pairs;
    }
  }

  // Trend analysis
  let trends: AnalysisReport['trends'];
  if (options.trends) {
    if (options.verbose) {
      log('Analyzing trends...');
    }
    trends = detectTrends(data, columnStats);
  }

  // Data quality
  const quality = calculateDataQuality(columnStats, data);

  // Visualization recommendations
  const visualizationRecommendations = generateVisualizationRecommendations(columnStats);

  // Build report
  const report: AnalysisReport = {
    overview: {
      fileName: basename(filePath),
      fileSize: formatBytes(fileStats.size),
      fileType: fileExt.slice(1).toUpperCase(),
      rowCount: data.length,
      columnCount: columnNames.length,
      memoryUsage: formatBytes(JSON.stringify(data).length),
      processingTime: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    },
    columns: columnStats,
    correlations,
    correlationPairs,
    quality,
    trends,
    visualizationRecommendations,
    insights: [],
  };

  // Generate insights
  report.insights = generateInsights(report);

  return report;
}

// ============================================================================
