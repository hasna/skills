import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("package ownership and sync strategy", () => {
  const content = readFileSync(
    join(process.cwd(), "docs/architecture/package-ownership-sync-strategy.md"),
    "utf8",
  );
  const compactContent = content.replace(/\s+/g, " ");

  test("chooses package dependency plus generated registry sync", () => {
    expect(content).toContain("canonical upstream package");
    expect(content).toContain("imports released public");
    expect(content).toContain("Released npm package pinned by lockfile");
    expect(content).toContain("Generated Registry Sync");
  });

  test("assigns ownership across OSS, operator selfhost, and Hasna cloud", () => {
    for (const phrase of [
      "`hasna/skills`, npm `@hasna/skills`",
      "Agent CLI",
      "MCP server",
      "Bundled skill corpus",
      "Provider-neutral server",
      "Operator selfhost composition",
      "Hasna cloud composition",
      "Hasna cloud infrastructure",
      "Hasna-internal infrastructure belongs in this row",
    ]) {
      expect(compactContent).toContain(phrase);
    }
  });

  test("rejects source-copy integration strategies", () => {
    for (const phrase of [
      "Permanent Fork",
      "Git Subtree Or Submodule",
      "Generated Source Copy",
      "Monorepo Package Ownership Transfer",
    ]) {
      expect(compactContent).toContain(phrase);
    }
  });

  test("keeps selfhost and cloud compositions as package consumers", () => {
    expect(content).toContain("External selfhost compositions and the Hasna cloud platform should consume");
    expect(content).toContain("Released npm package pinned by lockfile");
    expect(content).toContain("public-boundary preflight");
    expect(content).not.toContain("@hasnatools/platform-skills");
    expect(content).not.toContain("src/platform");
  });

  test("keeps private composition concerns out of upstream", () => {
    for (const phrase of [
      "No private composition module should publish as `@hasna/skills`",
      "No upstream client or embedded-engine module should require cloud account",
      "Hasna billing",
      "customer tenancy",
      "No remote or paid skill should download protected source code",
    ]) {
      expect(compactContent).toContain(phrase);
    }
  });

  test("defines remote-only premium boundary while preserving local user-key skills", () => {
    for (const phrase of [
      "Premium Remote-Only Boundary",
      "selected, enrolled `selfhost` or `cloud` profile",
      "must not fall back to bundled local execution",
      "OSS package may expose public contracts for server-executed skills",
      "must not expose private provider routing",
      "`SKILLS_API_KEY` is the current legacy remote credential input",
      "provider keys such as",
      "`OPENAI_API_KEY`",
      "skill-specific local credentials",
      "protected server-side implementation source",
    ]) {
      expect(compactContent).toContain(phrase);
    }
  });

  test("maps legacy deployment, storage, and credentials independently", () => {
    for (const phrase of [
      "Legacy-To-Target Mapping",
      "`HASNA_SKILLS_STORAGE_MODE` / `SKILLS_STORAGE_MODE`",
      "Storage profile `mode` (`local`, `remote`, or `hybrid`)",
      "`credentialReenrollmentRequired`",
      "deployment authority, operation execution, and storage authority",
      "never determine target mode without trust enrollment",
    ]) {
      expect(compactContent).toContain(phrase);
    }
  });
});
