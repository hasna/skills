import { join } from "path";

import { TEMPLATES } from "./templates";
import type { ProjectConfig, ScaffoldOptions, Template } from "./types";

export function generateProjectConfig(options: ScaffoldOptions): ProjectConfig {
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

export function generateScripts(template: Template, options: ScaffoldOptions): Record<string, string> {
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

export function generateTsConfig(template: Template): any {
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

export function generateGitignore(template: Template): string {
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

export function generateEnvExample(options: ScaffoldOptions): string {
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

export function generateReadme(config: ProjectConfig, options: ScaffoldOptions): string {
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
