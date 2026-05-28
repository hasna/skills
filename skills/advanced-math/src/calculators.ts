import { mathConfig } from "./runtime";
import type { MatrixOperation } from "./types";

// ============================================================================
// Calculator Mode
// ============================================================================
export function evaluateExpression(expr: string, precision: number): any {
  try {
    // Configure precision
    mathConfig.config({ precision });

    const result = mathConfig.evaluate(expr);
    return result;
  } catch (error) {
    throw new Error(`Failed to evaluate expression: ${error instanceof Error ? error.message : "Unknown error"}`);
  }
}

// ============================================================================
// Statistics Mode
// ============================================================================
export function calculateStatistics(data: number[], metrics?: string): any {
  const requestedMetrics = metrics?.split(",").map(m => m.trim()) || ["all"];
  const stats: any = {};

  if (requestedMetrics.includes("all") || requestedMetrics.includes("mean")) {
    stats.mean = mathConfig.mean(data);
  }

  if (requestedMetrics.includes("all") || requestedMetrics.includes("median")) {
    stats.median = mathConfig.median(data);
  }

  if (requestedMetrics.includes("all") || requestedMetrics.includes("mode")) {
    stats.mode = mathConfig.mode(data);
  }

  if (requestedMetrics.includes("all") || requestedMetrics.includes("std")) {
    stats.std = mathConfig.std(data);
  }

  if (requestedMetrics.includes("all") || requestedMetrics.includes("variance")) {
    stats.variance = mathConfig.variance(data);
  }

  if (requestedMetrics.includes("all") || requestedMetrics.includes("min")) {
    stats.min = mathConfig.min(data);
  }

  if (requestedMetrics.includes("all") || requestedMetrics.includes("max")) {
    stats.max = mathConfig.max(data);
  }

  if (requestedMetrics.includes("all") || requestedMetrics.includes("range")) {
    stats.range = mathConfig.max(data) - mathConfig.min(data);
  }

  if (requestedMetrics.includes("all") || requestedMetrics.includes("sum")) {
    stats.sum = mathConfig.sum(data);
  }

  if (requestedMetrics.includes("all") || requestedMetrics.includes("count")) {
    stats.count = data.length;
  }

  if (requestedMetrics.includes("all") || requestedMetrics.includes("quartiles")) {
    const sorted = [...data].sort((a, b) => a - b);
    stats.quartiles = {
      q1: mathConfig.quantileSeq(sorted, 0.25),
      q2: mathConfig.quantileSeq(sorted, 0.5),
      q3: mathConfig.quantileSeq(sorted, 0.75),
    };
    stats.iqr = stats.quartiles.q3 - stats.quartiles.q1;
  }

  return stats;
}

// ============================================================================
// Matrix Mode
// ============================================================================
export function performMatrixOperation(matrices: any[], operation: MatrixOperation): any {
  const matrix1 = mathConfig.matrix(matrices[0]);

  switch (operation) {
    case "add":
      if (matrices.length < 2) throw new Error("Addition requires two matrices");
      return mathConfig.add(matrix1, mathConfig.matrix(matrices[1]));

    case "multiply":
      if (matrices.length < 2) throw new Error("Multiplication requires two matrices");
      return mathConfig.multiply(matrix1, mathConfig.matrix(matrices[1]));

    case "transpose":
      return mathConfig.transpose(matrix1);

    case "determinant":
      return mathConfig.det(matrix1);

    case "inverse":
      return mathConfig.inv(matrix1);

    case "eigenvalues":
      return mathConfig.eigs(matrix1).values;

    case "rank":
      // mathjs doesn't have rank, approximate with determinant check
      const det = mathConfig.det(matrix1);
      const size = mathConfig.size(matrix1).valueOf() as number[];
      return det !== 0 ? size[0] : "< " + size[0];

    case "trace":
      return mathConfig.trace(matrix1);

    default:
      throw new Error(`Unknown matrix operation: ${operation}`);
  }
}
