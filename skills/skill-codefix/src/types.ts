/**
 * Type definitions for skill-codefix
 */

export type Language =
  | 'typescript'
  | 'javascript'
  | 'python'
  | 'go'
  | 'rust'
  | 'java'
  | 'c'
  | 'cpp'
  | 'csharp'
  | 'ruby'
  | 'php'
  | 'swift'
  | 'kotlin'
  | 'shell'
  | 'sql'
  | 'html'
  | 'css'
  | 'json'
  | 'yaml'
  | 'markdown'
  | 'auto';

export type FixType =
  | 'lint'        // Fix linting issues
  | 'format'      // Format/prettify code
  | 'types'       // Fix type errors (TypeScript)
  | 'imports'     // Organize and fix imports
  | 'style'       // Fix style guide violations
  | 'security'    // Fix security issues
  | 'perf'        // Fix performance issues
  | 'docs'        // Add/fix documentation
  | 'all';        // Run all applicable fixes

export type Severity = 'error' | 'warning' | 'info' | 'hint';

export interface Issue {
  line: number;
  column: number;
  message: string;
  rule?: string;
  severity: Severity;
  fixable: boolean;
  fix?: string;
}

export interface FixOptions {
  /** File or directory to fix */
  path: string;
  /** Type of fix to apply */
  type: FixType;
  /** Programming language (auto-detected if not specified) */
  language?: Language;
  /** Dry run - show what would be fixed without making changes */
  dryRun?: boolean;
  /** Fix files in place */
  write?: boolean;
  /** Output fixed content to a different path */
  output?: string;
  /** Show diff of changes */
  diff?: boolean;
  /** Ignore patterns (glob) */
  ignore?: string[];
  /** Include hidden files */
  includeHidden?: boolean;
  /** Config file path (eslint, prettier, etc.) */
  config?: string;
  /** Be verbose */
  verbose?: boolean;
}

export interface AnalyzeOptions {
  /** File or directory to analyze */
  path: string;
  /** Programming language (auto-detected if not specified) */
  language?: Language;
  /** Types of issues to check for */
  types?: FixType[];
  /** Output format */
  format?: 'text' | 'json' | 'github';
  /** Show only errors */
  errorsOnly?: boolean;
  /** Ignore patterns (glob) */
  ignore?: string[];
}

export interface FixResult {
  success: boolean;
  path: string;
  language: Language;
  issuesFound: number;
  issuesFixed: number;
  issues: Issue[];
  diff?: string;
  error?: string;
}

export interface AnalyzeResult {
  success: boolean;
  path: string;
  language: Language;
  issues: Issue[];
  summary: {
    errors: number;
    warnings: number;
    info: number;
    hints: number;
    fixable: number;
  };
}

export interface FileResult {
  file: string;
  result: FixResult | AnalyzeResult;
}

export interface BatchResult {
  success: boolean;
  filesProcessed: number;
  filesWithIssues: number;
  totalIssues: number;
  totalFixed: number;
  results: FileResult[];
  duration: number;
}

/** Language-specific fixer configuration */
export interface FixerConfig {
  language: Language;
  extensions: string[];
  lintCommand?: string;
  formatCommand?: string;
  typeCheckCommand?: string;
}

/** Built-in fixer configurations */
export const FIXER_CONFIGS: Record<string, FixerConfig> = {
  typescript: {
    language: 'typescript',
    extensions: ['.ts', '.tsx', '.mts', '.cts'],
    lintCommand: 'eslint --fix',
    formatCommand: 'prettier --write',
    typeCheckCommand: 'tsc --noEmit',
  },
  javascript: {
    language: 'javascript',
    extensions: ['.js', '.jsx', '.mjs', '.cjs'],
    lintCommand: 'eslint --fix',
    formatCommand: 'prettier --write',
  },
  python: {
    language: 'python',
    extensions: ['.py', '.pyi'],
    lintCommand: 'ruff check --fix',
    formatCommand: 'ruff format',
    typeCheckCommand: 'mypy',
  },
  go: {
    language: 'go',
    extensions: ['.go'],
    lintCommand: 'golangci-lint run --fix',
    formatCommand: 'gofmt -w',
  },
  rust: {
    language: 'rust',
    extensions: ['.rs'],
    lintCommand: 'cargo clippy --fix --allow-dirty',
    formatCommand: 'cargo fmt',
  },
  json: {
    language: 'json',
    extensions: ['.json', '.jsonc'],
    formatCommand: 'prettier --write',
  },
  yaml: {
    language: 'yaml',
    extensions: ['.yaml', '.yml'],
    formatCommand: 'prettier --write',
  },
  markdown: {
    language: 'markdown',
    extensions: ['.md', '.mdx'],
    formatCommand: 'prettier --write',
  },
  html: {
    language: 'html',
    extensions: ['.html', '.htm'],
    formatCommand: 'prettier --write',
  },
  css: {
    language: 'css',
    extensions: ['.css', '.scss', '.sass', '.less'],
    lintCommand: 'stylelint --fix',
    formatCommand: 'prettier --write',
  },
  shell: {
    language: 'shell',
    extensions: ['.sh', '.bash', '.zsh'],
    lintCommand: 'shellcheck',
    formatCommand: 'shfmt -w',
  },
  sql: {
    language: 'sql',
    extensions: ['.sql'],
    formatCommand: 'sql-formatter',
  },
};
