#!/usr/bin/env bun

import * as fs from "fs";
import * as path from "path";
import minimist from "minimist";

// Types
interface Finding {
  id?: string;
  title: string;
  location?: string;
  description: string;
  recommendation?: string;
}

interface AuditJsonData {
  summary?: string;
  findings?: {
    critical?: Finding[];
    high?: Finding[];
    medium?: Finding[];
    low?: Finding[];
    info?: Finding[];
  };
  recommendations?: string[];
  actionItems?: (string | { text: string; done?: boolean })[];
  references?: string[];
  notes?: string;
}

interface AuditData {
  id: string;
  slug: string;
  title: string;
  description: string;
  category: "security" | "performance" | "quality" | "accessibility" | "general";
  status: "draft" | "in_progress" | "completed" | "reviewed";
  scope?: string;
  auditor?: string;
  tags: string[];
  findings: {
    critical: number;
    high: number;
    medium: number;
    low: number;
    info: number;
  };
  created: string;
  updated: string;
  jsonData?: AuditJsonData;
}

// Parse command line arguments
const args = minimist(process.argv.slice(2), {
  string: ["slug", "scope", "auditor", "category", "status", "tags", "content", "data"],
  boolean: ["no-index", "help"],
  default: {
    category: "general",
    status: "in_progress",
    "no-index": false,
  },
  alias: {
    s: "slug",
    a: "auditor",
    t: "tags",
    d: "data",
    h: "help",
  },
});

// Show help
if (args.help) {
  console.log(`
Implementation Audit - Create code audit reports

Usage:
  skills run implementation-audit -- "<title>" [options]

Options:
  -s, --slug <name>       Slug name for the audit file (required)
  --scope <path>          Files/directories being audited (glob pattern)
  -a, --auditor <name>    Person conducting the audit
  --category <type>       Category: security, performance, quality, accessibility, general (default: general)
  --status <status>       Status: draft, in_progress, completed, reviewed (default: in_progress)
  -t, --tags <tags>       Comma-separated tags
  --content <text>        Additional content/description to add
  -d, --data <json>       JSON data with findings, recommendations, etc.
  --no-index              Skip updating AUDITS.md index
  -h, --help              Show this help

JSON Data Format (--data):
  {
    "summary": "Brief overview of findings",
    "findings": {
      "critical": [{ "title": "SQL Injection", "location": "src/db.ts:42", "description": "Unparameterized query", "recommendation": "Use prepared statements" }],
      "high": [],
      "medium": [],
      "low": [],
      "info": []
    },
    "recommendations": ["Implement input validation", "Add security headers"],
    "actionItems": ["Review all database queries", { "text": "Update dependencies", "done": true }],
    "references": ["https://owasp.org/Top10"],
    "notes": "Additional notes"
  }

Examples:
  skills run implementation-audit -- "Security Review" --slug security-review
  skills run implementation-audit -- "API Audit" --slug api-audit --category security --auditor alice
  skills run implementation-audit -- "Audit" --slug audit --data '{"findings":{"high":[{"title":"Issue","description":"Description"}]}}'
`);
  process.exit(0);
}

// Get title
const title = args._[0] as string;

if (!title) {
  console.error("Error: Title is required");
  console.error('Usage: skills run implementation-audit -- "<title>" --slug <slug>');
  process.exit(1);
}

// Get slug
const rawSlug = args.slug as string;

if (!rawSlug) {
  console.error("Error: --slug is required");
  console.error('Usage: skills run implementation-audit -- "<title>" --slug <slug>');
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
const outputDir = path.join(implDir, "data", "audits");

if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

// Get next sequence number
function getNextSequence(): number {
  if (!fs.existsSync(outputDir)) return 1;

  const files = fs.readdirSync(outputDir);
  let maxSeq = 0;

  for (const file of files) {
    const match = file.match(/^audit_(\d{5})_/);
    if (match) {
      const seq = parseInt(match[1], 10);
      if (seq > maxSeq) maxSeq = seq;
    }
  }

  return maxSeq + 1;
}

const sequence = getNextSequence();
const auditId = `audit_${String(sequence).padStart(5, "0")}`;
const timestamp = new Date().toISOString().split("T")[0];

// Parse JSON data if provided
let jsonData: AuditJsonData | undefined;
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

// Count findings from JSON data
function countFindings(): { critical: number; high: number; medium: number; low: number; info: number } {
  if (!jsonData?.findings) {
    return { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  }
  return {
    critical: jsonData.findings.critical?.length || 0,
    high: jsonData.findings.high?.length || 0,
    medium: jsonData.findings.medium?.length || 0,
    low: jsonData.findings.low?.length || 0,
    info: jsonData.findings.info?.length || 0,
  };
}

// Build audit data
const auditData: AuditData = {
  id: auditId,
  slug,
  title,
  description: userContent || title,
  category: args.category as AuditData["category"],
  status: args.status as AuditData["status"],
  scope: args.scope,
  auditor: args.auditor,
  tags,
  findings: countFindings(),
  created: timestamp,
  updated: timestamp,
  jsonData,
};

// Get category description
function getCategoryDescription(category: string): string {
  const descriptions: Record<string, string> = {
    security: "Security vulnerabilities, authentication issues, data exposure risks",
    performance: "Performance bottlenecks, slow queries, memory issues, optimization opportunities",
    quality: "Code quality issues, complexity, duplication, test coverage, documentation",
    accessibility: "Accessibility issues, WCAG compliance, screen reader support, keyboard navigation",
    general: "General code review findings, best practices, architecture concerns",
  };
  return descriptions[category] || descriptions.general;
}

// Helper to render findings table
function renderFindingsTable(findings: Finding[] | undefined, noFindingsText: string, idPrefix: string): string {
  let content = `| ID | Title | Location | Description | Recommendation |\n`;
  content += `|----|-------|----------|-------------|----------------|\n`;

  if (findings && findings.length > 0) {
    findings.forEach((finding, index) => {
      const id = finding.id || `${idPrefix}-${index + 1}`;
      const location = finding.location || "-";
      const recommendation = finding.recommendation || "-";
      content += `| ${id} | ${finding.title} | ${location} | ${finding.description} | ${recommendation} |\n`;
    });
  } else {
    content += `| - | ${noFindingsText} | - | - | - |\n`;
  }

  return content;
}

// Generate markdown content
function generateMarkdown(data: AuditData): string {
  const json = data.jsonData;
  const total = data.findings.critical + data.findings.high + data.findings.medium + data.findings.low + data.findings.info;

  let content = `# Audit: ${data.title}\n\n`;

  // Metadata
  content += `- **ID**: ${data.id}\n`;
  content += `- **Slug**: ${data.slug}\n`;
  content += `- **Category**: ${data.category}\n`;
  content += `- **Status**: ${data.status}\n`;

  if (data.auditor) {
    content += `- **Auditor**: ${data.auditor}\n`;
  }

  if (data.scope) {
    content += `- **Scope**: \`${data.scope}\`\n`;
  }

  if (data.tags.length > 0) {
    content += `- **Tags**: ${data.tags.join(", ")}\n`;
  }

  content += `- **Created**: ${data.created}\n`;
  content += `- **Updated**: ${data.updated}\n`;

  // Scope section
  content += `\n## Scope\n\n`;
  if (data.scope) {
    content += `Files/modules being audited: \`${data.scope}\`\n\n`;
  }
  content += `${getCategoryDescription(data.category)}\n`;

  // Executive Summary
  content += `\n## Executive Summary\n\n`;
  if (json?.summary) {
    content += `${json.summary}\n\n`;
  } else if (userContent) {
    content += `${userContent}\n\n`;
  } else {
    content += `<!-- Add executive summary of audit findings -->\n\n`;
  }
  content += `- **Total Findings**: ${total}\n`;
  content += `- **Critical**: ${data.findings.critical}\n`;
  content += `- **High**: ${data.findings.high}\n`;
  content += `- **Medium**: ${data.findings.medium}\n`;
  content += `- **Low**: ${data.findings.low}\n`;
  content += `- **Info**: ${data.findings.info}\n`;

  // Findings section
  content += `\n## Findings\n`;

  content += `\n### Critical\n\n`;
  content += renderFindingsTable(json?.findings?.critical, "No critical findings", "CRIT");

  content += `\n### High\n\n`;
  content += renderFindingsTable(json?.findings?.high, "No high findings", "HIGH");

  content += `\n### Medium\n\n`;
  content += renderFindingsTable(json?.findings?.medium, "No medium findings", "MED");

  content += `\n### Low\n\n`;
  content += renderFindingsTable(json?.findings?.low, "No low findings", "LOW");

  content += `\n### Info\n\n`;
  content += renderFindingsTable(json?.findings?.info, "No informational findings", "INFO");

  // Statistics
  content += `\n## Statistics\n\n`;
  content += `| Severity | Count |\n`;
  content += `|----------|-------|\n`;
  content += `| Critical | ${data.findings.critical} |\n`;
  content += `| High | ${data.findings.high} |\n`;
  content += `| Medium | ${data.findings.medium} |\n`;
  content += `| Low | ${data.findings.low} |\n`;
  content += `| Info | ${data.findings.info} |\n`;
  content += `| **Total** | **${total}** |\n`;

  // Recommendations
  content += `\n## Recommendations\n\n`;
  if (json?.recommendations && json.recommendations.length > 0) {
    json.recommendations.forEach((rec, i) => {
      content += `${i + 1}. ${rec}\n`;
    });
  } else {
    content += `<!-- Add recommendations based on findings -->\n`;
    content += `1. \n`;
  }

  // Action Items
  content += `\n## Action Items\n\n`;
  if (json?.actionItems && json.actionItems.length > 0) {
    for (const item of json.actionItems) {
      if (typeof item === "string") {
        content += `- [ ] ${item}\n`;
      } else {
        const checkbox = item.done ? "[x]" : "[ ]";
        content += `- ${checkbox} ${item.text}\n`;
      }
    }
  } else {
    content += `<!-- Add action items to remediate findings -->\n`;
    content += `- [ ] \n`;
  }

  // References
  content += `\n## References\n\n`;
  if (json?.references && json.references.length > 0) {
    for (const ref of json.references) {
      content += `- ${ref}\n`;
    }
  } else {
    content += `<!-- Add relevant references and documentation -->\n`;
  }

  // Notes
  content += `\n## Notes\n\n`;
  if (json?.notes) {
    content += `${json.notes}\n`;
  } else {
    content += `<!-- Additional notes and observations -->\n`;
  }

  // Audit Log
  content += `\n## Audit Log\n\n`;
  content += `| Date | Action | By |\n`;
  content += `|------|--------|----|\n`;
  content += `| ${data.created} | Audit created | ${data.auditor || "Unknown"} |\n`;

  return content;
}

// Update index file
function updateIndex(data: AuditData, filename: string): void {
  const indexPath = path.join(implDir, "data", "indexes", "AUDITS.md");

  if (!fs.existsSync(indexPath)) {
    console.error("Warning: AUDITS.md index not found, skipping index update");
    return;
  }

  let content = fs.readFileSync(indexPath, "utf-8");

  // Calculate total findings
  const totalFindings = data.findings.critical + data.findings.high + data.findings.medium + data.findings.low + data.findings.info;

  // Find the "No audits yet" placeholder and replace it, or add new row
  const newRow = `| ${data.id} | ${filename} | ${data.scope || "-"} | ${data.created} | ${totalFindings} |`;

  if (content.includes("| - | - | No audits yet | - | - |")) {
    content = content.replace("| - | - | No audits yet | - | - |", newRow);
  } else {
    // Find the end of the Recent Audits table and add new row
    const tableMatch = content.match(/(## Recent Audits[\s\S]*?\|[-|]+\|[-|]+\|[-|]+\|[-|]+\|[-|]+\|)/);
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
  console.log(`\nImplementation Audit`);
  console.log(`====================\n`);

  // Generate filename
  const filename = `${auditId}_${slug}.md`;
  const outputPath = path.join(outputDir, filename);

  // Generate content
  const content = generateMarkdown(auditData);

  // Write file
  fs.writeFileSync(outputPath, content);

  console.log(`Created: ${outputPath}`);
  console.log(`\nAudit Details:`);
  console.log(`  ID: ${auditData.id}`);
  console.log(`  Title: ${auditData.title}`);
  console.log(`  Slug: ${auditData.slug}`);
  console.log(`  Category: ${auditData.category}`);
  console.log(`  Status: ${auditData.status}`);

  if (auditData.auditor) {
    console.log(`  Auditor: ${auditData.auditor}`);
  }

  if (auditData.scope) {
    console.log(`  Scope: ${auditData.scope}`);
  }

  if (auditData.tags.length > 0) {
    console.log(`  Tags: ${auditData.tags.join(", ")}`);
  }

  // Update index
  if (!args["no-index"]) {
    console.log(`\nUpdating AUDITS.md index...`);
    updateIndex(auditData, filename);
    console.log(`Index updated.`);
  }

  console.log(`\n${"=".repeat(40)}`);
  console.log(`\nAudit created successfully!`);
  console.log(`File: .implementation/data/audits/${filename}`);
  console.log(`\nNext steps:`);
  console.log(`  - Fill in findings for each severity level`);
  console.log(`  - Update executive summary`);
  console.log(`  - Add recommendations and action items`);
  console.log(`  - Use 'implementation-todo' to create action items from findings`);
}

main().catch((error) => {
  console.error(`Error: ${error.message}`);
  process.exit(1);
});
