#!/usr/bin/env bun

/**
 * Scaffold Project Skill
 * Generates complete project boilerplates from plain English descriptions
 */

import { spawnSync } from "child_process";
import { existsSync } from "fs";
import { parseArgs } from "util";

import { detectTemplate } from "./ai-detect";
import { generateFiles } from "./file-generators";
import { generateProjectConfig } from "./project-config";
import { TEMPLATES } from "./templates";
import { validatePackageManager } from "./types";
import type { Auth, Database, PackageManager, ScaffoldOptions, State, Template, Testing } from "./types";

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
