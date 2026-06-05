import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("database boundary audit", () => {
  const content = readFileSync(
    join(process.cwd(), "docs/architecture/database-schema-audit.md"),
    "utf8",
  );

  test("documents that no hosted product schema exists in OSS", () => {
    expect(content).toContain("There is no hosted product database schema");
    expect(content).toContain("@hasna/skills");
    expect(content).toContain("skill implementation details");
    expect(content).toContain("hosted\nservice schema");
  });

  test("defines hosted wrapper state domains", () => {
    for (const phrase of [
      "Tenancy",
      "Identity",
      "API access",
      "Skill registry",
      "Pins",
      "Execution",
      "Async jobs",
      "Approvals",
      "Billing",
      "Connectors",
      "Audit",
    ]) {
      expect(content).toContain(phrase);
    }
  });

  test("requires tenant, idempotency, and provenance fields", () => {
    for (const phrase of [
      "tenant or organization ids",
      "idempotency keys",
      "correlation ids",
      "upstream package version",
      "canonical skill slug",
      "requested\nskill slug",
      "private-hosted",
    ]) {
      expect(content).toContain(phrase);
    }
  });

  test("keeps hosted database work out of public package exports", () => {
    expect(content).toContain("Project config");
    expect(content).toContain("Run metadata");
    expect(content).toContain("Do not add hosted database requirements");
    expect(content).toContain("Do not use skill-local database helper code");
  });
});
