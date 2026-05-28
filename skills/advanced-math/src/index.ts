#!/usr/bin/env bun
/**
 * Advanced Math Skill
 * Performs advanced mathematical calculations, symbolic math, and numerical analysis.
 */

import { writeFileSync } from "fs";
import { join } from "path";
import {
  calculateStatistics,
  evaluateExpression,
  performMatrixOperation,
} from "./calculators";
import { parseMathCli } from "./cli";
import { convertUnit } from "./conversion";
import { calculateFinance } from "./finance";
import { formatNumber, formatResult } from "./formatting";
import { EXPORTS_DIR, SESSION_ID, ensureDir, log, mathConfig } from "./runtime";
import { performSymbolicMath } from "./symbolic";
import type { Result } from "./types";

async function main() {
  const { input, mode, precision, options, positionals } = parseMathCli();

  try {
    log(`Session ID: ${SESSION_ID}`);
    log(`Mode: ${mode}`);

    let result: Result;

    switch (mode) {
      case "calc": {
        if (!input) throw new Error("Expression required for calc mode");
        const output = evaluateExpression(input, precision);
        const formatted = formatNumber(output, options.format, precision);
        result = { input, mode, output, formatted };
        break;
      }

      case "stats": {
        if (!input) throw new Error("Data required for stats mode");
        const data = input.split(",").map((value) => parseFloat(value.trim()));
        if (data.some(isNaN)) throw new Error("Invalid data: must be comma-separated numbers");
        const output = calculateStatistics(data, options.stats);
        result = { input, mode, output };
        break;
      }

      case "matrix": {
        if (!input) throw new Error("Matrix required for matrix mode");
        if (!options.matrix) throw new Error("Matrix operation required (--matrix)");

        let matrices;
        try {
          matrices = positionals.map((positional) => JSON.parse(positional));
        } catch {
          throw new Error("Invalid matrix format. Use JSON arrays e.g. [[1,2],[3,4]]");
        }
        const output = performMatrixOperation(matrices, options.matrix);
        const formatted = mathConfig.format(output, { precision });
        result = { input: positionals, mode, output, formatted };
        break;
      }

      case "convert": {
        if (!input) throw new Error("Value required for convert mode");
        if (!options.from || !options.to) throw new Error("--from and --to units required");

        const value = parseFloat(input);
        if (isNaN(value)) throw new Error("Invalid value for conversion");
        const output = convertUnit(value, options.from, options.to);
        const formatted = formatNumber(output, options.format, precision);
        result = {
          input: `${input} ${options.from}`,
          mode,
          output,
          formatted: `${formatted} ${options.to}`,
        };
        break;
      }

      case "finance": {
        if (!options.finance) throw new Error("Finance type required (--finance)");
        const output = calculateFinance(options.finance, options);
        const formatted = formatNumber(output, options.format, precision);
        result = { input: options.finance, mode, output, formatted };
        break;
      }

      case "symbolic": {
        if (!input) throw new Error("Expression required for symbolic mode");
        if (!options.operation) throw new Error("Operation required (--operation)");

        const symbolicResult = await performSymbolicMath(
          input,
          options.operation,
          options.var,
          options.showSteps
        );

        result = {
          input,
          mode,
          output: symbolicResult.result,
          steps: symbolicResult.steps,
          latex: symbolicResult.latex,
        };
        break;
      }

      default:
        throw new Error(`Unknown mode: ${mode}`);
    }

    const outputText = formatResult(result, options);
    console.log(outputText);

    if (options.output === "json" || mode === "stats") {
      const timestamp = new Date().toISOString().replace(/[:.]/g, "_").slice(0, 19);
      const outputFile = join(EXPORTS_DIR, `export_${timestamp}_${mode}.json`);
      ensureDir(EXPORTS_DIR);
      writeFileSync(outputFile, JSON.stringify(result, null, 2));
      log(`Results saved to: ${outputFile}`, "success");
    }

    log("Calculation completed successfully", "success");
  } catch (error) {
    log(`Error: ${error instanceof Error ? error.message : "Unknown error"}`, "error");
    process.exit(1);
  }
}

main();
