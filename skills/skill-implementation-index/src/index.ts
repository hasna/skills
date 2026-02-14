#!/usr/bin/env bun

import * as fs from "fs";
import * as path from "path";
import minimist from "minimist";

// Types
interface TodoItem {
  id: string;
  slug: string;
  title: string;
  status: string;
  priority: string;
  assignee?: string;
  due?: string;
  tags: string[];
  created: string;
  updated: string;
  format: "md" | "json";
  filename: string;
}

interface PlanItem {
  id: string;
  slug: string;
  title: string;
  status: string;
  owner?: string;
  phases: string[];
  start?: string;
  end?: string;
  tags: string[];
  created: string;
  updated: string;
  filename: string;
}

interface AuditItem {
  id: string;
  slug: string;
  title: string;
  category: string;
  status: string;
  scope?: string;
  auditor?: string;
  findings: number;
  tags: string[];
  created: string;
  updated: string;
  filename: string;
}

interface ArchitectureItem {
  id: string;
  slug: string;
  title: string;
  status: string;
  date: string;
  filename: string;
}

interface MementoItem {
  id: string;
  slug: string;
  title: string;
  category: string;
  tags: string[];
  created: string;
  updated: string;
  filename: string;
}

// Parse command line arguments
const args = minimist(process.argv.slice(2), {
  string: ["only", "sort"],
  boolean: ["reverse", "include-completed", "stats", "help"],
  default: {
    sort: "date",
    reverse: false,
    "include-completed": true,
    stats: true,
  },
  alias: {
    o: "only",
    s: "sort",
    r: "reverse",
    h: "help",
  },
});

// Show help
if (args.help) {
  console.log(`
Implementation Indexes - Regenerate index files from existing data

Usage:
  skills run implementation-indexes [options]

Options:
  -o, --only <type>       Rebuild only: todos, plans, audits, architecture, mementos
  -s, --sort <by>         Sort by: date, status, priority, name (default: date)
  -r, --reverse           Reverse sort order
  --include-completed     Include completed items (default: true)
  --stats                 Show statistics summary (default: true)
  -h, --help              Show this help

Examples:
  skills run implementation-index
  skills run implementation-index -- --only todos
  skills run implementation-index -- --only mementos
  skills run implementation-index -- --sort priority --reverse
`);
  process.exit(0);
}

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

// Get project name from parent directory
const projectName = path.basename(path.dirname(implDir));
const timestamp = new Date().toISOString().split("T")[0];

// Parse markdown frontmatter-style metadata
function parseMarkdownMeta(content: string): Record<string, string> {
  const meta: Record<string, string> = {};
  const lines = content.split("\n");

  for (const line of lines) {
    const match = line.match(/^-\s*\*\*([^*]+)\*\*:\s*(.+)$/);
    if (match) {
      const key = match[1].toLowerCase().trim();
      const value = match[2].trim().replace(/`/g, "");
      meta[key] = value;
    }
  }

  return meta;
}

// Parse todos
function parseTodos(): TodoItem[] {
  const todos: TodoItem[] = [];
  const jsonDir = path.join(implDir, "data", "todos", "json");
  const mdDir = path.join(implDir, "data", "todos", "md");

  // Parse JSON todos
  if (fs.existsSync(jsonDir)) {
    const files = fs.readdirSync(jsonDir).filter((f) => f.endsWith(".json") && f.startsWith("todo_"));
    for (const file of files) {
      try {
        const content = fs.readFileSync(path.join(jsonDir, file), "utf-8");
        const data = JSON.parse(content);
        todos.push({
          id: data.id || file.replace(".json", ""),
          slug: data.slug || "",
          title: data.title || "",
          status: data.status || "pending",
          priority: data.priority || "medium",
          assignee: data.assignee,
          due: data.due,
          tags: data.tags || [],
          created: data.created || "",
          updated: data.updated || "",
          format: "json",
          filename: file,
        });
      } catch (e) {
        console.error(`Warning: Could not parse ${file}`);
      }
    }
  }

  // Parse MD todos
  if (fs.existsSync(mdDir)) {
    const files = fs.readdirSync(mdDir).filter((f) => f.endsWith(".md") && f.startsWith("todo_"));
    for (const file of files) {
      try {
        const content = fs.readFileSync(path.join(mdDir, file), "utf-8");
        const meta = parseMarkdownMeta(content);
        const titleMatch = content.match(/^#\s*Todo:\s*(.+)$/m);

        todos.push({
          id: meta.id || file.replace(".md", ""),
          slug: meta.slug || "",
          title: titleMatch ? titleMatch[1].trim() : "",
          status: meta.status || "pending",
          priority: meta.priority || "medium",
          assignee: meta.assignee,
          due: meta.due,
          tags: meta.tags ? meta.tags.split(",").map((t) => t.trim()) : [],
          created: meta.created || "",
          updated: meta.updated || "",
          format: "md",
          filename: file,
        });
      } catch (e) {
        console.error(`Warning: Could not parse ${file}`);
      }
    }
  }

  return todos;
}

// Parse plans
function parsePlans(): PlanItem[] {
  const plans: PlanItem[] = [];
  const plansDir = path.join(implDir, "data", "plans");

  if (!fs.existsSync(plansDir)) return plans;

  const files = fs.readdirSync(plansDir).filter((f) => f.endsWith(".md") && f.startsWith("plan_"));
  for (const file of files) {
    try {
      const content = fs.readFileSync(path.join(plansDir, file), "utf-8");
      const meta = parseMarkdownMeta(content);
      const titleMatch = content.match(/^#\s*Plan:\s*(.+)$/m);

      // Count phases
      const phaseMatches = content.match(/^###\s*Phase\s+\d+/gm) || [];

      plans.push({
        id: meta.id || file.replace(".md", ""),
        slug: meta.slug || "",
        title: titleMatch ? titleMatch[1].trim() : "",
        status: meta.status || "draft",
        owner: meta.owner,
        phases: new Array(phaseMatches.length).fill(""),
        start: meta.start,
        end: meta.end,
        tags: meta.tags ? meta.tags.split(",").map((t) => t.trim()) : [],
        created: meta.created || "",
        updated: meta.updated || "",
        filename: file,
      });
    } catch (e) {
      console.error(`Warning: Could not parse ${file}`);
    }
  }

  return plans;
}

// Parse audits
function parseAudits(): AuditItem[] {
  const audits: AuditItem[] = [];
  const auditsDir = path.join(implDir, "data", "audits");

  if (!fs.existsSync(auditsDir)) return audits;

  const files = fs.readdirSync(auditsDir).filter((f) => f.endsWith(".md") && f.startsWith("audit_"));
  for (const file of files) {
    try {
      const content = fs.readFileSync(path.join(auditsDir, file), "utf-8");
      const meta = parseMarkdownMeta(content);
      const titleMatch = content.match(/^#\s*Audit:\s*(.+)$/m);

      // Count findings (look for table rows that aren't headers or "No findings")
      const findingsMatches = content.match(/^\|\s*[A-Z0-9_-]+\s*\|/gm) || [];
      const findings = findingsMatches.filter((m) => !m.includes("No ") && !m.includes("ID")).length;

      audits.push({
        id: meta.id || file.replace(".md", ""),
        slug: meta.slug || "",
        title: titleMatch ? titleMatch[1].trim() : "",
        category: meta.category || "general",
        status: meta.status || "in_progress",
        scope: meta.scope,
        auditor: meta.auditor,
        findings,
        tags: meta.tags ? meta.tags.split(",").map((t) => t.trim()) : [],
        created: meta.created || "",
        updated: meta.updated || "",
        filename: file,
      });
    } catch (e) {
      console.error(`Warning: Could not parse ${file}`);
    }
  }

  return audits;
}

// Parse architecture
function parseArchitecture(): ArchitectureItem[] {
  const items: ArchitectureItem[] = [];
  const archDir = path.join(implDir, "data", "architecture");

  if (!fs.existsSync(archDir)) return items;

  const files = fs.readdirSync(archDir).filter((f) => f.endsWith(".md") && !f.startsWith("."));
  for (const file of files) {
    try {
      const content = fs.readFileSync(path.join(archDir, file), "utf-8");
      const meta = parseMarkdownMeta(content);
      const titleMatch = content.match(/^#\s*(?:ADR|Architecture):\s*(.+)$/m) || content.match(/^#\s*(.+)$/m);

      // Extract ID from filename or generate one
      const idMatch = file.match(/^(adr_\d{5}|arch_\d{5})/);
      const id = idMatch ? idMatch[1] : file.replace(".md", "");

      items.push({
        id,
        slug: meta.slug || file.replace(".md", "").replace(/^(adr|arch)_\d{5}_/, ""),
        title: titleMatch ? titleMatch[1].trim() : file.replace(".md", ""),
        status: meta.status || "proposed",
        date: meta.created || meta.date || "",
        filename: file,
      });
    } catch (e) {
      console.error(`Warning: Could not parse ${file}`);
    }
  }

  return items;
}

// Parse mementos
function parseMementos(): MementoItem[] {
  const mementos: MementoItem[] = [];
  const mementosDir = path.join(implDir, "data", "mementos");

  if (!fs.existsSync(mementosDir)) return mementos;

  const files = fs.readdirSync(mementosDir).filter((f) => f.endsWith(".md") && f.startsWith("memento_"));
  for (const file of files) {
    try {
      const content = fs.readFileSync(path.join(mementosDir, file), "utf-8");
      const meta = parseMarkdownMeta(content);
      const titleMatch = content.match(/^#\s*Memento:\s*(.+)$/m);

      mementos.push({
        id: meta.id || file.replace(".md", ""),
        slug: meta.slug || "",
        title: titleMatch ? titleMatch[1].trim() : "",
        category: meta.category || "note",
        tags: meta.tags ? meta.tags.split(",").map((t) => t.trim()) : [],
        created: meta.created || "",
        updated: meta.updated || "",
        filename: file,
      });
    } catch (e) {
      console.error(`Warning: Could not parse ${file}`);
    }
  }

  return mementos;
}

// Sort items
function sortItems<T extends { created?: string; status?: string; priority?: string; title?: string; slug?: string }>(
  items: T[],
  sortBy: string,
  reverse: boolean
): T[] {
  const priorityOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  const statusOrder: Record<string, number> = { in_progress: 0, pending: 1, draft: 2, blocked: 3, completed: 4, reviewed: 5 };

  const sorted = [...items].sort((a, b) => {
    let comparison = 0;

    switch (sortBy) {
      case "date":
        comparison = (b.created || "").localeCompare(a.created || "");
        break;
      case "status":
        comparison = (statusOrder[a.status || ""] || 99) - (statusOrder[b.status || ""] || 99);
        break;
      case "priority":
        comparison = (priorityOrder[(a as any).priority || ""] || 99) - (priorityOrder[(b as any).priority || ""] || 99);
        break;
      case "name":
        comparison = (a.title || a.slug || "").localeCompare(b.title || b.slug || "");
        break;
      default:
        comparison = (b.created || "").localeCompare(a.created || "");
    }

    return reverse ? -comparison : comparison;
  });

  return sorted;
}

// Generate TODOS.md
function generateTodosIndex(todos: TodoItem[]): string {
  const sorted = sortItems(todos, args.sort, args.reverse);
  const active = sorted.filter((t) => t.status !== "completed");
  const completed = sorted.filter((t) => t.status === "completed");

  let content = `# Todos Index\n\n`;
  content += `**Project:** ${projectName}\n`;
  content += `**Updated:** ${timestamp}\n\n`;

  // Summary
  if (args.stats) {
    const statusCounts: Record<string, number> = {};
    for (const todo of todos) {
      statusCounts[todo.status] = (statusCounts[todo.status] || 0) + 1;
    }

    content += `## Summary\n\n`;
    content += `| Status | Count |\n`;
    content += `|--------|-------|\n`;
    for (const [status, count] of Object.entries(statusCounts).sort()) {
      content += `| ${status} | ${count} |\n`;
    }
    content += `| **Total** | **${todos.length}** |\n\n`;

    // Priority breakdown
    const priorityCounts: Record<string, number> = {};
    for (const todo of active) {
      priorityCounts[todo.priority] = (priorityCounts[todo.priority] || 0) + 1;
    }
    if (Object.keys(priorityCounts).length > 0) {
      content += `### By Priority (Active)\n\n`;
      content += `| Priority | Count |\n`;
      content += `|----------|-------|\n`;
      const priorityOrder = ["critical", "high", "medium", "low"];
      for (const priority of priorityOrder) {
        if (priorityCounts[priority]) {
          content += `| ${priority} | ${priorityCounts[priority]} |\n`;
        }
      }
      content += `\n`;
    }
  }

  // Active todos
  content += `## Active Todos\n\n`;
  if (active.length === 0) {
    content += `No active todos.\n\n`;
  } else {
    content += `| ID | Slug | Title | Status | Priority | Assignee | Due | Created |\n`;
    content += `|----|------|-------|--------|----------|----------|-----|--------|\n`;
    for (const todo of active) {
      content += `| ${todo.id} | ${todo.slug} | ${todo.title} | ${todo.status} | ${todo.priority} | ${todo.assignee || "-"} | ${todo.due || "-"} | ${todo.created} |\n`;
    }
    content += `\n`;
  }

  // Completed todos
  if (args["include-completed"] && completed.length > 0) {
    content += `## Completed Todos\n\n`;
    content += `| ID | Slug | Title | Completed |\n`;
    content += `|----|------|-------|----------|\n`;
    for (const todo of completed) {
      content += `| ${todo.id} | ${todo.slug} | ${todo.title} | ${todo.updated || todo.created} |\n`;
    }
    content += `\n`;
  }

  content += `---\n\n*Generated by implementation-indexes*\n`;

  return content;
}

// Generate PLANS.md
function generatePlansIndex(plans: PlanItem[]): string {
  const sorted = sortItems(plans, args.sort, args.reverse);
  const active = sorted.filter((p) => p.status !== "completed" && p.status !== "cancelled");
  const completed = sorted.filter((p) => p.status === "completed");

  let content = `# Plans Index\n\n`;
  content += `**Project:** ${projectName}\n`;
  content += `**Updated:** ${timestamp}\n\n`;

  // Summary
  if (args.stats) {
    const statusCounts: Record<string, number> = {};
    for (const plan of plans) {
      statusCounts[plan.status] = (statusCounts[plan.status] || 0) + 1;
    }

    content += `## Summary\n\n`;
    content += `| Status | Count |\n`;
    content += `|--------|-------|\n`;
    for (const [status, count] of Object.entries(statusCounts).sort()) {
      content += `| ${status} | ${count} |\n`;
    }
    content += `| **Total** | **${plans.length}** |\n\n`;
  }

  // Active plans
  content += `## Active Plans\n\n`;
  if (active.length === 0) {
    content += `No active plans.\n\n`;
  } else {
    content += `| ID | Slug | Title | Status | Owner | Phases | Start | End | Created |\n`;
    content += `|----|------|-------|--------|-------|--------|-------|-----|--------|\n`;
    for (const plan of active) {
      content += `| ${plan.id} | ${plan.slug} | ${plan.title} | ${plan.status} | ${plan.owner || "-"} | ${plan.phases.length} | ${plan.start || "-"} | ${plan.end || "-"} | ${plan.created} |\n`;
    }
    content += `\n`;
  }

  // Completed plans
  if (args["include-completed"] && completed.length > 0) {
    content += `## Completed Plans\n\n`;
    content += `| ID | Slug | Title | Owner | Completed |\n`;
    content += `|----|------|-------|-------|----------|\n`;
    for (const plan of completed) {
      content += `| ${plan.id} | ${plan.slug} | ${plan.title} | ${plan.owner || "-"} | ${plan.updated || plan.created} |\n`;
    }
    content += `\n`;
  }

  content += `---\n\n*Generated by implementation-indexes*\n`;

  return content;
}

// Generate AUDITS.md
function generateAuditsIndex(audits: AuditItem[]): string {
  const sorted = sortItems(audits, args.sort, args.reverse);

  let content = `# Audits Index\n\n`;
  content += `**Project:** ${projectName}\n`;
  content += `**Updated:** ${timestamp}\n\n`;

  // Summary
  if (args.stats) {
    const categoryCounts: Record<string, { count: number; findings: number }> = {};
    for (const audit of audits) {
      if (!categoryCounts[audit.category]) {
        categoryCounts[audit.category] = { count: 0, findings: 0 };
      }
      categoryCounts[audit.category].count++;
      categoryCounts[audit.category].findings += audit.findings;
    }

    const totalFindings = audits.reduce((sum, a) => sum + a.findings, 0);

    content += `## Summary\n\n`;
    content += `| Category | Count | Findings |\n`;
    content += `|----------|-------|----------|\n`;
    for (const [category, data] of Object.entries(categoryCounts).sort()) {
      content += `| ${category} | ${data.count} | ${data.findings} |\n`;
    }
    content += `| **Total** | **${audits.length}** | **${totalFindings}** |\n\n`;

    // Status breakdown
    const statusCounts: Record<string, number> = {};
    for (const audit of audits) {
      statusCounts[audit.status] = (statusCounts[audit.status] || 0) + 1;
    }
    content += `### By Status\n\n`;
    content += `| Status | Count |\n`;
    content += `|--------|-------|\n`;
    for (const [status, count] of Object.entries(statusCounts).sort()) {
      content += `| ${status} | ${count} |\n`;
    }
    content += `\n`;
  }

  // All audits
  content += `## Recent Audits\n\n`;
  if (sorted.length === 0) {
    content += `No audits yet.\n\n`;
  } else {
    content += `| ID | Slug | Title | Category | Status | Auditor | Findings | Created |\n`;
    content += `|----|------|-------|----------|--------|---------|----------|--------|\n`;
    for (const audit of sorted) {
      content += `| ${audit.id} | ${audit.slug} | ${audit.title} | ${audit.category} | ${audit.status} | ${audit.auditor || "-"} | ${audit.findings} | ${audit.created} |\n`;
    }
    content += `\n`;
  }

  content += `---\n\n*Generated by implementation-indexes*\n`;

  return content;
}

// Generate ARCHITECTURE.md
function generateArchitectureIndex(items: ArchitectureItem[]): string {
  const sorted = sortItems(items, args.sort, args.reverse);

  let content = `# Architecture Index\n\n`;
  content += `**Project:** ${projectName}\n`;
  content += `**Updated:** ${timestamp}\n\n`;

  // Summary
  if (args.stats) {
    const statusCounts: Record<string, number> = {};
    for (const item of items) {
      statusCounts[item.status] = (statusCounts[item.status] || 0) + 1;
    }

    content += `## Summary\n\n`;
    content += `| Status | Count |\n`;
    content += `|--------|-------|\n`;
    for (const [status, count] of Object.entries(statusCounts).sort()) {
      content += `| ${status} | ${count} |\n`;
    }
    content += `| **Total** | **${items.length}** |\n\n`;
  }

  // All items
  content += `## Architecture Decision Records\n\n`;
  if (sorted.length === 0) {
    content += `No architecture decision records yet.\n\n`;
  } else {
    content += `| ID | Slug | Title | Status | Date |\n`;
    content += `|----|------|-------|--------|------|\n`;
    for (const item of sorted) {
      content += `| ${item.id} | ${item.slug} | ${item.title} | ${item.status} | ${item.date || "-"} |\n`;
    }
    content += `\n`;
  }

  content += `---\n\n*Generated by implementation-index*\n`;

  return content;
}

// Generate MEMENTOS.md
function generateMementosIndex(mementos: MementoItem[]): string {
  const sorted = sortItems(mementos, args.sort, args.reverse);

  let content = `# Mementos Index\n\n`;
  content += `**Project:** ${projectName}\n`;
  content += `**Updated:** ${timestamp}\n\n`;

  // Summary
  if (args.stats) {
    const categoryCounts: Record<string, number> = {};
    for (const memento of mementos) {
      categoryCounts[memento.category] = (categoryCounts[memento.category] || 0) + 1;
    }

    content += `## Summary\n\n`;
    content += `| Category | Count |\n`;
    content += `|----------|-------|\n`;
    for (const [category, count] of Object.entries(categoryCounts).sort()) {
      content += `| ${category} | ${count} |\n`;
    }
    content += `| **Total** | **${mementos.length}** |\n\n`;
  }

  // All mementos
  content += `## Recent Mementos\n\n`;
  if (sorted.length === 0) {
    content += `No mementos yet.\n\n`;
  } else {
    content += `| ID | Slug | Title | Category | Created |\n`;
    content += `|----|------|-------|----------|--------|\n`;
    for (const memento of sorted) {
      content += `| ${memento.id} | ${memento.slug} | ${memento.title} | ${memento.category} | ${memento.created} |\n`;
    }
    content += `\n`;
  }

  content += `---\n\n*Generated by implementation-index*\n`;

  return content;
}

// Main execution
async function main(): Promise<void> {
  console.log(`\nImplementation Indexes`);
  console.log(`======================\n`);
  console.log(`Project: ${projectName}`);
  console.log(`Sort by: ${args.sort}${args.reverse ? " (reversed)" : ""}\n`);

  const only = args.only as string | undefined;
  const indexesDir = path.join(implDir, "data", "indexes");

  if (!fs.existsSync(indexesDir)) {
    fs.mkdirSync(indexesDir, { recursive: true });
  }

  let todosCount = 0;
  let plansCount = 0;
  let auditsCount = 0;
  let archCount = 0;
  let mementosCount = 0;

  // Rebuild TODOS.md
  if (!only || only === "todos") {
    console.log(`Scanning todos...`);
    const todos = parseTodos();
    todosCount = todos.length;
    const content = generateTodosIndex(todos);
    fs.writeFileSync(path.join(indexesDir, "TODOS.md"), content);
    console.log(`  Found ${todos.length} todos`);
    console.log(`  Updated: TODOS.md`);
  }

  // Rebuild PLANS.md
  if (!only || only === "plans") {
    console.log(`Scanning plans...`);
    const plans = parsePlans();
    plansCount = plans.length;
    const content = generatePlansIndex(plans);
    fs.writeFileSync(path.join(indexesDir, "PLANS.md"), content);
    console.log(`  Found ${plans.length} plans`);
    console.log(`  Updated: PLANS.md`);
  }

  // Rebuild AUDITS.md
  if (!only || only === "audits") {
    console.log(`Scanning audits...`);
    const audits = parseAudits();
    auditsCount = audits.length;
    const content = generateAuditsIndex(audits);
    fs.writeFileSync(path.join(indexesDir, "AUDITS.md"), content);
    console.log(`  Found ${audits.length} audits`);
    console.log(`  Updated: AUDITS.md`);
  }

  // Rebuild ARCHITECTURE.md
  if (!only || only === "architecture") {
    console.log(`Scanning architecture...`);
    const items = parseArchitecture();
    archCount = items.length;
    const content = generateArchitectureIndex(items);
    fs.writeFileSync(path.join(indexesDir, "ARCHITECTURE.md"), content);
    console.log(`  Found ${items.length} architecture records`);
    console.log(`  Updated: ARCHITECTURE.md`);
  }

  // Rebuild MEMENTOS.md
  if (!only || only === "mementos") {
    console.log(`Scanning mementos...`);
    const mementos = parseMementos();
    mementosCount = mementos.length;
    const content = generateMementosIndex(mementos);
    fs.writeFileSync(path.join(indexesDir, "MEMENTOS.md"), content);
    console.log(`  Found ${mementos.length} mementos`);
    console.log(`  Updated: MEMENTOS.md`);
  }

  console.log(`\n${"=".repeat(40)}`);
  console.log(`\nIndexes regenerated successfully!`);
  console.log(`\nSummary:`);
  if (!only || only === "todos") console.log(`  Todos: ${todosCount}`);
  if (!only || only === "plans") console.log(`  Plans: ${plansCount}`);
  if (!only || only === "audits") console.log(`  Audits: ${auditsCount}`);
  if (!only || only === "architecture") console.log(`  Architecture: ${archCount}`);
  if (!only || only === "mementos") console.log(`  Mementos: ${mementosCount}`);
}

main().catch((error) => {
  console.error(`Error: ${error.message}`);
  process.exit(1);
});
