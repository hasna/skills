import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("README remote premium onboarding", () => {
  const readme = readFileSync(join(process.cwd(), "README.md"), "utf8");

  test("documents premium hosted runs as remote-only SaaS execution", () => {
    for (const phrase of [
      "## Remote-Only Premium Skills",
      "Premium skills are SaaS runs",
      "do not fall back to bundled local execution",
      "skills auth login",
      "skills runs status <run-id>",
      "skills exports download <run-id>",
    ]) {
      expect(readme).toContain(phrase);
    }
  });

  test("separates skills.md auth from local provider keys", () => {
    for (const phrase of [
      "`SKILLS_API_KEY` is the skills.md account credential",
      "It is not a provider",
      "`OPENAI_API_KEY`",
      "free/local OSS skills",
      "premium package output excludes private src",
    ]) {
      expect(readme).toContain(phrase);
    }
  });

  test("documents versioned remote JSON run payloads", () => {
    expect(readme).toContain('"contractVersion": 1');
    expect(readme).toContain('"remote": true');
    expect(readme).toContain('"remoteRun"');
    expect(readme).toContain('"nextActions"');
  });
});
