import { parseArgs } from "util";
import { log } from "./runtime";
import type {
  FinanceType,
  MathOptions,
  MatrixOperation,
  Mode,
  NumberFormat,
  OutputFormat,
  SymbolicOperation,
} from "./types";

export function parseMathCli(): { input: string; mode: Mode; precision: number; options: MathOptions; positionals: string[] } {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: {
      mode: { type: "string", default: "calc" },
      precision: { type: "string", default: "10" },
      format: { type: "string", default: "number" },
      output: { type: "string", default: "text" },
      "show-steps": { type: "boolean", default: false },
      stats: { type: "string" },
      matrix: { type: "string" },
      from: { type: "string" },
      to: { type: "string" },
      finance: { type: "string" },
      principal: { type: "string" },
      rate: { type: "string" },
      years: { type: "string" },
      periods: { type: "string" },
      payment: { type: "string" },
      cashflows: { type: "string" },
      operation: { type: "string" },
      var: { type: "string", default: "x" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
  });

  if (values.help) {
    console.log(`
╔═══════════════════════════════════════════════════════════════════════════════╗
║                        ADVANCED MATH - Calculation Engine                      ║
║     Perform complex mathematical operations, statistics, and symbolic math     ║
╚═══════════════════════════════════════════════════════════════════════════════╝

USAGE:
  skills run advanced-math -- "<expression or data>" [options]

MODES:
  calc      Basic expression evaluation and scientific calculations
  stats     Statistical analysis (mean, median, std dev, etc.)
  matrix    Matrix operations (determinant, inverse, eigenvalues)
  convert   Unit conversions (length, weight, temperature, etc.)
  finance   Financial calculations (compound interest, NPV, IRR)
  symbolic  AI-powered symbolic math (derivatives, integrals)

OPTIONS:
  --mode <mode>           Calculation mode [default: calc]
  --precision <n>         Decimal places [default: 10]
  --format <format>       Output format: number, scientific, fraction, percentage
  --output <format>       Result format: text, json, latex [default: text]
  --show-steps           Show calculation steps

CALC MODE:
  skills run advanced-math -- "2 + 2 * 3"
  skills run advanced-math -- "sin(pi/4) + cos(pi/4)"
  skills run advanced-math -- "sqrt(16) + log10(100)"

STATS MODE:
  skills run advanced-math -- "1,2,3,4,5" --mode stats
  skills run advanced-math -- "10,20,30" --mode stats --stats mean,median

MATRIX MODE:
  skills run advanced-math -- "[[1,2],[3,4]]" --mode matrix --matrix determinant
  skills run advanced-math -- "[[4,7],[2,6]]" --mode matrix --matrix inverse

CONVERT MODE:
  skills run advanced-math -- "100" --mode convert --from celsius --to fahrenheit
  skills run advanced-math -- "1" --mode convert --from kilometer --to mile

FINANCE MODE:
  skills run advanced-math -- --mode finance --finance compound --principal 1000 --rate 5 --years 10
  skills run advanced-math -- --mode finance --finance pmt --principal 200000 --rate 4.5 --years 30

SYMBOLIC MODE (requires OPENAI_API_KEY):
  skills run advanced-math -- "x^2 + 3*x" --mode symbolic --operation derivative --var x
  skills run advanced-math -- "2*x + 3" --mode symbolic --operation integral --show-steps

For full documentation, see SKILL.md
`);
    process.exit(0);
  }

  const input = positionals.join(" ");
  const mode = values.mode as Mode;
  const precision = parseInt(values.precision as string);

  if (isNaN(precision) || precision < 0 || precision > 100) {
    log("Error: Precision must be a number between 0 and 100", "error");
    process.exit(1);
  }

  return {
    input,
    mode,
    precision,
    positionals,
    options: {
      mode,
      precision,
      format: values.format as NumberFormat,
      output: values.output as OutputFormat,
      showSteps: values["show-steps"] as boolean,
      stats: values.stats as string,
      matrix: values.matrix as MatrixOperation,
      from: values.from as string,
      to: values.to as string,
      finance: values.finance as FinanceType,
      principal: values.principal ? parseFloat(values.principal as string) : undefined,
      rate: values.rate ? parseFloat(values.rate as string) : undefined,
      years: values.years ? parseFloat(values.years as string) : undefined,
      periods: values.periods ? parseFloat(values.periods as string) : undefined,
      payment: values.payment ? parseFloat(values.payment as string) : undefined,
      cashflows: values.cashflows as string,
      operation: values.operation as SymbolicOperation,
      var: values.var as string,
    },
  };
}
