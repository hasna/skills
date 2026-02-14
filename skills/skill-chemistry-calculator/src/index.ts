#!/usr/bin/env bun
import { parseArgs } from "util";
import * as math from "mathjs";

const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  options: {
    mode: { type: "string", default: "mw" }, // mw (molecular weight), balance
    help: { type: "boolean" },
  },
  allowPositionals: true,
});

if (values.help || positionals.length === 0) {
  console.log(`
Chemistry Calculator
Usage: skills run chemistry-calculator -- <input> [options]

Options:
  --mode <mode>    Operation mode: mw (molecular weight), balance (balance equation)
`);
  process.exit(0);
}

const input = positionals.join(" ");

// Atomic weights (simplified)
const atomicWeights: Record<string, number> = {
  H: 1.008, He: 4.0026, Li: 6.94, Be: 9.0122, B: 10.81, C: 12.011, N: 14.007, O: 15.999,
  F: 18.998, Ne: 20.180, Na: 22.990, Mg: 24.305, Al: 26.982, Si: 28.085, P: 30.974,
  S: 32.06, Cl: 35.45, K: 39.098, Ar: 39.948, Ca: 40.078, Sc: 44.956, Ti: 47.867,
  V: 50.942, Cr: 51.996, Mn: 54.938, Fe: 55.845, Co: 58.933, Ni: 58.693, Cu: 63.546,
  Zn: 65.38, Ga: 69.723, Ge: 72.63, As: 74.922, Se: 78.96, Br: 79.904, Kr: 83.798,
  Rb: 85.468, Sr: 87.62, Y: 88.906, Zr: 91.224, Nb: 92.906, Mo: 95.95, Tc: 98,
  Ru: 101.07, Rh: 102.91, Pd: 106.42, Ag: 107.87, Cd: 112.41, In: 114.82, Sn: 118.71,
  Sb: 121.76, Te: 127.60, I: 126.90, Xe: 131.29, Cs: 132.91, Ba: 137.33, La: 138.91,
  // ... add more as needed
};

function calculateMW(formula: string): number {
  const regex = /([A-Z][a-z]*)(\d*)/g;
  let match;
  let totalWeight = 0;

  while ((match = regex.exec(formula)) !== null) {
    const element = match[1];
    const count = match[2] ? parseInt(match[2]) : 1;
    const weight = atomicWeights[element];

    if (weight) {
      totalWeight += weight * count;
    } else {
      throw new Error(`Unknown element: ${element}`);
    }
  }
  return totalWeight;
}

async function balanceEquation(equation: string): Promise<string> {
  // Using LLM for balancing as it's robust for complex equations without a heavy solver library
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return "Error: OPENAI_API_KEY required for balancing equations.";
  }

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: "You are a chemistry expert. Balance the following chemical equation. Return ONLY the balanced equation, nothing else.",
          },
          {
            role: "user",
            content: equation,
          },
        ],
        temperature: 0,
      }),
    });

    const data = await response.json();
    return data.choices[0].message.content.trim();
  } catch (e) {
    return `Error balancing equation: ${e}`;
  }
}

async function main() {
  if (values.mode === "mw") {
    try {
      const mw = calculateMW(input);
      console.log(`Molecular Weight of ${input}: ${mw.toFixed(4)} g/mol`);
    } catch (e) {
      console.error(e instanceof Error ? e.message : e);
    }
  } else if (values.mode === "balance") {
    const balanced = await balanceEquation(input);
    console.log(`Balanced Equation: ${balanced}`);
  }
}

main();