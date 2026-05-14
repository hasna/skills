export interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, ParameterDef>;
}

export interface ParameterDef {
  type: "string" | "number" | "boolean" | "array" | "object";
  description: string;
  required?: boolean;
  default?: any;
  items?: { type: string };
}

export interface ResourceDef {
  uri: string;
  name: string;
  description: string;
  mimeType?: string;
}

export interface PromptDef {
  name: string;
  description: string;
  arguments?: { name: string; description: string; required?: boolean }[];
}

export interface BuildOptions {
  name: string;
  language: "typescript" | "python";
  template: string | null;
  tools: ToolDef[];
  resources: ResourceDef[];
  prompts: PromptDef[];
  output: string;
  overwrite: boolean;
  aiDescriptions: boolean;
  withTests: boolean;
  withDocker: boolean;
}

// Templates
