export type DocFormat = "jsdoc" | "tsdoc" | "python" | "auto";
export type OutputMode = "inline" | string; // inline or file path
export type ApiProvider = "anthropic" | "openai";

export interface GenerateOptions {
  path: string;
  format: DocFormat;
  output: OutputMode;
  includeExamples: boolean;
  update: boolean;
  verbose: boolean;
  apiProvider: ApiProvider;
  model?: string;
}

export interface CodeElement {
  type: "function" | "class" | "method" | "interface" | "type";
  name: string;
  code: string;
  startLine: number;
  endLine: number;
  hasExistingDoc: boolean;
  language: "typescript" | "javascript" | "python";
}

export interface DocumentationResult {
  element: CodeElement;
  documentation: string;
  updated: boolean;
}
