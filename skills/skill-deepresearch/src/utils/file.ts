import { mkdir, writeFile } from "fs/promises";
import { join, dirname } from "path";
import { homedir } from "os";
import type { ResearchReport, Source } from "../types";

const SKILL_DIR = join(homedir(), ".skills", "skill-deepresearch");
const EXPORTS_DIR = join(SKILL_DIR, "exports");
const LOGS_DIR = join(SKILL_DIR, "logs");

export async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
}

export async function ensureSkillDirs(): Promise<void> {
  await ensureDir(EXPORTS_DIR);
  await ensureDir(LOGS_DIR);
}

function generateTimestamp(): string {
  const now = new Date();
  return now.toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

function sanitizeFilename(topic: string): string {
  return topic
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50);
}

export async function saveReport(
  report: ResearchReport,
  customPath?: string
): Promise<string> {
  await ensureSkillDirs();

  const timestamp = generateTimestamp();
  const topicSlug = sanitizeFilename(report.topic);
  const filename = `report-${topicSlug}-${timestamp}.md`;
  const filepath = customPath || join(EXPORTS_DIR, filename);

  if (customPath) {
    await ensureDir(dirname(customPath));
  }

  const content = formatReport(report);
  await writeFile(filepath, content, "utf-8");

  return filepath;
}

export async function saveSourcesJson(
  sources: Source[],
  topic: string,
  customPath?: string
): Promise<string> {
  await ensureSkillDirs();

  const timestamp = generateTimestamp();
  const topicSlug = sanitizeFilename(topic);
  const filename = `sources-${topicSlug}-${timestamp}.json`;
  const filepath = customPath
    ? customPath.replace(/\.md$/, ".json")
    : join(EXPORTS_DIR, filename);

  if (customPath) {
    await ensureDir(dirname(filepath));
  }

  await writeFile(filepath, JSON.stringify(sources, null, 2), "utf-8");

  return filepath;
}

function formatReport(report: ResearchReport): string {
  const header = `# Research Report: ${report.topic}

**Generated:** ${report.generatedAt}
**Depth:** ${report.depth}
**Queries:** ${report.queryCount}
**Sources:** ${report.sourceCount}

---

`;

  const sourcesSection = `

---

## Sources

${report.sources
  .map(
    (s) =>
      `${s.id}. [${s.title}](${s.url})${s.publishedDate ? ` - ${s.publishedDate}` : ""}`
  )
  .join("\n")}
`;

  return header + report.report + sourcesSection;
}

export function getExportsDir(): string {
  return EXPORTS_DIR;
}

export function getLogsDir(): string {
  return LOGS_DIR;
}
