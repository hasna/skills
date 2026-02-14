#!/usr/bin/env bun

function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help')) {
    console.log('Usage: shadcn-theme [options]');
    console.log('Options:');
    console.log('  --help  Show help');
    return;
  }

  // Placeholder for shadcn-theme skill
}

main();