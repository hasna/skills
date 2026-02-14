#!/usr/bin/env bun
import { glob } from "glob";
import { readFile, writeFile } from "fs/promises";
import { join } from "path";

function showHelp(): void {
  console.log(`
skill-security-audit - Scan code for security vulnerabilities

Usage:
  skills run security-audit -- [options]

Options:
  -h, --help               Show this help message
  path=<directory>         Directory to scan (default: current directory)
  output=<filename>        Output report filename

Detected Patterns:
  - AWS Access Keys (CRITICAL)
  - Private Keys (CRITICAL)
  - Generic API Keys (HIGH)
  - Hardcoded Passwords (HIGH)
  - Eval Usage (MEDIUM)
  - Insecure HTTP URLs (LOW)

Output:
  Generates a Markdown report with:
  - Files scanned count
  - Findings by severity
  - File, line number, and matched content

Examples:
  skills run security-audit -- path=./src
  skills run security-audit -- path=./src output=audit-report.md
`);
}

const args = process.argv.slice(2);

// Check for help flag
if (args.includes("-h") || args.includes("--help")) {
  showHelp();
  process.exit(0);
}
const pathArg = args.find(a => a.startsWith("path="))?.split("=")[1] || ".";
const outputArg = args.find(a => a.startsWith("output="))?.split("=")[1];

// Simple regex patterns for demonstration
const PATTERNS = [
  { name: "AWS Access Key", regex: /AKIA[0-9A-Z]{16}/, severity: "CRITICAL" },
  { name: "Private Key", regex: /-----BEGIN PRIVATE KEY-----/, severity: "CRITICAL" },
  { name: "Generic API Key", regex: /api_key\s*[:=]\s*['"][a-zA-Z0-9]{20,}['"]/, severity: "HIGH" },
  { name: "Hardcoded Password", regex: /password\s*[:=]\s*['"][a-zA-Z0-9]{8,}['"]/, severity: "HIGH" },
  { name: "Eval Usage", regex: /eval\(/, severity: "MEDIUM" },
  { name: "Insecure HTTP", regex: /http:\/\//, severity: "LOW" },
];

interface Finding {
  file: string;
  line: number;
  pattern: string;
  severity: string;
  match: string;
}

async function main() {
  console.log(`Scanning ${pathArg}...`);

  const files = await glob("**/*.{js,ts,json,yml,yaml,env,md}", { 
    cwd: pathArg, 
    ignore: ["**/node_modules/**", "**/.git/**", "**/dist/**", "**/build/**"] 
  });

  const findings: Finding[] = [];

  for (const file of files) {
    const content = await readFile(join(pathArg, file), "utf-8");
    const lines = content.split("\n");

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      for (const pattern of PATTERNS) {
        if (pattern.regex.test(line)) {
          findings.push({
            file,
            line: i + 1,
            pattern: pattern.name,
            severity: pattern.severity,
            match: line.trim().substring(0, 100) // Truncate for display
          });
        }
      }
    }
  }

  // Generate Report
  let report = "# Security Audit Report\n\n";
  report += `**Scan Path:** ${pathArg}\n`;
  report += `**Files Scanned:** ${files.length}\n`;
  report += `**Findings:** ${findings.length}\n\n`;

  if (findings.length > 0) {
    report += "| Severity | Pattern | File | Line | Match |\n";
    report += "|---|---|---|---|---|\n";
    for (const f of findings) {
      report += `| ${f.severity} | ${f.pattern} | ${f.file} | ${f.line} | \`${f.match.replace(/\|/g, "\\|")}\` |\n`;
    }
  } else {
    report += "✅ No vulnerabilities found.\n";
  }

  console.log(report);

  if (outputArg) {
    const outputDir = process.env.SKILLS_EXPORTS_DIR || ".";
    const outputPath = join(outputDir, outputArg);
    await writeFile(outputPath, report);
    console.log(`Report saved to ${outputPath}`);
  } else if (process.env.SKILLS_EXPORTS_DIR) {
      // Always save a report if running in runner
      const outputPath = join(process.env.SKILLS_EXPORTS_DIR, "security-audit-report.md");
      await writeFile(outputPath, report);
  }
}

main();
