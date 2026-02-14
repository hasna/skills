#!/usr/bin/env bun

/**
 * Batch crawl all API documentation from the list
 *
 * Usage:
 *   bun run scripts/crawl-all.ts              # Crawl all priority 1 APIs
 *   bun run scripts/crawl-all.ts --all        # Crawl all APIs
 *   bun run scripts/crawl-all.ts --priority 2 # Crawl priority 1 and 2
 *   bun run scripts/crawl-all.ts --category llm-providers
 */

import { readFileSync } from 'fs';
import { spawn } from 'child_process';
import { join } from 'path';

interface ApiEntry {
  name: string;
  url: string;
  priority: number;
  maxPages?: number;
}

interface ApiDocsList {
  categories: Record<string, {
    description: string;
    apis: ApiEntry[];
  }>;
}

// Parse arguments
const args = process.argv.slice(2);
const crawlAll = args.includes('--all');
const priorityArg = args.find(a => a.startsWith('--priority'));
const maxPriority = priorityArg ? parseInt(priorityArg.split('=')[1] || args[args.indexOf('--priority') + 1] || '1') : 1;
const categoryArg = args.find(a => a.startsWith('--category'));
const filterCategory = categoryArg ? (categoryArg.split('=')[1] || args[args.indexOf('--category') + 1]) : null;
const maxPagesArg = args.find(a => a.startsWith('--max-pages'));
const maxPages = maxPagesArg ? parseInt(maxPagesArg.split('=')[1] || args[args.indexOf('--max-pages') + 1] || '100') : 100;
const dryRun = args.includes('--dry-run');

// Load API docs list
const listPath = join(import.meta.dir, '..', 'api-docs-list.json');
const list: ApiDocsList = JSON.parse(readFileSync(listPath, 'utf-8'));

// Collect APIs to crawl
const apisToCrawl: ApiEntry[] = [];

for (const [categoryName, category] of Object.entries(list.categories)) {
  if (filterCategory && categoryName !== filterCategory) {
    continue;
  }

  for (const api of category.apis) {
    if (crawlAll || api.priority <= maxPriority) {
      apisToCrawl.push(api);
    }
  }
}

console.log(`\n🚀 API Documentation Batch Crawler`);
console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
console.log(`APIs to crawl: ${apisToCrawl.length}`);
console.log(`Max pages per API: ${maxPages}`);
console.log(`Priority filter: ${crawlAll ? 'all' : `<= ${maxPriority}`}`);
if (filterCategory) console.log(`Category filter: ${filterCategory}`);
if (dryRun) console.log(`Mode: DRY RUN (no actual crawling)`);
console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

if (dryRun) {
  console.log('APIs that would be crawled:');
  for (const api of apisToCrawl) {
    console.log(`  - ${api.name}: ${api.url} (priority ${api.priority})`);
  }
  process.exit(0);
}

// Results tracking
const results: { name: string; success: boolean; error?: string; duration?: number }[] = [];

// Crawl function
async function crawlApi(api: ApiEntry): Promise<void> {
  const startTime = Date.now();
  const apiMaxPages = api.maxPages || maxPages;
  console.log(`\n📖 [${results.length + 1}/${apisToCrawl.length}] Crawling: ${api.name}`);
  console.log(`   URL: ${api.url}`);
  console.log(`   Max pages: ${apiMaxPages}`);

  return new Promise((resolve) => {
    const proc = spawn('bun', [
      'run', 'bin/cli.ts', 'add',
      api.url,
      '--name', api.name,
      '--max-pages', apiMaxPages.toString()
    ], {
      cwd: join(import.meta.dir, '..'),
      stdio: 'inherit'
    });

    proc.on('close', (code) => {
      const duration = Math.round((Date.now() - startTime) / 1000);
      if (code === 0) {
        results.push({ name: api.name, success: true, duration });
        console.log(`   ✅ ${api.name} completed in ${duration}s`);
      } else {
        results.push({ name: api.name, success: false, error: `Exit code ${code}`, duration });
        console.log(`   ❌ ${api.name} failed (exit code ${code})`);
      }
      resolve();
    });

    proc.on('error', (err) => {
      results.push({ name: api.name, success: false, error: err.message });
      console.log(`   ❌ ${api.name} error: ${err.message}`);
      resolve();
    });
  });
}

// Run crawls sequentially
async function main() {
  const totalStart = Date.now();

  for (const api of apisToCrawl) {
    await crawlApi(api);
    // Small delay between crawls to be polite
    await new Promise(r => setTimeout(r, 2000));
  }

  const totalDuration = Math.round((Date.now() - totalStart) / 1000);

  // Summary
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`📊 Crawl Summary`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

  const successful = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);

  console.log(`✅ Successful: ${successful.length}`);
  console.log(`❌ Failed: ${failed.length}`);
  console.log(`⏱️  Total time: ${Math.floor(totalDuration / 60)}m ${totalDuration % 60}s`);

  if (failed.length > 0) {
    console.log(`\nFailed APIs:`);
    for (const f of failed) {
      console.log(`  - ${f.name}: ${f.error}`);
    }
  }

  console.log(`\nSuccessful APIs:`);
  for (const s of successful) {
    console.log(`  - ${s.name} (${s.duration}s)`);
  }
}

main().catch(console.error);
