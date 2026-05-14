export const ALLOWED_PACKAGE_MANAGERS = ['npm', 'yarn', 'pnpm', 'bun'] as const;

export function validatePackageManager(pm: string): asserts pm is PackageManager {
  if (!ALLOWED_PACKAGE_MANAGERS.includes(pm as PackageManager)) {
    throw new Error(
      `Invalid package manager: "${pm}". Must be one of: ${ALLOWED_PACKAGE_MANAGERS.join(', ')}`
    );
  }
}

// ============================================================================
// Types & Interfaces
// ============================================================================

export type Template =
  | 'next' | 'react' | 'vue' | 'svelte' | 'astro' | 'remix'
  | 'express' | 'fastapi' | 'hono' | 'elysia' | 'nestjs'
  | 't3' | 'nextjs-supabase' | 'remix-prisma'
  | 'rest-api' | 'graphql' | 'trpc'
  | 'cli' | 'chrome-extension' | 'electron' | 'react-native' | 'tauri' | 'monorepo';

export type Database = 'prisma' | 'drizzle' | 'supabase' | 'none';
export type Auth = 'nextauth' | 'clerk' | 'lucia' | 'supabase' | 'none';
export type Testing = 'vitest' | 'playwright' | 'both' | 'none';
export type State = 'zustand' | 'jotai' | 'redux' | 'none';
export type PackageManager = 'npm' | 'yarn' | 'pnpm' | 'bun';

export interface ScaffoldOptions {
  description?: string;
  template?: Template;
  name?: string;
  output?: string;
  typescript: boolean;
  tailwind: boolean;
  shadcn: boolean;
  database: Database;
  auth: Auth;
  testing: Testing;
  state: State;
  git: boolean;
  install: boolean;
  pm: PackageManager;
  dryRun: boolean;
  verbose: boolean;
}

export interface ProjectConfig {
  name: string;
  template: Template;
  outputDir: string;
  dependencies: string[];
  devDependencies: string[];
  scripts: Record<string, string>;
  files: Array<{ path: string; content: string }>;
  features: string[];
}

// ============================================================================
