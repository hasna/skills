import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("API-first boundary contract", () => {
  const doc = readFileSync(join(process.cwd(), "docs/architecture/api-first-boundaries.md"), "utf8");

  test("keeps CLI, MCP, and web as thin adapters", () => {
    expect(doc).toContain("CLI, MCP, and future web UI clients are thin adapters");
    expect(doc).toContain("Client surfaces may format inputs, display outputs, and call APIs");
    expect(doc).toMatch(/They may not\s+own the canonical implementation/);
  });

  test("assigns durable product behavior to backend layers", () => {
    for (const phrase of [
      "Database schema and migrations",
      "Service modules",
      "HTTP API routes",
      "Worker jobs",
      "Webhooks",
    ]) {
      expect(doc).toContain(phrase);
    }
  });

  test("defines shared API contracts for future web readiness", () => {
    expect(doc).toContain("Versioned API routes under `/api/v1`");
    expect(doc).toMatch(/Every API response should be stable enough for CLI, MCP, automated tests, and\s+future web clients/);
    expect(doc).toContain("Create a shared typed client before web-specific data access grows");
  });

  test("prevents privileged worker and billing bypasses", () => {
    expect(doc).toContain("MCP tools should not bypass approval gates");
    expect(doc).toContain("Clients observe worker state through API reads");
    expect(doc).toMatch(/They do not enqueue privileged\s+jobs directly/);
  });
});
