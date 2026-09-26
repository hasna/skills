import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getPortableSkillsRoot } from "./portable-skills.js";
import { clearRegistryCache } from "./registry.js";
import { createInstructionManifest, readPortableSkillManifest, writeSkillJsonWithHash } from "./portable-skills-files.js";

/** Synthetic metadata and one-line documents, never an operational skill corpus. */
export function writeOwnedFixture(name: string, options: {
  root?: string; description?: string; displayName?: string; category?: string; tags?: string[];
} = {}): string {
  const dir = join(options.root ?? getPortableSkillsRoot(), name);
  mkdirSync(dir, { recursive: true });
  const displayName = options.displayName ?? name.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase());
  const manifest = createInstructionManifest(name, {
    description: options.description ?? "Synthetic test fixture", category: options.category ?? "Development Tools",
    tags: options.tags ?? ["fixture"],
  });
  manifest.version = "1.0.0";
  manifest.displayName = displayName;
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name, version: "1.0.0", skills: { kind: "instruction" } }));
  writeFileSync(join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: Synthetic test fixture\nkind: instruction\nuser_invocable: true\n---\n\n# ${displayName}\n\nSynthetic test document.\n`);
  writeSkillJsonWithHash(dir, manifest);
  clearRegistryCache();
  return dir;
}

// These names are stable transport-test identifiers retained by old CLI tests.
// Every document below is generated synthetic text, not an operational skill.
export const TEST_CATALOG = [
  ["brand-kit", "Design & Branding", ["image", "design", "branding", "api"]],
  ["market-research-report", "Research & Writing", ["research", "report", "marketing", "api"]],
  ["blog-article", "Research & Writing", ["blog", "writing", "marketing"]],
  ["ad-creative-pack", "Business & Marketing", ["image", "marketing"]],
  ["contract-review-report", "Finance & Compliance", ["documents", "json", "pdf"]],
  ["seo-content-pack", "Content Generation", ["seo", "frontend", "marketing"]],
  ["email-sequence", "Communication", ["email", "marketing"]],
  ["pitch-deck", "Business & Marketing", ["slides", "marketing"]],
  ["proposal-pack", "Business & Marketing", ["proposal", "payments", "pdf"]],
  ["social-content-calendar", "Content Generation", ["social", "marketing"]],
  ["repo-onboarding-report", "Development Tools", ["typescript", "code", "api"]],
  ["test-suite-generator", "Development Tools", ["testing", "test", "api", "backend"]],
] as const;

export function writeTestCatalog(root: string): void {
  for (const [name, category, tags] of TEST_CATALOG) {
    const dir = writeOwnedFixture(name, { root, category, tags: [...tags],
      description: `Synthetic ${tags.join(" ")} fixture metadata for CLI and MCP transport tests.` });
    // Keep large-output pipe regressions meaningful without bundling real docs.
    writeFileSync(join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: Synthetic fixture document\nkind: instruction\n---\n# ${name.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase())}\n\n` +
      "Synthetic transport fixture text; no operational instructions.\n".repeat(128));
    writeSkillJsonWithHash(dir, readPortableSkillManifest(dir));
  }
}
