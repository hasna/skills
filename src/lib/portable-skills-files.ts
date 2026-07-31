import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "fs";
import { basename, dirname, join, relative } from "path";

import type { SkillKind } from "./registry-types.js";
import { parseSkillFrontmatter } from "./skill-validation.js";
import {
  PORTABLE_SKILL_DEFAULT_VERSION,
  PORTABLE_SKILL_SCHEMA,
  PORTABLE_SKILL_STANDARD,
  type PortableSkillCommand,
  type PortableSkillInput,
  type PortableSkillManifest,
} from "./portable-skills-types.js";

interface PackageJson {
  name?: unknown;
  version?: unknown;
  description?: unknown;
  type?: unknown;
  bin?: unknown;
  scripts?: unknown;
  dependencies?: unknown;
}

// Structural / junk entries excluded at ANY depth of the source tree: VCS metadata,
// dependency trees, and macOS/agent sidecar dirs never belong in a portable skill.
const ANY_SEGMENT_COPY_EXCLUDES = new Set([
  ".git",
  ".DS_Store",
  ".system",
  "node_modules",
]);

// Build-output directories excluded only at the FIRST path segment (the skill root).
// A nested `references/build/` or `docs/dist/` is legitimate content and must survive.
const FIRST_SEGMENT_COPY_EXCLUDES = new Set([
  "dist",
  "build",
  ".turbo",
]);

const DEFAULT_INPUTS: PortableSkillInput[] = [
  {
    name: "args",
    type: "string[]",
    required: false,
    description: "Arguments passed after `skills run <name>`.",
  },
];

export function normalizePortableSkillName(name: string): string {
  const normalized = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!normalized || !/^[a-z0-9][a-z0-9._-]*$/.test(normalized)) {
    throw new Error(`Invalid skill name '${name}'. Use letters, numbers, dots, underscores, or hyphens.`);
  }
  return normalized;
}

export function readPortableSkillManifest(skillPath: string, fallbackName = basename(skillPath)): PortableSkillManifest {
  const skillJsonPath = join(skillPath, "skill.json");
  const skillMdPath = join(skillPath, "SKILL.md");
  const pkgPath = join(skillPath, "package.json");

  const jsonManifest = existsSync(skillJsonPath) ? readJsonObject(skillJsonPath) : undefined;
  const frontmatter = existsSync(skillMdPath) ? parseSkillFrontmatter(readFileSync(skillMdPath, "utf-8")) ?? undefined : undefined;
  const pkg = existsSync(pkgPath) ? readJsonObject(pkgPath) as PackageJson : undefined;

  const name = normalizePortableSkillName(
    stringField(jsonManifest, "name")
      ?? frontmatter?.name
      ?? stringValue(pkg?.name)
      ?? fallbackName,
  );
  const description = stringField(jsonManifest, "description")
    ?? frontmatter?.description
    ?? stringValue(pkg?.description)
    ?? `${name} skill`;
  const version = stringField(jsonManifest, "version")
    ?? frontmatter?.version
    ?? stringValue(pkg?.version)
    ?? PORTABLE_SKILL_DEFAULT_VERSION;
  const kind = parseSkillKind(stringField(jsonManifest, "kind") ?? frontmatter?.kind);
  const commands = parseManifestCommands(jsonManifest)
    ?? (kind === "instruction" ? [] : inferPackageCommands(pkg, name))
    ?? [];

  return {
    $schema: stringField(jsonManifest, "$schema") ?? PORTABLE_SKILL_SCHEMA,
    standard: stringField(jsonManifest, "standard") ?? PORTABLE_SKILL_STANDARD,
    name,
    description,
    version,
    displayName: stringField(jsonManifest, "displayName") ?? frontmatter?.displayName ?? displayName(name),
    category: stringField(jsonManifest, "category") ?? frontmatter?.category ?? "Development Tools",
    tags: stringArrayField(jsonManifest, "tags") ?? frontmatter?.tags ?? ["custom"],
    ...(kind ? { kind } : {}),
    inputs: kind === "instruction" ? (parseManifestInputs(jsonManifest) ?? []) : (parseManifestInputs(jsonManifest) ?? DEFAULT_INPUTS),
    commands,
  };
}

export function parseSkillKind(value: string | undefined): SkillKind | undefined {
  if (value === "executable" || value === "instruction") return value;
  return undefined;
}

export function createInstructionManifest(name: string, options: { description: string }): PortableSkillManifest {
  return {
    $schema: PORTABLE_SKILL_SCHEMA,
    standard: PORTABLE_SKILL_STANDARD,
    name,
    description: options.description,
    version: PORTABLE_SKILL_DEFAULT_VERSION,
    displayName: displayName(name),
    category: "Development Tools",
    tags: ["custom", name],
    kind: "instruction",
    inputs: [],
    commands: [],
  };
}

export function writeInstructionSkillTemplate(skillPath: string, manifest: PortableSkillManifest): void {
  mkdirSync(skillPath, { recursive: true });
  writeFileSync(join(skillPath, "SKILL.md"), renderInstructionSkillMd(manifest));
  writeFileSync(join(skillPath, "skill.json"), renderSkillJson(manifest));
}

function renderInstructionSkillMd(manifest: PortableSkillManifest): string {
  const tags = manifest.tags?.length
    ? `tags:\n${manifest.tags.map((tag) => `  - ${tag}`).join("\n")}\n`
    : "";
  return `---\nname: ${manifest.name}\ndescription: ${manifest.description}\nkind: instruction\nversion: ${manifest.version}\nsource: custom\ncategory: ${manifest.category ?? "Development Tools"}\n${tags}---\n\n# ${manifest.displayName ?? displayName(manifest.name)}\n\n${manifest.description}\n\n## Instructions\n\nWrite the agent-facing prose for this skill here. Instruction skills are consumed\nby agents through skill renderers and MCP docs; they are not executed locally.\n`;
}

export function createPortableManifest(name: string, options: { description: string }): PortableSkillManifest {
  return {
    $schema: PORTABLE_SKILL_SCHEMA,
    standard: PORTABLE_SKILL_STANDARD,
    name,
    description: options.description,
    version: PORTABLE_SKILL_DEFAULT_VERSION,
    displayName: displayName(name),
    category: "Development Tools",
    tags: ["custom", name],
    inputs: DEFAULT_INPUTS,
    commands: [{
      name,
      description: `Run ${displayName(name)}.`,
      entry: "src/index.ts",
      args: ["...args"],
    }],
  };
}

export function writePortableSkillTemplate(skillPath: string, manifest: PortableSkillManifest): void {
  mkdirSync(join(skillPath, "src"), { recursive: true });
  writeFileSync(join(skillPath, "SKILL.md"), renderSkillMd(manifest));
  writeFileSync(join(skillPath, "skill.json"), renderSkillJson(manifest));
  writeFileSync(join(skillPath, "AGENTS.md"), renderAgentsMd(manifest));
  writeFileSync(join(skillPath, "package.json"), renderPackageJson(manifest));
  writeFileSync(join(skillPath, "tsconfig.json"), renderTsconfig());
  writeFileSync(join(skillPath, "src", "index.ts"), renderEntrypoint(manifest));
}

export function ensurePortableSkillFiles(skillPath: string, manifest: PortableSkillManifest): PortableSkillManifest {
  let next = manifest;
  if (!next.commands.length) {
    next = {
      ...next,
      commands: [{
        name: next.name,
        description: `Run ${displayName(next.name)}.`,
        entry: "src/index.ts",
        args: ["...args"],
      }],
    };
  }
  if (!next.inputs.length) next = { ...next, inputs: DEFAULT_INPUTS };
  next = {
    ...next,
    standard: PORTABLE_SKILL_STANDARD,
    $schema: next.$schema ?? PORTABLE_SKILL_SCHEMA,
    displayName: next.displayName ?? displayName(next.name),
    category: next.category ?? "Development Tools",
    tags: next.tags?.length ? next.tags : ["custom", next.name],
  };

  const entry = next.commands[0]?.entry ?? "src/index.ts";
  if (entry && !existsSync(join(skillPath, entry))) {
    mkdirSync(dirname(join(skillPath, entry)), { recursive: true });
    writeFileSync(join(skillPath, entry), renderEntrypoint(next));
  }
  if (!existsSync(join(skillPath, "SKILL.md"))) writeFileSync(join(skillPath, "SKILL.md"), renderSkillMd(next));
  else writeFileSync(join(skillPath, "SKILL.md"), ensureSkillMdFrontmatter(readFileSync(join(skillPath, "SKILL.md"), "utf-8"), next));
  if (!existsSync(join(skillPath, "skill.json"))) writeFileSync(join(skillPath, "skill.json"), renderSkillJson(next));
  if (!existsSync(join(skillPath, "AGENTS.md"))) writeFileSync(join(skillPath, "AGENTS.md"), renderAgentsMd(next));
  ensurePackageJson(skillPath, next);
  if (!existsSync(join(skillPath, "tsconfig.json"))) writeFileSync(join(skillPath, "tsconfig.json"), renderTsconfig());
  return readPortableSkillManifest(skillPath, next.name);
}

function ensurePackageJson(skillPath: string, manifest: PortableSkillManifest): void {
  const pkgPath = join(skillPath, "package.json");
  const first = manifest.commands[0] ?? { name: manifest.name, entry: "src/index.ts" };
  const commandName = normalizePortableSkillName(first.name || manifest.name);
  const entry = (first.entry ?? "src/index.ts").replace(/^\.\//, "");

  if (!existsSync(pkgPath)) {
    writeFileSync(pkgPath, renderPackageJson(manifest));
    return;
  }

  const existing = readJsonObject(pkgPath) as PackageJson;
  const bin: Record<string, string> = {};
  if (isRecord(existing.bin)) {
    for (const [name, value] of Object.entries(existing.bin)) {
      if (typeof value === "string" && value.trim()) bin[normalizePortableSkillName(name)] = value.replace(/^\.\//, "");
    }
  } else {
    const binEntry = stringValue(existing.bin);
    if (binEntry) bin[manifest.name] = binEntry.replace(/^\.\//, "");
  }
  bin[commandName] = entry;

  const scripts = isRecord(existing.scripts) ? { ...existing.scripts } : {};
  if (!stringValue(scripts.dev)) scripts.dev = `bun run ${entry}`;

  writeFileSync(pkgPath, `${JSON.stringify({
    ...existing,
    name: manifest.name,
    version: manifest.version,
    description: manifest.description,
    type: stringValue(existing.type) ?? "module",
    bin,
    scripts,
  }, null, 2)}\n`);
}

/**
 * Instruction (prose) skills are consumed by agent renderers/MCP docs, not run
 * locally, so `port` must never fabricate executable stubs (package.json, bin,
 * src/index.ts, tsconfig.json, AGENTS.md). It keeps the copied SKILL.md verbatim
 * and writes a minimal skill.json declaring `kind: "instruction"`.
 */
export function ensureInstructionSkillFiles(skillPath: string, manifest: PortableSkillManifest): PortableSkillManifest {
  const next: PortableSkillManifest = {
    ...manifest,
    kind: "instruction",
    standard: PORTABLE_SKILL_STANDARD,
    $schema: manifest.$schema ?? PORTABLE_SKILL_SCHEMA,
    displayName: manifest.displayName ?? displayName(manifest.name),
    category: manifest.category ?? "Development Tools",
    tags: manifest.tags?.length ? manifest.tags : ["custom", manifest.name],
    inputs: [],
    commands: [],
  };

  // SKILL.md is the agent handoff artifact and is kept exactly as copied. Only
  // synthesize one if the source somehow lacked it.
  if (!existsSync(join(skillPath, "SKILL.md"))) {
    writeFileSync(join(skillPath, "SKILL.md"), renderSkillMd(next));
  }
  writeFileSync(join(skillPath, "skill.json"), renderInstructionSkillJson(next));
  return readPortableSkillManifest(skillPath, next.name);
}

export function copySkillDirectory(source: string, destination: string): void {
  // A source folder can itself be a symlink (e.g. agent skill dirs full of
  // `impeccable-*` symlinks). cpSync would try to recreate the symlink over the
  // freshly-created destination directory and crash, so resolve it first.
  const resolvedSource = lstatSync(source).isSymbolicLink() ? realpathSync(source) : source;
  mkdirSync(destination, { recursive: true });
  cpSync(resolvedSource, destination, {
    recursive: true,
    filter: (src) => {
      const rel = relative(resolvedSource, src);
      if (!rel) return true;
      const segments = rel.split(/[\\/]/);
      for (let i = 0; i < segments.length; i++) {
        if (isExcludedCopyEntry(segments[i]!, i === 0)) return false;
      }
      // Skip nested symlinks: agent corpora often symlink shared skills, and a
      // dangling link would break the copy.
      if (lstatSync(src).isSymbolicLink()) return false;
      return true;
    },
  });
}

function isExcludedCopyEntry(name: string, isFirstSegment: boolean): boolean {
  if (ANY_SEGMENT_COPY_EXCLUDES.has(name)) return true;
  // Build output only counts as junk at the skill root; nested copies are real content.
  if (isFirstSegment && FIRST_SEGMENT_COPY_EXCLUDES.has(name)) return true;
  // AppleDouble sidecar files (`._SKILL.md`, `._foo`) written by macOS — any depth.
  if (name.startsWith("._")) return true;
  return false;
}

function renderSkillMd(manifest: PortableSkillManifest): string {
  const tags = manifest.tags?.length
    ? `tags:\n${manifest.tags.map((tag) => `  - ${tag}`).join("\n")}\n`
    : "";
  return `---\nname: ${manifest.name}\ndescription: ${manifest.description}\nversion: ${manifest.version}\nsource: custom\ncategory: ${manifest.category ?? "Development Tools"}\n${tags}---\n\n# ${manifest.displayName ?? displayName(manifest.name)}\n\n${manifest.description}\n\n## Usage\n\n\`\`\`bash\nskills run ${manifest.name} --help\n\`\`\`\n`;
}

export function renderSkillJson(manifest: PortableSkillManifest): string {
  return `${JSON.stringify({
    $schema: manifest.$schema ?? PORTABLE_SKILL_SCHEMA,
    standard: PORTABLE_SKILL_STANDARD,
    name: manifest.name,
    description: manifest.description,
    version: manifest.version,
    displayName: manifest.displayName ?? displayName(manifest.name),
    category: manifest.category ?? "Development Tools",
    tags: manifest.tags ?? ["custom", manifest.name],
    ...(manifest.kind ? { kind: manifest.kind } : {}),
    inputs: manifest.inputs,
    commands: manifest.commands,
  }, null, 2)}\n`;
}

function renderInstructionSkillJson(manifest: PortableSkillManifest): string {
  return `${JSON.stringify({
    $schema: manifest.$schema ?? PORTABLE_SKILL_SCHEMA,
    standard: PORTABLE_SKILL_STANDARD,
    name: manifest.name,
    description: manifest.description,
    version: manifest.version,
    displayName: manifest.displayName ?? displayName(manifest.name),
    category: manifest.category ?? "Development Tools",
    tags: manifest.tags ?? ["custom", manifest.name],
    kind: "instruction",
  }, null, 2)}\n`;
}

function renderPackageJson(manifest: PortableSkillManifest): string {
  const first = manifest.commands[0] ?? { name: manifest.name, entry: "src/index.ts" };
  return `${JSON.stringify({
    name: manifest.name,
    version: manifest.version,
    description: manifest.description,
    type: "module",
    bin: { [first.name]: first.entry ?? "src/index.ts" },
    scripts: { dev: `bun run ${first.entry ?? "src/index.ts"}` },
    dependencies: {},
  }, null, 2)}\n`;
}

function renderTsconfig(): string {
  return `${JSON.stringify({
    compilerOptions: {
      target: "ES2022",
      module: "ESNext",
      moduleResolution: "bundler",
      strict: true,
      outDir: "dist",
    },
    include: ["src/**/*.ts"],
  }, null, 2)}\n`;
}

function renderEntrypoint(manifest: PortableSkillManifest): string {
  return `#!/usr/bin/env bun\n\nconst args = process.argv.slice(2);\n\nif (args.includes("--help") || args.includes("-h")) {\n  console.log("${manifest.name}");\n  console.log("");\n  console.log("${escapeJsString(manifest.description)}");\n  console.log("");\n  console.log("Usage: skills run ${manifest.name} [args...]");\n  process.exit(0);\n}\n\nconsole.log(JSON.stringify({\n  skill: "${manifest.name}",\n  args,\n}, null, 2));\n`;
}

function renderAgentsMd(manifest: PortableSkillManifest): string {
  const command = manifest.commands[0];
  const entry = command?.entry ?? "src/index.ts";
  return `# Agent Build Instructions: ${manifest.name}\n\nThis folder is a portable @hasna/skills skill. Build it in place and keep it valid against the portable skill standard.\n\n## Contract\n\n- Skill name: \`${manifest.name}\`\n- Description: ${manifest.description}\n- Manifest files: \`SKILL.md\` frontmatter and \`skill.json\`\n- Runtime entrypoint: \`${entry}\`\n- User command: \`skills run ${manifest.name} [args]\`\n\n## Build Rules\n\n1. Put executable logic in \`${entry}\` or files imported by it.\n2. Keep \`skill.json\` updated when inputs, commands, or version change.\n3. Keep \`SKILL.md\` concise and compatible with Codewith-style skill frontmatter: \`name\`, \`description\`, \`version\`, optional \`category\`, and optional \`tags\`.\n4. Add tests under \`tests/\` when behavior is non-trivial, then run \`bun test\` from this folder if tests exist.\n5. Verify with \`skills validate ${manifest.name}\` and smoke-test with \`skills run ${manifest.name} --help\`.\n6. Do not commit secrets, generated credentials, \`.env\`, \`node_modules\`, or build output.\n`;
}

function ensureSkillMdFrontmatter(content: string, manifest: PortableSkillManifest): string {
  const body = content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "").trimStart();
  const generated = renderSkillMd(manifest);
  const frontmatter = generated.match(/^---\r?\n[\s\S]*?\r?\n---/)?.[0] ?? "";
  return `${frontmatter}\n\n${body || `# ${manifest.displayName ?? displayName(manifest.name)}\n\n${manifest.description}\n`}`;
}

function parseManifestCommands(value: Record<string, unknown> | undefined): PortableSkillCommand[] | undefined {
  const raw = value?.commands;
  if (!Array.isArray(raw)) return undefined;
  const commands = raw
    .map((item) => {
      if (!isRecord(item)) return null;
      const name = stringValue(item.name);
      if (!name) return null;
      return {
        name: normalizePortableSkillName(name),
        ...(stringValue(item.description) ? { description: stringValue(item.description) } : {}),
        ...(stringValue(item.entry) ? { entry: stringValue(item.entry) } : {}),
        ...(stringValue(item.command) ? { command: stringValue(item.command) } : {}),
        ...(Array.isArray(item.args) ? { args: item.args.filter((arg): arg is string => typeof arg === "string") } : {}),
      } satisfies PortableSkillCommand;
    })
    .filter((item): item is PortableSkillCommand => item !== null);
  return commands.length ? commands : undefined;
}

function parseManifestInputs(value: Record<string, unknown> | undefined): PortableSkillInput[] | undefined {
  const raw = value?.inputs;
  if (!Array.isArray(raw)) return undefined;
  const inputs = raw
    .map((item) => {
      if (!isRecord(item)) return null;
      const name = stringValue(item.name);
      const type = stringValue(item.type);
      if (!name || !type) return null;
      return {
        name,
        type,
        ...(typeof item.required === "boolean" ? { required: item.required } : {}),
        ...(stringValue(item.description) ? { description: stringValue(item.description) } : {}),
      } satisfies PortableSkillInput;
    })
    .filter((item): item is PortableSkillInput => item !== null);
  return inputs.length ? inputs : undefined;
}

function inferPackageCommands(pkg: PackageJson | undefined, fallbackName: string): PortableSkillCommand[] | undefined {
  if (!pkg) return undefined;
  if (isRecord(pkg.bin)) {
    const commands = Object.entries(pkg.bin)
      .filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].trim().length > 0)
      .map(([name, entry]) => ({
        name: normalizePortableSkillName(name),
        entry: entry.replace(/^\.\//, ""),
        description: `Run ${displayName(fallbackName)}.`,
      }));
    if (commands.length) return commands;
  }
  const scripts = isRecord(pkg.scripts) ? pkg.scripts : undefined;
  const dev = stringValue(scripts?.dev);
  const match = dev?.match(/(?:bun\s+run\s+|bun\s+)([^ ]+)/);
  if (match?.[1]) {
    return [{ name: fallbackName, entry: match[1].replace(/^\.\//, ""), description: `Run ${displayName(fallbackName)}.` }];
  }
  return undefined;
}

function readJsonObject(path: string): Record<string, unknown> {
  const parsed = JSON.parse(readFileSync(path, "utf-8"));
  if (!isRecord(parsed)) throw new Error(`${basename(path)} must contain a JSON object`);
  return parsed;
}

export function hasPackageDependencies(pkgPath: string): boolean {
  try {
    const pkg = readJsonObject(pkgPath) as PackageJson;
    const deps = isRecord(pkg.dependencies) ? Object.keys(pkg.dependencies) : [];
    return deps.length > 0;
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(value: Record<string, unknown> | undefined, key: string): string | undefined {
  return stringValue(value?.[key]);
}

function stringArrayField(value: Record<string, unknown> | undefined, key: string): string[] | undefined {
  const raw = value?.[key];
  if (!Array.isArray(raw)) return undefined;
  const strings = raw.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  return strings.length ? strings : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function displayName(name: string): string {
  return name.replace(/[-_]+/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function escapeJsString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r?\n/g, " ");
}
