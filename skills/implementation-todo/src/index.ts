#!/usr/bin/env bun

import * as fs from "fs";
import * as path from "path";
import minimist from "minimist";

// Types
interface TaskItem {
  text: string;
  done?: boolean;
}

interface ChecklistSection {
  name: string;
  items: (string | TaskItem)[];
}

interface TodoJsonData {
  tasks?: (string | TaskItem)[];
  checklists?: ChecklistSection[];
  acceptance?: string[];
  notes?: string;
  links?: string[];
}

interface TodoData {
  id: string;
  slug: string;
  title: string;
  description: string;
  status: "pending" | "in_progress" | "completed" | "blocked";
  priority: "low" | "medium" | "high" | "critical";
  assignee?: string;
  due?: string;
  tags: string[];
  parent?: string;
  tasks: { text: string; done: boolean }[];
  notes: string;
  created: string;
  updated: string;
  jsonData?: TodoJsonData;
}

// Parse command line arguments
const args = minimist(process.argv.slice(2), {
  string: ["slug", "format", "priority", "status", "assignee", "due", "tags", "parent", "content", "data"],
  boolean: ["no-index", "help"],
  default: {
    format: "md",
    priority: "medium",
    status: "pending",
    "no-index": false,
  },
  alias: {
    s: "slug",
    f: "format",
    p: "priority",
    a: "assignee",
    d: "due",
    t: "tags",
    c: "content",
    h: "help",
  },
});

// Show help
if (args.help) {
  console.log(`
Implementation Todo - Create todo files for development tracking

Usage:
  skills run implementation-todo -- "<title>" [options]

Options:
  -s, --slug <name>       Slug name for the todo file (required)
  -f, --format <type>     Output format: md, json (default: md)
  -p, --priority <level>  Priority: low, medium, high, critical (default: medium)
  --status <status>       Status: pending, in_progress, completed, blocked (default: pending)
  -a, --assignee <name>   Person assigned to the todo
  -d, --due <date>        Due date (YYYY-MM-DD)
  -t, --tags <tags>       Comma-separated tags
  -c, --content <text>    Additional content/description to add
  --data <json>           JSON data with tasks, checklists, etc.
  --parent <id>           Parent todo ID for subtasks
  --no-index              Skip updating TODOS.md index
  -h, --help              Show this help

JSON Data Format (--data):
  {
    "tasks": ["Task 1", "Task 2", { "text": "Task 3", "done": true }],
    "checklists": [
      { "name": "Before starting", "items": ["Review requirements", "Setup environment"] },
      { "name": "Completion criteria", "items": ["Tests pass", "Code reviewed"] }
    ],
    "acceptance": ["Feature works as expected", "No regressions"],
    "notes": "Additional notes here",
    "links": ["https://docs.example.com", "https://ticket.example.com/123"]
  }

Examples:
  skills run implementation-todo -- "Add authentication" --slug auth-feature
  skills run implementation-todo -- "Fix bug" --slug bug-fix --format json
  skills run implementation-todo -- "Security fixes" --slug security --priority critical --assignee alice
  skills run implementation-todo -- "Feature" --slug feature --data '{"tasks":["Implement login","Add tests"],"acceptance":["Works with OAuth"]}'
`);
  process.exit(0);
}

// Get title
const title = args._[0] as string;

if (!title) {
  console.error("Error: Title is required");
  console.error('Usage: skills run implementation-todo -- "<title>" --slug <slug>');
  process.exit(1);
}

// Get slug
const rawSlug = args.slug as string;

if (!rawSlug) {
  console.error("Error: --slug is required");
  console.error('Usage: skills run implementation-todo -- "<title>" --slug <slug>');
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

// Determine format and output directory
const format = args.format as "md" | "json";
const outputDir = path.join(implDir, "data", "todos", format);

if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

// Get next sequence number
function getNextSequence(): number {
  const jsonDir = path.join(implDir, "data", "todos", "json");
  const mdDir = path.join(implDir, "data", "todos", "md");

  let maxSeq = 0;

  for (const dir of [jsonDir, mdDir]) {
    if (!fs.existsSync(dir)) continue;

    const files = fs.readdirSync(dir);
    for (const file of files) {
      const match = file.match(/^todo_(\d{5})_/);
      if (match) {
        const seq = parseInt(match[1], 10);
        if (seq > maxSeq) maxSeq = seq;
      }
    }
  }

  return maxSeq + 1;
}

const sequence = getNextSequence();
const todoId = `todo_${String(sequence).padStart(5, "0")}`;
const timestamp = new Date().toISOString().split("T")[0];

// Parse JSON data if provided
let jsonData: TodoJsonData | undefined;
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

// Build todo data
const todoData: TodoData = {
  id: todoId,
  slug,
  title,
  description: userContent || title,
  status: args.status as TodoData["status"],
  priority: args.priority as TodoData["priority"],
  assignee: args.assignee,
  due: args.due,
  tags,
  parent: args.parent,
  tasks: [],
  notes: jsonData?.notes || "",
  created: timestamp,
  updated: timestamp,
  jsonData,
};

// Helper function to render task item
function renderTaskItem(task: string | TaskItem): string {
  if (typeof task === "string") {
    return `- [ ] ${task}\n`;
  } else {
    const checkbox = task.done ? "[x]" : "[ ]";
    return `- ${checkbox} ${task.text}\n`;
  }
}

// Generate markdown content
function generateMarkdown(data: TodoData): string {
  const json = data.jsonData;
  let content = `# Todo: ${data.title}\n\n`;

  // Metadata
  content += `- **ID**: ${data.id}\n`;
  content += `- **Slug**: ${data.slug}\n`;
  content += `- **Status**: ${data.status}\n`;
  content += `- **Priority**: ${data.priority}\n`;

  if (data.assignee) {
    content += `- **Assignee**: ${data.assignee}\n`;
  }

  if (data.due) {
    content += `- **Due**: ${data.due}\n`;
  }

  if (data.tags.length > 0) {
    content += `- **Tags**: ${data.tags.join(", ")}\n`;
  }

  if (data.parent) {
    content += `- **Parent**: ${data.parent}\n`;
  }

  content += `- **Created**: ${data.created}\n`;
  content += `- **Updated**: ${data.updated}\n`;

  // Description
  content += `\n## Description\n\n`;
  if (userContent) {
    content += `${userContent}\n`;
  } else {
    content += `<!-- Add a description of what needs to be done -->\n`;
  }

  // Tasks section
  content += `\n## Tasks\n\n`;
  if (json?.tasks && json.tasks.length > 0) {
    for (const task of json.tasks) {
      content += renderTaskItem(task);
    }
  } else {
    content += `<!-- Add tasks to complete -->\n`;
    content += `- [ ] \n`;
  }

  // Checklists (if provided)
  if (json?.checklists && json.checklists.length > 0) {
    for (const checklist of json.checklists) {
      content += `\n### ${checklist.name}\n\n`;
      if (checklist.items.length > 0) {
        for (const item of checklist.items) {
          content += renderTaskItem(item);
        }
      } else {
        content += `- [ ] \n`;
      }
    }
  }

  // Acceptance Criteria (if provided)
  if (json?.acceptance && json.acceptance.length > 0) {
    content += `\n## Acceptance Criteria\n\n`;
    for (const criteria of json.acceptance) {
      content += `- [ ] ${criteria}\n`;
    }
  }

  // Links (if provided)
  if (json?.links && json.links.length > 0) {
    content += `\n## Links\n\n`;
    for (const link of json.links) {
      content += `- ${link}\n`;
    }
  }

  // Notes section
  content += `\n## Notes\n\n`;
  if (json?.notes) {
    content += `${json.notes}\n`;
  } else {
    content += `<!-- Add notes and additional context -->\n`;
  }

  // Progress Log
  content += `\n## Progress\n\n`;
  content += `| Date | Update |\n`;
  content += `|------|--------|\n`;
  content += `| ${data.created} | Created |\n`;

  return content;
}

// Generate JSON content
function generateJson(data: TodoData): string {
  return JSON.stringify(data, null, 2);
}

// Update index file
function updateIndex(data: TodoData, filename: string): void {
  const indexPath = path.join(implDir, "data", "indexes", "TODOS.md");

  if (!fs.existsSync(indexPath)) {
    console.error("Warning: TODOS.md index not found, skipping index update");
    return;
  }

  let content = fs.readFileSync(indexPath, "utf-8");

  // Find the "No todos yet" placeholder and replace it, or add new row
  const newRow = `| ${data.id} | ${filename} | ${data.title} | ${data.status} | ${data.priority} |`;

  if (content.includes("| - | - | No todos yet | - | - |")) {
    content = content.replace("| - | - | No todos yet | - | - |", newRow);
  } else {
    // Find the end of the Active Todos table and add new row
    const tableMatch = content.match(/(## Active Todos[\s\S]*?\|[-|]+\|[-|]+\|[-|]+\|[-|]+\|[-|]+\|)/);
    if (tableMatch) {
      const insertPoint = tableMatch.index! + tableMatch[0].length;
      content = content.slice(0, insertPoint) + "\n" + newRow + content.slice(insertPoint);
    }
  }

  // Update timestamp
  content = content.replace(/\*Updated.*\*/, `*Updated: ${timestamp}*`);

  fs.writeFileSync(indexPath, content);
}

// Main execution
async function main(): Promise<void> {
  console.log(`\nImplementation Todo`);
  console.log(`===================\n`);

  // Generate filename
  const extension = format === "json" ? "json" : "md";
  const filename = `${todoId}_${slug}.${extension}`;
  const outputPath = path.join(outputDir, filename);

  // Generate content
  const content = format === "json" ? generateJson(todoData) : generateMarkdown(todoData);

  // Write file
  fs.writeFileSync(outputPath, content);

  console.log(`Created: ${outputPath}`);
  console.log(`\nTodo Details:`);
  console.log(`  ID: ${todoData.id}`);
  console.log(`  Title: ${todoData.title}`);
  console.log(`  Slug: ${todoData.slug}`);
  console.log(`  Status: ${todoData.status}`);
  console.log(`  Priority: ${todoData.priority}`);

  if (todoData.assignee) {
    console.log(`  Assignee: ${todoData.assignee}`);
  }

  if (todoData.due) {
    console.log(`  Due: ${todoData.due}`);
  }

  if (todoData.tags.length > 0) {
    console.log(`  Tags: ${todoData.tags.join(", ")}`);
  }

  // Update index
  if (!args["no-index"]) {
    console.log(`\nUpdating TODOS.md index...`);
    updateIndex(todoData, filename);
    console.log(`Index updated.`);
  }

  console.log(`\n${"=".repeat(40)}`);
  console.log(`\nTodo created successfully!`);
  console.log(`File: .implementation/data/todos/${format}/${filename}`);
}

main().catch((error) => {
  console.error(`Error: ${error.message}`);
  process.exit(1);
});
