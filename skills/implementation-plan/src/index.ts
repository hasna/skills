#!/usr/bin/env bun

import * as fs from "fs";
import * as path from "path";
import minimist from "minimist";

// Types
interface PhaseTask {
  text: string;
  done?: boolean;
}

interface Phase {
  name: string;
  tasks: (string | PhaseTask)[];
  start?: string;
  end?: string;
  status?: "pending" | "in_progress" | "completed";
}

interface Risk {
  risk: string;
  impact: "critical" | "high" | "medium" | "low";
  mitigation: string;
}

interface PlanJsonData {
  goals?: string[];
  scope?: {
    in?: string[];
    out?: string[];
  };
  phases?: Phase[];
  dependencies?: string[];
  risks?: Risk[];
  resources?: string[];
  notes?: string;
}

interface PlanData {
  id: string;
  slug: string;
  title: string;
  description: string;
  status: "draft" | "in_progress" | "completed" | "cancelled";
  owner?: string;
  phases: string[];
  start?: string;
  end?: string;
  tags: string[];
  created: string;
  updated: string;
  jsonData?: PlanJsonData;
}

// Parse command line arguments
const args = minimist(process.argv.slice(2), {
  string: ["slug", "status", "owner", "phases", "start", "end", "tags", "content", "data"],
  boolean: ["no-index", "help"],
  default: {
    status: "draft",
    "no-index": false,
  },
  alias: {
    s: "slug",
    o: "owner",
    p: "phases",
    t: "tags",
    c: "content",
    d: "data",
    h: "help",
  },
});

// Show help
if (args.help) {
  console.log(`
Implementation Plan - Create implementation plan documents

Usage:
  skills run implementation-plan -- "<title>" [options]

Options:
  -s, --slug <name>       Slug name for the plan file (required)
  --status <status>       Status: draft, in_progress, completed, cancelled (default: draft)
  -o, --owner <name>      Person responsible for the plan
  -p, --phases <phases>   Comma-separated phase names (simple mode)
  --start <date>          Start date (YYYY-MM-DD)
  --end <date>            Target end date (YYYY-MM-DD)
  -t, --tags <tags>       Comma-separated tags
  -c, --content <text>    Additional content/description to add
  -d, --data <json>       JSON data with phases, goals, tasks, etc. (advanced mode)
  --no-index              Skip updating PLANS.md index
  -h, --help              Show this help

JSON Data Format (--data):
  {
    "goals": ["Goal 1", "Goal 2"],
    "scope": { "in": ["In scope"], "out": ["Out of scope"] },
    "phases": [
      { "name": "Phase 1", "tasks": ["Task 1", "Task 2"], "status": "pending" },
      { "name": "Phase 2", "tasks": [{ "text": "Task", "done": true }] }
    ],
    "dependencies": ["Dep 1"],
    "risks": [{ "risk": "Risk", "impact": "high", "mitigation": "Strategy" }],
    "resources": ["Resource 1"],
    "notes": "Additional notes"
  }

Examples:
  skills run implementation-plan -- "User Auth System" --slug auth-system
  skills run implementation-plan -- "API Migration" --slug api-v2 --status in_progress --owner alice
  skills run implementation-plan -- "DB Optimization" --slug db-opt --phases "Analysis,Implementation,Testing"
  skills run implementation-plan -- "Feature" --slug feature --data '{"goals":["Implement login"],"phases":[{"name":"Design","tasks":["Create wireframes"]}]}'
`);
  process.exit(0);
}

// Get title
const title = args._[0] as string;

if (!title) {
  console.error("Error: Title is required");
  console.error('Usage: skills run implementation-plan -- "<title>" --slug <slug>');
  process.exit(1);
}

// Get slug
const rawSlug = args.slug as string;

if (!rawSlug) {
  console.error("Error: --slug is required");
  console.error('Usage: skills run implementation-plan -- "<title>" --slug <slug>');
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
const outputDir = path.join(implDir, "data", "plans");

if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

// Get next sequence number
function getNextSequence(): number {
  if (!fs.existsSync(outputDir)) return 1;

  const files = fs.readdirSync(outputDir);
  let maxSeq = 0;

  for (const file of files) {
    const match = file.match(/^plan_(\d{5})_/);
    if (match) {
      const seq = parseInt(match[1], 10);
      if (seq > maxSeq) maxSeq = seq;
    }
  }

  return maxSeq + 1;
}

const sequence = getNextSequence();
const planId = `plan_${String(sequence).padStart(5, "0")}`;
const timestamp = new Date().toISOString().split("T")[0];

// Parse JSON data if provided
let jsonData: PlanJsonData | undefined;
if (args.data) {
  try {
    jsonData = JSON.parse(args.data as string);
  } catch (e) {
    console.error("Error: Invalid JSON data provided");
    console.error("Make sure to escape quotes properly in the shell");
    process.exit(1);
  }
}

// Parse phases - use JSON phases if provided, otherwise use --phases or default
const defaultPhases = ["Planning", "Implementation", "Testing", "Deployment"];
let phases: string[];

if (jsonData?.phases && jsonData.phases.length > 0) {
  phases = jsonData.phases.map((p) => p.name);
} else if (args.phases) {
  phases = (args.phases as string).split(",").map((p: string) => p.trim());
} else {
  phases = defaultPhases;
}

// Parse tags
const tags = args.tags ? (args.tags as string).split(",").map((t: string) => t.trim()) : [];

// Build plan data
const planData: PlanData = {
  id: planId,
  slug,
  title,
  description: userContent || title,
  status: args.status as PlanData["status"],
  owner: args.owner,
  phases,
  start: args.start,
  end: args.end,
  tags,
  created: timestamp,
  updated: timestamp,
  jsonData,
};

// Generate markdown content
function generateMarkdown(data: PlanData): string {
  const json = data.jsonData;
  const hasJsonData = json && Object.keys(json).length > 0;

  let content = `# Plan: ${data.title}\n\n`;

  // Metadata section
  content += `- **ID**: ${data.id}\n`;
  content += `- **Slug**: ${data.slug}\n`;
  content += `- **Status**: ${data.status}\n`;

  if (data.owner) {
    content += `- **Owner**: ${data.owner}\n`;
  }

  if (data.start) {
    content += `- **Start**: ${data.start}\n`;
  }

  if (data.end) {
    content += `- **End**: ${data.end}\n`;
  }

  if (data.tags.length > 0) {
    content += `- **Tags**: ${data.tags.join(", ")}\n`;
  }

  content += `- **Created**: ${data.created}\n`;
  content += `- **Updated**: ${data.updated}\n`;

  // Overview section
  content += `\n## Overview\n\n`;
  if (userContent) {
    content += `${userContent}\n`;
  } else {
    content += `<!-- Add a brief overview of what this plan aims to accomplish -->\n`;
  }

  // Goals section
  content += `\n## Goals\n\n`;
  if (json?.goals && json.goals.length > 0) {
    for (const goal of json.goals) {
      content += `- ${goal}\n`;
    }
  } else {
    content += `<!-- Define clear, measurable objectives for this plan -->\n`;
    content += `- [ ] Goal 1\n`;
    content += `- [ ] Goal 2\n`;
  }

  // Scope section
  content += `\n## Scope\n\n`;
  content += `### In Scope\n\n`;
  if (json?.scope?.in && json.scope.in.length > 0) {
    for (const item of json.scope.in) {
      content += `- ${item}\n`;
    }
  } else {
    content += `<!-- What is included in this implementation -->\n`;
  }

  content += `\n### Out of Scope\n\n`;
  if (json?.scope?.out && json.scope.out.length > 0) {
    for (const item of json.scope.out) {
      content += `- ${item}\n`;
    }
  } else {
    content += `<!-- What is explicitly NOT included -->\n`;
  }

  // Phases section
  content += `\n## Phases\n`;

  if (json?.phases && json.phases.length > 0) {
    // Use JSON phases with tasks
    for (let i = 0; i < json.phases.length; i++) {
      const phase = json.phases[i];
      const phaseStatus = phase.status || "pending";
      content += `\n### Phase ${i + 1}: ${phase.name}\n\n`;

      if (phase.start || phase.end) {
        content += `*`;
        if (phase.start) content += `Start: ${phase.start}`;
        if (phase.start && phase.end) content += ` | `;
        if (phase.end) content += `End: ${phase.end}`;
        content += ` | Status: ${phaseStatus}*\n\n`;
      }

      if (phase.tasks && phase.tasks.length > 0) {
        for (const task of phase.tasks) {
          if (typeof task === "string") {
            content += `- [ ] ${task}\n`;
          } else {
            const checkbox = task.done ? "[x]" : "[ ]";
            content += `- ${checkbox} ${task.text}\n`;
          }
        }
      } else {
        content += `<!-- Add tasks for this phase -->\n`;
      }
    }
  } else {
    // Use simple phase names
    for (let i = 0; i < data.phases.length; i++) {
      const phase = data.phases[i];
      content += `\n### Phase ${i + 1}: ${phase}\n\n`;
      content += `<!-- Add tasks for this phase -->\n`;
      content += `- [ ] \n`;
    }
  }

  // Timeline section
  content += `\n## Timeline\n\n`;
  content += `| Phase | Start | End | Status |\n`;
  content += `|-------|-------|-----|--------|\n`;
  if (json?.phases && json.phases.length > 0) {
    for (const phase of json.phases) {
      const start = phase.start || "TBD";
      const end = phase.end || "TBD";
      const status = phase.status || "pending";
      content += `| ${phase.name} | ${start} | ${end} | ${status} |\n`;
    }
  } else {
    for (const phase of data.phases) {
      content += `| ${phase} | TBD | TBD | pending |\n`;
    }
  }

  // Dependencies section
  content += `\n## Dependencies\n\n`;
  if (json?.dependencies && json.dependencies.length > 0) {
    for (const dep of json.dependencies) {
      content += `- ${dep}\n`;
    }
  } else {
    content += `<!-- List prerequisites and dependencies -->\n`;
  }

  // Risks section
  content += `\n## Risks\n\n`;
  content += `| Risk | Impact | Mitigation |\n`;
  content += `|------|--------|------------|\n`;
  if (json?.risks && json.risks.length > 0) {
    for (const risk of json.risks) {
      content += `| ${risk.risk} | ${risk.impact} | ${risk.mitigation} |\n`;
    }
  } else {
    content += `| <!-- Risk description --> | <!-- critical/high/medium/low --> | <!-- Mitigation strategy --> |\n`;
  }

  // Resources section
  content += `\n## Resources\n\n`;
  if (json?.resources && json.resources.length > 0) {
    for (const resource of json.resources) {
      content += `- ${resource}\n`;
    }
  } else {
    content += `<!-- Add links to documentation, tools, references -->\n`;
    content += `- \n`;
  }

  // Open Questions section
  content += `\n## Open Questions\n\n`;
  content += `<!-- Track unresolved questions and decisions needed -->\n`;
  content += `- [ ] \n`;

  // Notes section
  content += `\n## Notes\n\n`;
  if (json?.notes) {
    content += `${json.notes}\n`;
  } else {
    content += `<!-- Additional context and notes -->\n`;
  }

  // Progress Log
  content += `\n## Progress Log\n\n`;
  content += `| Date | Update |\n`;
  content += `|------|--------|\n`;
  content += `| ${data.created} | Plan created |\n`;

  return content;
}

// Update index file
function updateIndex(data: PlanData, filename: string): void {
  const indexPath = path.join(implDir, "data", "indexes", "PLANS.md");

  if (!fs.existsSync(indexPath)) {
    console.error("Warning: PLANS.md index not found, skipping index update");
    return;
  }

  let content = fs.readFileSync(indexPath, "utf-8");

  // Find the "No plans yet" placeholder and replace it, or add new row
  const newRow = `| ${data.id} | ${filename} | ${data.title} | ${data.status} | ${data.created} |`;

  if (content.includes("| - | - | No plans yet | - | - |")) {
    content = content.replace("| - | - | No plans yet | - | - |", newRow);
  } else {
    // Find the end of the Active Plans table and add new row
    const tableMatch = content.match(/(## Active Plans[\s\S]*?\|[-|]+\|[-|]+\|[-|]+\|[-|]+\|[-|]+\|)/);
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
  console.log(`\nImplementation Plan`);
  console.log(`===================\n`);

  // Generate filename
  const filename = `${planId}_${slug}.md`;
  const outputPath = path.join(outputDir, filename);

  // Generate content
  const content = generateMarkdown(planData);

  // Write file
  fs.writeFileSync(outputPath, content);

  console.log(`Created: ${outputPath}`);
  console.log(`\nPlan Details:`);
  console.log(`  ID: ${planData.id}`);
  console.log(`  Title: ${planData.title}`);
  console.log(`  Slug: ${planData.slug}`);
  console.log(`  Status: ${planData.status}`);

  if (planData.owner) {
    console.log(`  Owner: ${planData.owner}`);
  }

  if (planData.start) {
    console.log(`  Start: ${planData.start}`);
  }

  if (planData.end) {
    console.log(`  End: ${planData.end}`);
  }

  console.log(`  Phases: ${planData.phases.join(", ")}`);

  if (planData.tags.length > 0) {
    console.log(`  Tags: ${planData.tags.join(", ")}`);
  }

  // Update index
  if (!args["no-index"]) {
    console.log(`\nUpdating PLANS.md index...`);
    updateIndex(planData, filename);
    console.log(`Index updated.`);
  }

  console.log(`\n${"=".repeat(40)}`);
  console.log(`\nPlan created successfully!`);
  console.log(`File: .implementation/data/plans/${filename}`);
}

main().catch((error) => {
  console.error(`Error: ${error.message}`);
  process.exit(1);
});
