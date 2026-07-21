import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("upstream boundary documentation", () => {
  const cloudPackage = "@hasna" + "/cloud";
  const content = readFileSync(
    join(process.cwd(), "docs/architecture/upstream-boundary.md"),
    "utf8",
  );
  const compactContent = content.replace(/\s+/g, " ");

  test("keeps hasna/skills as the public origin", () => {
    expect(content).toContain("origin");
    expect(content).toContain("hasna/skills");
    expect(content).toContain("canonical open core");
    expect(content).not.toContain(cloudPackage);
  });

  test("separates open-core changes from self-hosted service changes", () => {
    expect(content).toContain("Open-Core Changes");
    expect(content).toContain("Self-Hosted Service Changes");
    expect(content).toContain("compatible API");
    expect(content).toContain("Hasna billing, credits, ledgers");
    expect(content).toContain("Hasna-managed production infrastructure");
  });

  test("keeps generic security and operations contracts upstream", () => {
    for (const phrase of [
      "Generic authentication interfaces and implementations",
      "API-key issuance and verification",
      "provider-neutral tenant isolation",
      "Provider-neutral health, readiness, metrics, tracing, logging, backup",
      "opt-in selfhost deployment contracts",
      "Generic account, organization, session, auth, and API-key contracts remain upstream",
    ]) {
      expect(compactContent).toContain(phrase);
    }
    expect(content).toContain("Hasna customer-account records");
    expect(content).toContain("private operational configuration");
  });

  test("preserves local-capable upstream behavior", () => {
    expect(content).toContain("Preserve local-capable behavior");
    expect(content).toContain("Keep self-hosted mode explicit");
    expect(content).toContain("local-safe");
  });

  test("separates native storage from self-hosted service databases", () => {
    expect(content).toContain("HASNA_SKILLS_*");
    expect(content).toContain("provider-neutral server's");
    expect(content).toContain("must not silently point client");
  });
});
