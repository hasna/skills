import {
  getSkill,
  loadRegistryProfile,
  type SkillMeta,
  type SkillRegistryProfile,
} from "./registry.js";

export const TOOL_PRIMITIVE_SCHEMA_VERSION = 1 as const;

export type ToolPrimitiveRuntime =
  | "local"
  | "hosted"
  | "gateway"
  | "connector"
  | "mixed";

export interface ToolPrimitive {
  name: string;
  title: string;
  family: string;
  description: string;
  runtime: ToolPrimitiveRuntime;
  stable: true;
  cliCommands: string[];
  mcpTools: string[];
  apiSurfaces: string[];
  envVars: string[];
  outputTypes: string[];
  capabilities: string[];
}

export interface ToolPrimitiveSummary {
  name: string;
  title: string;
  family: string;
  runtime: ToolPrimitiveRuntime;
  description: string;
}

export interface SkillToolDependency {
  skill: string;
  primitive: string;
  family: string;
  required: boolean;
  reason: string;
}

export interface SkillToolDependencies {
  schemaVersion: typeof TOOL_PRIMITIVE_SCHEMA_VERSION;
  skill: string;
  category: string;
  source: SkillMeta["source"] | "official";
  dependencies: SkillToolDependency[];
  gatewayBacked: boolean;
  hostedRuntime: boolean;
}

export interface ToolPrimitiveCoverageIssue {
  skill: string;
  code: "skill.unmapped" | "primitive.missing";
  message: string;
}

export interface ToolPrimitiveCoverageResult {
  schemaVersion: typeof TOOL_PRIMITIVE_SCHEMA_VERSION;
  valid: boolean;
  profile: SkillRegistryProfile;
  skillCount: number;
  primitiveCount: number;
  mappedSkillCount: number;
  gatewayBackedSkillCount: number;
  hostedRuntimeSkillCount: number;
  issues: ToolPrimitiveCoverageIssue[];
}

interface PrimitiveRule {
  primitive: string;
  reason: string;
  required?: boolean;
  categories?: string[];
  tags?: string[];
  names?: string[];
  keywords?: string[];
}

export const TOOL_PRIMITIVES: ToolPrimitive[] = [
  {
    name: "ai-gateway",
    title: "AI Gateway",
    family: "ai",
    description: "Provider-neutral text, code, reasoning, and multimodal model calls routed through the configured hosted gateway.",
    runtime: "gateway",
    stable: true,
    cliCommands: ["skills tools deps <skill>", "skills run <skill>"],
    mcpTools: ["get_skill_tool_dependencies", "run_skill"],
    apiSurfaces: ["runSkill", "SkillRunRecord", "RemoteSkillRunContract"],
    envVars: ["HASNA_SKILLS_API_KEY"],
    outputTypes: ["text", "json", "markdown", "artifact"],
    capabilities: ["completion", "reasoning", "tool-calling", "vision-input", "structured-output"],
  },
  {
    name: "documents-read",
    title: "Document Read",
    family: "documents",
    description: "Read, parse, normalize, and extract from PDF, DOCX, slides, invoices, contracts, and other document files.",
    runtime: "mixed",
    stable: true,
    cliCommands: ["skills tools deps <skill>", "skills run <skill>"],
    mcpTools: ["get_skill_tool_dependencies", "run_skill"],
    apiSurfaces: ["getSkillRequirements", "runSkill"],
    envVars: [],
    outputTypes: ["text", "json", "markdown"],
    capabilities: ["pdf-parse", "office-parse", "ocr", "metadata-extraction"],
  },
  {
    name: "documents-write",
    title: "Document Write",
    family: "documents",
    description: "Generate PDFs, DOCX, slide decks, ebooks, reports, and other downloadable document artifacts.",
    runtime: "mixed",
    stable: true,
    cliCommands: ["skills tools deps <skill>", "skills run <skill>"],
    mcpTools: ["get_skill_tool_dependencies", "run_skill"],
    apiSurfaces: ["createSkillRun", "completeSkillRun", "writeRunLogs"],
    envVars: [],
    outputTypes: ["pdf", "docx", "pptx", "markdown", "zip"],
    capabilities: ["document-generation", "layout", "export-artifacts"],
  },
  {
    name: "structured-data",
    title: "Structured Data",
    family: "data",
    description: "Read, transform, validate, and export CSV, Excel, JSON, SQL, metrics, and tabular datasets.",
    runtime: "mixed",
    stable: true,
    cliCommands: ["skills tools deps <skill>", "skills run <skill>"],
    mcpTools: ["get_skill_tool_dependencies", "run_skill"],
    apiSurfaces: ["runSkill", "SkillRunArtifact"],
    envVars: [],
    outputTypes: ["csv", "xlsx", "json", "sql", "markdown"],
    capabilities: ["csv", "excel", "etl", "schema", "analytics"],
  },
  {
    name: "media-image",
    title: "Image Tooling",
    family: "media",
    description: "Generate, inspect, transform, remove backgrounds from, and package image artifacts.",
    runtime: "gateway",
    stable: true,
    cliCommands: ["skills tools deps <skill>", "skills run <skill>"],
    mcpTools: ["get_skill_tool_dependencies", "run_skill"],
    apiSurfaces: ["runSkill", "RemoteSkillRunContract"],
    envVars: ["HASNA_SKILLS_API_KEY"],
    outputTypes: ["png", "jpeg", "webp", "svg", "zip"],
    capabilities: ["image-generation", "image-analysis", "image-editing", "asset-packaging"],
  },
  {
    name: "media-audio",
    title: "Audio Tooling",
    family: "media",
    description: "Transcribe, extract, clean, generate, and package audio, voiceover, music, and podcast outputs.",
    runtime: "gateway",
    stable: true,
    cliCommands: ["skills tools deps <skill>", "skills run <skill>"],
    mcpTools: ["get_skill_tool_dependencies", "run_skill"],
    apiSurfaces: ["runSkill", "RemoteSkillRunContract"],
    envVars: ["HASNA_SKILLS_API_KEY"],
    outputTypes: ["mp3", "wav", "txt", "srt", "json", "zip"],
    capabilities: ["transcription", "audio-generation", "voiceover", "audio-cleanup"],
  },
  {
    name: "media-video",
    title: "Video Tooling",
    family: "media",
    description: "Generate, analyze, cut, caption, summarize, thumbnail, and package video outputs.",
    runtime: "gateway",
    stable: true,
    cliCommands: ["skills tools deps <skill>", "skills run <skill>"],
    mcpTools: ["get_skill_tool_dependencies", "run_skill"],
    apiSurfaces: ["runSkill", "RemoteSkillRunContract"],
    envVars: ["HASNA_SKILLS_API_KEY"],
    outputTypes: ["mp4", "mov", "srt", "png", "json", "zip"],
    capabilities: ["video-generation", "video-analysis", "captioning", "highlight-extraction"],
  },
  {
    name: "web-browser",
    title: "Web Browser",
    family: "web",
    description: "Browse, crawl, search, screenshot, inspect, and analyze websites and web application states.",
    runtime: "mixed",
    stable: true,
    cliCommands: ["skills tools deps <skill>", "skills run <skill>"],
    mcpTools: ["get_skill_tool_dependencies", "run_skill"],
    apiSurfaces: ["runSkill", "SkillRunArtifact"],
    envVars: [],
    outputTypes: ["html", "markdown", "png", "json", "har"],
    capabilities: ["crawl", "browser-automation", "screenshots", "site-analysis"],
  },
  {
    name: "connectors-run",
    title: "Connector Operations",
    family: "connectors",
    description: "Declare and execute external account operations through approved connector plans instead of direct provider CLIs.",
    runtime: "connector",
    stable: true,
    cliCommands: ["skills tools deps <skill>", "skills run <skill>"],
    mcpTools: ["get_skill_tool_dependencies", "run_skill"],
    apiSurfaces: ["SkillRunContext", "RemoteSkillRunContract"],
    envVars: ["HASNA_SKILLS_API_KEY"],
    outputTypes: ["json", "artifact"],
    capabilities: ["approval", "external-api", "account-scoped-execution"],
  },
  {
    name: "project-artifacts",
    title: "Project Artifacts",
    family: "workspace",
    description: "Read project context and write deterministic run logs, exports, and downloadable artifacts.",
    runtime: "local",
    stable: true,
    cliCommands: ["skills tools deps <skill>", "skills run <skill>"],
    mcpTools: ["get_skill_tool_dependencies", "run_skill"],
    apiSurfaces: ["createSkillRun", "completeSkillRun", "writeRunLogs", "SkillRunArtifact"],
    envVars: [],
    outputTypes: ["log", "json", "markdown", "file"],
    capabilities: ["filesystem", "run-state", "artifact-export", "deterministic-logs"],
  },
  {
    name: "safety-approval",
    title: "Safety And Approval",
    family: "safety",
    description: "Gate risky, security-sensitive, or compliance-sensitive skill actions behind explicit approval and structured evidence.",
    runtime: "mixed",
    stable: true,
    cliCommands: ["skills tools deps <skill>"],
    mcpTools: ["get_skill_tool_dependencies"],
    apiSurfaces: ["validateSkillDirectory"],
    envVars: [],
    outputTypes: ["json", "markdown"],
    capabilities: ["risk-review", "policy-evidence", "validation"],
  },
  {
    name: "hosted-auth",
    title: "Hosted Auth",
    family: "hosted",
    description: "Authenticate hosted runs through Skills account credentials rather than local provider keys.",
    runtime: "hosted",
    stable: true,
    cliCommands: ["skills auth login", "skills run <skill>"],
    mcpTools: ["run_skill"],
    apiSurfaces: ["RemoteSkillsClient", "RemoteSkillRunContract"],
    envVars: ["HASNA_SKILLS_API_KEY"],
    outputTypes: ["json"],
    capabilities: ["account-auth", "remote-run-submit"],
  },
];

const CATEGORY_RULES: PrimitiveRule[] = [
  { primitive: "ai-gateway", categories: ["Business & Marketing", "Content Generation", "Design & Branding", "Research & Writing", "Education & Learning", "Communication", "Health & Wellness", "Travel & Lifestyle", "Event Management", "Science & Academic"], reason: "Category is primarily AI-assisted generation, analysis, or planning." },
  { primitive: "project-artifacts", categories: ["Development Tools", "Project Management", "Productivity & Organization"], reason: "Category operates on project context, run logs, or workspace artifacts." },
  { primitive: "structured-data", categories: ["Data & Analysis", "Finance & Compliance", "Science & Academic"], reason: "Category works with structured inputs, tabular evidence, metrics, or analytical outputs." },
  { primitive: "safety-approval", categories: ["Finance & Compliance"], reason: "Category has compliance-sensitive outputs that need reviewable evidence." },
  { primitive: "web-browser", categories: ["Web & Browser"], reason: "Category depends on browser, crawl, search, or web inspection primitives." },
  { primitive: "media-image", categories: ["Media Processing", "Design & Branding"], reason: "Category includes visual asset generation, inspection, or packaging." },
];

// NAME_RULES map specific shipped skills to primitives. The OSS catalog is
// declarative-only, so these lists were pruned to shipped skill names when the
// executable skills were archived; category and keyword rules still cover the
// rest. Rules whose only members were archived (structured-data, media-audio)
// were dropped here — those primitives remain reachable via CATEGORY/KEYWORD
// rules. To wire a restored dev skill to a primitive, add its name back here.
const NAME_RULES: PrimitiveRule[] = [
  { primitive: "documents-read", names: ["contract-review-report"], reason: "Skill explicitly reads or extracts from document files." },
  { primitive: "documents-write", names: ["pitch-deck", "proposal-pack", "landing-page-pack"], reason: "Skill generates downloadable documents or presentation artifacts." },
  { primitive: "media-image", names: ["ad-creative-pack"], reason: "Skill works directly with image or visual asset primitives." },
  { primitive: "media-video", names: ["video-highlight-pack"], reason: "Skill works directly with video generation, editing, captions, or thumbnails." },
  { primitive: "web-browser", names: ["performance-audit-report", "seo-content-pack", "security-audit-report"], reason: "Skill needs live web, crawl, browser, or site inspection primitives." },
  { primitive: "connectors-run", names: ["email-sequence", "meeting-pack", "customer-feedback-report"], reason: "Skill can execute account-scoped external communication or CRM operations." },
  { primitive: "safety-approval", names: ["security-audit-report", "contract-review-report"], reason: "Skill produces security, legal, compliance, or procurement-sensitive evidence." },
];

const KEYWORD_RULES: PrimitiveRule[] = [
  { primitive: "documents-read", keywords: ["pdf", "docx", "document", "invoice", "contract"], reason: "Skill metadata references document parsing or review." },
  { primitive: "documents-write", keywords: ["deck", "presentation", "report", "proposal", "ebook", "pdf"], reason: "Skill metadata references generated document artifacts." },
  { primitive: "structured-data", keywords: ["csv", "excel", "spreadsheet", "dataset", "sql", "metric", "analytics", "scorecard", "budget"], reason: "Skill metadata references tabular or analytical data." },
  { primitive: "media-image", keywords: ["image", "photo", "logo", "icon", "thumbnail", "visual", "ad creative", "mockup"], reason: "Skill metadata references image or visual assets." },
  { primitive: "media-audio", keywords: ["audio", "voice", "music", "podcast", "transcript", "subtitle"], reason: "Skill metadata references audio or transcript assets." },
  { primitive: "media-video", keywords: ["video", "clip", "caption", "highlight"], reason: "Skill metadata references video assets." },
  { primitive: "web-browser", keywords: ["web", "website", "browser", "crawl", "seo", "landing page", "site"], reason: "Skill metadata references web or browser work." },
  { primitive: "connectors-run", keywords: ["email", "calendar", "crm", "inbox", "meeting", "outreach"], reason: "Skill metadata references external account operations." },
];

const primitiveByName = new Map(TOOL_PRIMITIVES.map((primitive) => [primitive.name, primitive]));
// No shipped skill declares an off-repo/hosted runtime: the OSS catalog is
// declarative-only. Kept as an explicit empty set so the hostedRuntime signal
// stays wired if a hosted skill is ever reintroduced.
const HOSTED_RUNTIME_SKILL_NAMES = new Set<string>([]);

export function listToolPrimitives(query?: string): ToolPrimitiveSummary[] {
  const needle = query?.trim().toLowerCase();
  return TOOL_PRIMITIVES
    .filter((primitive) => !needle || primitiveHaystack(primitive).includes(needle))
    .map(summarizeToolPrimitive)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function getToolPrimitive(name: string): ToolPrimitive | undefined {
  return clone(primitiveByName.get(name));
}

export function getSkillToolDependencies(name: string): SkillToolDependencies | null {
  const skill = getSkill(name);
  if (!skill) return null;
  return createSkillToolDependencies(skill);
}

export function createSkillToolDependencies(skill: SkillMeta): SkillToolDependencies {
  const dependencies = inferPrimitiveDependencies(skill);
  const primitiveNames = new Set(dependencies.map((dependency) => dependency.primitive));
  return {
    schemaVersion: TOOL_PRIMITIVE_SCHEMA_VERSION,
    skill: skill.name,
    category: skill.category,
    source: skill.source ?? "official",
    dependencies,
    gatewayBacked: [...primitiveNames].some((name) => primitiveByName.get(name)?.runtime === "gateway" || name === "ai-gateway"),
    hostedRuntime: isHostedRuntimeSkill(skill) || primitiveNames.has("hosted-auth"),
  };
}

export function isGatewayBackedSkill(name: string): boolean {
  return getSkillToolDependencies(name)?.gatewayBacked ?? false;
}

export function validateToolPrimitiveCoverage(profile: SkillRegistryProfile = "all"): ToolPrimitiveCoverageResult {
  const skills = loadRegistryProfile(profile);
  const issues: ToolPrimitiveCoverageIssue[] = [];
  let mappedSkillCount = 0;
  let gatewayBackedSkillCount = 0;
  let hostedRuntimeSkillCount = 0;

  for (const skill of skills) {
    const deps = createSkillToolDependencies(skill);
    if (deps.dependencies.length === 0) {
      issues.push({
        skill: skill.name,
        code: "skill.unmapped",
        message: `Skill '${skill.name}' has no primitive dependencies.`,
      });
      continue;
    }
    mappedSkillCount++;
    if (deps.gatewayBacked) gatewayBackedSkillCount++;
    if (deps.hostedRuntime) hostedRuntimeSkillCount++;
    for (const dependency of deps.dependencies) {
      if (!primitiveByName.has(dependency.primitive)) {
        issues.push({
          skill: skill.name,
          code: "primitive.missing",
          message: `Skill '${skill.name}' references missing primitive '${dependency.primitive}'.`,
        });
      }
    }
  }

  return {
    schemaVersion: TOOL_PRIMITIVE_SCHEMA_VERSION,
    valid: issues.length === 0,
    profile,
    skillCount: skills.length,
    primitiveCount: TOOL_PRIMITIVES.length,
    mappedSkillCount,
    gatewayBackedSkillCount,
    hostedRuntimeSkillCount,
    issues,
  };
}

function inferPrimitiveDependencies(skill: SkillMeta): SkillToolDependency[] {
  const matches: SkillToolDependency[] = [];
  const allRules = [...CATEGORY_RULES, ...NAME_RULES, ...KEYWORD_RULES];
  for (const rule of allRules) {
    if (!ruleMatches(skill, rule)) continue;
    const primitive = primitiveByName.get(rule.primitive);
    if (!primitive) continue;
    matches.push({
      skill: skill.name,
      primitive: primitive.name,
      family: primitive.family,
      required: rule.required ?? true,
      reason: rule.reason,
    });
  }

  if (isHostedRuntimeSkill(skill)) {
    const primitive = primitiveByName.get("hosted-auth")!;
    matches.push({
      skill: skill.name,
      primitive: primitive.name,
      family: primitive.family,
      required: true,
      reason: "Skill is remote or hosted and must use Skills account authentication.",
    });
  }

  if (matches.length === 0) {
    const primitive = primitiveByName.get("project-artifacts")!;
    matches.push({
      skill: skill.name,
      primitive: primitive.name,
      family: primitive.family,
      required: true,
      reason: "Default workspace primitive for local skill execution, run logs, and artifacts.",
    });
  }

  return dedupeDependencies(matches).sort((a, b) => a.primitive.localeCompare(b.primitive));
}

function ruleMatches(skill: SkillMeta, rule: PrimitiveRule): boolean {
  const name = skill.name.toLowerCase();
  const category = skill.category.toLowerCase();
  const tags = skill.tags.map((tag) => tag.toLowerCase());
  const haystack = [
    skill.name,
    skill.displayName,
    skill.description,
    skill.category,
    ...skill.tags,
  ].join(" ").toLowerCase();

  if (rule.names?.some((candidate) => candidate.toLowerCase() === name)) return true;
  if (rule.categories?.some((candidate) => candidate.toLowerCase() === category)) return true;
  if (rule.tags?.some((candidate) => tags.includes(candidate.toLowerCase()))) return true;
  if (rule.keywords?.some((keyword) => haystack.includes(keyword.toLowerCase()))) return true;
  return false;
}

function isHostedRuntimeSkill(skill: SkillMeta): boolean {
  const tags = new Set(skill.tags.map((tag) => tag.toLowerCase()));
  return HOSTED_RUNTIME_SKILL_NAMES.has(skill.name)
    || tags.has("remote")
    || tags.has("hosted");
}

function dedupeDependencies(dependencies: SkillToolDependency[]): SkillToolDependency[] {
  const byPrimitive = new Map<string, SkillToolDependency>();
  for (const dependency of dependencies) {
    const existing = byPrimitive.get(dependency.primitive);
    if (!existing) {
      byPrimitive.set(dependency.primitive, dependency);
      continue;
    }
    byPrimitive.set(dependency.primitive, {
      ...existing,
      required: existing.required || dependency.required,
      reason: existing.reason === dependency.reason
        ? existing.reason
        : `${existing.reason} ${dependency.reason}`,
    });
  }
  return [...byPrimitive.values()];
}

function summarizeToolPrimitive(primitive: ToolPrimitive): ToolPrimitiveSummary {
  return {
    name: primitive.name,
    title: primitive.title,
    family: primitive.family,
    runtime: primitive.runtime,
    description: primitive.description,
  };
}

function primitiveHaystack(primitive: ToolPrimitive): string {
  return [
    primitive.name,
    primitive.title,
    primitive.family,
    primitive.description,
    primitive.runtime,
    ...primitive.capabilities,
  ].join(" ").toLowerCase();
}

function clone<T>(value: T | undefined): T | undefined {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value)) as T;
}
