import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("database schema audit", () => {
  const content = readFileSync(
    join(process.cwd(), "docs/architecture/database-schema-audit.md"),
    "utf8",
  );

  test("documents that no SaaS Drizzle schema exists yet", () => {
    expect(content).toContain("There is no existing Drizzle ORM SaaS schema");
    expect(content).toContain("@hasna/skills");
    expect(content).toContain("skill implementation details");
    expect(content).toContain("SaaS\nplatform schema");
  });

  test("defines required product domains for the new schema", () => {
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
      "tenantId",
      "organizationId",
      "idempotency key",
      "correlation id",
      "upstream package version",
      "canonical skill slug",
      "requested skill slug",
      "private-hosted",
    ]) {
      expect(content).toContain(phrase);
    }
  });

  test("sets immediate Phase 2 implementation path", () => {
    expect(content).toContain("Add schema package and Drizzle config");
    expect(content).toContain("Add skill source and artifact provenance fields");
    expect(content).toContain("Generate and test migrations");
    expect(content).toContain("Do not use skill-local database helper code");
  });
});
