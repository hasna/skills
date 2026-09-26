import { hasDependencyPreparationMarker, prepareSkillDependencies } from "./dependency-preparation";
/**
 * Skill info - reads docs, requirements, and metadata from skill source
 */

import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { getInstalledSkills, getSkillPath } from "./installer.js";
import { getSkill, loadRegistry, type SkillMeta } from "./registry.js";
import { normalizeSkillName } from "./utils.js";
import { parseSkillFrontmatter } from "./skill-validation.js";
import { resolveSkillDocFile, selectSkillDoc } from "./skill-doc-file.js";

/**
 * Detect whether a skill directory is an instruction (prose-only) skill.
 * Instruction skills are declared via `kind: instruction` in SKILL.md
 * frontmatter and are consumed by agents, not run locally.
 */
function isInstructionSkillDir(skillPath: string, meta?: SkillMeta): boolean {
  if (meta?.kind === "instruction") return true;
  const skillMdPath = join(skillPath, "SKILL.md");
  if (!existsSync(skillMdPath)) return false;
  try {
    return parseSkillFrontmatter(readFileSync(skillMdPath, "utf-8"))?.kind === "instruction";
  } catch {
    return false;
  }
}

export interface SkillDocs {
  skillMd: string | null;
  readme: string | null;
  claudeMd: string | null;
}

export interface SkillRequirements {
  envVars: string[];
  systemDeps: string[];
  cliCommand: string | null;
  dependencies: Record<string, string>;
}

const HOSTED_PROVIDER_ENV_PREFIXES = [
  "OPENAI_",
  "ANTHROPIC_",
  "GEMINI_",
  "GOOGLE_",
  "XAI_",
  "MINIMAX_",
  "ELEVENLABS_",
  "DEEPGRAM_",
  "REPLICATE_",
  "FAL_",
  "STABILITY_",
  "EXA_",
  "FIRECRAWL_",
  "AWS_",
];

/**
 * Read documentation files from a skill
 */
export function getSkillDocs(name: string): SkillDocs | null {
  const skillPath = getSkillPath(name);
  if (!existsSync(skillPath)) return null;

  return {
    skillMd: readIfExists(join(skillPath, "SKILL.md")),
    readme: readIfExists(join(skillPath, "README.md")),
    claudeMd: readIfExists(join(skillPath, "CLAUDE.md")),
  };
}

/**
 * Get preferred documentation, or an exact docs alias (skill, readme, claude).
 * Unknown aliases and missing explicitly requested files refuse without fallback.
 */
export function getSkillBestDoc(name: string, file?: string): string | null {
  resolveSkillDocFile(file);
  const docs = getSkillDocs(name);
  if (!docs) return null;
  return selectSkillDoc(docs, file);
}

/**
 * Extract requirements from a skill's source files
 */
export function getSkillRequirements(name: string): SkillRequirements | null {
  const skillPath = getSkillPath(name);
  if (!existsSync(skillPath)) return null;

  // Read all text content to scan
  const texts: string[] = [];
  for (const file of ["SKILL.md", "README.md", "CLAUDE.md", ".env.example", ".env.local.example"]) {
    const content = readIfExists(join(skillPath, file));
    if (content) texts.push(content);
  }
  const meta = getSkill(name);
  let dependencies: Record<string, string> = {};
  try { dependencies = JSON.parse(readFileSync(join(skillPath, "package.json"), "utf8")).dependencies || {}; } catch {}
  return getSkillRequirementsFromContent(name, texts, dependencies, meta);
}

/** Shared parser for verified bundle content and explicit local authoring files. */
export function getSkillRequirementsFromContent(name: string, texts: string[], dependencies: Record<string, string> = {}, meta?: SkillMeta): SkillRequirements {
  const allText = texts.join("\n");
  const canonicalName = meta?.name ?? normalizeSkillName(name);

  // Extract env vars
  const envVars = extractEnvVars(allText);
  if (isHostedPremiumSkill(canonicalName, meta)) {
    for (const envVar of Array.from(envVars)) {
      if (HOSTED_PROVIDER_ENV_PREFIXES.some((prefix) => envVar.startsWith(prefix))) {
        envVars.delete(envVar);
      }
    }
    // The canonical fleet name. The unprefixed SKILLS_API_KEY alias still works
    // (the shared ladder accepts it), but what a hosted skill DOCUMENTS is the
    // name that will not be retired.
    envVars.delete("SKILL_API_KEY");
    envVars.delete("SKILLS_API_KEY");
    envVars.add("HASNA_SKILLS_API_KEY");
  }

  // Extract system deps
  const systemDeps = new Set<string>();
  const depPatterns: [RegExp, string][] = [
    [/\bffmpeg\b/i, "ffmpeg"],
    [/\bplaywright\b/i, "playwright"],
    [/\bchromium\b/i, "chromium"],
    [/\bpuppeteer\b/i, "puppeteer"],
    [/\bpython3?\b/i, "python"],
    [/\bdocker\b/i, "docker"],
    [/\bpandoc\b/i, "pandoc"],
    [/\bimageMagick\b|imagemagick|\bconvert\b.*image/i, "imagemagick"],
    [/\bwkhtmltopdf\b/i, "wkhtmltopdf"],
    [/\bgit\b(?! ?(hub|lab|ignore))/i, "git"],
  ];
  for (const [pattern, dep] of depPatterns) {
    if (pattern.test(allText)) {
      systemDeps.add(dep);
    }
  }

  // User-facing execution goes through the root CLI. package.json bin entries
  // are implementation details for runSkill() resolution.
  const skillName = normalizeSkillName(name);
  let cliCommand: string | null = `skills run ${skillName}`;
  return {
    envVars: Array.from(envVars).sort(),
    systemDeps: Array.from(systemDeps).sort(),
    cliCommand,
    dependencies,
  };
}

function isHostedPremiumSkill(skillName: string, meta?: SkillMeta): boolean {
  return Boolean(meta?.tags.includes("premium") || meta?.tags.includes("remote"));
}

export interface SkillDependencyStatus {
  name: string;
  version: string;
  installed: boolean;
}

/**
 * Check whether `pkgName` is resolvable from `fromDir` using node_modules
 * resolution: walk up ancestor directories looking for
 * `node_modules/<pkgName>/package.json`. Handles scoped packages because
 * `pkgName` already contains the `@scope/` prefix. This mirrors how a skill
 * actually imports the dependency at runtime.
 */
function isPackageResolvable(pkgName: string, fromDir: string): boolean {
  let dir = fromDir;
  while (true) {
    if (existsSync(join(dir, "node_modules", pkgName, "package.json"))) return true;
    const parent = join(dir, "..");
    if (parent === dir) return false;
    dir = parent;
  }
}

/**
 * Resolve npm dependency install status for a skill.
 *
 * A dependency counts as installed only when it is resolvable from the skill
 * directory (the skill's own node_modules or any ancestor node_modules),
 * matching how the skill imports it when it runs. This keeps the doctor/test
 * readiness signal truthful: a runnable skill that imports `xlsx` is not
 * "ready" until `xlsx` is actually installed, even if every env var is set.
 */
export function getSkillDependencyStatus(name: string): SkillDependencyStatus[] {
  const skillPath = getSkillPath(name);
  const reqs = getSkillRequirements(name);
  const deps = reqs?.dependencies ?? {};
  return Object.entries(deps).map(([pkgName, version]) => ({
    name: pkgName,
    version: version as string,
    installed: isPackageResolvable(pkgName, skillPath),
  }));
}

/**
 * Run a skill by name with given arguments
 */
export async function runSkill(
  name: string,
  args: string[],
  options: { installed?: boolean; stdio?: "inherit" | "pipe" | "stderr"; env?: Record<string, string>; preparationTimeoutMs?: number } = {}
): Promise<{ exitCode: number; error?: string; stdout?: string; stderr?: string }> {
  // Skills execute from the bundled package source. Project `.skills/` is only
  // for pins, run metadata, logs, and exports; it is never a source directory.
  const meta = getSkill(name);
  const canonicalName = meta?.name ?? name;
  const skillPath = getSkillPath(canonicalName);

  if (!existsSync(skillPath)) {
    return { exitCode: 1, error: `Skill '${name}' not found` };
  }

  // Instruction skills are prose-only and are consumed by agents, not executed.
  if (isInstructionSkillDir(skillPath, meta)) {
    return {
      exitCode: 1,
      error: `Skill '${name}' is an instruction skill (kind: instruction) and is not runnable. Instruction skills are consumed by coding agents via SKILL.md, not executed with 'skills run'.`,
    };
  }

  // Read package.json for bin entry
  const pkgPath = join(skillPath, "package.json");
  if (!existsSync(pkgPath)) {
    return { exitCode: 1, error: `No package.json in skill '${name}'` };
  }

  let entryPoint: string;
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    if (pkg.bin) {
      const binValues = Object.values(pkg.bin) as string[];
      entryPoint = binValues[0];
    } else if (pkg.scripts?.dev) {
      // Parse "bun run bin/cli.ts" -> "bin/cli.ts"
      const devScript = pkg.scripts.dev as string;
      const match = devScript.match(/(?:bun\s+run\s+)(.+)/);
      entryPoint = match ? match[1] : "bin/cli.ts";
    } else {
      entryPoint = "bin/cli.ts";
    }
  } catch {
    return { exitCode: 1, error: `Failed to parse package.json for skill '${name}'` };
  }

  const entryPath = join(skillPath, entryPoint);
  if (!existsSync(entryPath)) {
    return { exitCode: 1, error: `Entry point '${entryPoint}' not found in skill '${name}'` };
  }

  const env = { ...process.env, ...options.env };
  // Preparation and execution must use the same selected HOME, cache and PATH.
  // Failed preparation is terminal: never run an entry with incomplete deps.
  if (!existsSync(join(skillPath, "node_modules")) || hasDependencyPreparationMarker(skillPath)) {
    const failure = await prepareSkillDependencies(skillPath, env, options.preparationTimeoutMs);
    if (failure) return failure;
  }

  // Run the skill
  const proc = Bun.spawn(["bun", "run", entryPath, ...args], {
    cwd: skillPath,
    // Structured command output owns fd1. Stream child diagnostics directly to
    // fd2 in stderr mode; do not accumulate them in an unbounded string buffer.
    stdout: options.stdio === "pipe" ? "pipe" : options.stdio === "stderr" ? 2 : "inherit",
    stderr: options.stdio === "pipe" ? "pipe" : "inherit",
    stdin: "inherit",
    env,
  });

  if (options.stdio === "pipe") {
    // This branch requested a pipe; the numeric stdout descriptor belongs only
    // to stderr mode and cannot reach this existing capture path.
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout as ReadableStream<Uint8Array>).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { exitCode, stdout, stderr };
  }

  const exitCode = await proc.exited;
  return { exitCode };
}

export interface DetectedProjectSkills {
  detected: string[];
  recommended: SkillMeta[];
}

/**
 * Detect project type from package.json and recommend relevant skills
 */
export function detectProjectSkills(cwd: string = process.cwd()): DetectedProjectSkills {
  let pkg: unknown;
  try { pkg = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8")); }
  catch { return { detected: [], recommended: [] }; }
  if (!pkg || typeof pkg !== "object" || Array.isArray(pkg)) return { detected: [], recommended: [] };
  const fields = pkg as Record<string, unknown>;
  const dependencies = [fields.dependencies, fields.devDependencies].flatMap(value =>
    value && typeof value === "object" && !Array.isArray(value) ? Object.keys(value) : []);
  const detected = [...new Set(dependencies)].sort();
  const tags = new Set(detected.map(name => name.toLowerCase()));
  const families: Record<string, readonly string[]> = {
    frontend: ["next", "react", "vue", "svelte", "nuxt", "@nuxtjs/nuxt"],
    backend: ["express", "fastify", "hono", "koa", "@hono/hono"],
    ai: ["@anthropic-ai/sdk", "openai", "@openai/openai", "anthropic"],
    payments: ["stripe"], email: ["nodemailer", "@sendgrid/mail", "@sendgrid/client"],
    testing: ["vitest", "jest", "mocha", "@jest/core"],
  };
  for (const [family, names] of Object.entries(families)) {
    if (names.some(name => detected.some(dep => dep === name || dep.startsWith(`${name}/`)))) tags.add(family);
  }
  // Recommendations follow the owner's metadata; no package-owned skill names
  // or implicit default selection can inject an unrelated catalog entry.
  const recommended = loadRegistry().filter(skill => skill.tags.some(tag => tags.has(tag.toLowerCase())));
  return { detected, recommended };
}

/**
 * Generate a .env.example from pinned skills
 */
export function generateEnvExample(targetDir: string = process.cwd()): string {
  const dirs = getInstalledSkills(targetDir);
  if (!dirs.length) return "";

  const envMap = new Map<string, string[]>();

  for (const dir of dirs) {
    const skillName = normalizeSkillName(dir);
    const reqs = getSkillRequirements(skillName);
    for (const envVar of reqs?.envVars ?? []) {
      if (!envMap.has(envVar)) {
        envMap.set(envVar, []);
      }
      if (!envMap.get(envVar)!.includes(skillName)) {
        envMap.get(envVar)!.push(skillName);
      }
    }
  }

  if (envMap.size === 0) return "";

  const lines = [
    "# Environment variables for pinned skills",
    "# Auto-generated by: skills init",
    "",
  ];

  // Group by provider prefix
  const sorted = Array.from(envMap.entries()).sort(([a], [b]) => a.localeCompare(b));

  let lastPrefix = "";
  for (const [envVar, skills] of sorted) {
    const prefix = envVar.split("_")[0];
    if (prefix !== lastPrefix) {
      if (lastPrefix) lines.push("");
      lines.push(`# ${prefix}`);
      lastPrefix = prefix;
    }
    lines.push(`# Used by: ${skills.join(", ")}`);
    lines.push(`${envVar}=`);
  }

  return lines.join("\n") + "\n";
}

/**
 * Generate a SKILL.md for a skill that doesn't have one.
 * Builds from registry metadata, README.md/CLAUDE.md content, and package.json info.
 */
export function generateSkillMd(name: string): string | null {
  const meta = getSkill(name);
  if (!meta) return null;

  const skillPath = getSkillPath(name);
  if (!existsSync(skillPath)) return null;

  // Build frontmatter
  const frontmatter = [
    "---",
    `name: ${meta.name}`,
    `description: ${meta.description}`,
    "---",
  ].join("\n");

  // Try to extract useful content from existing docs
  const readme = readIfExists(join(skillPath, "README.md"));
  const claudeMd = readIfExists(join(skillPath, "CLAUDE.md"));

  // Get CLI command from package.json
  let cliCommand: string | null = null;
  const pkgPath = join(skillPath, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
      if (pkg.bin) {
        const binKeys = Object.keys(pkg.bin);
        if (binKeys.length > 0) cliCommand = binKeys[0];
      }
    } catch {}
  }

  // Build body from available sources
  const sections: string[] = [];
  sections.push(`# ${meta.displayName}`);
  sections.push("");
  sections.push(meta.description);

  // Extract content from README (skip title if it duplicates)
  if (readme) {
    const lines = readme.split("\n");
    // Skip first heading if it matches the display name
    let startIdx = 0;
    if (lines[0]?.startsWith("# ")) {
      startIdx = 1;
      // Skip blank line after title
      if (lines[1]?.trim() === "") startIdx = 2;
    }
    const body = lines.slice(startIdx).join("\n").trim();
    if (body) {
      sections.push("");
      sections.push(body);
    }
  } else if (claudeMd) {
    const lines = claudeMd.split("\n");
    let startIdx = 0;
    if (lines[0]?.startsWith("# ")) {
      startIdx = 1;
      if (lines[1]?.trim() === "") startIdx = 2;
    }
    const body = lines.slice(startIdx).join("\n").trim();
    if (body) {
      sections.push("");
      sections.push(body);
    }
  }

  if (cliCommand) {
    sections.push("");
    sections.push("## CLI");
    sections.push("");
    sections.push("```bash");
    sections.push(`skills run ${meta.name}`);
    sections.push("```");
  }

  sections.push("");
  sections.push(`Category: ${meta.category}`);
  sections.push(`Tags: ${meta.tags.join(", ")}`);

  return frontmatter + "\n\n" + sections.join("\n") + "\n";
}

const ENV_VAR_PATTERN = /\b([A-Z][A-Z0-9_]{2,}(?:_API_KEY|_KEY|_TOKEN|_SECRET|_URL|_ID|_PASSWORD|_ENDPOINT|_REGION|_BUCKET))\b/g;
const GENERIC_ENV_PATTERN = /\b((?:OPENAI|ANTHROPIC|GEMINI|XAI|ELEVENLABS|DEEPGRAM|REPLICATE|FAL|STABILITY|EXA|FIRECRAWL|TWILIO|SENDGRID|RESEND|SLACK|DISCORD|NOTION|LINEAR|GITHUB|AWS|GOOGLE|CLOUDFLARE|VERCEL|SUPABASE|STRIPE)_[A-Z_]+)\b/g;

/**
 * Extract environment variable names from text using known patterns
 */
function extractEnvVars(text: string): Set<string> {
  const envVars = new Set<string>();
  for (const pattern of [ENV_VAR_PATTERN, GENERIC_ENV_PATTERN]) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(text)) !== null) {
      envVars.add(match[1]);
    }
  }
  return envVars;
}

function docsDeclareHostedRuntime(skillPath: string, text: string): boolean {
  if (/hosted skills\/connectors runtime/i.test(text) || /provider-specific keys are managed by that runtime/i.test(text)) {
    return true;
  }

  const sourceFiles = [
    join(skillPath, "src", "index.ts"),
    join(skillPath, "src", "index.js"),
    join(skillPath, "src", "index-local.ts"),
    join(skillPath, "src", "index-local.js"),
  ];

  for (const sourceFile of sourceFiles) {
    const source = readIfExists(sourceFile);
    if (source && /requiredEnvVars\s*:\s*\[\s*["'](?:HASNA_SKILLS_API_KEY|SKILLS?_API_KEY)["']\s*\]/.test(source)) {
      return true;
    }
  }

  return false;
}

function readIfExists(path: string): string | null {
  try {
    if (existsSync(path)) {
      return readFileSync(path, "utf-8");
    }
  } catch {}
  return null;
}
