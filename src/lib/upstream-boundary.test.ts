import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();

describe("upstream boundary documentation", () => {
  const cloudPackage = "@hasna" + "/cloud";
  const content = readFileSync(
    join(process.cwd(), "docs/architecture/upstream-boundary.md"),
    "utf8",
  );

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
    expect(content).toContain("Billing, credits, ledgers");
    expect(content).toContain("Deployment infrastructure");
  });

  test("preserves local-capable upstream behavior without a deployment mode", () => {
    expect(content).toContain("Preserve local-capable behavior");
    expect(content).toContain("Keep the API origin explicit");
    // The sync rules used to order contributors to keep the deployment variant
    // explicit by name, which is a standing instruction to rebuild the concept
    // this repo removed. The rule survives; the vocabulary does not.
    expect(content).toContain("There is no");
    expect(content).toContain("deployment mode to select");
  });

  test("separates native storage from self-hosted service databases", () => {
    expect(content).toContain("HASNA_SKILLS_*");
    expect(content).toContain("self-hosted service");
    expect(content).toContain("must not pass");
  });
});
