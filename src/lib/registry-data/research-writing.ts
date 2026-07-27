import type { SkillMeta } from "../registry-types.js";

export const RESEARCH_WRITING_SKILLS: SkillMeta[] = [
  {
    name: "blog-article",
    displayName: "Blog Article",
    description: "Create SEO-optimized blog article artifact packages",
    category: "Research & Writing",
    kind: "instruction",
    tags: ["blog", "article", "writing", "seo"],
  },
  {
    name: "market-research-report",
    displayName: "Market Research Report",
    description: "Generate market research packages with competitor tables, positioning, pricing notes, source notes, and PDF/Markdown artifacts",
    category: "Research & Writing",
    kind: "instruction",
    tags: ["market-research", "competitors", "positioning", "pricing", "report"],
  },
];
