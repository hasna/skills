#!/usr/bin/env bun

import * as fs from "fs";
import * as path from "path";
import minimist from "minimist";

// Types
interface MementoSection {
  heading: string;
  content: string;
}

interface MementoJsonData {
  context?: string;
  sections?: MementoSection[];
  codeSnippets?: { language?: string; filename?: string; code: string }[];
  keyPoints?: string[];
  decisions?: { decision: string; rationale?: string }[];
  links?: string[];
  nextSteps?: string[];
  notes?: string;
}

interface MementoData {
  id: string;
  slug: string;
  title: string;
  content: string;
  category: "code" | "decision" | "context" | "note" | "research";
  tags: string[];
  related: string[];
  created: string;
  updated: string;
  jsonData?: MementoJsonData;
}

// Parse command line arguments
const args = minimist(process.argv.slice(2), {
  string: ["slug", "category", "content", "tags", "related", "data"],
  boolean: ["no-index", "help"],
  default: {
    category: "note",
    "no-index": false,
  },
  alias: {
    s: "slug",
    c: "content",
    t: "tags",
    r: "related",
    d: "data",
    h: "help",
  },
});

// Show help
if (args.help) {
  console.log(`
Implementation Memento - Create memento files for capturing notes and context

Usage:
  skills run implementation-memento -- "<title>" [options]

Options:
  -s, --slug <name>       Slug name for the memento file (required)
  --category <type>       Category: code, decision, context, note, research (default: note)
  -c, --content <text>    Additional content/body for the memento
  -t, --tags <tags>       Comma-separated tags
  -r, --related <ids>     Related memento/todo/plan IDs (comma-separated)
  -d, --data <json>       JSON data with sections, code snippets, etc.
  --no-index              Skip updating MEMENTOS.md index
  -h, --help              Show this help

JSON Data Format (--data):
  {
    "context": "Background context for this memento",
    "sections": [
      { "heading": "Overview", "content": "Section content here" },
      { "heading": "Details", "content": "More details" }
    ],
    "codeSnippets": [
      { "language": "typescript", "filename": "src/index.ts", "code": "const x = 1;" }
    ],
    "keyPoints": ["Important point 1", "Important point 2"],
    "decisions": [
      { "decision": "Use PostgreSQL", "rationale": "Better JSON support" }
    ],
    "links": ["https://docs.example.com"],
    "nextSteps": ["Review with team", "Create follow-up tasks"],
    "notes": "Additional notes"
  }

Examples:
  skills run implementation-memento -- "API endpoint found" --slug api-discovery
  skills run implementation-memento -- "DB choice" --slug db-decision --category decision
  skills run implementation-memento -- "Discovery" --slug discovery --data '{"keyPoints":["Found useful pattern"],"links":["https://example.com"]}'
`);
  process.exit(0);
}

// Get title
const title = args._[0] as string;

if (!title) {
  console.error("Error: Title is required");
  console.error('Usage: skills run implementation-memento -- "<title>" --slug <slug>');
  process.exit(1);
}

// Get slug
const rawSlug = args.slug as string;

if (!rawSlug) {
  console.error("Error: --slug is required");
  console.error('Usage: skills run implementation-memento -- "<title>" --slug <slug>');
  process.exit(1);
}

// Normalize slug (replace spaces and dashes with underscores)
const slug = rawSlug.toLowerCase().replace(/[\s-]+/g, "_").replace(/[^a-z0-9_]/g, "");

// Sanitize content for safe inclusion (handle quotes and special chars)
function sanitizeContent(text: string): string {
  if (!text) return "";
  // Normalize line endings and trim
  return text
    .replace(/\\n/g, "\n")  // Handle escaped newlines from CLI
    .replace(/\\t/g, "\t")  // Handle escaped tabs from CLI
    .trim();
}

// Get content if provided
const userContent = args.content ? sanitizeContent(args.content as string) : "";

// Find .implementation directory
function findImplementationDir(): string | null {
  // Use SKILLS_CWD if available (user's working directory from remote execution)
  let currentDir = process.env.SKILLS_CWD || process.cwd();

  while (currentDir !== path.dirname(currentDir)) {
    const implDir = path.join(currentDir, ".implementation");
    if (fs.existsSync(implDir)) {
      return implDir;
    }
    currentDir = path.dirname(currentDir);
  }

  return null;
}

const implDir = findImplementationDir();

if (!implDir) {
  console.error("Error: .implementation directory not found");
  console.error("Run 'skills run implementation-init' first to create the folder structure");
  process.exit(1);
}

// Output directory
const outputDir = path.join(implDir, "data", "mementos");

if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

// Get next sequence number
function getNextSequence(): number {
  if (!fs.existsSync(outputDir)) return 1;

  const files = fs.readdirSync(outputDir);
  let maxSeq = 0;

  for (const file of files) {
    const match = file.match(/^memento_(\d{5})_/);
    if (match) {
      const seq = parseInt(match[1], 10);
      if (seq > maxSeq) maxSeq = seq;
    }
  }

  return maxSeq + 1;
}

const sequence = getNextSequence();
const mementoId = `memento_${String(sequence).padStart(5, "0")}`;
const timestamp = new Date().toISOString().split("T")[0];

// Parse JSON data if provided
let jsonData: MementoJsonData | undefined;
if (args.data) {
  try {
    jsonData = JSON.parse(args.data as string);
  } catch (e) {
    console.error("Error: Invalid JSON data provided");
    console.error("Make sure to escape quotes properly in the shell");
    process.exit(1);
  }
}

// Parse tags
const tags = args.tags ? (args.tags as string).split(",").map((t: string) => t.trim()) : [];

// Parse related
const related = args.related ? (args.related as string).split(",").map((r: string) => r.trim()) : [];

// Validate category
const validCategories = ["code", "decision", "context", "note", "research"];
const category = validCategories.includes(args.category) ? args.category : "note";

// Build memento data
const mementoData: MementoData = {
  id: mementoId,
  slug,
  title,
  content: userContent || title,
  category: category as MementoData["category"],
  tags,
  related,
  created: timestamp,
  updated: timestamp,
  jsonData,
};

// Get category description
function getCategoryDescription(cat: string): string {
  const descriptions: Record<string, string> = {
    code: "Code snippets, functions, patterns discovered during development",
    decision: "Architecture decisions, library choices, implementation approaches",
    context: "Current state, progress updates, situational information",
    note: "General notes, observations, reminders",
    research: "Research findings, comparisons, evaluations",
  };
  return descriptions[cat] || descriptions.note;
}

// Generate markdown content
function generateMarkdown(data: MementoData): string {
  const json = data.jsonData;
  let content = `# Memento: ${data.title}\n\n`;

  // Metadata
  content += `- **ID**: ${data.id}\n`;
  content += `- **Slug**: ${data.slug}\n`;
  content += `- **Category**: ${data.category}\n`;

  if (data.tags.length > 0) {
    content += `- **Tags**: ${data.tags.join(", ")}\n`;
  }

  if (data.related.length > 0) {
    content += `- **Related**: ${data.related.join(", ")}\n`;
  }

  content += `- **Created**: ${data.created}\n`;
  content += `- **Updated**: ${data.updated}\n`;

  // Context section
  content += `\n## Context\n\n`;
  if (json?.context) {
    content += `${json.context}\n`;
  } else if (userContent) {
    content += `${userContent}\n`;
  } else {
    content += `<!-- ${getCategoryDescription(data.category)} -->\n`;
  }

  // Custom sections (if provided)
  if (json?.sections && json.sections.length > 0) {
    for (const section of json.sections) {
      content += `\n## ${section.heading}\n\n`;
      content += `${section.content}\n`;
    }
  }

  // Key Points (if provided)
  if (json?.keyPoints && json.keyPoints.length > 0) {
    content += `\n## Key Points\n\n`;
    for (const point of json.keyPoints) {
      content += `- ${point}\n`;
    }
  }

  // Decisions (if provided - especially for decision category)
  if (json?.decisions && json.decisions.length > 0) {
    content += `\n## Decisions\n\n`;
    for (const dec of json.decisions) {
      content += `### ${dec.decision}\n\n`;
      if (dec.rationale) {
        content += `**Rationale:** ${dec.rationale}\n\n`;
      }
    }
  }

  // Code Snippets (if provided - especially for code category)
  if (json?.codeSnippets && json.codeSnippets.length > 0) {
    content += `\n## Code Snippets\n`;
    for (const snippet of json.codeSnippets) {
      if (snippet.filename) {
        content += `\n### ${snippet.filename}\n\n`;
      } else {
        content += `\n`;
      }
      const lang = snippet.language || "";
      content += `\`\`\`${lang}\n${snippet.code}\n\`\`\`\n`;
    }
  }

  // Links (if provided)
  if (json?.links && json.links.length > 0) {
    content += `\n## Links\n\n`;
    for (const link of json.links) {
      content += `- ${link}\n`;
    }
  }

  // Next Steps (if provided)
  if (json?.nextSteps && json.nextSteps.length > 0) {
    content += `\n## Next Steps\n\n`;
    for (const step of json.nextSteps) {
      content += `- [ ] ${step}\n`;
    }
  }

  // Related Items
  content += `\n## Related Items\n\n`;
  if (data.related.length > 0) {
    for (const rel of data.related) {
      content += `- ${rel}\n`;
    }
  } else {
    content += `<!-- Add related mementos, todos, or plans -->\n`;
  }

  // Notes section
  content += `\n## Notes\n\n`;
  if (json?.notes) {
    content += `${json.notes}\n`;
  } else {
    content += `<!-- Additional notes and observations -->\n`;
  }

  // History
  content += `\n## History\n\n`;
  content += `| Date | Action |\n`;
  content += `|------|--------|\n`;
  content += `| ${data.created} | Created |\n`;

  return content;
}

// Update index file
function updateIndex(data: MementoData, filename: string): void {
  const indexPath = path.join(implDir, "data", "indexes", "MEMENTOS.md");

  // Create index file if it doesn't exist
  if (!fs.existsSync(indexPath)) {
    const initialContent = `# Mementos Index

Project: ${path.basename(path.dirname(implDir))}
Created: ${timestamp}

## Overview

This file indexes all mementos in this implementation.

## Recent Mementos

| ID | Slug | Title | Category | Created |
|----|------|-------|----------|---------|
| ${data.id} | ${data.slug} | ${data.title} | ${data.category} | ${data.created} |

---

*Updated: ${timestamp}*
`;
    fs.writeFileSync(indexPath, initialContent);
    return;
  }

  let content = fs.readFileSync(indexPath, "utf-8");

  // Add new row to table
  const newRow = `| ${data.id} | ${data.slug} | ${data.title} | ${data.category} | ${data.created} |`;

  // Find the table and add new row after header
  const tableMatch = content.match(/(## Recent Mementos[\s\S]*?\|[-|]+\|[-|]+\|[-|]+\|[-|]+\|[-|]+\|)/);
  if (tableMatch) {
    const insertPoint = tableMatch.index! + tableMatch[0].length;
    content = content.slice(0, insertPoint) + "\n" + newRow + content.slice(insertPoint);
  }

  // Update timestamp
  content = content.replace(/\*Updated:.*\*/, `*Updated: ${timestamp}*`);

  fs.writeFileSync(indexPath, content);
}

// Main execution
async function main(): Promise<void> {
  console.log(`\nImplementation Memento`);
  console.log(`======================\n`);

  // Generate filename
  const filename = `${mementoId}_${slug}.md`;
  const outputPath = path.join(outputDir, filename);

  // Generate content
  const content = generateMarkdown(mementoData);

  // Write file
  fs.writeFileSync(outputPath, content);

  console.log(`Created: ${outputPath}`);
  console.log(`\nMemento Details:`);
  console.log(`  ID: ${mementoData.id}`);
  console.log(`  Title: ${mementoData.title}`);
  console.log(`  Slug: ${mementoData.slug}`);
  console.log(`  Category: ${mementoData.category}`);

  if (mementoData.tags.length > 0) {
    console.log(`  Tags: ${mementoData.tags.join(", ")}`);
  }

  if (mementoData.related.length > 0) {
    console.log(`  Related: ${mementoData.related.join(", ")}`);
  }

  // Update index
  if (!args["no-index"]) {
    console.log(`\nUpdating MEMENTOS.md index...`);
    updateIndex(mementoData, filename);
    console.log(`Index updated.`);
  }

  console.log(`\n${"=".repeat(40)}`);
  console.log(`\nMemento created successfully!`);
  console.log(`File: .implementation/data/mementos/${filename}`);
}

main().catch((error) => {
  console.error(`Error: ${error.message}`);
  process.exit(1);
});
