import { existsSync, lstatSync, readFileSync, readdirSync, statSync } from "fs";
import { isAbsolute, join, normalize } from "path";
import type { SkillMeta } from "./registry.js";

export interface SkillValidationMessage {
  code: string;
  message: string;
}

export interface SkillValidationResult {
  name: string;
  path: string;
  valid: boolean;
  issues: SkillValidationMessage[];
  warnings: SkillValidationMessage[];
  metadata: {
    packageName?: string;
    version?: string;
    binCommands: string[];
    docFiles: string[];
    skillMdFrontmatter?: SkillFrontmatter;
    provenance?: SkillValidationProvenance;
  };
}

export interface RegistryConsistencyResult {
  valid: boolean;
  missingDirectories: string[];
  orphanDirectories: string[];
  duplicateRegistryNames: string[];
}

export interface SkillFrontmatter {
  name?: string;
  description?: string;
  displayName?: string;
  category?: string;
  tags?: string[];
  version?: string;
  source?: string;
}

export interface SkillValidationProvenance {
  directoryName: string;
  packageName?: string;
  packageVersion?: string;
  frontmatterSource?: string;
  registrySource?: string;
}

interface PackageJson {
  name?: unknown;
  version?: unknown;
  bin?: unknown;
  scripts?: unknown;
}

const DOC_FILES = ["SKILL.md", "README.md", "CLAUDE.md"];
const RESERVED_SKILL_ENTRIES = new Set([
  ".env",
  ".npmrc",
  ".pypirc",
  ".netrc",
  "id_rsa",
  "id_ed25519",
]);
const KNOWN_TOP_LEVEL_ENTRIES = new Set([
  ".claude",
  ".env.example",
  ".gitignore",
  ".skills",
  "CLAUDE.md",
  "LICENSE",
  "PROJECT_OVERVIEW.md",
  "QUICKSTART.md",
  "README.md",
  "SKILL.md",
  "api-docs-list.json",
  "auth.ts",
  "bun.lock",
  "bunfig.toml",
  "data",
  "dist",
  "examples",
  "exports",
  "http-client.ts",
  "index.ts",
  "install.sh",
  "installer.ts",
  "logs",
  "node_modules",
  "package.json",
  "scripts",
  "skill-install.ts",
  "src",
  "tests",
  "tsconfig.json",
  "vision.ts",
]);
const VALID_PROVENANCE_SOURCES = new Set(["official", "custom", "remote", "private", "private-hosted", "upstream"]);
const VALID_BIN_COMMAND = /^[a-z0-9][a-z0-9._-]*$/;

function add(target: SkillValidationMessage[], code: string, message: string): void {
  target.push({ code, message });
}

function readJsonFile(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf-8"));
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function sortMessages(messages: SkillValidationMessage[]): SkillValidationMessage[] {
  return [...messages].sort((a, b) => a.code.localeCompare(b.code) || a.message.localeCompare(b.message));
}

function isSafeRelativePath(value: string): boolean {
  if (!value.trim() || isAbsolute(value)) return false;
  const normalized = normalize(value).replace(/\\/g, "/");
  return normalized !== ".." && !normalized.startsWith("../") && !normalized.includes("/../");
}

export function parseSkillFrontmatter(content: string): SkillFrontmatter | null {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return null;

  const result: SkillFrontmatter = {};
  const lines = match[1].split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const colon = line.indexOf(":");
    if (colon === -1) continue;

    const key = line.slice(0, colon).trim();
    const rawValue = line.slice(colon + 1).trim();
    if (!key) continue;

    if (key === "tags" && rawValue === "") {
      const tags: string[] = [];
      while (i + 1 < lines.length && /^\s+-\s+/.test(lines[i + 1])) {
        i++;
        tags.push(lines[i].replace(/^\s+-\s+/, "").trim());
      }
      result.tags = tags;
      continue;
    }

    const value = rawValue.replace(/^["']|["']$/g, "");
    if (!value) continue;

    if (key === "name") result.name = value;
    else if (key === "description") result.description = value;
    else if (key === "displayName" || key === "display_name") result.displayName = value;
    else if (key === "category") result.category = value;
    else if (key === "version") result.version = value;
    else if (key === "source") result.source = value;
    else if (key === "tags") {
      result.tags = value.replace(/[\[\]]/g, "").split(",").map((tag) => tag.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
    }
  }

  return Object.keys(result).length > 0 ? result : null;
}

export function validateSkillDirectory(
  name: string,
  skillPath: string,
  registryMeta?: SkillMeta
): SkillValidationResult {
  const bareName = name;
  const issues: SkillValidationMessage[] = [];
  const warnings: SkillValidationMessage[] = [];
  const metadata: SkillValidationResult["metadata"] = {
    binCommands: [],
    docFiles: [],
  };

  if (!existsSync(skillPath)) {
    add(issues, "skill.dir_missing", `Skill directory not found: ${skillPath}`);
    return {
      name: bareName,
      path: skillPath,
      valid: false,
      issues: sortMessages(issues),
      warnings: sortMessages(warnings),
      metadata,
    };
  }

  if (!VALID_BIN_COMMAND.test(bareName)) {
    add(issues, "skill.name_invalid", `Skill name '${bareName}' must use lowercase letters, numbers, dots, underscores, or hyphens`);
  }

  for (const entry of readdirSync(skillPath).sort()) {
    const entryPath = join(skillPath, entry);
    if (RESERVED_SKILL_ENTRIES.has(entry)) {
      add(issues, "skill.reserved_file", `Reserved file '${entry}' is not allowed in skill packages`);
    }
    if (lstatSync(entryPath).isSymbolicLink()) {
      add(issues, "skill.symlink_forbidden", `Symlink '${entry}' is not allowed in skill packages`);
    }
    if (!KNOWN_TOP_LEVEL_ENTRIES.has(entry)) {
      add(warnings, "skill.file_unrecognized", `Unrecognized top-level skill entry '${entry}'`);
    }
  }

  for (const docFile of DOC_FILES) {
    if (existsSync(join(skillPath, docFile))) metadata.docFiles.push(docFile);
  }
  if (metadata.docFiles.length === 0) {
    add(issues, "skill.docs_missing", "Missing documentation file: expected SKILL.md, README.md, or CLAUDE.md");
  }

  const skillMdPath = join(skillPath, "SKILL.md");
  if (existsSync(skillMdPath)) {
    const frontmatter = parseSkillFrontmatter(readFileSync(skillMdPath, "utf-8"));
    if (!frontmatter) {
      add(warnings, "skill.frontmatter_missing", "SKILL.md has no YAML frontmatter");
    } else {
      metadata.skillMdFrontmatter = frontmatter;
      metadata.provenance = {
        ...(metadata.provenance ?? { directoryName: bareName }),
        ...(frontmatter.source ? { frontmatterSource: frontmatter.source } : {}),
        ...(registryMeta?.source ? { registrySource: registryMeta.source } : {}),
      };
      if (!frontmatter.name) add(issues, "skill.frontmatter_name_missing", "SKILL.md frontmatter missing name");
      if (!frontmatter.description) add(issues, "skill.frontmatter_description_missing", "SKILL.md frontmatter missing description");
      if (frontmatter.name && frontmatter.name !== bareName) {
        add(issues, "skill.frontmatter_name_mismatch", `SKILL.md name '${frontmatter.name}' does not match '${bareName}'`);
      }
      if (frontmatter.source && !VALID_PROVENANCE_SOURCES.has(frontmatter.source)) {
        add(issues, "skill.frontmatter_source_invalid", `SKILL.md source '${frontmatter.source}' is not one of: ${[...VALID_PROVENANCE_SOURCES].join(", ")}`);
      }
      if (frontmatter.tags && frontmatter.tags.some((tag) => !tag.trim())) {
        add(issues, "skill.frontmatter_tags_invalid", "SKILL.md tags must be non-empty strings");
      }
      if (registryMeta?.description && frontmatter.description && frontmatter.description.length < 8) {
        add(warnings, "skill.frontmatter_description_short", "SKILL.md description is very short");
      }
      if (registryMeta?.category && frontmatter.category && frontmatter.category !== registryMeta.category) {
        add(warnings, "skill.frontmatter_category_mismatch", `SKILL.md category '${frontmatter.category}' does not match registry category '${registryMeta.category}'`);
      }
    }
  } else {
    add(warnings, "skill.skill_md_missing", "Missing SKILL.md; registry docs may need generated agent-facing instructions");
  }

  const pkgPath = join(skillPath, "package.json");
  if (!existsSync(pkgPath)) {
    add(issues, "package.missing", "Missing package.json");
  } else {
    try {
      const pkg = readJsonFile(pkgPath) as PackageJson;
      const packageRecord = asRecord(pkg);
      if (!packageRecord) {
        add(issues, "package.invalid_shape", "package.json must be an object");
      } else {
        if (typeof pkg.name === "string") {
          metadata.packageName = pkg.name;
          if (pkg.name !== bareName) {
            add(issues, "package.name_mismatch", `package.json name '${pkg.name}' does not match '${bareName}'`);
          }
        } else {
          add(issues, "package.name_missing", "package.json missing string name");
        }

        if (typeof pkg.version === "string" && pkg.version.trim()) metadata.version = pkg.version;
        else add(warnings, "package.version_missing", "package.json missing string version");

        metadata.provenance = {
          ...(metadata.provenance ?? { directoryName: bareName }),
          ...(typeof pkg.name === "string" ? { packageName: pkg.name } : {}),
          ...(typeof pkg.version === "string" && pkg.version.trim() ? { packageVersion: pkg.version } : {}),
          ...(registryMeta?.source ? { registrySource: registryMeta.source } : {}),
        };

        const binRecord = asRecord(pkg.bin);
        if (!binRecord || Object.keys(binRecord).length === 0) {
          add(issues, "package.bin_missing", "package.json missing non-empty bin object");
        } else {
          for (const [command, target] of Object.entries(binRecord)) {
            if (!VALID_BIN_COMMAND.test(command)) {
              add(issues, "package.bin_command_invalid", `package.json bin command '${command}' must use lowercase letters, numbers, dots, underscores, or hyphens`);
            }
            if (typeof target !== "string" || !target.trim()) {
              add(issues, "package.bin_invalid", `package.json bin '${command}' must point to a file`);
              continue;
            }
            metadata.binCommands.push(command);
            if (!isSafeRelativePath(target)) {
              add(issues, "package.bin_target_unsafe", `package.json bin '${command}' target '${target}' must stay inside the skill directory`);
              continue;
            }
            const targetPath = join(skillPath, target);
            if (!existsSync(targetPath)) {
              add(warnings, "package.bin_target_missing", `package.json bin '${command}' target '${target}' is not present before build`);
            } else if (statSync(targetPath).isDirectory()) {
              add(issues, "package.bin_target_directory", `package.json bin '${command}' target '${target}' must point to a file, not a directory`);
            }
          }
        }
      }
    } catch (error) {
      add(issues, "package.invalid_json", `package.json is invalid JSON: ${(error as Error).message}`);
    }
  }

  const srcDir = join(skillPath, "src");
  if (!existsSync(srcDir)) {
    add(issues, "skill.src_missing", "Missing src/ directory");
  } else if (!existsSync(join(srcDir, "index.ts")) && !existsSync(join(srcDir, "index.js"))) {
    add(issues, "skill.src_index_missing", "Missing src/index.ts or src/index.js");
  } else {
    const indexPath = existsSync(join(srcDir, "index.ts")) ? join(srcDir, "index.ts") : join(srcDir, "index.js");
    const size = statSync(indexPath).size;
    if (size < 50) add(warnings, "skill.src_index_minimal", `Source entry point is very small (${size}B)`);
  }

  return {
    name: bareName,
    path: skillPath,
    valid: issues.length === 0,
    issues: sortMessages(issues),
    warnings: sortMessages(warnings),
    metadata,
  };
}

export function validateRegistryConsistency(registry: SkillMeta[], skillsDir: string): RegistryConsistencyResult {
  const registryNames = registry.map((skill) => skill.name);
  const seen = new Set<string>();
  const duplicateRegistryNames = Array.from(new Set(registryNames.filter((name) => {
    if (seen.has(name)) return true;
    seen.add(name);
    return false;
  })));

  const skillDirs = existsSync(skillsDir)
    ? readdirSync(skillsDir).filter((entry) => {
      const fullPath = join(skillsDir, entry);
      return !entry.startsWith(".") && entry !== "_common" && statSync(fullPath).isDirectory();
    })
    : [];
  const directoryNames = new Set(skillDirs);
  const registryNameSet = new Set(registryNames);

  const missingDirectories = registryNames.filter((name) => !directoryNames.has(name));
  const orphanDirectories = skillDirs.filter((dir) => !registryNameSet.has(dir));

  return {
    valid: missingDirectories.length === 0 && orphanDirectories.length === 0 && duplicateRegistryNames.length === 0,
    missingDirectories,
    orphanDirectories,
    duplicateRegistryNames,
  };
}
