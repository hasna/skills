export type SkillKind = "executable" | "instruction";

/**
 * Provenance sources for a skill. Kept in sync with VALID_PROVENANCE_SOURCES in
 * skill-validation.ts (plus "extension" for private extension overlays).
 */
export type SkillSource =
  | "official"
  | "custom"
  | "remote"
  | "private"
  | "private-hosted"
  | "upstream"
  | "extension";

export interface SkillMeta {
  name: string;
  displayName: string;
  description: string;
  category: string;
  tags: string[];
  dependencies?: string[];
  version?: string;
  /**
   * Artifact class of the skill. "executable" skills carry a runnable
   * package.json/bin/src; "instruction" skills are SKILL.md-primary prose for
   * agents. Missing kind defaults to "executable" during migration.
   */
  kind?: SkillKind;
  creditQuote?: import("./public-credits.js").PublicCreditQuote;
  availability?: SkillAvailabilityMetadata;
  source?: SkillSource;
}

export interface SkillAvailabilityMetadata {
  status: "available" | "unavailable";
  code?: string;
  message?: string;
  details?: string[];
}

export const CATEGORIES = [
  "Development Tools",
  "Business & Marketing",
  "Productivity & Organization",
  "Project Management",
  "Content Generation",
  "Finance & Compliance",
  "Data & Analysis",
  "Media Processing",
  "Design & Branding",
  "Web & Browser",
  "Research & Writing",
  "Science & Academic",
  "Education & Learning",
  "Communication",
  "Health & Wellness",
  "Travel & Lifestyle",
  "Event Management",
] as const;

export type Category = (typeof CATEGORIES)[number];

export const BASIC_SKILL_NAMES = [
  "image",
  "video",
  "audio",
  "music",
  "transcript",
  "audio-extract",
  "read-image",
  "read-pdf",
  "pdf-read",
  "pdf-to-markdown",
  "doc-read",
  "pdf-generate",
  "doc-generate",
  "read-csv",
  "read-excel",
  "excel",
  "convert",
] as const;

export type SkillRegistryProfile = "basic" | "all";
