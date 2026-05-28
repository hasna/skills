// ============================================================================

export interface EnvVariable {
  name: string;
  category: string;
  description: string;
  example?: string;
  defaultValue?: string;
  required: boolean;
  sensitive: boolean;
  format?: string;
  validation?: string;
}

export interface GenerateOptions {
  dir: string;
  include: string[];
  exclude: string[];
  output: string;
  envs: string[];
  prefix: string;
  generateSecrets: boolean;
  secretLength: number;
  withTypes: boolean;
  withValidation: boolean;
  templateOnly: boolean;
  categories: string[];
  autoCategorize: boolean;
  format: 'inline' | 'block' | 'minimal';
  includeExamples: boolean;
  securityWarnings: boolean;
}
