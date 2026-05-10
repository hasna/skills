#!/usr/bin/env bun
import fs from 'fs';
import path from 'path';
import yaml from 'yaml';

function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.length === 0) {
    console.log('Usage: validate-config <file-path>');
    console.log('Options:');
    console.log('  --help  Show help');
    return;
  }

  const filePath = args[0];
  if (!fs.existsSync(filePath)) {
    console.error(`Error: File not found at ${filePath}`);
    process.exit(1);
  }

  const fileContent = fs.readFileSync(filePath, 'utf-8');
  const fileExtension = path.extname(filePath).toLowerCase();

  let isValid = false;
  let error = '';

  if (fileExtension === '.json') {
    try {
      JSON.parse(fileContent);
      isValid = true;
    } catch (e: any) {
      error = `Invalid JSON: ${e.message}`;
    }
  } else if (fileExtension === '.yaml' || fileExtension === '.yml') {
    try {
      yaml.parse(fileContent);
      isValid = true;
    } catch (e: any) {
      error = `Invalid YAML: ${e.message}`;
    }
  } else {
    error = `Unsupported file type: ${fileExtension}`;
  }

  if (isValid) {
    console.log(`Validation successful for ${filePath}`);
    process.exit(0);
  } else {
    console.error(`Validation failed for ${filePath}`);
    console.error(error);
    process.exit(1);
  }
}

main();