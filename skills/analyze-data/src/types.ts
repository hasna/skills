export interface AnalysisOptions {
  format: 'markdown' | 'json' | 'html';
  output?: string;
  correlations: boolean;
  outliers: boolean;
  trends: boolean;
  sample?: number;
  percentiles: number[];
  verbose: boolean;
}

export interface ColumnStats {
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

export interface AnalysisReport {
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
