import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();

describe("README premium server-side onboarding", () => {
  const readme = readFileSync(join(process.cwd(), "README.md"), "utf8");

  test("documents premium runs as server-side execution", () => {
    for (const phrase of [
      "## Server-Side Runtime Skills",
      "Premium skills run on the server",
      "do not fall back to bundled local execution",
      "skills auth login --api-key",
      "skills runs status <run-id>",
      "skills exports download <run-id>",
    ]) {
      expect(readme).toContain(phrase);
    }
  });

  test("separates Skills API auth from local provider keys", () => {
    for (const phrase of [
      "`SKILLS_API_KEY` is the Skills API credential",
      "It is not a provider",
      "`OPENAI_API_KEY`",
      "free/local OSS skills",
      "server-executed skills expose metadata/contracts",
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
