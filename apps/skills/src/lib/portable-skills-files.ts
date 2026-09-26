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
import { computeContentHash } from "./skill-hash.js";
import {
  PORTABLE_SKILL_DEFAULT_VERSION,
  PORTABLE_SKILL_SCHEMA,
  PORTABLE_SKILL_STANDARD,
  type PortableSkillCommand,
  type PortableSkillInput,
  type PortableSkillManifest,
  type PortableSkillProvenance,
  type PortableSkillRuntimeContract,
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

// Build output and local runtime state excluded only at the FIRST path segment (the skill root).
// A nested `references/build/` or `docs/dist/` is legitimate content and must survive.
const FIRST_SEGMENT_COPY_EXCLUDES = new Set([
  "dist",
  "build",
  ".turbo",
  ".skills-dependency-preparation",
]);

const DEFAULT_INPUTS: PortableSkillInput[] = [
  {
    name: "args",
    type: "string[]",
    required: false,
    description: "Arguments passed after `skills run <name>`.",
  },
];

/**
 * Default runtime contract (hasna.skill.v1). `bun` is the Hasna default
 * runtime; the sandbox is read-only by default, execution is time-capped at
 * 900s and does not assume network egress.
 */
export function defaultRuntimeContract(entrypoint = "src/index.ts"): PortableSkillRuntimeContract {
  return {
    runtime: "bun",
    entrypoint,
    timeout: 900,
    needs_network: false,
    env: [],
    sandbox: "readonly-fs",
    system_deps: [],
    artifacts: [],
  };
}

/** Provenance defaults; content_hash is filled at write time over the bundle. */
export function defaultProvenance(sourceCommit = "unknown"): PortableSkillProvenance {
  return { source_commit: sourceCommit };
}

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

/** New local identities use hyphens; legacy lookups and command names keep their grammar. */
export function normalizeNewPortableSkillName(name: string): string {
  // Keep existing invalid-name refusals (including leading dots/path traversal)
  // before converting accepted spelling to a new identity.
  normalizePortableSkillName(name);
  const normalized = name.trim()
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2")
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!normalized) throw new Error(`Invalid skill name '${name}'. Include letters or numbers.`);
  return normalized;
}

export function readPortableSkillManifest(skillPath: string, fallbackName = basename(skillPath)): PortableSkillManifest {
  return readManifest(skillPath, fallbackName, normalizePortableSkillName);
}

/** Import needs the original spelling before the legacy reader discards case boundaries. */
export function readPortableSkillManifestForImport(skillPath: string): PortableSkillManifest {
  return readManifest(skillPath, basename(skillPath), normalizeNewPortableSkillName);
}

function readManifest(skillPath: string, fallbackName: string, normalizeName: (name: string) => string): PortableSkillManifest {
  const skillJsonPath = join(skillPath, "skill.json");
  const skillMdPath = join(skillPath, "SKILL.md");
  const pkgPath = join(skillPath, "package.json");

  const jsonManifest = existsSync(skillJsonPath) ? readJsonObject(skillJsonPath) : undefined;
  const frontmatter = existsSync(skillMdPath) ? parseSkillFrontmatter(readFileSync(skillMdPath, "utf-8")) ?? undefined : undefined;
  const pkg = existsSync(pkgPath) ? readJsonObject(pkgPath) as PackageJson : undefined;

  const name = normalizeName(
    stringField(jsonManifest, "name")
      ?? frontmatter?.name
      ?? stringValue(pkg?.name)
      ?? fallbackName,
  );
  const description = stringField(jsonManifest, "description")
    ?? frontmatter?.description
    ?? stringValue(pkg?.description)
    ?? `${name} skill`;
  const version = readDeclaredSkillVersion(skillPath) ?? PORTABLE_SKILL_DEFAULT_VERSION;
  const kind = parseSkillKind(stringField(jsonManifest, "kind") ?? frontmatter?.kind);
  const commands = parseManifestCommands(jsonManifest)
    ?? (kind === "instruction" ? [] : inferPackageCommands(pkg, name))
    ?? [];
  // A legacy executable source may have no portable skill.json yet. Preserve
  // the runtime implied by a Python package entry instead of letting the
  // generic Bun default claim a .py file. Other runtimes remain explicit: an
  // extension alone cannot establish their policy or dependency contract.
  const runtime = parseManifestRuntime(jsonManifest) ?? inferRuntimeFromCommands(commands);

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
    ...(runtime ? { runtime } : {}),
    ...(parseManifestProvenance(jsonManifest) ? { provenance: parseManifestProvenance(jsonManifest) } : {}),
  };
}

export function parseSkillKind(value: string | undefined): SkillKind | undefined {
  if (value === "executable" || value === "instruction") return value;
  return undefined;
}

/**
 * The version a skill EXPLICITLY declares, or undefined when none of the sources do:
 * skill.json first, then the SKILL.md frontmatter, then package.json.
 *
 * Distinct from `readPortableSkillManifest().version`, which falls back to
 * PORTABLE_SKILL_DEFAULT_VERSION: callers that must not invent a version (publishing,
 * version pinning) use this and refuse when it is undefined.
 */
export function readDeclaredSkillVersion(skillPath: string): string | undefined {
  const skillJsonPath = join(skillPath, "skill.json");
  const skillMdPath = join(skillPath, "SKILL.md");
  const pkgPath = join(skillPath, "package.json");
  const jsonManifest = existsSync(skillJsonPath) ? readJsonObject(skillJsonPath) : undefined;
  const frontmatter = existsSync(skillMdPath) ? parseSkillFrontmatter(readFileSync(skillMdPath, "utf-8")) ?? undefined : undefined;
  const pkg = existsSync(pkgPath) ? readJsonObject(pkgPath) as PackageJson : undefined;
  return stringField(jsonManifest, "version") ?? frontmatter?.version ?? stringValue(pkg?.version);
}

export function createInstructionManifest(name: string, options: { description: string; category?: string; tags?: string[] }): PortableSkillManifest {
  return {
    $schema: PORTABLE_SKILL_SCHEMA,
    standard: PORTABLE_SKILL_STANDARD,
    name,
    description: options.description,
    version: PORTABLE_SKILL_DEFAULT_VERSION,
    displayName: displayName(name),
    category: options.category ?? "Development Tools",
    tags: options.tags ?? ["custom", name],
    kind: "instruction",
    inputs: [],
    commands: [],
    provenance: defaultProvenance(),
  };
}

export function writeInstructionSkillTemplate(skillPath: string, manifest: PortableSkillManifest): void {
  mkdirSync(skillPath, { recursive: true });
  writeFileSync(join(skillPath, "SKILL.md"), renderInstructionSkillMd(manifest));
  writeSkillJsonWithHash(skillPath, manifest);
}

function renderInstructionSkillMd(manifest: PortableSkillManifest): string {
  const tags = manifest.tags?.length
    ? `tags:\n${manifest.tags.map((tag) => `  - ${yamlString(tag)}`).join("\n")}\n`
    : "";
  return `---\nname: ${manifest.name}\ndescription: ${yamlString(manifest.description)}\nkind: instruction\nversion: ${manifest.version}\nsource: custom\ncategory: ${yamlString(manifest.category ?? "Development Tools")}\n${tags}---\n\n# ${manifest.displayName ?? displayName(manifest.name)}\n\n${manifest.description}\n\n## Instructions\n\nWrite the agent-facing prose for this skill here. Instruction skills are consumed\nby agents through skill renderers and MCP docs; they are not executed locally.\n`;
}

export function createPortableManifest(name: string, options: { description: string; category?: string; tags?: string[] }): PortableSkillManifest {
  return {
    $schema: PORTABLE_SKILL_SCHEMA,
    standard: PORTABLE_SKILL_STANDARD,
    name,
    description: options.description,
    version: PORTABLE_SKILL_DEFAULT_VERSION,
    displayName: displayName(name),
    category: options.category ?? "Development Tools",
    tags: options.tags ?? ["custom", name],
    kind: "executable",
    inputs: DEFAULT_INPUTS,
    commands: [{
      name,
      description: `Run ${displayName(name)}.`,
      entry: "src/index.ts",
      args: ["...args"],
    }],
    runtime: defaultRuntimeContract("src/index.ts"),
    provenance: defaultProvenance(),
  };
}

export function writePortableSkillTemplate(skillPath: string, manifest: PortableSkillManifest): void {
  mkdirSync(join(skillPath, "src"), { recursive: true });
  writeFileSync(join(skillPath, "SKILL.md"), renderSkillMd(manifest));
  writeFileSync(join(skillPath, "AGENTS.md"), renderAgentsMd(manifest));
  writeFileSync(join(skillPath, "package.json"), renderPackageJson(manifest));
  writeFileSync(join(skillPath, "tsconfig.json"), renderTsconfig());
  writeFileSync(join(skillPath, "src", "index.ts"), renderEntrypoint(manifest));
  writeSkillJsonWithHash(skillPath, manifest);
}

/**
 * Fill provenance defaults and executable/legacy runtime defaults. Explicit
 * instructions retain any supplied helper runtime without inventing one.
 */
function fillContractDefaults(manifest: PortableSkillManifest, entrypoint?: string): PortableSkillManifest {
  const resolvedEntrypoint = entrypoint ?? manifest.commands[0]?.entry ?? "src/index.ts";
  return {
    ...manifest,
    standard: PORTABLE_SKILL_STANDARD,
    ...(manifest.kind === "instruction" ? {} : { runtime: manifest.runtime ?? defaultRuntimeContract(resolvedEntrypoint) }),
    provenance: {
      ...defaultProvenance(),
      ...(manifest.provenance ?? {}),
    },
  };
}

/**
 * Write skill.json with the canonical content_hash computed over the current
 * bundle. Preserves unknown keys already present in an existing skill.json
 * (merge, never replace) and recomputes the hash whenever content changed.
 *
 * The manifest is written hashless FIRST so the canonical bundle covers
 * skill.json itself; canonicalization strips content_hash, so adding the hash
 * afterwards does not change the digest.
 */
export function writeSkillJsonWithHash(skillPath: string, manifest: PortableSkillManifest): PortableSkillManifest {
  const withDefaults = fillContractDefaults(manifest);
  const existing = readExistingSkillJson(skillPath);
  const withoutHash: PortableSkillManifest = {
    ...withDefaults,
    provenance: {
      ...(withDefaults.provenance ?? {}),
      content_hash: undefined,
    },
  };
  writeFileSync(join(skillPath, "skill.json"), `${JSON.stringify({ ...existing, ...renderSkillJsonObject(withoutHash) }, null, 2)}\n`);
  const hash = computeContentHash(skillPath);
  const withHash: PortableSkillManifest = {
    ...withDefaults,
    provenance: {
      ...(withDefaults.provenance ?? {}),
      content_hash: hash,
    },
  };
  writeFileSync(join(skillPath, "skill.json"), `${JSON.stringify({ ...existing, ...renderSkillJsonObject(withHash) }, null, 2)}\n`);
  return withHash;
}

function readExistingSkillJson(skillPath: string): Record<string, unknown> {
  const path = join(skillPath, "skill.json");
  if (!existsSync(path)) return {};
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf-8"));
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
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
  if (!existsSync(join(skillPath, "AGENTS.md"))) writeFileSync(join(skillPath, "AGENTS.md"), renderAgentsMd(next));
  ensurePackageJson(skillPath, next);
  if (!existsSync(join(skillPath, "tsconfig.json"))) writeFileSync(join(skillPath, "tsconfig.json"), renderTsconfig());
  // Hash last: every file it covers must already be on disk in final form.
  writeSkillJsonWithHash(skillPath, next);
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
 * src/index.ts, tsconfig.json, AGENTS.md). Apart from aligning declared names
 * after an import rename, it preserves the copied prose and metadata.
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

  // Change only the copied declaration when import chooses a new identity.
  // Do not re-render frontmatter: instruction metadata and prose belong to its author.
  if (!existsSync(join(skillPath, "SKILL.md"))) {
    writeFileSync(join(skillPath, "SKILL.md"), renderSkillMd(next));
  } else {
    const path = join(skillPath, "SKILL.md");
    const content = readFileSync(path, "utf8");
    const declaredName = parseSkillFrontmatter(content)?.name;
    if (declaredName && declaredName !== next.name) {
      writeFileSync(path, renameInstructionFrontmatter(content, next.name));
    }
  }
  // Instruction packages are optional: keep existing command/bin declarations,
  // and never fabricate a package solely to give an instruction a new name.
  const packagePath = join(skillPath, "package.json");
  if (existsSync(packagePath)) {
    const pkg = readJsonObject(packagePath);
    if (typeof pkg.name === "string" && pkg.name !== next.name) {
      writeFileSync(packagePath, `${JSON.stringify({ ...pkg, name: next.name }, null, 2)}\n`);
    }
  }
  writeSkillJsonWithHash(skillPath, next);
  return readPortableSkillManifest(skillPath, next.name);
}

function renameInstructionFrontmatter(content: string, name: string): string {
  const frontmatter = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?=\r?\n|$)/);
  const names = frontmatter?.[1]?.match(/^[ \t]*name[ \t]*:[^\r\n]*/gm) ?? [];
  const declaration = names.length === 1 ? names[0]!.match(/^(name[ \t]*:[ \t]*)(.*?)([ \t]*)$/) : null;
  const scalar = declaration?.[2] ?? "";
  // The existing metadata reader supports simple scalars, not full YAML. Do
  // not guess about duplicate/nested keys, comments, aliases or multiline values.
  let simple = /^[a-zA-Z0-9_.@/ -]+$/.test(scalar);
  if (scalar.startsWith('"')) {
    try { simple = typeof JSON.parse(scalar) === "string"; } catch { simple = false; }
  } else if (scalar.startsWith("'")) simple = /^'[^'\r\n]*'$/.test(scalar);
  if (!frontmatter || !declaration || !simple) {
    throw new Error("Cannot rename instruction SKILL.md: use one unambiguous top-level name scalar in frontmatter.");
  }
  const renamed = frontmatter[0].replace(/^name[ \t]*:[^\r\n]*/m, () => `${declaration[1]}${name}${declaration[3]}`);
  return renamed + content.slice(frontmatter[0].length);
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
  // Root build output/runtime state is not portable; nested copies are real content.
  if (isFirstSegment && FIRST_SEGMENT_COPY_EXCLUDES.has(name)) return true;
  // AppleDouble sidecar files (`._SKILL.md`, `._foo`) written by macOS — any depth.
  if (name.startsWith("._")) return true;
  return false;
}

// JSON string literals are valid YAML scalars and cannot create new fields.
function yamlString(value: string): string {
  return JSON.stringify(value);
}

function renderSkillMd(manifest: PortableSkillManifest): string {
  // Consumer frontmatter stays minimal (name + description only): portable
  // metadata lives in skill.json (hasna.skill.v1). See docs/authoring-rule-amendment.md.
  return `---\nname: ${manifest.name}\ndescription: ${yamlString(manifest.description)}\n---\n\n# ${manifest.displayName ?? displayName(manifest.name)}\n\n${manifest.description}\n\n## Usage\n\n\`\`\`bash\nskills run ${manifest.name} --help\n\`\`\`\n`;
}

export function renderSkillJson(manifest: PortableSkillManifest): string {
  return `${JSON.stringify(renderSkillJsonObject(manifest), null, 2)}\n`;
}

/** The skill.json object for a manifest, with contract defaults applied. */
export function renderSkillJsonObject(manifest: PortableSkillManifest): Record<string, unknown> {
  return {
    $schema: manifest.$schema ?? PORTABLE_SKILL_SCHEMA,
    standard: PORTABLE_SKILL_STANDARD,
    name: manifest.name,
    description: manifest.description,
    version: manifest.version,
    displayName: manifest.displayName ?? displayName(manifest.name),
    category: manifest.category ?? "Development Tools",
    tags: manifest.tags ?? ["custom", manifest.name],
    ...(manifest.kind ? { kind: manifest.kind } : {}),
    // Instruction skills declare no inputs or commands; empty arrays make that
    // explicit and schema-valid.
    inputs: manifest.inputs,
    commands: manifest.commands,
    ...(manifest.runtime ? { runtime: manifest.runtime } : {}),
    ...(manifest.provenance ? { provenance: manifest.provenance } : {}),
  };
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
    ...(manifest.runtime ? { runtime: manifest.runtime } : {}),
    ...(manifest.provenance ? { provenance: manifest.provenance } : {}),
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
  return `# Agent Build Instructions: ${manifest.name}\n\nThis folder is a portable @hasna/skills skill. Build it in place and keep it valid against the portable skill standard.\n\n## Contract\n\n- Skill name: \`${manifest.name}\`\n- Description: ${manifest.description}\n- Portable metadata: \`skill.json\` (standard \`hasna.skill.v1\`) — the source of truth\n- Consumer frontmatter: \`SKILL.md\` keeps \`name\` + \`description\` only\n- Runtime entrypoint: \`${entry}\`\n- User command: \`skills run ${manifest.name} [args]\`\n\n## Build Rules\n\n1. Put executable logic in \`${entry}\` or files imported by it.\n2. Review metadata and source edits, then run \`skills prepare ${manifest.name} --version <new-semver>\` to validate the draft and refresh its manifest version and content hash. Any content change requires a version bump.\n3. Keep \`SKILL.md\` concise: \`name\` + \`description\` frontmatter only.\n4. Add tests under \`tests/\` when behavior is non-trivial, then run \`bun test\` from this folder if tests exist.\n5. Verify with \`skills validate ${manifest.name}\` (checks the schema and the canonical \`content_hash\`) and smoke-test with \`skills run ${manifest.name} --help\`.\n6. Do not commit secrets, generated credentials, \`.env\`, \`node_modules\`, or build output.\n`;
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

function parseManifestRuntime(value: Record<string, unknown> | undefined): PortableSkillRuntimeContract | undefined {
  const raw = value?.runtime;
  if (!isRecord(raw)) return undefined;
  const runtimeName = stringValue(raw.runtime);
  if (!runtimeName) return undefined;
  const parsed: PortableSkillRuntimeContract = { runtime: runtimeName as PortableSkillRuntimeContract["runtime"] };
  if (stringValue(raw.version)) parsed.version = stringValue(raw.version);
  if (stringValue(raw.entrypoint)) parsed.entrypoint = stringValue(raw.entrypoint);
  if (typeof raw.timeout === "number") parsed.timeout = raw.timeout;
  if (typeof raw.needs_network === "boolean") parsed.needs_network = raw.needs_network;
  if (Array.isArray(raw.env)) parsed.env = raw.env.filter((item): item is string => typeof item === "string");
  if (stringValue(raw.sandbox)) parsed.sandbox = raw.sandbox as PortableSkillRuntimeContract["sandbox"];
  if (Array.isArray(raw.system_deps)) parsed.system_deps = raw.system_deps.filter((item): item is string => typeof item === "string") as PortableSkillRuntimeContract["system_deps"];
  if (Array.isArray(raw.artifacts)) parsed.artifacts = raw.artifacts.filter((item): item is string => typeof item === "string");
  return parsed;
}

function parseManifestProvenance(value: Record<string, unknown> | undefined): PortableSkillProvenance | undefined {
  const raw = value?.provenance;
  if (!isRecord(raw)) return undefined;
  const parsed: PortableSkillProvenance = {};
  if (stringValue(raw.source_commit)) parsed.source_commit = stringValue(raw.source_commit);
  if (stringValue(raw.content_hash)) parsed.content_hash = stringValue(raw.content_hash);
  if (stringValue(raw.changelog)) parsed.changelog = stringValue(raw.changelog);
  return Object.keys(parsed).length > 0 ? parsed : undefined;
}

function parseManifestInputs(value: Record<string, unknown> | undefined): PortableSkillInput[] | undefined {  const raw = value?.inputs;
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

function inferRuntimeFromCommands(commands: PortableSkillCommand[]): PortableSkillRuntimeContract | undefined {
  const entrypoint = commands.find(command => command.entry)?.entry;
  if (!entrypoint || !entrypoint.toLowerCase().endsWith(".py")) return undefined;
  return { ...defaultRuntimeContract(entrypoint), runtime: "python3" };
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
