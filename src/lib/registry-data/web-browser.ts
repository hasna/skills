import type { SkillMeta } from "../registry-types.js";

export const WEB_BROWSER_SKILLS: SkillMeta[] = [
  {
    name: "browse",
    displayName: "Browse",
    description: "Browser automation using Browser-Use Cloud API for AI agents",
    category: "Web & Browser",
    tags: ["browser", "automation", "scraping", "web"],
  },
  {
    name: "domainpurchase",
    displayName: "Domain Purchase",
    description: "Purchase and manage domains via registrar connectors",
    category: "Web & Browser",
    tags: ["domain", "purchase", "registrar", "management"],
  },
  {
    name: "domainsearch",
    displayName: "Domain Search",
    description: "Search domain availability and suggestions via registrar connectors",
    category: "Web & Browser",
    tags: ["domain", "search", "availability", "registration"],
  },
  {
    name: "webcrawling",
    displayName: "Web Crawling",
    description: "Web crawling service using Firecrawl API for content extraction",
    category: "Web & Browser",
    tags: ["crawling", "web", "firecrawl", "extraction"],
  },
];
