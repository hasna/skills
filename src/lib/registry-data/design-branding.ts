import type { SkillMeta } from "../registry-types.js";

export const DESIGN_BRANDING_SKILLS: SkillMeta[] = [
  {
    name: "brand-kit",
    displayName: "Brand Kit",
    description: "Generate brand kits with logo usage, palette, typography, brand voice, sample applications, Markdown guide, PDF guide, and SVG assets",
    category: "Design & Branding",
    kind: "instruction",
    tags: ["brand", "design", "palette", "typography"],
  },
  {
    name: "brand-assets",
    displayName: "Brand Assets",
    description: "Fetch official brand assets from a website or brand name with logos, PNG sizes, palette, typography, source metadata, and manifests",
    category: "Design & Branding",
    tags: ["brand", "logo", "assets", "palette", "typography"],
  },
  {
    name: "logo-design",
    displayName: "Logo Design",
    description: "Generate multi-variant logo packages with transparent PNGs, vector-style SVGs, usage notes, and manifests",
    category: "Design & Branding",
    tags: ["logo", "design", "branding", "identity"],
  },
  {
    name: "generate-favicon",
    displayName: "Generate Favicon",
    description: "Generate favicons in multiple sizes and formats for websites",
    category: "Design & Branding",
    tags: ["favicon", "icon", "design", "web"],
  },
  {
    name: "product-mockup",
    displayName: "Product Mockup",
    description: "Generate product mockup packages with visual variants, prompts, usage notes, and asset metadata",
    category: "Design & Branding",
    tags: ["product", "mockup", "visualization", "marketing"],
  },
  {
    name: "siteanalyze",
    displayName: "Site Analyze",
    description: "Analyze any website's design system — detects shadcn/ui, Tailwind, extracts colors, typography, and components via Playwright + Claude Vision.",
    category: "Design & Branding",
    tags: ["design", "shadcn", "tailwind", "colors", "typography", "playwright", "analysis", "open-styles"],
  },
];
