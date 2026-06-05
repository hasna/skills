import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

describe("open-core SaaS pattern", () => {
  const content = readFileSync(join(process.cwd(), "docs/architecture/open-core-saas-pattern.md"), "utf8");

  test("keeps hosted server implementation outside OSS packages", () => {
    expect(content).toContain("hosted-aware");
    expect(content).toContain("local");
    expect(content).toContain("billing status");
    expect(content).toContain("OAuth provider secrets");
    expect(content).toContain("Stripe webhook handlers");
    expect(content).toContain("The hosted web app is the account and billing source of truth");
  });
});
