import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("human approval model", () => {
  const doc = readFileSync(join(process.cwd(), "docs/architecture/human-approval-model.md"), "utf8");

  test("defines approval triggers for paid and sensitive actions", () => {
    for (const phrase of [
      "Paid execution above tenant auto-approve limits",
      "Checkout, Payment Link, credit purchase",
      "Connector action that writes, sends, deletes, purchases, publishes, or invites",
      "First run of a newly pinned paid or unmoderated skill",
    ]) {
      expect(doc).toContain(phrase);
    }
  });

  test("defines request fields, states, and expiration", () => {
    expect(doc).toContain("`idempotency_key`");
    expect(doc).toContain("`approval_id`, `status`, `approval_url`");
    for (const state of ["`pending`", "`approved`", "`rejected`", "`expired`", "`consumed`"]) {
      expect(doc).toContain(state);
    }
    expect(doc).toContain("Expired approvals cannot be consumed");
  });

  test("keeps decisions server-side and auditable", () => {
    expect(doc).toContain("Every decision path calls the same backend endpoint");
    expect(doc).toContain("Workers must atomically consume approval records");
    expect(doc).toContain("Every approval creates immutable audit events");
    expect(doc).toContain("Server state, not client claims, decides whether an approval is valid");
  });

  test("defines agent-facing approval UX", () => {
    expect(doc).toContain("CLI prints structured JSON");
    expect(doc).toContain("MCP returns structured JSON");
    expect(doc).toContain("HTTP 202");
    expect(doc).toContain("poll_after_ms");
  });
});
