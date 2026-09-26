import { createHash, randomUUID } from "node:crypto";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { getPortableSkillsRootReadOnly, normalizePortableSkillName, validatePortableSkillDirectory, type PortableSkillManifest, type PortableSkillOptions, type SkillKind } from "./portable-skills.js";
import { SEMVER_PATTERN, validatePortableManifestContract } from "./skill-contract.js";
import { collectBundleFiles, computeContentHash } from "./skill-hash.js";
import { collectSkillBundleEntries } from "./skill-bundle.js";
import { parseSkillFrontmatter } from "./skill-validation.js";
import { assertPortableAuthoringPath } from "./authoring-path.js";

export interface PrepareSkillOptions extends PortableSkillOptions {
  version: string;
  kind?: SkillKind;
  dryRun?: boolean;
}

export interface PrepareSkillResult {
  name: string;
  path: string;
  previousVersion: string;
  version: string;
  kind: SkillKind;
  contentHash: string;
  changed: boolean;
  written: boolean;
  warnings: Array<{ code: string; message: string }>;
}

/** Prepare a reviewed local draft. No execution, dependency install, API call or source rewrite. */
export function prepareSkill(name: string, options: PrepareSkillOptions): PrepareSkillResult {
  const normalized = normalizePortableSkillName(name);
  if (!new RegExp(SEMVER_PATTERN).test(options.version)) throw new Error("--version must be a semantic version, for example 0.2.0.");
  const path = join(getPortableSkillsRootReadOnly(options), normalized);
  assertPortableAuthoringPath(path, options);
  const before = snapshot(path);
  const manifestFile = before.files.find(file => file.path === "skill.json");
  if (!manifestFile) throw new Error(`Skill '${normalized}' needs skill.json. Import the source with skills port first.`);
  let manifest: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(manifestFile.bytes.toString("utf8"));
    if (!isRecord(parsed)) throw new Error("not an object");
    manifest = parsed;
  } catch { throw new Error("skill.json must contain a JSON object; no files were changed."); }
  const previousVersion = manifest.version;
  if (typeof previousVersion !== "string" || !new RegExp(SEMVER_PATTERN).test(previousVersion)) {
    throw new Error("skill.json must declare its current semantic version before preparation.");
  }
  if (manifest.kind !== undefined && manifest.kind !== "instruction" && manifest.kind !== "executable") {
    throw new Error("skill.json has an invalid kind; correct it before preparation.");
  }
  const kind = options.kind ?? manifest.kind;
  if (kind !== "instruction" && kind !== "executable") {
    throw new Error("This legacy manifest has no explicit kind. Pass --kind instruction or --kind executable; helper scripts alone do not determine a skill's kind.");
  }
  const document = before.files.find(file => file.path === "SKILL.md");
  const documentKind = document ? parseSkillFrontmatter(document.bytes.toString("utf8"))?.kind : undefined;
  if (documentKind !== undefined && documentKind !== kind) {
    throw new Error("SKILL.md kind conflicts with the candidate skill.json kind. Review and align both declarations (or remove the optional frontmatter kind), then prepare again; no files were changed.");
  }
  if (manifest.provenance !== undefined && !isRecord(manifest.provenance)) throw new Error("skill.json provenance must be an object.");
  const provenance = manifest.provenance as Record<string, unknown> | undefined;
  const candidate = { ...manifest, version: options.version, kind, provenance: { ...provenance } };
  const staging = mkdtempSync(join(tmpdir(), "skills-prepare-"));
  try {
    for (const directory of before.directories) mkdirSync(join(staging, directory), { recursive: true });
    for (const file of before.files) {
      const destination = join(staging, file.path);
      mkdirSync(dirname(destination), { recursive: true });
      writeFileSync(destination, file.bytes, { mode: file.mode });
    }
    const stagedManifest = join(staging, "skill.json");
    writeFileSync(stagedManifest, `${JSON.stringify(candidate, null, 2)}\n`);
    const contentHash = computeContentHash(staging);
    const changed = options.version !== previousVersion || kind !== manifest.kind || contentHash !== provenance?.content_hash;
    if (changed && compareVersions(options.version, previousVersion) <= 0) {
      throw new Error(`Changed content requires a version greater than ${previousVersion}; pass --version <new-semver>.`);
    }
    candidate.provenance.content_hash = contentHash;
    const candidateBytes = `${JSON.stringify(candidate, null, 2)}\n`;
    writeFileSync(stagedManifest, candidateBytes);
    validateRawCandidate(candidate);
    validateRuntimeEntrypoint(candidate, staging);
    const validation = validatePortableSkillDirectory(normalized, staging);
    if (!validation.valid) throw new Error(`Skill '${normalized}' cannot be prepared:\n${validation.issues.map(issue => `${issue.code}: ${issue.message}`).join("\n")}`);
    assertPackedCanonicalCoverage(staging);
    // Optimistic source check: refuse any observed edit during preparation. The
    // final replacement is atomic; this is not a filesystem compare-and-swap.
    if (snapshot(path).identity !== before.identity) throw new Error("Skill changed during preparation; review the draft and run prepare again.");
    if (changed && !options.dryRun) {
      const temporary = join(path, `.skill-prepare-${randomUUID()}.tmp`);
      try {
        writeFileSync(temporary, candidateBytes, { flag: "wx", mode: manifestFile.mode });
        chmodSync(temporary, manifestFile.mode);
        renameSync(temporary, join(path, "skill.json"));
      } finally { rmSync(temporary, { force: true }); }
    }
    return { name: normalized, path, previousVersion, version: options.version, kind, contentHash, changed, written: changed && !options.dryRun, warnings: validation.warnings };
  } finally { rmSync(staging, { recursive: true, force: true }); }
}

const MAX_PACK_PARITY_PATHS = 8;
const MAX_PACK_PARITY_PATH_CHARS = 120;

/**
 * Preparation hashes the canonical source tree, while publishing sends the packed tree.
 * Refuse the draft when the packer's exclusions would silently remove a hash-covered file.
 * The source snapshot has already applied the preparation entry and byte limits, and the
 * diagnostic is deliberately capped and escaped so an unusual filename cannot flood output.
 */
function assertPackedCanonicalCoverage(root: string): void {
  const canonicalPaths = new Set(collectBundleFiles(root).map(file => file.rel));
  const packedPaths = new Set(collectSkillBundleEntries(root).map(entry => entry.path));
  const omitted = [...canonicalPaths].filter(path => !packedPaths.has(path)).sort();
  if (omitted.length === 0) return;

  const rendered = omitted.slice(0, MAX_PACK_PARITY_PATHS).map(escapedRelativePath).join(", ");
  const suffix = omitted.length > MAX_PACK_PARITY_PATHS ? ` (+${omitted.length - MAX_PACK_PARITY_PATHS} more)` : "";
  throw new Error(
    `Skill cannot be prepared because packSkillBundle excludes canonical source path(s): ${rendered}${suffix}. `
      + "Rename or remove the excluded source before preparing; no files were changed.",
  );
}

function escapedRelativePath(path: string): string {
  const bounded = path.length > MAX_PACK_PARITY_PATH_CHARS - 8
    ? `${path.slice(0, MAX_PACK_PARITY_PATH_CHARS - 8)}...`
    : path;
  return JSON.stringify(bounded);
}

function validateRuntimeEntrypoint(candidate: Record<string, unknown>, root: string): void {
  // Instructions may retain helper metadata without a runnable entrypoint.
  if (candidate.kind !== "executable" || !isRecord(candidate.runtime)) return;
  const entry = candidate.runtime.entrypoint;
  if (typeof entry !== "string") return; // Optional; raw contract checked its type.
  const target = resolve(root, entry), rel = relative(root, target);
  if (isAbsolute(entry) || /^[a-zA-Z]:/.test(entry) || entry.includes("\\") || !rel || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)
    || !existsSync(target) || !lstatSync(target).isFile()) {
    throw new Error("Executable runtime.entrypoint must name an existing regular file inside the skill directory.");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Check raw fields before the compatibility reader can normalize malformed values away. */
function validateRawCandidate(candidate: Record<string, unknown>): void {
  for (const field of ["standard", "name", "description", "version"]) {
    if (typeof candidate[field] !== "string" || !candidate[field].trim()) throw new Error(`skill.json ${field} is required.`);
  }
  for (const field of ["displayName", "category"]) {
    if (candidate[field] !== undefined && (typeof candidate[field] !== "string" || !candidate[field].trim())) throw new Error(`Invalid skill.json ${field}.`);
  }
  if (candidate.tags !== undefined && (!Array.isArray(candidate.tags) || candidate.tags.some(tag => typeof tag !== "string" || !tag.trim()))) throw new Error("Invalid skill.json tags.");
  const issues = validatePortableManifestContract(candidate as unknown as PortableSkillManifest, { strict: true });
  if (issues.length) throw new Error(`Invalid skill.json: ${issues.map(issue => issue.code).join(", ")}`);
  validateRuntimeEntrypointCompatibility(candidate);
  for (const field of ["inputs", "commands"] as const) {
    const items = candidate[field];
    if (items === undefined) continue;
    if (!Array.isArray(items)) throw new Error(`skill.json ${field} must be an array.`);
    for (const item of items) {
      if (!isRecord(item) || typeof item.name !== "string" || !item.name.trim()) throw new Error(`Invalid skill.json ${field} name.`);
      if (field === "inputs" && (typeof item.type !== "string" || !item.type.trim() || (item.required !== undefined && typeof item.required !== "boolean"))) throw new Error("Invalid skill.json input type or required flag.");
      if (field === "commands") {
        if (!/^[a-z0-9][a-z0-9._-]*$/.test(item.name)) throw new Error("Invalid skill.json command name.");
        for (const target of ["entry", "command"]) if (item[target] !== undefined && (typeof item[target] !== "string" || !item[target].trim())) throw new Error(`Invalid skill.json command ${target}.`);
        if (!item.entry && !item.command) throw new Error("A skill.json command needs entry or command.");
        if (item.args !== undefined && (!Array.isArray(item.args) || item.args.some(arg => typeof arg !== "string"))) throw new Error("Invalid skill.json command args.");
      }
    }
  }
}

function validateRuntimeEntrypointCompatibility(candidate: Record<string, unknown>): void {
  if (candidate.kind !== "executable" || !isRecord(candidate.runtime)) return;
  const runtime = candidate.runtime.runtime;
  const entrypoint = candidate.runtime.entrypoint;
  if (typeof runtime !== "string" || typeof entrypoint !== "string") return;
  const extension = entrypoint.toLowerCase().split(".").pop();
  if (extension === "py" && runtime !== "python3") {
    throw new Error("Invalid skill.json: runtime.entrypoint with .py extension requires runtime python3.");
  }
}

/** Semver precedence; build metadata cannot turn the same version into a content bump. */
function compareVersions(left: string, right: string): number {
  const parts = (value: string) => value.split("+")[0]!.split(/-(.*)/s).slice(0, 2);
  const [a, ap] = parts(left), [b, bp] = parts(right);
  const ac = a!.split(".").map(BigInt), bc = b!.split(".").map(BigInt);
  for (let i = 0; i < 3; i++) if (ac[i] !== bc[i]) return ac[i]! > bc[i]! ? 1 : -1;
  if (ap === undefined || bp === undefined) return ap === bp ? 0 : ap === undefined ? 1 : -1;
  const aa = ap.split("."), bb = bp.split(".");
  for (let i = 0; i < Math.max(aa.length, bb.length); i++) {
    const x = aa[i], y = bb[i];
    if (x === undefined || y === undefined) return x === y ? 0 : x === undefined ? -1 : 1;
    if (x === y) continue;
    const xn = /^\d+$/.test(x), yn = /^\d+$/.test(y);
    if (xn && yn) return BigInt(x) > BigInt(y) ? 1 : -1;
    if (xn !== yn) return xn ? -1 : 1;
    return x > y ? 1 : -1;
  }
  return 0;
}

// Dependency/VCS/build trees are not authoring input. Everything else is bounded
// and copied without following symlinks, including hidden source and empty dirs.
const IGNORED = new Set([".git", ".ds_store", ".system"]);
// Local dependency preparation state must not enter an authoring snapshot.
const ROOT_IGNORED = new Set(["dist", "build", ".turbo", ".skills-dependency-preparation"]);
function snapshot(root: string): { files: Array<{ path: string; bytes: Buffer; mode: number }>; directories: string[]; identity: string } {
  const rootStat = lstatSync(root);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) throw new Error("Skill root must be a real directory, not a symlink.");
  const files: Array<{ path: string; bytes: Buffer; mode: number }> = [], directories: string[] = [];
  const hash = createHash("sha256").update(`${rootStat.dev}:${rootStat.ino}\0`);
  let count = 0, bytes = 0;
  const walk = (relative: string) => {
    for (const name of readdirSync(join(root, relative)).sort()) {
      if (IGNORED.has(name.toLowerCase()) || (!relative && ROOT_IGNORED.has(name.toLowerCase()))) continue;
      const path = relative ? `${relative}/${name}` : name;
      if (++count > 20_000) throw new Error("Skill exceeds the preparation entry limit (20000).");
      const absolute = join(root, path), stat = lstatSync(absolute);
      if (stat.isSymbolicLink()) throw new Error(`Skill contains a symlink: ${path}. No files were changed.`);
      // Canonical hashing excludes only exact-case dependency directories.
      // A Node_Modules directory or a regular file named node_modules is source
      // input and must survive staging, or the written hash will be stale.
      if (stat.isDirectory() && name === "node_modules") continue;
      hash.update(JSON.stringify([path, stat.dev, stat.ino, stat.mode]));
      if (stat.isDirectory()) { directories.push(path); walk(path); }
      else if (stat.isFile()) {
        bytes += stat.size;
        if (bytes > 50_000_000) throw new Error("Skill exceeds the preparation size limit (50000000 bytes).");
        const content = readFileSync(absolute);
        if (content.length !== stat.size) throw new Error("Skill changed during preparation.");
        files.push({ path, bytes: content, mode: stat.mode & 0o777 });
        hash.update(`\0${content.length}\0`).update(content);
      } else throw new Error(`Unsupported skill entry: ${path}.`);
      hash.update("\0");
    }
  };
  walk("");
  return { files, directories, identity: hash.digest("hex") };
}
