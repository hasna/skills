import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("README remote premium onboarding", () => {
  const readme = readFileSync(join(process.cwd(), "README.md"), "utf8");

  test("documents premium runs as remote-only execution", () => {
    for (const phrase of [
      "## Remote Runtime Skills",
      "Premium skills are remote-only runs",
      "do not fall back to bundled local execution",
      "skills runs status <run-id>",
      "skills exports download <run-id>",
    ]) {
      expect(readme).toContain(phrase);
    }
  });

  test("documents both SaaS and self-hosted onboarding", () => {
    for (const phrase of [
      "skills setup --mode cloud",
      "skills auth login",
      "skills setup --mode self-hosted --api-url https://skills.example.com",
      "skills auth login --api-key",
    ]) {
      expect(readme).toContain(phrase);
    }
  });

  test("separates remote auth from local provider keys", () => {
    for (const phrase of [
      "`SKILLS_API_KEY` is a remote API credential",
      "It is not a provider",
      "`OPENAI_API_KEY`",
      "free/local OSS skills",
      "does not prove that an origin is `selfhost` or `cloud`",
    ]) {
      expect(readme).toContain(phrase);
    }
  });

  test("documents versioned remote JSON run payloads", () => {
    expect(readme).toContain('"contractVersion": 1');
    expect(readme).toContain('"remote": true');
    expect(readme).toContain('"remoteRun"');
    expect(readme).toContain('"creditQuote"');
    expect(readme).toContain('"nextActions"');
  });
});
