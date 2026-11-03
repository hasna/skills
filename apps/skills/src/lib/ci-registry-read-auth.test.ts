import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { installReadAuth, READ_TOKEN_ENV, READ_TOKEN_NPMRC } from "../../scripts/registry-read-auth.js";

// SH-00057. The private @hasna/secrets can only be installed with the read-only
// CI token. Every install must get it, and nothing else may: the consumer gate
// runs floating third-party code after its installs.
const repo = join(import.meta.dir, "../../../..");
const workflows = ["skills-consumer-gate.yml", "release-skills.yml"];
const SECRET = "${{ secrets.NPM_READ_TOKEN }}";
type Step = { name?: string; run?: string; env?: Record<string, string>; "working-directory"?: string };

function steps(file: string): Array<{ job: string; step: Step; jobEnv?: Record<string, string> }> {
  const doc = parse(readFileSync(join(repo, ".github/workflows", file), "utf8"));
  expect(doc.env?.[READ_TOKEN_ENV]).toBeUndefined();
  return Object.entries(doc.jobs as Record<string, { steps: Step[]; env?: Record<string, string> }>)
    .flatMap(([job, body]) => body.steps.map((step) => ({ job, step, jobEnv: body.env })));
}
const installs = (run = "") => /\bbun install\b/.test(run);
const installsThroughScripts = (run = "") => /\bbun run (prepack|verify:consumer-(mcp|types|credentials))\b/.test(run);

describe("CI installs read the private packages with the read-only token, and only installs get it", () => {
  for (const file of workflows) {
    test(file, () => {
      const all = steps(file);
      expect(all.some(({ step }) => installs(step.run))).toBe(true);
      for (const { job, step, jobEnv } of all) {
        const label = `${file} ${job}: ${step.name}`;
        expect(jobEnv?.[READ_TOKEN_ENV], label).toBeUndefined();
        if (installs(step.run)) {
          // The dependency install writes the reference-only .npmrc where bun runs, and removes it.
          expect(step.env?.[READ_TOKEN_ENV], label).toBe(SECRET);
          expect(step["working-directory"], label).toBe("apps/skills");
          expect(step.run, label).toContain(`printf '%s\\n' '//registry.npmjs.org/:_authToken=\${NPM_READ_TOKEN}' > .npmrc`);
          expect(step.run, label).toContain(`trap 'rm -f .npmrc' EXIT`);
          expect(step.run, label).toContain(`test -n "$NPM_READ_TOKEN"`);
          expect(step.run!.indexOf("> .npmrc"), label).toBeLessThan(step.run!.indexOf("bun install"));
        } else if (installsThroughScripts(step.run)) {
          expect(step.env?.[READ_TOKEN_ENV], label).toBe(SECRET);
        } else {
          expect(step.env?.[READ_TOKEN_ENV], label).toBeUndefined();
        }
      }
    });
  }
});

describe("the consumer fixtures pass the token to their install commands only", () => {
  test("installReadAuth adds the variable and a reference-only npm config when, and only when, the token is set", () => {
    const base = { PATH: "/usr/bin:/bin", HOME: "/h" };
    expect(installReadAuth(base, {})).toEqual({ env: base, npmrc: "" });
    expect(installReadAuth(base, { [READ_TOKEN_ENV]: "" })).toEqual({ env: base, npmrc: "" });
    const authed = installReadAuth(base, { [READ_TOKEN_ENV]: "synthetic-read-token-value" });
    expect(authed.env).toEqual({ ...base, [READ_TOKEN_ENV]: "synthetic-read-token-value" });
    expect(authed.npmrc).toBe(READ_TOKEN_NPMRC);
    expect(authed.npmrc).toContain("${NPM_READ_TOKEN}");
    expect(authed.npmrc).not.toContain("synthetic-read-token-value");
    expect(base).toEqual({ PATH: "/usr/bin:/bin", HOME: "/h" });
  });
  test("every registry install in the consumer scripts runs with the installReadAuth environment", () => {
    for (const script of ["consumer-mcp.ts", "consumer-types.ts", "consumer-credentials.ts"]) {
      const text = readFileSync(join(repo, "apps/skills/scripts", script), "utf8");
      const calls = [...text.matchAll(/run\(\[[^\]]*"(?:install|ci)"[\s\S]*?\],\s*[^,]+,\s*([^,)]+)/g)];
      expect(calls.length, script).toBeGreaterThan(0);
      for (const call of calls) expect(call[1]!.trim(), `${script}: ${call[0].slice(0, 80)}`).toBe("auth.env");
    }
  });
});
