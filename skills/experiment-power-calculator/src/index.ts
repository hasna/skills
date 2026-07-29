#!/usr/bin/env bun
import { parseArgs } from "util";
import * as math from "mathjs";

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    test: { type: "string", default: "t-test" },
    "effect-size": { type: "string" }, // Cohen's d
    power: { type: "string", default: "0.8" },
    alpha: { type: "string", default: "0.05" },
    help: { type: "boolean" },
  },
  allowPositionals: true,
});

if (values.help || !values["effect-size"]) {
  console.log(`
Experiment Power Calculator
Usage: skills run experiment-power-calculator --effect-size <d> [options]

Options:
  --test <type>        Test type (t-test) [currently only t-test supported]
  --effect-size <d>    Cohen's d (0.2 small, 0.5 medium, 0.8 large)
  --power <p>          Desired power (default: 0.8)
  --alpha <a>          Significance level (default: 0.05)
`);
  process.exit(0);
}

const d = parseFloat(values["effect-size"] as string);
const power = parseFloat(values.power as string);
const alpha = parseFloat(values.alpha as string);

// Simple approximation for Independent Samples T-Test Sample Size (per group)
// N = 2 * ( (Z_alpha + Z_beta) / d )^2
// Z_alpha for two-tailed 0.05 is ~1.96
// Z_beta for 0.8 power is ~0.84

function getZScore(p: number): number {
  // Approximation of inverse CDF for normal distribution
  // This is a simplified lookup for common values
  if (p === 0.05) return 1.96; // Two-tailed alpha
  if (p === 0.01) return 2.58;
  if (p === 0.80) return 0.84; // Power
  if (p === 0.90) return 1.28;
  if (p === 0.95) return 1.645;
  
  // Fallback approximation
  return Math.sqrt(2) * math.erfinv(2 * p - 1); // Requires mathjs erfinv if available, or just use approximation
}

// Using a standard approximation formula for N per group
// Lehr's Formula: N = 16 / d^2 (for alpha=0.05, power=0.8)
// More general: N = 2 * ( (z_alpha/2 + z_beta) / d )^2

const z_alpha = 1.96; // Assumes 0.05 two-tailed
const z_beta = 0.84;  // Assumes 0.80 power

let n = 0;

if (values.test === "t-test") {
    // Using Lehr's formula as a baseline if standard params
    if (alpha === 0.05 && power === 0.8) {
        n = 16 / (d * d);
    } else {
        // General approximation
        // We need inverse normal distribution. 
        // Let's use a hardcoded lookup for common power values to keep it simple without heavy stats lib
        const z_b = power === 0.9 ? 1.28 : (power === 0.95 ? 1.645 : 0.84);
        const z_a = alpha === 0.01 ? 2.58 : 1.96;
        
        n = 2 * Math.pow((z_a + z_b) / d, 2);
    }
}

console.log(`
Sample Size Calculation (${values.test})
---------------------------------------
Effect Size (d): ${d}
Power:           ${power}
Alpha:           ${alpha}

Required Sample Size (per group): ${Math.ceil(n)}
Total Sample Size:                ${Math.ceil(n) * 2}
`);