/**
 * Skill info - reads docs, requirements, and metadata from skill source
 */

import { existsSync, readFileSync, readdirSync } from "fs";
import { join } from "path";
import { getSkillPath } from "./installer.js";
import { getSkill } from "./registry.js";
import { normalizeSkillName } from "./utils.js";

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
 * Get the best available documentation for a skill (SKILL.md > README.md > CLAUDE.md)
 */
export function getSkillBestDoc(name: string): string | null {
  const docs = getSkillDocs(name);
  if (!docs) return null;
  return docs.skillMd || docs.readme || docs.claudeMd || null;
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
  const allText = texts.join("\n");

  // Extract env vars
  const envVars = extractEnvVars(allText);

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

  // Read CLI command from package.json
  let cliCommand: string | null = null;
  let dependencies: Record<string, string> = {};
  const pkgPath = join(skillPath, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
      if (pkg.bin) {
        const binKeys = Object.keys(pkg.bin);
        if (binKeys.length > 0) cliCommand = binKeys[0];
      }
      dependencies = pkg.dependencies || {};
    } catch {}
  }

  return {
    envVars: Array.from(envVars).sort(),
    systemDeps: Array.from(systemDeps).sort(),
    cliCommand,
    dependencies,
  };
}

/**
 * Run a skill by name with given arguments
 */
export async function runSkill(
  name: string,
  args: string[],
  options: { installed?: boolean } = {}
): Promise<{ exitCode: number; error?: string }> {
  // Look in .skills/ first (installed), then fall back to package skills/
  const skillName = normalizeSkillName(name);
  let skillPath: string;

  if (options.installed) {
    skillPath = join(process.cwd(), ".skills", skillName);
  } else {
    // Check installed first
    const installedPath = join(process.cwd(), ".skills", skillName);
    if (existsSync(installedPath)) {
      skillPath = installedPath;
    } else {
      skillPath = getSkillPath(name);
    }
  }

  if (!existsSync(skillPath)) {
    return { exitCode: 1, error: `Skill '${name}' not found` };
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

  // Install deps if node_modules missing
  const nodeModules = join(skillPath, "node_modules");
  if (!existsSync(nodeModules)) {
    const install = Bun.spawn(["bun", "install", "--no-save"], {
      cwd: skillPath,
      stdout: "pipe",
      stderr: "pipe",
    });
    await install.exited;
  }

  // Run the skill
  const proc = Bun.spawn(["bun", "run", entryPath, ...args], {
    cwd: skillPath,
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
  });

  const exitCode = await proc.exited;
  return { exitCode };
}

/**
 * Generate a .env.example from installed skills
 */
export function generateEnvExample(targetDir: string = process.cwd()): string {
  const skillsDir = join(targetDir, ".skills");
  if (!existsSync(skillsDir)) return "";

  const dirs = readdirSync(skillsDir).filter(
    (f) => f.startsWith("skill-") && existsSync(join(skillsDir, f, "package.json"))
  );

  const envMap = new Map<string, string[]>();

  for (const dir of dirs) {
    const skillName = dir.replace("skill-", "");
    const skillPath = join(skillsDir, dir);

    const texts: string[] = [];
    for (const file of ["SKILL.md", "README.md", "CLAUDE.md", ".env.example"]) {
      const content = readIfExists(join(skillPath, file));
      if (content) texts.push(content);
    }
    const allText = texts.join("\n");

    const foundVars = extractEnvVars(allText);
    for (const envVar of foundVars) {
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
    "# Environment variables for installed skills",
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

function readIfExists(path: string): string | null {
  try {
    if (existsSync(path)) {
      return readFileSync(path, "utf-8");
    }
  } catch {}
  return null;
}
