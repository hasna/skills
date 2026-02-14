#!/usr/bin/env bun

import * as fs from "fs";
import * as path from "path";
import minimist from "minimist";

// Types
interface TechStack {
  runtime?: string;
  framework?: string;
  language?: string;
  styling?: string;
  database?: string;
  orm?: string;
  auth?: string;
  hosting?: string;
  ci?: string;
  testing?: string;
  other?: string[];
}

interface DatabaseSchema {
  tables?: Array<{
    name: string;
    description?: string;
    columns?: Array<{
      name: string;
      type: string;
      nullable?: boolean;
      default?: string;
      description?: string;
    }>;
    relations?: string[];
  }>;
  enums?: Array<{
    name: string;
    values: string[];
  }>;
}

interface ProjectStructure {
  description?: string;
  folders?: Array<{
    path: string;
    description: string;
  }>;
  keyFiles?: Array<{
    path: string;
    description: string;
  }>;
  conventions?: string[];
}

interface ApiEndpoint {
  method: string;
  path: string;
  description?: string;
  auth?: boolean;
  params?: Array<{
    name: string;
    type: string;
    required?: boolean;
    description?: string;
  }>;
  response?: string;
}

interface ApiDocs {
  baseUrl?: string;
  auth?: string;
  endpoints?: ApiEndpoint[];
  errors?: Array<{
    code: number;
    message: string;
  }>;
}

interface ArchitectureData {
  tech?: TechStack;
  database?: DatabaseSchema;
  structure?: ProjectStructure;
  api?: ApiDocs;
}

// Parse command line arguments
const args = minimist(process.argv.slice(2), {
  string: ["type", "data"],
  boolean: ["force", "help"],
  default: {
    force: false,
  },
  alias: {
    t: "type",
    d: "data",
    f: "force",
    h: "help",
  },
});

// Show help
if (args.help) {
  console.log(`
Implementation Architecture - Create architecture documentation files

Usage:
  skills run implementation-architecture -- [options]

Options:
  -t, --type <type>   Create specific doc: tech, database, structure, api, all (default: all)
  -d, --data <json>   JSON data for the architecture documentation
  -f, --force         Overwrite existing files
  -h, --help          Show this help

Examples:
  skills run implementation-architecture -- --type tech --data '{"runtime":"Bun","framework":"Next.js"}'
  skills run implementation-architecture -- --type database --data '{"tables":[{"name":"users","columns":[{"name":"id","type":"uuid"}]}]}'
  skills run implementation-architecture -- --type api --data '{"endpoints":[{"method":"GET","path":"/api/users"}]}'
  skills run implementation-architecture -- --type all --data '{"tech":{"runtime":"Bun"},"database":{"tables":[]}}'
`);
  process.exit(0);
}

// Find .implementation directory
function findImplementationDir(): string | null {
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

const archDir = path.join(implDir, "data", "architecture");
const timestamp = new Date().toISOString().split("T")[0];
const projectName = path.basename(path.dirname(implDir));

// Parse JSON data
let data: ArchitectureData = {};
if (args.data) {
  try {
    data = JSON.parse(args.data);
  } catch (e) {
    console.error("Error: Invalid JSON data");
    process.exit(1);
  }
}

// Generate tech.md
function generateTechMd(tech: TechStack): string {
  let content = `# Technology Stack

**Project:** ${projectName}
**Updated:** ${timestamp}

## Overview

This document describes the technology stack used in this project.

## Stack

| Layer | Technology |
|-------|------------|
`;

  if (tech.runtime) content += `| Runtime | ${tech.runtime} |\n`;
  if (tech.language) content += `| Language | ${tech.language} |\n`;
  if (tech.framework) content += `| Framework | ${tech.framework} |\n`;
  if (tech.styling) content += `| Styling | ${tech.styling} |\n`;
  if (tech.database) content += `| Database | ${tech.database} |\n`;
  if (tech.orm) content += `| ORM | ${tech.orm} |\n`;
  if (tech.auth) content += `| Auth | ${tech.auth} |\n`;
  if (tech.hosting) content += `| Hosting | ${tech.hosting} |\n`;
  if (tech.ci) content += `| CI/CD | ${tech.ci} |\n`;
  if (tech.testing) content += `| Testing | ${tech.testing} |\n`;

  if (tech.other && tech.other.length > 0) {
    content += `\n## Other Technologies\n\n`;
    for (const item of tech.other) {
      content += `- ${item}\n`;
    }
  }

  content += `\n## Notes\n\n<!-- Add notes about technology choices -->\n`;

  return content;
}

// Generate database.md
function generateDatabaseMd(db: DatabaseSchema): string {
  let content = `# Database Schema

**Project:** ${projectName}
**Updated:** ${timestamp}

## Overview

This document describes the database schema.

`;

  if (db.enums && db.enums.length > 0) {
    content += `## Enums\n\n`;
    for (const e of db.enums) {
      content += `### ${e.name}\n\n`;
      content += `\`\`\`\n${e.values.join(" | ")}\n\`\`\`\n\n`;
    }
  }

  if (db.tables && db.tables.length > 0) {
    content += `## Tables\n\n`;
    for (const table of db.tables) {
      content += `### ${table.name}\n\n`;
      if (table.description) {
        content += `${table.description}\n\n`;
      }

      if (table.columns && table.columns.length > 0) {
        content += `| Column | Type | Nullable | Default | Description |\n`;
        content += `|--------|------|----------|---------|-------------|\n`;
        for (const col of table.columns) {
          content += `| ${col.name} | ${col.type} | ${col.nullable ? "Yes" : "No"} | ${col.default || "-"} | ${col.description || "-"} |\n`;
        }
        content += `\n`;
      }

      if (table.relations && table.relations.length > 0) {
        content += `**Relations:**\n`;
        for (const rel of table.relations) {
          content += `- ${rel}\n`;
        }
        content += `\n`;
      }
    }
  } else {
    content += `## Tables\n\n<!-- Add table definitions -->\n\n`;
  }

  content += `## Notes\n\n<!-- Add notes about database design -->\n`;

  return content;
}

// Generate structure.md
function generateStructureMd(structure: ProjectStructure): string {
  let content = `# Project Structure

**Project:** ${projectName}
**Updated:** ${timestamp}

## Overview

`;

  if (structure.description) {
    content += `${structure.description}\n\n`;
  } else {
    content += `This document describes the project folder structure.\n\n`;
  }

  if (structure.folders && structure.folders.length > 0) {
    content += `## Folders\n\n`;
    content += `| Path | Description |\n`;
    content += `|------|-------------|\n`;
    for (const folder of structure.folders) {
      content += `| \`${folder.path}\` | ${folder.description} |\n`;
    }
    content += `\n`;
  } else {
    content += `## Folders\n\n<!-- Add folder descriptions -->\n\n`;
  }

  if (structure.keyFiles && structure.keyFiles.length > 0) {
    content += `## Key Files\n\n`;
    content += `| File | Description |\n`;
    content += `|------|-------------|\n`;
    for (const file of structure.keyFiles) {
      content += `| \`${file.path}\` | ${file.description} |\n`;
    }
    content += `\n`;
  }

  if (structure.conventions && structure.conventions.length > 0) {
    content += `## Conventions\n\n`;
    for (const convention of structure.conventions) {
      content += `- ${convention}\n`;
    }
    content += `\n`;
  }

  content += `## Notes\n\n<!-- Add notes about project structure -->\n`;

  return content;
}

// Generate api.md
function generateApiMd(api: ApiDocs): string {
  let content = `# API Documentation

**Project:** ${projectName}
**Updated:** ${timestamp}

## Overview

`;

  if (api.baseUrl) {
    content += `**Base URL:** \`${api.baseUrl}\`\n\n`;
  }

  if (api.auth) {
    content += `**Authentication:** ${api.auth}\n\n`;
  }

  if (api.endpoints && api.endpoints.length > 0) {
    content += `## Endpoints\n\n`;
    for (const endpoint of api.endpoints) {
      content += `### \`${endpoint.method}\` ${endpoint.path}\n\n`;
      if (endpoint.description) {
        content += `${endpoint.description}\n\n`;
      }
      if (endpoint.auth !== undefined) {
        content += `**Auth required:** ${endpoint.auth ? "Yes" : "No"}\n\n`;
      }

      if (endpoint.params && endpoint.params.length > 0) {
        content += `**Parameters:**\n\n`;
        content += `| Name | Type | Required | Description |\n`;
        content += `|------|------|----------|-------------|\n`;
        for (const param of endpoint.params) {
          content += `| ${param.name} | ${param.type} | ${param.required ? "Yes" : "No"} | ${param.description || "-"} |\n`;
        }
        content += `\n`;
      }

      if (endpoint.response) {
        content += `**Response:**\n\n\`\`\`json\n${endpoint.response}\n\`\`\`\n\n`;
      }

      content += `---\n\n`;
    }
  } else {
    content += `## Endpoints\n\n<!-- Add API endpoint definitions -->\n\n`;
  }

  if (api.errors && api.errors.length > 0) {
    content += `## Error Codes\n\n`;
    content += `| Code | Message |\n`;
    content += `|------|----------|\n`;
    for (const error of api.errors) {
      content += `| ${error.code} | ${error.message} |\n`;
    }
    content += `\n`;
  }

  content += `## Notes\n\n<!-- Add notes about API -->\n`;

  return content;
}

// Main execution
async function main(): Promise<void> {
  console.log(`\nImplementation Architecture`);
  console.log(`===========================\n`);
  console.log(`Project: ${projectName}`);
  console.log(`Output: ${archDir}\n`);

  // Ensure directory exists
  if (!fs.existsSync(archDir)) {
    fs.mkdirSync(archDir, { recursive: true });
  }

  const type = (args.type as string) || "all";
  const created: string[] = [];
  const skipped: string[] = [];

  // Generate tech.md
  if (type === "all" || type === "tech") {
    const filePath = path.join(archDir, "tech.md");
    if (fs.existsSync(filePath) && !args.force) {
      skipped.push("tech.md");
    } else {
      const content = generateTechMd(data.tech || {});
      fs.writeFileSync(filePath, content);
      created.push("tech.md");
    }
  }

  // Generate database.md
  if (type === "all" || type === "database") {
    const filePath = path.join(archDir, "database.md");
    if (fs.existsSync(filePath) && !args.force) {
      skipped.push("database.md");
    } else {
      const content = generateDatabaseMd(data.database || {});
      fs.writeFileSync(filePath, content);
      created.push("database.md");
    }
  }

  // Generate structure.md
  if (type === "all" || type === "structure") {
    const filePath = path.join(archDir, "structure.md");
    if (fs.existsSync(filePath) && !args.force) {
      skipped.push("structure.md");
    } else {
      const content = generateStructureMd(data.structure || {});
      fs.writeFileSync(filePath, content);
      created.push("structure.md");
    }
  }

  // Generate api.md
  if (type === "all" || type === "api") {
    const filePath = path.join(archDir, "api.md");
    if (fs.existsSync(filePath) && !args.force) {
      skipped.push("api.md");
    } else {
      const content = generateApiMd(data.api || {});
      fs.writeFileSync(filePath, content);
      created.push("api.md");
    }
  }

  // Summary
  console.log(`${"=".repeat(40)}\n`);

  if (created.length > 0) {
    console.log(`Created:`);
    for (const file of created) {
      console.log(`  - ${file}`);
    }
  }

  if (skipped.length > 0) {
    console.log(`\nSkipped (already exist, use --force to overwrite):`);
    for (const file of skipped) {
      console.log(`  - ${file}`);
    }
  }

  console.log(`\nFiles are in: .implementation/data/architecture/`);
}

main().catch((error) => {
  console.error(`Error: ${error.message}`);
  process.exit(1);
});
