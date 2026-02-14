/**
 * Validate a hook structure
 */

import { existsSync } from 'fs';
import { join } from 'path';

interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export async function validateHook(hookPath: string): Promise<void> {
  const result: ValidationResult = {
    valid: true,
    errors: [],
    warnings: [],
  };

  // Required files
  const requiredFiles = [
    'hook.config.json',
    'package.json',
    'src/index.ts',
    'src/commands/run.ts',
    'src/commands/setup.ts',
    'HOOK.md',
  ];

  // Check required files
  for (const file of requiredFiles) {
    const filePath = join(hookPath, file);
    if (!existsSync(filePath)) {
      result.errors.push(`Missing required file: ${file}`);
      result.valid = false;
    }
  }

  // Validate hook.config.json
  const configPath = join(hookPath, 'hook.config.json');
  if (existsSync(configPath)) {
    try {
      const configFile = Bun.file(configPath);
      const config = await configFile.json();

      // Required fields
      const requiredFields = ['name', 'description', 'version', 'event', 'matcher'];
      for (const field of requiredFields) {
        if (!config[field]) {
          result.errors.push(`hook.config.json missing required field: ${field}`);
          result.valid = false;
        }
      }

      // Validate event
      const validEvents = ['PreToolUse', 'PostToolUse', 'Stop'];
      if (config.event && !validEvents.includes(config.event)) {
        result.errors.push(`Invalid event: ${config.event}. Must be one of: ${validEvents.join(', ')}`);
        result.valid = false;
      }

      // Validate name format
      if (config.name && !config.name.startsWith('hook-')) {
        result.warnings.push(`Hook name should start with 'hook-': ${config.name}`);
      }
    } catch (e) {
      result.errors.push(`Invalid JSON in hook.config.json: ${(e as Error).message}`);
      result.valid = false;
    }
  }

  // Validate package.json
  const pkgPath = join(hookPath, 'package.json');
  if (existsSync(pkgPath)) {
    try {
      const pkgFile = Bun.file(pkgPath);
      const pkg = await pkgFile.json();

      if (!pkg.bin) {
        result.errors.push('package.json missing "bin" field');
        result.valid = false;
      }

      if (!pkg.repository) {
        result.warnings.push('package.json missing "repository" field');
      }
    } catch (e) {
      result.errors.push(`Invalid JSON in package.json: ${(e as Error).message}`);
      result.valid = false;
    }
  }

  // Print results
  console.log(`\nHook Validation: ${hookPath}\n`);

  if (result.errors.length > 0) {
    console.log('ERRORS:');
    result.errors.forEach((e) => console.log(`  - ${e}`));
    console.log('');
  }

  if (result.warnings.length > 0) {
    console.log('WARNINGS:');
    result.warnings.forEach((w) => console.log(`  - ${w}`));
    console.log('');
  }

  if (result.valid && result.warnings.length === 0) {
    console.log('Valid hook structure');
  } else if (result.valid) {
    console.log('Valid hook structure (with warnings)');
  } else {
    console.log('Invalid hook structure');
    process.exit(1);
  }
}
