export interface SkillMeta {
  name: string;
  displayName: string;
  description: string;
  category: string;
  tags: string[];
  dependencies?: string[];
  version?: string;
  pricing?: SkillPricingMetadata;
  availability?: SkillAvailabilityMetadata;
  source?: "official" | "custom" | "remote";
}

export interface SkillPricingMetadata {
  tier?: "free" | "premium" | string;
  billingUnit?: string;
  costCents?: number;
  formattedCost: string;
  formattedUnitCost?: string;
  unitCount?: number;
  estimated?: boolean;
  quoteDependsOnInput?: boolean;
  quoteRequired?: boolean;
  description?: string;
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
