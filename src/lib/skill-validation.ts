import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
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

interface PackageJson {
  name?: unknown;
  version?: unknown;
  bin?: unknown;
  scripts?: unknown;
}

const DOC_FILES = ["SKILL.md", "README.md", "CLAUDE.md"];

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
    return { name: bareName, path: skillPath, valid: false, issues, warnings, metadata };
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
      if (!frontmatter.name) add(issues, "skill.frontmatter_name_missing", "SKILL.md frontmatter missing name");
      if (!frontmatter.description) add(issues, "skill.frontmatter_description_missing", "SKILL.md frontmatter missing description");
      if (frontmatter.name && frontmatter.name !== bareName) {
        add(issues, "skill.frontmatter_name_mismatch", `SKILL.md name '${frontmatter.name}' does not match '${bareName}'`);
      }
      if (registryMeta?.description && frontmatter.description && frontmatter.description.length < 8) {
        add(warnings, "skill.frontmatter_description_short", "SKILL.md description is very short");
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
        if (typeof pkg.name === "string") metadata.packageName = pkg.name;
        else add(issues, "package.name_missing", "package.json missing string name");

        if (typeof pkg.version === "string" && pkg.version.trim()) metadata.version = pkg.version;
        else add(warnings, "package.version_missing", "package.json missing string version");

        const binRecord = asRecord(pkg.bin);
        if (!binRecord || Object.keys(binRecord).length === 0) {
          add(issues, "package.bin_missing", "package.json missing non-empty bin object");
        } else {
          for (const [command, target] of Object.entries(binRecord)) {
            if (typeof target !== "string" || !target.trim()) {
              add(issues, "package.bin_invalid", `package.json bin '${command}' must point to a file`);
              continue;
            }
            metadata.binCommands.push(command);
            if (!existsSync(join(skillPath, target))) {
              add(warnings, "package.bin_target_missing", `package.json bin '${command}' target '${target}' is not present before build`);
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
    issues,
    warnings,
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
