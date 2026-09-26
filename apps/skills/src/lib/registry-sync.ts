import { mkdirSync, writeFileSync } from "fs";
import { dirname, relative } from "path";
import pkg from "../../package.json" with { type: "json" };
import { getSkillPath } from "./installer.js";
import { loadRegistryProfile, type SkillMeta, type SkillRegistryProfile } from "./registry.js";
import { getSkillDocs, getSkillRequirements, type SkillDocs, type SkillRequirements } from "./skillinfo.js";
import { validateSkillDirectory, type SkillValidationResult } from "./skill-validation.js";

export interface RegistrySyncOptions {
  profile?: SkillRegistryProfile;
  includeDocs?: boolean;
  includeRequirements?: boolean;
  includeValidation?: boolean;
  packageName?: string;
  packageVersion?: string;
  sourceRepository?: string;
}

export interface RegistrySyncSkill {
  name: string;
  slug: string;
  displayName: string;
  description: string;
  category: string;
  tags: string[];
  dependencies: string[];
  source: {
    packageName: string;
    packageVersion: string;
    repository: string;
    directory: string;
  };
  docs?: SkillDocs & { best: string | null };
  requirements?: SkillRequirements | null;
  validation?: SkillValidationResult;
}

export interface RegistrySyncArtifact {
  schemaVersion: 1;
  source: {
    packageName: string;
    packageVersion: string;
    repository: string;
    profile: SkillRegistryProfile;
  };
  summary: {
    skillCount: number;
    validSkillCount: number | null;
    invalidSkillCount: number | null;
    categories: Array<{ name: string; count: number }>;
  };
  skills: RegistrySyncSkill[];
}

export function createRegistrySyncArtifact(options: RegistrySyncOptions = {}): RegistrySyncArtifact {
  const profile = options.profile ?? "all";
  const includeDocs = options.includeDocs ?? true;
  const includeRequirements = options.includeRequirements ?? true;
  const includeValidation = options.includeValidation ?? true;
  const packageName = options.packageName ?? "@hasna/skills";
  const packageVersion = options.packageVersion ?? pkg.version;
  const sourceRepository = options.sourceRepository ?? "hasna/skills";

  const registry = [...loadRegistryProfile(profile)].sort((a, b) => a.name.localeCompare(b.name));
  const skills = registry.map((skill): RegistrySyncSkill => {
    const skillPath = getSkillPath(skill.name);
    const directory = relative(process.cwd(), skillPath) || skillPath;
    const validation = includeValidation ? validateSkillDirectory(skill.name, skillPath, skill) : undefined;
    const docs = includeDocs ? buildDocs(skill.name) : undefined;

    return {
      name: skill.name,
      slug: skill.name,
      displayName: skill.displayName,
      description: skill.description,
      category: skill.category,
      tags: [...skill.tags].sort(),
      dependencies: [...(skill.dependencies ?? [])].sort(),
      source: {
        packageName,
        packageVersion,
        repository: sourceRepository,
        directory,
      },
      ...(docs ? { docs } : {}),
      ...(includeRequirements ? { requirements: getSkillRequirements(skill.name) } : {}),
      ...(validation ? { validation } : {}),
    };
  });

  const validSkillCount = includeValidation
    ? skills.filter((skill) => skill.validation?.valid).length
    : null;
  const categories = Array.from(
    skills.reduce((counts, skill) => {
      counts.set(skill.category, (counts.get(skill.category) ?? 0) + 1);
      return counts;
    }, new Map<string, number>()),
  )
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    schemaVersion: 1,
    source: {
      packageName,
      packageVersion,
      repository: sourceRepository,
      profile,
    },
    summary: {
      skillCount: skills.length,
      validSkillCount,
      invalidSkillCount: validSkillCount === null ? null : skills.length - validSkillCount,
      categories,
    },
    skills,
  };
}

export function writeRegistrySyncArtifact(path: string, artifact: RegistrySyncArtifact): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(artifact, null, 2)}\n`);
}

function buildDocs(name: string): RegistrySyncSkill["docs"] {
  const docs = getSkillDocs(name) ?? { skillMd: null, readme: null, claudeMd: null };
  return {
    ...docs,
    best: docs.skillMd ?? docs.readme ?? docs.claudeMd ?? null,
  };
}
