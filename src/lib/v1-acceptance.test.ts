import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("v1 acceptance criteria", () => {
  const doc = readFileSync(join(process.cwd(), "docs/release/v1-acceptance.md"), "utf8");

  test("anchors product, domain, port, and upstream strategy", () => {
    expect(doc).toContain("`skills.md` is the production domain");
    expect(doc).toContain("port `3505`");
    expect(doc).toContain("open `hasna/skills` package remains upstream");
    expect(doc).toContain("PostgreSQL, Stripe, AWS, hosted execution");
  });

  test("covers CLI, MCP, API, database, worker, and billing acceptance", () => {
    for (const section of [
      "## CLI Acceptance",
      "## MCP Acceptance",
      "## API Acceptance",
      "## Database Acceptance",
      "## Worker Acceptance",
      "## Billing Acceptance",
    ]) {
      expect(doc).toContain(section);
    }
  });

  test("covers security, web readiness, deployment, and launch gates", () => {
    for (const phrase of [
      "## Security Acceptance",
      "## Web-Ready Acceptance",
      "## Deployment Acceptance",
      "Stripe sandbox payment tests passing",
      "PR preview smoke tests passing",
      "Production deploys are tag-gated",
    ]) {
      expect(doc).toContain(phrase);
    }
  });

  test("requires local verification commands", () => {
    expect(doc).toContain("bun install --frozen-lockfile");
    expect(doc).toContain("bun run typecheck");
    expect(doc).toContain("bun test");
    expect(doc).toContain("bun run build");
    expect(doc).toContain("systemd-run --user --scope");
  });
});
