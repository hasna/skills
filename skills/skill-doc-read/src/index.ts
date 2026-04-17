#!/usr/bin/env bun

import { readFile, writeFile, stat, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { basename, extname, dirname, resolve } from 'path';
import { parseArgs } from 'util';
import JSZip from 'jszip';

interface DocResult {
  file: string;
  text: string;
  sections: DocSection[];
  metadata: DocMetadata;
  wordCount: number;
}

interface DocSection {
  type: 'heading' | 'paragraph' | 'list' | 'table';
  level?: number;
  text: string;
  items?: string[];
  rows?: string[][];
}

interface DocMetadata {
  title?: string;
  author?: string;
  lastModifiedBy?: string;
  created?: string;
  modified?: string;
  description?: string;
}

async function extractDocxText(buffer: Buffer): Promise<{ text: string; sections: DocSection[] }> {
  const zip = await JSZip.loadAsync(buffer);

  const documentXml = await zip.file('word/document.xml')?.async('string');
  if (!documentXml) throw new Error('Invalid DOCX: missing word/document.xml');

  const sections: DocSection[] = [];
  let fullText = '';

  const paragraphs = documentXml.match(/<w:p[\s>][\s\S]*?<\/w:p>/g) || [];

  for (const para of paragraphs) {
    const textParts = para.match(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g) || [];
    const text = textParts
      .map(t => t.replace(/<w:t[^>]*>/, '').replace(/<\/w:t>/, ''))
      .join('');

    if (!text.trim()) continue;

    const headingMatch = para.match(/<w:pStyle w:val="Heading(\d)"/);
    if (headingMatch) {
      const level = parseInt(headingMatch[1]);
      sections.push({ type: 'heading', level, text: text.trim() });
    } else if (para.includes('<w:numPr>')) {
      const lastSection = sections[sections.length - 1];
      if (lastSection?.type === 'list') {
        lastSection.items!.push(text.trim());
      } else {
        sections.push({ type: 'list', text: text.trim(), items: [text.trim()] });
      }
    } else {
      sections.push({ type: 'paragraph', text: text.trim() });
    }

    fullText += text.trim() + '\n';
  }

  const tables = documentXml.match(/<w:tbl>[\s\S]*?<\/w:tbl>/g) || [];
  for (const table of tables) {
    const rows: string[][] = [];
    const tableRows = table.match(/<w:tr[\s>][\s\S]*?<\/w:tr>/g) || [];
    for (const row of tableRows) {
      const cells = row.match(/<w:tc[\s>][\s\S]*?<\/w:tc>/g) || [];
      const rowData = cells.map(cell => {
        const cellTexts = cell.match(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g) || [];
        return cellTexts.map(t => t.replace(/<w:t[^>]*>/, '').replace(/<\/w:t>/, '')).join(' ');
      });
      rows.push(rowData);
    }
    if (rows.length > 0) {
      sections.push({ type: 'table', text: '', rows });
    }
  }

  return { text: fullText, sections };
}

async function extractDocxMetadata(buffer: Buffer): Promise<DocMetadata> {
  const zip = await JSZip.loadAsync(buffer);

  const coreXml = await zip.file('docProps/core.xml')?.async('string');
  if (!coreXml) return {};

  const getTag = (xml: string, tag: string): string | undefined => {
    const match = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
    return match?.[1]?.trim() || undefined;
  };

  return {
    title: getTag(coreXml, 'dc:title'),
    author: getTag(coreXml, 'dc:creator'),
    lastModifiedBy: getTag(coreXml, 'cp:lastModifiedBy'),
    created: getTag(coreXml, 'dcterms:created'),
    modified: getTag(coreXml, 'dcterms:modified'),
    description: getTag(coreXml, 'dc:description'),
  };
}

async function readSingleDocx(filePath: string): Promise<DocResult> {
  const buffer = await readFile(filePath);
  const { text, sections } = await extractDocxText(buffer);
  const metadata = await extractDocxMetadata(buffer);
  const wordCount = text.split(/\s+/).filter(w => w.length > 0).length;

  return { file: filePath, text, sections, metadata, wordCount };
}

async function readMultipleDocx(files: string[], concurrency = 4): Promise<DocResult[]> {
  const results: DocResult[] = [];
  const queue = [...files];

  async function processNext(): Promise<void> {
    while (queue.length > 0) {
      const file = queue.shift()!;
      console.log(`Reading: ${basename(file)}`);
      const result = await readSingleDocx(file);
      results.push(result);
      console.log(`  ${result.sections.length} sections, ${result.wordCount} words`);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, files.length) }, () => processNext());
  await Promise.all(workers);

  return results;
}

function formatText(results: DocResult[]): string {
  return results.map(r => {
    const header = `=== ${basename(r.file)} (${r.wordCount} words) ===\n`;
    return header + r.text;
  }).join('\n\n');
}

function formatJson(results: DocResult[]): string {
  return JSON.stringify(results.map(r => ({
    file: basename(r.file),
    wordCount: r.wordCount,
    metadata: r.metadata,
    sections: r.sections,
  })), null, 2);
}

function formatMarkdown(results: DocResult[]): string {
  return results.map(r => {
    const lines: string[] = [];
    lines.push(`# ${basename(r.file)}`);
    lines.push('');
    if (r.metadata.title) lines.push(`**Title:** ${r.metadata.title}`);
    if (r.metadata.author) lines.push(`**Author:** ${r.metadata.author}`);
    lines.push(`**Words:** ${r.wordCount}`);
    lines.push('');

    for (const section of r.sections) {
      switch (section.type) {
        case 'heading':
          lines.push(`${'#'.repeat((section.level || 1) + 1)} ${section.text}`);
          lines.push('');
          break;
        case 'paragraph':
          lines.push(section.text);
          lines.push('');
          break;
        case 'list':
          for (const item of section.items || []) {
            lines.push(`- ${item}`);
          }
          lines.push('');
          break;
        case 'table':
          if (section.rows && section.rows.length > 0) {
            lines.push('| ' + section.rows[0].join(' | ') + ' |');
            lines.push('| ' + section.rows[0].map(() => '---').join(' | ') + ' |');
            for (const row of section.rows.slice(1)) {
              lines.push('| ' + row.join(' | ') + ' |');
            }
            lines.push('');
          }
          break;
      }
    }
    return lines.join('\n');
  }).join('\n---\n\n');
}

async function main() {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      format: { type: 'string', default: 'text' },
      output: { type: 'string', short: 'o' },
      concurrency: { type: 'string', default: '4' },
      help: { type: 'boolean', short: 'h' },
    },
    allowPositionals: true,
  });

  const command = positionals[0];
  const files = positionals.slice(1);

  if (values.help || !command) {
    console.log(`
Doc Read - Extract text from DOCX files

Usage:
  skill-doc-read read <files...> [options]
  skill-doc-read info <files...>

Commands:
  read          Extract text and structure from DOCX files
  info          Show document metadata

Read Options:
  --format <fmt>       Output format: text, json, markdown (default: text)
  --output, -o <path>  Write output to file
  --concurrency <n>    Parallel file processing (default: 4)

Examples:
  skill-doc-read read document.docx
  skill-doc-read read *.docx --format json --output extracted.json
  skill-doc-read read report.docx --format markdown
  skill-doc-read info document.docx
`);
    process.exit(0);
  }

  if (files.length === 0) {
    console.error('Error: At least one DOCX file is required');
    process.exit(1);
  }

  for (const file of files) {
    if (!existsSync(file)) {
      console.error(`File not found: ${file}`);
      process.exit(1);
    }
    const ext = extname(file).toLowerCase();
    if (ext !== '.docx' && ext !== '.doc') {
      console.error(`Not a DOCX file: ${file}`);
      process.exit(1);
    }
  }

  switch (command) {
    case 'read': {
      const concurrency = parseInt(values.concurrency as string) || 4;

      console.log(`\nReading ${files.length} DOCX file(s)...\n`);

      const results = await readMultipleDocx(files, concurrency);

      let output: string;
      switch (values.format) {
        case 'json': output = formatJson(results); break;
        case 'markdown': case 'md': output = formatMarkdown(results); break;
        default: output = formatText(results); break;
      }

      if (values.output) {
        const outputPath = resolve(values.output as string);
        await mkdir(dirname(outputPath), { recursive: true });
        await writeFile(outputPath, output);
        console.log(`\nOutput saved to: ${outputPath}`);
      } else {
        console.log('\n' + output);
      }

      const totalWords = results.reduce((s, r) => s + r.wordCount, 0);
      console.log(`\nProcessed: ${files.length} files, ${totalWords.toLocaleString()} words`);
      break;
    }

    case 'info': {
      for (const file of files) {
        const buffer = await readFile(file);
        const metadata = await extractDocxMetadata(buffer);
        const { text } = await extractDocxText(buffer);
        const wordCount = text.split(/\s+/).filter(w => w.length > 0).length;
        const fileStats = await stat(file);

        console.log(`\n${basename(file)}:`);
        console.log(`  Size: ${(fileStats.size / 1024).toFixed(1)} KB`);
        console.log(`  Words: ${wordCount.toLocaleString()}`);
        if (metadata.title) console.log(`  Title: ${metadata.title}`);
        if (metadata.author) console.log(`  Author: ${metadata.author}`);
        if (metadata.lastModifiedBy) console.log(`  Last Modified By: ${metadata.lastModifiedBy}`);
        if (metadata.created) console.log(`  Created: ${metadata.created}`);
        if (metadata.modified) console.log(`  Modified: ${metadata.modified}`);
      }
      break;
    }

    default:
      console.error(`Unknown command: ${command}`);
      process.exit(1);
  }
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
