export type Mode = "calc" | "stats" | "matrix" | "convert" | "finance" | "symbolic";
export type OutputFormat = "text" | "json" | "latex";
export type NumberFormat = "number" | "scientific" | "fraction" | "percentage";
export type MatrixOperation = "add" | "multiply" | "transpose" | "determinant" | "inverse" | "eigenvalues" | "rank" | "trace";
export type FinanceType = "compound" | "simple" | "npv" | "irr" | "pmt" | "fv" | "pv";
export type SymbolicOperation = "derivative" | "integral" | "simplify" | "factor" | "expand" | "solve";

export interface MathOptions {
  mode: Mode;
  precision: number;
  format: NumberFormat;
  output: OutputFormat;
  showSteps: boolean;
  stats?: string;
  matrix?: MatrixOperation;
  from?: string;
  to?: string;
  finance?: FinanceType;
  principal?: number;
  rate?: number;
  years?: number;
  periods?: number;
  payment?: number;
  cashflows?: string;
  operation?: SymbolicOperation;
  var?: string;
}

export interface Result {
  input: string | string[];
  mode: Mode;
  output: any;
  steps?: string[];
  formatted?: string;
  latex?: string;
}
