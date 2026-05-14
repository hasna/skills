import { mathConfig } from "./runtime";
import type { MathOptions, NumberFormat, Result } from "./types";

// ============================================================================
// Formatting Functions
// ============================================================================
export function formatNumber(value: any, format: NumberFormat, precision: number): string {
  // Convert mathjs BigNumber to regular number
  let num: number;
  if (value && typeof value === "object" && "toNumber" in value) {
    num = value.toNumber();
  } else if (typeof value === "number") {
    num = value;
  } else {
    num = Number(value);
  }

  switch (format) {
    case "scientific":
      return num.toExponential(precision);

    case "fraction":
      return mathConfig.format(mathConfig.fraction(num), { precision });

    case "percentage":
      return (num * 100).toFixed(precision) + "%";

    case "number":
    default:
      return num.toFixed(precision);
  }
}

export function formatResult(result: Result, options: MathOptions): string {
  // Helper to convert BigNumber to string
  const toString = (val: any): string => {
    if (val && typeof val === "object" && "toString" in val) {
      return val.toString();
    }
    return String(val);
  };

  if (options.output === "json") {
    // Convert BigNumbers to strings for JSON
    const jsonResult = JSON.parse(JSON.stringify(result, (key, value) => {
      if (value && typeof value === "object" && "toString" in value) {
        return value.toString();
      }
      return value;
    }));
    return JSON.stringify(jsonResult, null, 2);
  }

  if (options.output === "latex" && result.latex) {
    return result.latex;
  }

  // Text format
  let output = `\n${"=".repeat(80)}\n`;
  output += `  Advanced Math - ${result.mode.toUpperCase()} Mode\n`;
  output += `${"=".repeat(80)}\n\n`;

  output += `Input: ${Array.isArray(result.input) ? result.input.join(", ") : result.input}\n\n`;

  if (typeof result.output === "object" && !Array.isArray(result.output) && result.output !== null && !("toNumber" in result.output)) {
    output += "Results:\n";
    for (const [key, value] of Object.entries(result.output)) {
      if (typeof value === "object" && value !== null && !("toNumber" in value)) {
        output += `  ${key}:\n`;
        for (const [k, v] of Object.entries(value as any)) {
          output += `    ${k}: ${toString(v)}\n`;
        }
      } else {
        output += `  ${key}: ${toString(value)}\n`;
      }
    }
  } else {
    output += `Result: ${result.formatted || toString(result.output)}\n`;
  }

  if (result.steps && result.steps.length > 0) {
    output += "\nSteps:\n";
    result.steps.forEach((step, i) => {
      output += `  ${i + 1}. ${step}\n`;
    });
  }

  if (result.latex) {
    output += `\nLaTeX: ${result.latex}\n`;
  }

  output += `\n${"=".repeat(80)}\n`;

  return output;
}
