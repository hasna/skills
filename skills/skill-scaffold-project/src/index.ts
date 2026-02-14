#!/usr/bin/env bun

/**
 * Scaffold Project Skill
 * Generates complete project boilerplates from plain English descriptions
 */

import { parseArgs } from "util";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { spawnSync } from "child_process";
import { join } from "path";

// ============================================================================
// Security: Allowlist for Package Managers
// ============================================================================

const ALLOWED_PACKAGE_MANAGERS = ['npm', 'yarn', 'pnpm', 'bun'] as const;

function validatePackageManager(pm: string): asserts pm is PackageManager {
  if (!ALLOWED_PACKAGE_MANAGERS.includes(pm as PackageManager)) {
    throw new Error(
      `Invalid package manager: "${pm}". Must be one of: ${ALLOWED_PACKAGE_MANAGERS.join(', ')}`
    );
  }
}

// ============================================================================
// Types & Interfaces
// ============================================================================

type Template =
  | 'next' | 'react' | 'vue' | 'svelte' | 'astro' | 'remix'
  | 'express' | 'fastapi' | 'hono' | 'elysia' | 'nestjs'
  | 't3' | 'nextjs-supabase' | 'remix-prisma'
  | 'rest-api' | 'graphql' | 'trpc'
  | 'cli' | 'chrome-extension' | 'electron' | 'react-native' | 'tauri' | 'monorepo';

type Database = 'prisma' | 'drizzle' | 'supabase' | 'none';
type Auth = 'nextauth' | 'clerk' | 'lucia' | 'supabase' | 'none';
type Testing = 'vitest' | 'playwright' | 'both' | 'none';
type State = 'zustand' | 'jotai' | 'redux' | 'none';
type PackageManager = 'npm' | 'yarn' | 'pnpm' | 'bun';

interface ScaffoldOptions {
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

interface ProjectConfig {
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
// Template Definitions
// ============================================================================

const TEMPLATES: Record<Template, {
  name: string;
  description: string;
  category: string;
  defaultDeps: string[];
  defaultDevDeps: string[];
}> = {
  next: {
    name: 'Next.js 15',
    description: 'Next.js 15 App Router with React, TypeScript, and Tailwind',
    category: 'frontend',
    defaultDeps: ['next', 'react', 'react-dom'],
    defaultDevDeps: ['@types/node', '@types/react', '@types/react-dom', 'typescript'],
  },
  react: {
    name: 'React + Vite',
    description: 'Vite + React + TypeScript',
    category: 'frontend',
    defaultDeps: ['react', 'react-dom'],
    defaultDevDeps: ['@types/react', '@types/react-dom', '@vitejs/plugin-react', 'typescript', 'vite'],
  },
  vue: {
    name: 'Vue 3 + Vite',
    description: 'Vite + Vue 3 + TypeScript',
    category: 'frontend',
    defaultDeps: ['vue'],
    defaultDevDeps: ['@vitejs/plugin-vue', 'typescript', 'vite', 'vue-tsc'],
  },
  svelte: {
    name: 'SvelteKit',
    description: 'SvelteKit + TypeScript',
    category: 'frontend',
    defaultDeps: ['svelte'],
    defaultDevDeps: ['@sveltejs/adapter-auto', '@sveltejs/kit', 'typescript', 'vite'],
  },
  astro: {
    name: 'Astro',
    description: 'Astro + TypeScript',
    category: 'frontend',
    defaultDeps: ['astro'],
    defaultDevDeps: ['@astrojs/tailwind', 'typescript'],
  },
  remix: {
    name: 'Remix',
    description: 'Remix + TypeScript',
    category: 'frontend',
    defaultDeps: ['@remix-run/node', '@remix-run/react', '@remix-run/serve', 'react', 'react-dom'],
    defaultDevDeps: ['@remix-run/dev', '@types/react', '@types/react-dom', 'typescript'],
  },
  express: {
    name: 'Express.js',
    description: 'Express + TypeScript',
    category: 'backend',
    defaultDeps: ['express', 'cors', 'dotenv'],
    defaultDevDeps: ['@types/express', '@types/cors', '@types/node', 'typescript', 'tsx'],
  },
  fastapi: {
    name: 'FastAPI',
    description: 'FastAPI + Python',
    category: 'backend',
    defaultDeps: ['fastapi', 'uvicorn', 'pydantic'],
    defaultDevDeps: ['black', 'pytest'],
  },
  hono: {
    name: 'Hono',
    description: 'Hono + TypeScript (edge-ready)',
    category: 'backend',
    defaultDeps: ['hono'],
    defaultDevDeps: ['@types/node', 'typescript'],
  },
  elysia: {
    name: 'Elysia',
    description: 'Elysia + Bun + TypeScript',
    category: 'backend',
    defaultDeps: ['elysia'],
    defaultDevDeps: ['bun-types'],
  },
  nestjs: {
    name: 'NestJS',
    description: 'NestJS + TypeScript',
    category: 'backend',
    defaultDeps: ['@nestjs/common', '@nestjs/core', '@nestjs/platform-express', 'reflect-metadata', 'rxjs'],
    defaultDevDeps: ['@nestjs/cli', '@types/node', 'typescript'],
  },
  t3: {
    name: 'T3 Stack',
    description: 'Next.js + tRPC + Prisma + NextAuth',
    category: 'fullstack',
    defaultDeps: ['next', 'react', 'react-dom', '@trpc/client', '@trpc/server', '@trpc/react-query', '@tanstack/react-query', 'zod'],
    defaultDevDeps: ['@types/node', '@types/react', '@types/react-dom', 'typescript'],
  },
  'nextjs-supabase': {
    name: 'Next.js + Supabase',
    description: 'Next.js + Supabase',
    category: 'fullstack',
    defaultDeps: ['next', 'react', 'react-dom', '@supabase/supabase-js'],
    defaultDevDeps: ['@types/node', '@types/react', '@types/react-dom', 'typescript'],
  },
  'remix-prisma': {
    name: 'Remix + Prisma',
    description: 'Remix + Prisma ORM',
    category: 'fullstack',
    defaultDeps: ['@remix-run/node', '@remix-run/react', '@remix-run/serve', 'react', 'react-dom', '@prisma/client'],
    defaultDevDeps: ['@remix-run/dev', '@types/react', '@types/react-dom', 'typescript', 'prisma'],
  },
  'rest-api': {
    name: 'REST API',
    description: 'REST API boilerplate',
    category: 'api',
    defaultDeps: ['express', 'cors', 'dotenv'],
    defaultDevDeps: ['@types/express', '@types/cors', '@types/node', 'typescript', 'tsx'],
  },
  graphql: {
    name: 'GraphQL API',
    description: 'GraphQL API (Apollo Server)',
    category: 'api',
    defaultDeps: ['@apollo/server', 'graphql'],
    defaultDevDeps: ['@types/node', 'typescript'],
  },
  trpc: {
    name: 'tRPC API',
    description: 'tRPC API',
    category: 'api',
    defaultDeps: ['@trpc/server', 'zod'],
    defaultDevDeps: ['@types/node', 'typescript'],
  },
  cli: {
    name: 'CLI Tool',
    description: 'CLI tool with Commander.js or Bun',
    category: 'other',
    defaultDeps: ['commander'],
    defaultDevDeps: ['@types/node', 'typescript'],
  },
  'chrome-extension': {
    name: 'Chrome Extension',
    description: 'Chrome extension boilerplate',
    category: 'other',
    defaultDeps: [],
    defaultDevDeps: ['@types/chrome', 'typescript'],
  },
  electron: {
    name: 'Electron',
    description: 'Electron desktop app',
    category: 'other',
    defaultDeps: ['electron'],
    defaultDevDeps: ['@types/node', 'typescript'],
  },
  'react-native': {
    name: 'React Native',
    description: 'React Native mobile app',
    category: 'other',
    defaultDeps: ['react', 'react-native'],
    defaultDevDeps: ['@types/react', 'typescript'],
  },
  tauri: {
    name: 'Tauri',
    description: 'Tauri desktop app',
    category: 'other',
    defaultDeps: ['@tauri-apps/api'],
    defaultDevDeps: ['@tauri-apps/cli', 'typescript'],
  },
  monorepo: {
    name: 'Turborepo Monorepo',
    description: 'Turborepo monorepo',
    category: 'other',
    defaultDeps: [],
    defaultDevDeps: ['turbo'],
  },
};

// ============================================================================
// AI Template Detection
// ============================================================================

async function detectTemplate(description: string, verbose: boolean): Promise<{ template: Template; features: string[] }> {
  const apiKey = process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    console.error('❌ No API key found for AI detection.');
    console.error('Set OPENAI_API_KEY or ANTHROPIC_API_KEY, or use --template to specify manually.');
    process.exit(1);
  }

  if (verbose) {
    console.log('🤖 Analyzing description with AI...');
  }

  const prompt = `Analyze this project description and select the BEST matching template from the list below.

Project Description: "${description}"

Available Templates:
${Object.entries(TEMPLATES).map(([key, val]) => `- ${key}: ${val.description}`).join('\n')}

Also suggest which of these features to include:
- database: prisma, drizzle, supabase, none
- auth: nextauth, clerk, lucia, supabase, none
- testing: vitest, playwright, both, none
- state: zustand, jotai, redux, none
- shadcn: true, false
- tailwind: true, false

Respond ONLY with valid JSON in this format:
{
  "template": "template-name",
  "features": {
    "database": "prisma or drizzle or supabase or none",
    "auth": "nextauth or clerk or lucia or supabase or none",
    "testing": "vitest or playwright or both or none",
    "state": "zustand or jotai or redux or none",
    "shadcn": true or false,
    "tailwind": true or false
  },
  "reasoning": "Brief explanation of why this template was chosen"
}`;

  try {
    let response: any;

    if (process.env.OPENAI_API_KEY) {
      // Use OpenAI
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: 'You are a helpful assistant that selects appropriate project templates.' },
            { role: 'user', content: prompt }
          ],
          temperature: 0.3,
        }),
      });

      if (!res.ok) {
        throw new Error(`OpenAI API error: ${res.statusText}`);
      }

      const data = await res.json();
      response = JSON.parse(data.choices[0].message.content);
    } else {
      // Use Anthropic
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY!,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-3-5-sonnet-20241022',
          max_tokens: 1024,
          messages: [
            { role: 'user', content: prompt }
          ],
        }),
      });

      if (!res.ok) {
        throw new Error(`Anthropic API error: ${res.statusText}`);
      }

      const data = await res.json();
      response = JSON.parse(data.content[0].text);
    }

    if (verbose) {
      console.log(`✅ Selected template: ${response.template}`);
      console.log(`💡 Reasoning: ${response.reasoning}`);
    }

    // Convert features object to array of strings
    const featuresArray: string[] = [];
    if (response.features.database && response.features.database !== 'none') {
      featuresArray.push(`database:${response.features.database}`);
    }
    if (response.features.auth && response.features.auth !== 'none') {
      featuresArray.push(`auth:${response.features.auth}`);
    }
    if (response.features.testing && response.features.testing !== 'none') {
      featuresArray.push(`testing:${response.features.testing}`);
    }
    if (response.features.state && response.features.state !== 'none') {
      featuresArray.push(`state:${response.features.state}`);
    }
    if (response.features.shadcn) {
      featuresArray.push('shadcn');
    }
    if (response.features.tailwind) {
      featuresArray.push('tailwind');
    }

    return {
      template: response.template,
      features: featuresArray,
    };
  } catch (error) {
    console.error('❌ AI detection failed:', error);
    console.error('Please specify --template manually.');
    process.exit(1);
  }
}

// ============================================================================
// Project Generation
// ============================================================================

function generateProjectConfig(options: ScaffoldOptions): ProjectConfig {
  const template = TEMPLATES[options.template!];
  const name = options.name || 'my-app';
  const outputDir = options.output || join(process.cwd(), name);

  const config: ProjectConfig = {
    name,
    template: options.template!,
    outputDir,
    dependencies: [...template.defaultDeps],
    devDependencies: [...template.defaultDevDeps],
    scripts: {},
    files: [],
    features: [],
  };

  // Add TypeScript
  if (options.typescript) {
    config.features.push('typescript');
  }

  // Add Tailwind CSS
  if (options.tailwind) {
    config.dependencies.push('tailwindcss', 'autoprefixer', 'postcss');
    config.features.push('tailwind');
  }

  // Add shadcn/ui
  if (options.shadcn) {
    config.dependencies.push('class-variance-authority', 'clsx', 'tailwind-merge');
    config.devDependencies.push('tailwindcss-animate');
    config.features.push('shadcn');
  }

  // Add database
  if (options.database !== 'none') {
    config.features.push(`database:${options.database}`);

    if (options.database === 'prisma') {
      config.dependencies.push('@prisma/client');
      config.devDependencies.push('prisma');
    } else if (options.database === 'drizzle') {
      config.dependencies.push('drizzle-orm', 'postgres');
      config.devDependencies.push('drizzle-kit');
    } else if (options.database === 'supabase') {
      config.dependencies.push('@supabase/supabase-js');
    }
  }

  // Add authentication
  if (options.auth !== 'none') {
    config.features.push(`auth:${options.auth}`);

    if (options.auth === 'nextauth') {
      config.dependencies.push('next-auth');
    } else if (options.auth === 'clerk') {
      config.dependencies.push('@clerk/nextjs');
    } else if (options.auth === 'lucia') {
      config.dependencies.push('lucia');
    }
  }

  // Add testing
  if (options.testing !== 'none') {
    config.features.push(`testing:${options.testing}`);

    if (options.testing === 'vitest' || options.testing === 'both') {
      config.devDependencies.push('vitest', '@vitest/ui');
    }
    if (options.testing === 'playwright' || options.testing === 'both') {
      config.devDependencies.push('@playwright/test');
    }
  }

  // Add state management
  if (options.state !== 'none') {
    config.features.push(`state:${options.state}`);

    if (options.state === 'zustand') {
      config.dependencies.push('zustand');
    } else if (options.state === 'jotai') {
      config.dependencies.push('jotai');
    } else if (options.state === 'redux') {
      config.dependencies.push('@reduxjs/toolkit', 'react-redux');
    }
  }

  // Add ESLint and Prettier
  config.devDependencies.push('eslint', 'prettier');

  return config;
}

function generateFiles(config: ProjectConfig, options: ScaffoldOptions): void {
  const { outputDir, name, template } = config;

  // Create output directory
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  // Generate package.json
  const packageJson = {
    name,
    version: '0.1.0',
    private: true,
    scripts: generateScripts(template, options),
    dependencies: config.dependencies.reduce((acc, dep) => {
      acc[dep] = 'latest';
      return acc;
    }, {} as Record<string, string>),
    devDependencies: config.devDependencies.reduce((acc, dep) => {
      acc[dep] = 'latest';
      return acc;
    }, {} as Record<string, string>),
  };

  writeFileSync(
    join(outputDir, 'package.json'),
    JSON.stringify(packageJson, null, 2)
  );

  // Generate tsconfig.json
  if (options.typescript) {
    const tsConfig = generateTsConfig(template);
    writeFileSync(
      join(outputDir, 'tsconfig.json'),
      JSON.stringify(tsConfig, null, 2)
    );
  }

  // Generate .gitignore
  const gitignore = generateGitignore(template);
  writeFileSync(join(outputDir, '.gitignore'), gitignore);

  // Generate .env.example
  const envExample = generateEnvExample(options);
  writeFileSync(join(outputDir, '.env.example'), envExample);

  // Generate README.md
  const readme = generateReadme(config, options);
  writeFileSync(join(outputDir, 'README.md'), readme);

  // Generate template-specific files
  generateTemplateFiles(config, options);

  console.log(`\n✅ Project scaffolded successfully!`);
  console.log(`📁 Location: ${outputDir}`);
  console.log(`\nNext steps:`);
  console.log(`  cd ${name}`);
  if (!options.install) {
    console.log(`  ${options.pm} install`);
  }
  console.log(`  ${options.pm} ${options.pm === 'npm' ? 'run ' : ''}dev`);
}

function generateScripts(template: Template, options: ScaffoldOptions): Record<string, string> {
  const scripts: Record<string, string> = {
    dev: 'next dev',
    build: 'next build',
    start: 'next start',
    lint: 'eslint .',
    format: 'prettier --write .',
  };

  // Template-specific scripts
  if (template === 'next') {
    scripts.dev = 'next dev';
    scripts.build = 'next build';
    scripts.start = 'next start';
  } else if (template === 'react') {
    scripts.dev = 'vite';
    scripts.build = 'vite build';
    scripts.preview = 'vite preview';
  } else if (template === 'express' || template === 'rest-api') {
    scripts.dev = 'tsx watch src/index.ts';
    scripts.build = 'tsc';
    scripts.start = 'node dist/index.js';
  }

  // Database scripts
  if (options.database === 'prisma') {
    scripts['db:generate'] = 'prisma generate';
    scripts['db:push'] = 'prisma db push';
    scripts['db:migrate'] = 'prisma migrate dev';
    scripts['db:studio'] = 'prisma studio';
  } else if (options.database === 'drizzle') {
    scripts['db:generate'] = 'drizzle-kit generate';
    scripts['db:migrate'] = 'drizzle-kit migrate';
    scripts['db:studio'] = 'drizzle-kit studio';
  }

  // Testing scripts
  if (options.testing === 'vitest' || options.testing === 'both') {
    scripts.test = 'vitest';
    scripts['test:ui'] = 'vitest --ui';
  }
  if (options.testing === 'playwright' || options.testing === 'both') {
    scripts['test:e2e'] = 'playwright test';
  }

  return scripts;
}

function generateTsConfig(template: Template): any {
  return {
    compilerOptions: {
      target: 'ES2020',
      lib: ['ES2020', 'DOM', 'DOM.Iterable'],
      module: 'ESNext',
      skipLibCheck: true,
      moduleResolution: 'bundler',
      allowImportingTsExtensions: true,
      resolveJsonModule: true,
      isolatedModules: true,
      noEmit: true,
      jsx: template.includes('react') || template === 'next' ? 'preserve' : undefined,
      strict: true,
      noUnusedLocals: true,
      noUnusedParameters: true,
      noFallthroughCasesInSwitch: true,
      baseUrl: '.',
      paths: {
        '@/*': ['./src/*'],
      },
    },
    include: ['src'],
    exclude: ['node_modules'],
  };
}

function generateGitignore(template: Template): string {
  return `# Dependencies
node_modules
.pnp
.pnp.js

# Testing
coverage
.nyc_output

# Next.js
.next
out

# Production
build
dist

# Misc
.DS_Store
*.pem

# Debug
npm-debug.log*
yarn-debug.log*
yarn-error.log*

# Local env files
.env
.env*.local

# Vercel
.vercel

# TypeScript
*.tsbuildinfo
next-env.d.ts

# IDE
.vscode
.idea
*.swp
*.swo
*~
`;
}

function generateEnvExample(options: ScaffoldOptions): string {
  let env = '# Environment Variables\n\n';

  if (options.database === 'prisma' || options.database === 'drizzle') {
    env += '# Database\n';
    env += 'DATABASE_URL="postgresql://user:password@localhost:5432/dbname"\n\n';
  }

  if (options.database === 'supabase' || options.auth === 'supabase') {
    env += '# Supabase\n';
    env += 'NEXT_PUBLIC_SUPABASE_URL="your-supabase-url"\n';
    env += 'NEXT_PUBLIC_SUPABASE_ANON_KEY="your-supabase-anon-key"\n\n';
  }

  if (options.auth === 'nextauth') {
    env += '# NextAuth\n';
    env += 'NEXTAUTH_URL="http://localhost:3000"\n';
    env += 'NEXTAUTH_SECRET="your-secret-here"\n\n';
  }

  if (options.auth === 'clerk') {
    env += '# Clerk\n';
    env += 'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY="your-publishable-key"\n';
    env += 'CLERK_SECRET_KEY="your-secret-key"\n\n';
  }

  return env;
}

function generateReadme(config: ProjectConfig, options: ScaffoldOptions): string {
  const { name, template } = config;
  const templateInfo = TEMPLATES[template];

  return `# ${name}

${templateInfo.description}

## Tech Stack

- **Framework**: ${templateInfo.name}
${options.typescript ? '- **Language**: TypeScript\n' : ''}${options.tailwind ? '- **Styling**: Tailwind CSS\n' : ''}${options.shadcn ? '- **UI**: shadcn/ui\n' : ''}${options.database !== 'none' ? `- **Database**: ${options.database}\n` : ''}${options.auth !== 'none' ? `- **Auth**: ${options.auth}\n` : ''}${options.testing !== 'none' ? `- **Testing**: ${options.testing}\n` : ''}${options.state !== 'none' ? `- **State**: ${options.state}\n` : ''}
## Prerequisites

- Node.js 18+ (or Bun)
- ${options.database === 'prisma' || options.database === 'drizzle' ? 'PostgreSQL database' : ''}

## Getting Started

1. Install dependencies:

\`\`\`bash
${options.pm} install
\`\`\`

2. Copy environment variables:

\`\`\`bash
cp .env.example .env
\`\`\`

3. Fill in the environment variables in \`.env\`

${options.database === 'prisma' ? `4. Setup database:

\`\`\`bash
${options.pm} db:generate
${options.pm} db:push
\`\`\`

` : ''}${options.database === 'drizzle' ? `4. Setup database:

\`\`\`bash
${options.pm} db:generate
${options.pm} db:migrate
\`\`\`

` : ''}5. Run the development server:

\`\`\`bash
${options.pm} ${options.pm === 'npm' ? 'run ' : ''}dev
\`\`\`

## Available Scripts

- \`${options.pm} ${options.pm === 'npm' ? 'run ' : ''}dev\` - Start development server
- \`${options.pm} ${options.pm === 'npm' ? 'run ' : ''}build\` - Build for production
- \`${options.pm} ${options.pm === 'npm' ? 'run ' : ''}start\` - Start production server
- \`${options.pm} ${options.pm === 'npm' ? 'run ' : ''}lint\` - Run ESLint
- \`${options.pm} ${options.pm === 'npm' ? 'run ' : ''}format\` - Format code with Prettier
${options.testing !== 'none' ? `- \`${options.pm} ${options.pm === 'npm' ? 'run ' : ''}test\` - Run tests\n` : ''}
## Project Structure

\`\`\`
${name}/
├── src/
│   ├── app/          # Application routes
│   ├── components/   # React components
│   ├── lib/          # Utility functions
│   └── types/        # TypeScript types
├── public/           # Static assets
├── .env.example      # Environment variables template
├── package.json
└── README.md
\`\`\`

## Learn More

- [${templateInfo.name} Documentation](https://nextjs.org/docs)
${options.tailwind ? '- [Tailwind CSS](https://tailwindcss.com/docs)\n' : ''}${options.shadcn ? '- [shadcn/ui](https://ui.shadcn.com)\n' : ''}${options.database === 'prisma' ? '- [Prisma](https://www.prisma.io/docs)\n' : ''}${options.database === 'drizzle' ? '- [Drizzle](https://orm.drizzle.team)\n' : ''}
## Deployment

Deploy your application on [Vercel](https://vercel.com) or [Railway](https://railway.app).

---

Generated with [scaffold-project](https://skills.md/skills/scaffold-project)
`;
}

function generateTemplateFiles(config: ProjectConfig, options: ScaffoldOptions): void {
  const { outputDir, template } = config;
  const srcDir = join(outputDir, 'src');

  // Create src directory
  if (!existsSync(srcDir)) {
    mkdirSync(srcDir, { recursive: true });
  }

  // Generate template-specific files
  if (template === 'next') {
    generateNextJsFiles(srcDir, options);
  } else if (template === 'react') {
    generateReactFiles(srcDir, options);
  } else if (template === 'express' || template === 'rest-api') {
    generateExpressFiles(srcDir, options);
  } else if (template === 'cli') {
    generateCliFiles(srcDir, options);
  }
  // Add more template generators as needed
}

function generateNextJsFiles(srcDir: string, options: ScaffoldOptions): void {
  const appDir = join(srcDir, 'app');
  mkdirSync(appDir, { recursive: true });

  // layout.tsx
  writeFileSync(
    join(appDir, 'layout.tsx'),
    `import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'My App',
  description: 'Generated by scaffold-project',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
`
  );

  // page.tsx
  writeFileSync(
    join(appDir, 'page.tsx'),
    `export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-24">
      <h1 className="text-4xl font-bold">Welcome to Your App</h1>
      <p className="mt-4 text-lg">Start building something amazing!</p>
    </main>
  )
}
`
  );

  // globals.css
  writeFileSync(
    join(appDir, 'globals.css'),
    `@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  --foreground-rgb: 0, 0, 0;
  --background-start-rgb: 214, 219, 220;
  --background-end-rgb: 255, 255, 255;
}

@media (prefers-color-scheme: dark) {
  :root {
    --foreground-rgb: 255, 255, 255;
    --background-start-rgb: 0, 0, 0;
    --background-end-rgb: 0, 0, 0;
  }
}

body {
  color: rgb(var(--foreground-rgb));
  background: linear-gradient(
      to bottom,
      transparent,
      rgb(var(--background-end-rgb))
    )
    rgb(var(--background-start-rgb));
}
`
  );

  // lib/utils.ts
  const libDir = join(srcDir, 'lib');
  mkdirSync(libDir, { recursive: true });
  writeFileSync(
    join(libDir, 'utils.ts'),
    `import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
`
  );
}

function generateReactFiles(srcDir: string, options: ScaffoldOptions): void {
  // main.tsx
  writeFileSync(
    join(srcDir, 'main.tsx'),
    `import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
`
  );

  // App.tsx
  writeFileSync(
    join(srcDir, 'App.tsx'),
    `function App() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <h1 className="text-4xl font-bold mb-4">Welcome to Your App</h1>
        <p className="text-lg">Start building something amazing!</p>
      </div>
    </div>
  )
}

export default App
`
  );

  // index.css
  writeFileSync(
    join(srcDir, 'index.css'),
    `@tailwind base;
@tailwind components;
@tailwind utilities;
`
  );
}

function generateExpressFiles(srcDir: string, options: ScaffoldOptions): void {
  // index.ts
  writeFileSync(
    join(srcDir, 'index.ts'),
    `import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'

dotenv.config()

const app = express()
const port = process.env.PORT || 3000

app.use(cors())
app.use(express.json())

app.get('/', (req, res) => {
  res.json({ message: 'API is running' })
})

app.get('/health', (req, res) => {
  res.json({ status: 'ok' })
})

app.listen(port, () => {
  console.log(\`Server running on http://localhost:\${port}\`)
})
`
  );
}

function generateCliFiles(srcDir: string, options: ScaffoldOptions): void {
  // index.ts
  writeFileSync(
    join(srcDir, 'index.ts'),
    `#!/usr/bin/env node
import { Command } from 'commander'

const program = new Command()

program
  .name('my-cli')
  .description('CLI tool generated by scaffold-project')
  .version('1.0.0')

program
  .command('hello')
  .description('Say hello')
  .argument('<name>', 'Name to greet')
  .action((name) => {
    console.log(\`Hello, \${name}!\`)
  })

program.parse()
`
  );
}

// ============================================================================
// Main CLI Logic
// ============================================================================

async function main() {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: {
      description: { type: 'string' },
      template: { type: 'string' },
      name: { type: 'string' },
      output: { type: 'string' },
      typescript: { type: 'boolean', default: true },
      tailwind: { type: 'boolean', default: true },
      shadcn: { type: 'boolean', default: false },
      database: { type: 'string', default: 'none' },
      auth: { type: 'string', default: 'none' },
      testing: { type: 'string', default: 'none' },
      state: { type: 'string', default: 'none' },
      git: { type: 'boolean', default: true },
      install: { type: 'boolean', default: false },
      pm: { type: 'string', default: 'bun' },
      'dry-run': { type: 'boolean', default: false },
      verbose: { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
    allowPositionals: true,
  });

  if (values.help) {
    console.log(`
Scaffold Project - Generate project boilerplates from descriptions

Usage:
  scaffold-project [description] [options]
  scaffold-project --template <template> --name <name> [options]

Options:
  --description <text>     Project description (or use positional arg)
  --template <type>        Template to use (next, react, express, etc.)
  --name <name>            Project name
  --output <path>          Output directory
  --typescript             Use TypeScript (default: true)
  --tailwind              Include Tailwind CSS (default: true)
  --shadcn                Include shadcn/ui
  --database <type>       Database: prisma, drizzle, supabase, none
  --auth <type>           Auth: nextauth, clerk, lucia, supabase, none
  --testing <type>        Testing: vitest, playwright, both, none
  --state <type>          State: zustand, jotai, redux, none
  --git                   Initialize git repo (default: true)
  --install               Run package install (default: false)
  --pm <manager>          Package manager: npm, yarn, pnpm, bun
  --dry-run               Show what would be created
  --verbose               Show detailed output
  --help                  Show this help

Examples:
  scaffold-project "A SaaS dashboard with user auth"
  scaffold-project --template next --name my-app --shadcn
  scaffold-project --template express --database prisma --testing vitest
`);
    process.exit(0);
  }

  // Get description from positional args or --description
  const description = values.description || positionals.join(' ');

  // Determine template
  let template: Template | undefined = values.template as Template;
  let aiFeatures: string[] = [];

  if (!template && description) {
    const detected = await detectTemplate(description, !!values.verbose);
    template = detected.template;
    aiFeatures = detected.features;
  } else if (!template) {
    console.error('❌ Error: Must provide either a description or --template');
    console.error('Run with --help for usage information');
    process.exit(1);
  }

  // Validate package manager early (before building options)
  const pmValue = values.pm || 'bun';
  try {
    validatePackageManager(pmValue);
  } catch (error: any) {
    console.error(`❌ ${error.message}`);
    process.exit(1);
  }

  // Build options
  const options: ScaffoldOptions = {
    description,
    template,
    name: values.name,
    output: values.output,
    typescript: values.typescript ?? true,
    tailwind: values.tailwind ?? true,
    shadcn: values.shadcn ?? false,
    database: (values.database as Database) || 'none',
    auth: (values.auth as Auth) || 'none',
    testing: (values.testing as Testing) || 'none',
    state: (values.state as State) || 'none',
    git: values.git ?? true,
    install: values.install ?? false,
    pm: pmValue as PackageManager,
    dryRun: values['dry-run'] ?? false,
    verbose: values.verbose ?? false,
  };

  // Apply AI-detected features if not explicitly set
  for (const feature of aiFeatures) {
    if (feature.startsWith('database:') && options.database === 'none') {
      options.database = feature.split(':')[1] as Database;
    } else if (feature.startsWith('auth:') && options.auth === 'none') {
      options.auth = feature.split(':')[1] as Auth;
    } else if (feature.startsWith('testing:') && options.testing === 'none') {
      options.testing = feature.split(':')[1] as Testing;
    } else if (feature.startsWith('state:') && options.state === 'none') {
      options.state = feature.split(':')[1] as State;
    } else if (feature === 'shadcn') {
      options.shadcn = true;
    } else if (feature === 'tailwind') {
      options.tailwind = true;
    }
  }

  if (options.verbose) {
    console.log('\n📋 Project Configuration:');
    console.log(`  Template: ${options.template}`);
    console.log(`  Name: ${options.name || 'auto-generated'}`);
    console.log(`  TypeScript: ${options.typescript}`);
    console.log(`  Tailwind: ${options.tailwind}`);
    console.log(`  shadcn: ${options.shadcn}`);
    console.log(`  Database: ${options.database}`);
    console.log(`  Auth: ${options.auth}`);
    console.log(`  Testing: ${options.testing}`);
    console.log(`  State: ${options.state}`);
    console.log('');
  }

  // Generate project config
  const config = generateProjectConfig(options);

  if (options.dryRun) {
    console.log('\n🏗️  Dry Run - Would create:');
    console.log(`\n📁 ${config.outputDir}/`);
    console.log(`  ├── package.json`);
    console.log(`  ├── tsconfig.json`);
    console.log(`  ├── .gitignore`);
    console.log(`  ├── .env.example`);
    console.log(`  ├── README.md`);
    console.log(`  └── src/`);
    console.log(`\n📦 Dependencies (${config.dependencies.length}):`);
    config.dependencies.forEach(dep => console.log(`  - ${dep}`));
    console.log(`\n🔧 Dev Dependencies (${config.devDependencies.length}):`);
    config.devDependencies.forEach(dep => console.log(`  - ${dep}`));
    console.log(`\n✨ Features: ${config.features.join(', ')}`);
    return;
  }

  // Check if output directory exists
  if (existsSync(config.outputDir)) {
    console.error(`❌ Error: Directory ${config.outputDir} already exists`);
    console.error('Choose a different name or output directory');
    process.exit(1);
  }

  console.log(`\n🚀 Scaffolding ${TEMPLATES[template].name} project...`);

  // Generate files
  generateFiles(config, options);

  // Initialize git (using spawnSync with array args to prevent command injection)
  if (options.git) {
    try {
      const result = spawnSync('git', ['init'], { cwd: config.outputDir, stdio: 'ignore' });
      if (result.status === 0) {
        console.log('✅ Git repository initialized');
      } else {
        console.warn('⚠️  Failed to initialize git repository');
      }
    } catch (error) {
      console.warn('⚠️  Failed to initialize git repository');
    }
  }

  // Install dependencies (using spawnSync with array args to prevent command injection)
  if (options.install) {
    // Validate package manager before use
    try {
      validatePackageManager(options.pm);
    } catch (error: any) {
      console.error(`❌ ${error.message}`);
      process.exit(1);
    }

    console.log(`\n📦 Installing dependencies with ${options.pm}...`);
    try {
      const result = spawnSync(options.pm, ['install'], {
        cwd: config.outputDir,
        stdio: 'inherit'
      });
      if (result.status === 0) {
        console.log('✅ Dependencies installed');
      } else {
        console.error('❌ Failed to install dependencies');
        console.error('Run installation manually after setup');
      }
    } catch (error) {
      console.error('❌ Failed to install dependencies');
      console.error('Run installation manually after setup');
    }
  }

  console.log('\n✨ Done! Your project is ready.');
}

// Run the CLI
main().catch((error) => {
  console.error('❌ Error:', error.message);
  process.exit(1);
});
