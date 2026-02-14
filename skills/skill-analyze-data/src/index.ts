#!/usr/bin/env bun

/**
 * Analyze Data Skill
 *
 * Comprehensive data analysis for CSV and JSON files with statistics,
 * quality checks, correlation detection, and trend analysis.
 */

import { readFileSync, writeFileSync, statSync, appendFileSync, mkdirSync, existsSync } from 'fs';
import { basename, resolve, extname, join } from 'path';
import { parseArgs } from 'util';
import { randomUUID } from 'crypto';

// ============================================================================
// Constants & Logging
// ============================================================================

const SKILL_NAME = "analyze-data";
const SESSION_ID = randomUUID().slice(0, 8);
const SKILLS_OUTPUT_DIR = process.env.SKILLS_OUTPUT_DIR || join(process.cwd(), ".skills");
const LOGS_DIR = join(SKILLS_OUTPUT_DIR, "logs", SKILL_NAME);
const LOG_FILE = join(LOGS_DIR, `${new Date().toISOString().replace(/[:.]/g, "_").slice(0, 19)}_${SESSION_ID}.log`);

function ensureDir(dir: string) {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function log(message: string, level: "info" | "error" | "success" = "info") {
  ensureDir(LOGS_DIR);
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] [${level.toUpperCase()}] ${message}\n`;
  appendFileSync(LOG_FILE, logMessage);

  const prefixes = { 
    info: "ℹ️ ", 
    error: "❌ ", 
    success: "✅ " 
  };

  if (level === "error") {
    console.error(`${prefixes[level]} ${message}`);
  } else {
    console.log(`${prefixes[level]} ${message}`);
  }
}

// ============================================================================
// Types and Interfaces
// ============================================================================

interface AnalysisOptions {
  format: 'markdown' | 'json' | 'html';
  output?: string;
  correlations: boolean;
  outliers: boolean;
  trends: boolean;
  sample?: number;
  percentiles: number[];
  verbose: boolean;
}

interface ColumnStats {
  name: string;
  dataType: 'numeric' | 'string' | 'date' | 'boolean' | 'mixed';
  count: number;
  nullCount: number;
  nullPercentage: number;
  uniqueCount: number;
  uniquePercentage: number;
  sampleValues: any[];

  // Numeric stats
  mean?: number;
  median?: number;
  mode?: number | number[];
  stdDev?: number;
  variance?: number;
  min?: number;
  max?: number;
  range?: number;
  q1?: number;
  q2?: number;
  q3?: number;
  percentiles?: Record<number, number>;
  skewness?: number;
  kurtosis?: number;
  outliers?: number[];

  // String stats
  avgLength?: number;
  minLength?: number;
  maxLength?: number;

  // Distribution
  distribution?: Record<string, number>;
  topValues?: Array<{ value: any; count: number; percentage: number }>;
}

interface AnalysisReport {
  overview: {
    fileName: string;
    fileSize: string;
    fileType: string;
    rowCount: number;
    columnCount: number;
    memoryUsage: string;
    processingTime: number;
    timestamp: string;
  };
  columns: ColumnStats[];
  correlations?: number[][];
  correlationPairs?: Array<{ col1: string; col2: string; correlation: number }>;
  quality: {
    totalCells: number;
    missingCells: number;
    missingPercentage: number;
    duplicateRows: number;
    duplicatePercentage: number;
    dataQualityScore: number;
    issues: string[];
  };
  trends?: {
    detected: boolean;
    patterns: string[];
    insights: string[];
  };
  visualizationRecommendations: Array<{
    column: string;
    chartType: string;
    reason: string;
  }>;
  insights: string[];
}

// ============================================================================
// Utility Functions
// ============================================================================

function parseArguments(): { filePath: string; options: AnalysisOptions } {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: {
      format: { type: 'string', default: 'markdown' },
      output: { type: 'string' },
      correlations: { type: 'boolean', default: false },
      outliers: { type: 'boolean', default: false },
      trends: { type: 'boolean', default: false },
      sample: { type: 'string' },
      percentiles: { type: 'string', default: '25,50,75,90,95' },
      verbose: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h' },
    },
    allowPositionals: true,
  });

  if (values.help) {
    console.log(`
Analyze Data - Comprehensive data analysis for CSV and JSON files

Usage:
  skills run analyze-data -- <file-path> [options]

Options:
  --format <fmt>       Output format: markdown, json, html (default: markdown)
  --output <path>      Save report to file
  --correlations       Calculate correlations
  --outliers           Detect outliers
  --trends             Detect trends
  --sample <n>         Analyze only first n rows
  --percentiles <list> Comma-separated percentiles (default: 25,50,75,90,95)
  --verbose            Show detailed progress
  --help, -h           Show this help
`);
    process.exit(0);
  }

  if (positionals.length === 0) {
    log('Error: File path is required', 'error');
    console.log('Usage: skills run analyze-data -- <file-path> [options]');
    process.exit(1);
  }

  const filePath = resolve(process.cwd(), positionals[0]);
  
  return { 
    filePath, 
    options: {
      format: values.format as 'markdown' | 'json' | 'html',
      output: values.output as string,
      correlations: values.correlations as boolean,
      outliers: values.outliers as boolean,
      trends: values.trends as boolean,
      sample: values.sample ? parseInt(values.sample as string) : undefined,
      percentiles: (values.percentiles as string).split(',').map(Number),
      verbose: values.verbose as boolean,
    }
  };
}

function parseCSV(content: string): any[] {
  const lines = content.split('\n').filter(line => line.trim());
  if (lines.length === 0) return [];

  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
  const data: any[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    if (values.length === headers.length) {
      const row: any = {};
      headers.forEach((header, idx) => {
        row[header] = values[idx];
      });
      data.push(row);
    }
  }

  return data;
}

function parseCSVLine(line: string): string[] {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      values.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }

  values.push(current.trim());
  return values.map(v => v.replace(/^"|"$/g, ''));
}

function parseJSON(content: string): any[] {
  const parsed = JSON.parse(content);

  if (Array.isArray(parsed)) {
    return parsed;
  } else if (parsed.data && Array.isArray(parsed.data)) {
    return parsed.data;
  } else if (typeof parsed === 'object') {
    // Convert object to array of key-value pairs
    return Object.entries(parsed).map(([key, value]) => ({ key, value }));
  }

  throw new Error('Unsupported JSON structure');
}

function detectDataType(values: any[]): ColumnStats['dataType'] {
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

function calculateStats(values: number[]): Partial<ColumnStats> {
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

function calculatePercentiles(values: number[], percentiles: number[]): Record<number, number> {
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

function detectOutliers(values: number[], q1: number, q3: number): number[] {
  const iqr = q3 - q1;
  const lowerBound = q1 - 1.5 * iqr;
  const upperBound = q3 + 1.5 * iqr;

  return values.filter(val => val < lowerBound || val > upperBound);
}

function calculateCorrelation(x: number[], y: number[]): number {
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

function roundTo(value: number, decimals: number): number {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

// ============================================================================
// Analysis Functions
// ============================================================================

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
// Output Formatters
// ============================================================================

function formatMarkdown(report: AnalysisReport): string {
  let md = '# Data Analysis Report\n\n';

  md += `**Generated**: ${report.overview.timestamp}  \n`;
  md += `**Processing Time**: ${report.overview.processingTime}ms\n\n`;

  // Overview
  md += '## Dataset Overview\n\n';
  md += `- **File**: ${report.overview.fileName}\n`;
  md += `- **Size**: ${report.overview.fileSize}\n`;
  md += `- **Type**: ${report.overview.fileType}\n`;
  md += `- **Rows**: ${report.overview.rowCount.toLocaleString()}\n`;
  md += `- **Columns**: ${report.overview.columnCount}\n`;
  md += `- **Memory Usage**: ${report.overview.memoryUsage}\n\n`;

  // Column Analysis
  md += '## Column Analysis\n\n';

  report.columns.forEach(col => {
    md += `### ${col.name}\n\n`;
    md += `- **Type**: ${col.dataType}\n`;
    md += `- **Count**: ${col.count.toLocaleString()}\n`;
    md += `- **Null**: ${col.nullCount} (${col.nullPercentage}%)\n`;
    md += `- **Unique**: ${col.uniqueCount} (${col.uniquePercentage}%)\n`;
    md += `- **Sample**: ${col.sampleValues.join(', ')}\n`;

    if (col.dataType === 'numeric') {
      md += '\n**Statistics**:\n\n';
      md += `| Metric | Value |\n`;
      md += `|--------|-------|\n`;
      md += `| Mean | ${col.mean} |\n`;
      md += `| Median | ${col.median} |\n`;
      md += `| Std Dev | ${col.stdDev} |\n`;
      md += `| Min | ${col.min} |\n`;
      md += `| Max | ${col.max} |\n`;
      md += `| Q1 | ${col.q1} |\n`;
      md += `| Q3 | ${col.q3} |\n`;

      if (col.outliers && col.outliers.length > 0) {
        md += `\n**Outliers**: ${col.outliers.length} detected\n`;
      }
    }

    if (col.topValues && col.topValues.length > 0) {
      md += '\n**Top Values**:\n\n';
      md += `| Value | Count | Percentage |\n`;
      md += `|-------|-------|------------|\n`;
      col.topValues.forEach(tv => {
        md += `| ${tv.value} | ${tv.count} | ${tv.percentage}% |\n`;
      });
    }

    md += '\n';
  });

  // Correlations
  if (report.correlationPairs && report.correlationPairs.length > 0) {
    md += '## Correlation Analysis\n\n';
    md += '**Strong Correlations** (|r| > 0.5):\n\n';
    md += `| Column 1 | Column 2 | Correlation |\n`;
    md += `|----------|----------|-------------|\n`;
    report.correlationPairs.forEach(pair => {
      md += `| ${pair.col1} | ${pair.col2} | ${pair.correlation} |\n`;
    });
    md += '\n';
  }

  // Data Quality
  md += '## Data Quality\n\n';
  md += `- **Quality Score**: ${report.quality.dataQualityScore}/100\n`;
  md += `- **Missing Cells**: ${report.quality.missingCells} (${report.quality.missingPercentage}%)\n`;
  md += `- **Duplicate Rows**: ${report.quality.duplicateRows} (${report.quality.duplicatePercentage}%)\n\n`;

  if (report.quality.issues.length > 0) {
    md += '**Issues Found**:\n\n';
    report.quality.issues.forEach(issue => {
      md += `- ${issue}\n`;
    });
    md += '\n';
  }

  // Visualization Recommendations
  if (report.visualizationRecommendations.length > 0) {
    md += '## Visualization Recommendations\n\n';
    md += `| Column | Chart Type | Reason |\n`;
    md += `|--------|------------|--------|\n`;
    report.visualizationRecommendations.forEach(rec => {
      md += `| ${rec.column} | ${rec.chartType} | ${rec.reason} |\n`;
    });
    md += '\n';
  }

  // Insights
  if (report.insights.length > 0) {
    md += '## Key Insights\n\n';
    report.insights.forEach((insight, idx) => {
      md += `${idx + 1}. ${insight}\n`;
    });
    md += '\n';
  }

  md += '---\n\n';
  md += '*Generated by skills.md/analyze-data*\n';

  return md;
}

function formatHTML(report: AnalysisReport): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Data Analysis Report - ${report.overview.fileName}</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            line-height: 1.6;
            color: #333;
            background: #f5f5f5;
            padding: 20px;
        }
        .container { max-width: 1200px; margin: 0 auto; background: white; padding: 40px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        h1 { color: #2563eb; border-bottom: 3px solid #2563eb; padding-bottom: 10px; margin-bottom: 20px; }
        h2 { color: #1e40af; margin-top: 30px; margin-bottom: 15px; border-left: 4px solid #2563eb; padding-left: 10px; }
        h3 { color: #3b82f6; margin-top: 20px; margin-bottom: 10px; }
        .meta { color: #666; font-size: 14px; margin-bottom: 30px; }
        .overview { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin-bottom: 30px; }
        .overview-item { background: #f8fafc; padding: 15px; border-radius: 6px; border-left: 3px solid #2563eb; }
        .overview-item strong { display: block; color: #1e40af; margin-bottom: 5px; }
        table { width: 100%; border-collapse: collapse; margin: 15px 0; }
        th, td { padding: 12px; text-align: left; border-bottom: 1px solid #e5e7eb; }
        th { background: #f8fafc; color: #1e40af; font-weight: 600; }
        tr:hover { background: #f8fafc; }
        .quality-score { font-size: 48px; font-weight: bold; color: #10b981; text-align: center; margin: 20px 0; }
        .quality-score.medium { color: #f59e0b; }
        .quality-score.low { color: #ef4444; }
        .issue { background: #fef2f2; border-left: 3px solid #ef4444; padding: 10px; margin: 5px 0; border-radius: 4px; }
        .insight { background: #f0f9ff; border-left: 3px solid #3b82f6; padding: 10px; margin: 5px 0; border-radius: 4px; }
        .column-card { background: #fafafa; padding: 20px; margin: 15px 0; border-radius: 6px; border: 1px solid #e5e7eb; }
        .badge { display: inline-block; padding: 4px 8px; border-radius: 4px; font-size: 12px; font-weight: 600; margin-right: 5px; }
        .badge.numeric { background: #dbeafe; color: #1e40af; }
        .badge.string { background: #fce7f3; color: #9f1239; }
        .badge.date { background: #d1fae5; color: #065f46; }
        .badge.boolean { background: #fef3c7; color: #92400e; }
        footer { text-align: center; margin-top: 40px; padding-top: 20px; border-top: 1px solid #e5e7eb; color: #666; font-size: 14px; }
    </style>
</head>
<body>
    <div class="container">
        <h1>📊 Data Analysis Report</h1>
        <div class="meta">
            Generated: ${report.overview.timestamp} | Processing Time: ${report.overview.processingTime}ms
        </div>

        <h2>Dataset Overview</h2>
        <div class="overview">
            <div class="overview-item"><strong>File</strong>${report.overview.fileName}</div>
            <div class="overview-item"><strong>Size</strong>${report.overview.fileSize}</div>
            <div class="overview-item"><strong>Type</strong>${report.overview.fileType}</div>
            <div class="overview-item"><strong>Rows</strong>${report.overview.rowCount.toLocaleString()}</div>
            <div class="overview-item"><strong>Columns</strong>${report.overview.columnCount}</div>
            <div class="overview-item"><strong>Memory</strong>${report.overview.memoryUsage}</div>
        </div>

        <h2>Data Quality</h2>
        <div class="quality-score ${report.quality.dataQualityScore >= 70 ? '' : report.quality.dataQualityScore >= 50 ? 'medium' : 'low'}">
            ${report.quality.dataQualityScore}/100
        </div>
        <table>
            <tr><th>Metric</th><th>Value</th></tr>
            <tr><td>Missing Cells</td><td>${report.quality.missingCells} (${report.quality.missingPercentage}%)</td></tr>
            <tr><td>Duplicate Rows</td><td>${report.quality.duplicateRows} (${report.quality.duplicatePercentage}%)</td></tr>
        </table>
        ${report.quality.issues.length > 0 ? `
            <h3>Issues Found</h3>
            ${report.quality.issues.map(issue => `<div class="issue">${issue}</div>`).join('')}
        ` : ''}

        <h2>Column Analysis</h2>
        ${report.columns.map(col => `
            <div class="column-card">
                <h3>${col.name} <span class="badge ${col.dataType}">${col.dataType}</span></h3>
                <table>
                    <tr><td><strong>Count</strong></td><td>${col.count.toLocaleString()}</td></tr>
                    <tr><td><strong>Null</strong></td><td>${col.nullCount} (${col.nullPercentage}%)</td></tr>
                    <tr><td><strong>Unique</strong></td><td>${col.uniqueCount} (${col.uniquePercentage}%)</td></tr>
                    ${col.dataType === 'numeric' ? `
                        <tr><td><strong>Mean</strong></td><td>${col.mean}</td></tr>
                        <tr><td><strong>Median</strong></td><td>${col.median}</td></tr>
                        <tr><td><strong>Std Dev</strong></td><td>${col.stdDev}</td></tr>
                        <tr><td><strong>Min / Max</strong></td><td>${col.min} / ${col.max}</td></tr>
                        <tr><td><strong>Q1 / Q3</strong></td><td>${col.q1} / ${col.q3}</td></tr>
                    ` : ''}
                </table>
            </div>
        `).join('')}

        ${report.correlationPairs && report.correlationPairs.length > 0 ? `
            <h2>Correlation Analysis</h2>
            <table>
                <tr><th>Column 1</th><th>Column 2</th><th>Correlation</th></tr>
                ${report.correlationPairs.map(pair => `
                    <tr><td>${pair.col1}</td><td>${pair.col2}</td><td>${pair.correlation}</td></tr>
                `).join('')}
            </table>
        ` : ''}

        ${report.visualizationRecommendations.length > 0 ? `
            <h2>Visualization Recommendations</h2>
            <table>
                <tr><th>Column</th><th>Chart Type</th><th>Reason</th></tr>
                ${report.visualizationRecommendations.map(rec => `
                    <tr><td>${rec.column}</td><td>${rec.chartType}</td><td>${rec.reason}</td></tr>
                `).join('')}
            </table>
        ` : ''}

        ${report.insights.length > 0 ? `
            <h2>Key Insights</h2>
            ${report.insights.map(insight => `<div class="insight">${insight}</div>`).join('')}
        ` : ''}

        <footer>
            Generated by <strong>skills.md/analyze-data</strong>
        </footer>
    </div>
</body>
</html>`;
}

// ============================================================================
// Main Analysis Function
// ============================================================================

async function analyzeData(filePath: string, options: AnalysisOptions): Promise<AnalysisReport> {
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
// Main Entry Point
// ============================================================================

async function main() {
  try {
    log(`Starting ${SKILL_NAME} session: ${SESSION_ID}`);
    const { filePath, options } = parseArguments();

    // Check if file exists
    try {
      statSync(filePath);
    } catch {
      log(`Error: File not found: ${filePath}`, 'error');
      process.exit(1);
    }

    // Perform analysis
    const report = await analyzeData(filePath, options);

    // Format output
    let output: string;
    switch (options.format) {
      case 'json':
        output = JSON.stringify(report, null, 2);
        break;
      case 'html':
        output = formatHTML(report);
        break;
      default:
        output = formatMarkdown(report);
    }

    // Save or print
    if (options.output) {
      const outputPath = resolve(process.cwd(), options.output);
      writeFileSync(outputPath, output, 'utf-8');
      log(`Report saved to: ${outputPath}`, 'success');
    } else {
      console.log(output);
    }

    // Show summary in verbose mode
    if (options.verbose) {
      log('Analysis Complete', 'success');
      log(`Rows: ${report.overview.rowCount}`);
      log(`Columns: ${report.overview.columnCount}`);
      log(`Quality Score: ${report.quality.dataQualityScore}/100`);
      log(`Processing Time: ${report.overview.processingTime}ms`);
    }

  } catch (error) {
    log(`Error: ${error instanceof Error ? error.message : String(error)}`, 'error');
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.main) {
  main();
}
