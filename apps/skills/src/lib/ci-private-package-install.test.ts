import { describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "yaml";

// SH-00057, after the #187 review (Files f_dEn0dX5Aeh). The private @hasna/secrets
// needs NPM_READ_TOKEN, Andrei's full-access npm token. Only the locked
// dependency install step may hold it, before any test, build or third-party code
// in its job. The consumer fixtures install @hasna/secrets from the tarball that
// step fetched and checked, never with the token.
const repo = join(import.meta.dir, "../../../..");
const scripts = join(repo, "apps/skills/scripts");
// The workflows that may hold the token; every other workflow must not mention it.
const workflows = ["skills-consumer-gate.yml", "release-skills.yml"];
// The secret's name only, built so a scanner doesn't read it as an assignment of a value.
const SECRET_NAME = ["NPM", "READ", "TOKEN"].join("_");
const TOKEN_STEP = "Install locked standalone Skills dependencies";
// The token step, line for line. Anything added, dropped or loosened fails here.
const TOKEN_STEP_LINES = [
  "set -euo pipefail",
  `test -n "$NPM_READ_TOKEN" || { echo "::error::NPM_READ_TOKEN is not available to this run"; exit 1; }`,
  "trap 'rm -f .npmrc' EXIT",
  "umask 077",
  "printf '%s\\n' '//registry.npmjs.org/:_authToken=${NPM_READ_TOKEN}' > .npmrc",
  "bun install --frozen-lockfile --ignore-scripts --backend copyfile",
  `node scripts/fetch-locked-private.mjs --out "$RUNNER_TEMP/skills-private-tarballs"`,
  `echo "SKILLS_PRIVATE_TARBALLS=$RUNNER_TEMP/skills-private-tarballs/private-tarballs.json" >> "$GITHUB_ENV"`,
];
// A step that runs any of these runs tests, builds or third-party package code.
const RUNS_UNTRUSTED = /\b(bun (run|test|x)|bunx|npx|npm |pnpm|yarn)\b|bun -e|bun --no/;

type Step = { name?: string; uses?: string; run?: string; env?: Record<string, string>; with?: Record<string, unknown>; "working-directory"?: string };
type Job = { env?: Record<string, string>; steps: Step[] };

function jobs(file: string): Array<[string, Job]> {
  const text = readFileSync(join(repo, ".github/workflows", file), "utf8");
  const doc = parse(text) as { env?: Record<string, string>; jobs: Record<string, Job> };
  expect(doc.env?.[SECRET_NAME], file).toBeUndefined();
  return Object.entries(doc.jobs);
}
const runLines = (run = "") => run.split("\n").map(line => line.trim()).filter(line => line && !line.startsWith("#"));

describe("only the locked dependency install step holds the npm token", () => {
  test("no other workflow mentions the token", () => {
    const all = readdirSync(join(repo, ".github/workflows")).filter(name => /\.ya?ml$/.test(name));
    expect(all.length).toBeGreaterThan(workflows.length);
    for (const name of all) {
      const mentions = readFileSync(join(repo, ".github/workflows", name), "utf8").includes(SECRET_NAME);
      expect(mentions, name).toBe(workflows.includes(name));
    }
  });
  for (const file of workflows) {
    test(file, () => {
      for (const [job, body] of jobs(file)) {
        const label = `${file} ${job}`;
        expect(body.env?.[SECRET_NAME], label).toBeUndefined();
        // Every job that holds the token names an environment, so the token can be an environment secret.
        expect(typeof (body as { environment?: unknown }).environment, label).toBe("string");
        const holders = body.steps.filter(step => JSON.stringify(step).includes(SECRET_NAME));
        expect(holders.map(step => step.name), label).toEqual([TOKEN_STEP]);
        const [step] = holders;
        expect(step!.env, label).toEqual({ [SECRET_NAME]: "${{ secrets.NPM_READ_TOKEN }}" });
        expect(step!["working-directory"], label).toBe("apps/skills");
        expect(runLines(step!.run), label).toEqual(TOKEN_STEP_LINES);
        // No other step in the job reads any secret.
        for (const other of body.steps) if (other !== step) expect(JSON.stringify(other), `${label}: ${other.name}`).not.toMatch(/\$\{\{[^}]*\bsecrets\b/);
        // Before it, only pinned actions and inline admission checks: nothing that runs packages or tests,
        // no toolchain restored from or saved to the Actions cache, and nothing that changes later steps' environment.
        const at = body.steps.indexOf(step!);
        for (const before of body.steps.slice(0, at)) {
          const where = `${label}: ${before.name ?? before.uses}`;
          if (before.uses) expect(before.uses, where).toMatch(/@[0-9a-f]{40}( |$)/);
          if (before.uses?.startsWith("oven-sh/setup-bun@")) expect(before.with?.["no-cache"], where).toBe(true);
          if (before.uses?.startsWith("actions/setup-node@")) expect(before.with?.["package-manager-cache"], where).toBe(false);
          if (before.uses) expect(before.uses, where).toMatch(/^(actions\/checkout|actions\/setup-node|oven-sh\/setup-bun)@/);
          expect(before.run ?? "", where).not.toMatch(RUNS_UNTRUSTED);
          expect(before.run ?? "", where).not.toMatch(/GITHUB_ENV|GITHUB_PATH|NPM_CONFIG_|BUN_CONFIG_|NODE_OPTIONS/);
          expect(Object.keys(before.env ?? {}).filter(key => /^(NPM_CONFIG_|BUN_CONFIG_|NODE_OPTIONS)/.test(key)), where).toEqual([]);
        }
        expect(body.steps.slice(0, at).some(before => before.uses?.startsWith("oven-sh/setup-bun@")), label).toBe(true);
        expect(body.steps.slice(at + 1).some(after => RUNS_UNTRUSTED.test(after.run ?? "")), label).toBe(true);
      }
    });
  }
});

describe("the consumer fixtures install private packages from the fetched tarball, never with the token", () => {
  for (const name of ["consumer-mcp.ts", "consumer-types.ts", "consumer-credentials.ts"]) {
    test(name, () => {
      const text = readFileSync(join(scripts, name), "utf8");
      expect(text).not.toContain(SECRET_NAME);
      expect(text).not.toContain("_authToken");
      expect(text).toMatch(/overrides: (\{ \.\.\.typePins, \.\.\.privatePackageOverrides\(\) \}|privatePackageOverrides\(\))/);
      // No child inherits this process's environment: every spawn gets a constructed one.
      expect(text).not.toMatch(/\.\.\.process\.env\b/);
      expect(text).not.toMatch(/env: process\.env\b/);
      expect(text).not.toMatch(/run\([^;]*?,\s*process\.env\s*[,)]/);
      // Every install a fixture runs skips lifecycle scripts.
      const installs = [...text.matchAll(/run\(\[[^\]]*?"(install|ci)"[^\]]*\]/g)].map(match => match[0]);
      expect(installs.length, name).toBeGreaterThan(0);
      for (const install of installs) expect(install, name).toContain(`"--ignore-scripts"`);
    });
  }
});

describe("fetch-locked-private.mjs", () => {
  const source = readFileSync(join(scripts, "fetch-locked-private.mjs"), "utf8");
  const load = () => import(join(scripts, "fetch-locked-private.mjs"));

  test("imports node: builtins only, refuses redirects and checks integrity before writing", () => {
    const imports = [...source.matchAll(/^\s*(?:import\b[^;]*?|export\b[^;]*?\bfrom\s*)["']([^"']+)["']/gm)].map(match => match[1]);
    expect(imports.length).toBeGreaterThan(0);
    for (const specifier of imports) expect(specifier).toMatch(/^node:/);
    expect(source).not.toMatch(/\bimport\(|\brequire\(/);
    expect(source).toContain(`redirect: "error"`);
    expect(source.indexOf("integrity !== locked.integrity")).toBeGreaterThan(-1);
    expect(source.indexOf("integrity !== locked.integrity")).toBeLessThan(source.indexOf("writeFileSync(path"));
  });

  test("reads the one locked @hasna/secrets entry from bun.lock", async () => {
    const { lockedTarball, PRIVATE_PACKAGES } = await load();
    expect(PRIVATE_PACKAGES).toEqual(["@hasna/secrets"]);
    const manifest = JSON.parse(readFileSync(join(repo, "apps/skills/package.json"), "utf8"));
    const locked = lockedTarball(readFileSync(join(repo, "apps/skills/bun.lock"), "utf8"), "@hasna/secrets");
    expect(locked.version).toBe(manifest.optionalDependencies["@hasna/secrets"]);
    expect(locked.integrity).toMatch(/^sha512-[A-Za-z0-9+/]+={0,2}$/);
    expect(locked.url).toBe(`https://registry.npmjs.org/@hasna/secrets/-/secrets-${locked.version}.tgz`);
    expect(locked.file).toBe(`hasna-secrets-${locked.version}.tgz`);
  });

  test("refuses a missing, nested-only or duplicated lock entry", async () => {
    const { lockedTarball } = await load();
    const entry = `    "@hasna/secrets": ["@hasna/secrets@0.4.2", "", { "dependencies": { "zod": "3.25.76" } }, "sha512-AAAA"],`;
    expect(() => lockedTarball("", "@hasna/secrets")).toThrow(/found 0/);
    expect(() => lockedTarball(entry.replace(`"@hasna/secrets": [`, `"@hasna/skills/@hasna/secrets": [`), "@hasna/secrets")).toThrow(/found 0/);
    expect(() => lockedTarball(`${entry}\n${entry}`, "@hasna/secrets")).toThrow(/found 2/);
    expect(lockedTarball(entry, "@hasna/secrets").integrity).toBe("sha512-AAAA");
  });
});

describe("privatePackageOverrides", () => {
  const load = () => import(join(scripts, "private-package-overrides.ts"));

  test("is empty without the manifest variable", async () => {
    const { privatePackageOverrides } = await load();
    expect(privatePackageOverrides({})).toEqual({});
    expect(privatePackageOverrides({ SKILLS_PRIVATE_TARBALLS: "" })).toEqual({});
  });

  test("points each package at its tarball, and refuses a tarball that changed after the fetch", async () => {
    const [{ privatePackageOverrides }, { integrityOf }] = await Promise.all([load(), import(join(scripts, "fetch-locked-private.mjs"))]);
    const folder = mkdtempSync(join(tmpdir(), "skills-private-tarballs-"));
    const tarball = join(folder, "hasna-secrets-0.4.2.tgz");
    writeFileSync(tarball, "synthetic tarball bytes");
    const manifest = join(folder, "private-tarballs.json");
    writeFileSync(manifest, JSON.stringify({ "@hasna/secrets": { version: "0.4.2", integrity: integrityOf(Buffer.from("synthetic tarball bytes")), path: tarball } }));
    expect(privatePackageOverrides({ SKILLS_PRIVATE_TARBALLS: manifest })).toEqual({ "@hasna/secrets": `file:${tarball}` });
    writeFileSync(tarball, "changed bytes");
    expect(() => privatePackageOverrides({ SKILLS_PRIVATE_TARBALLS: manifest })).toThrow(/changed after it was fetched/);
    expect(() => privatePackageOverrides({ SKILLS_PRIVATE_TARBALLS: join(folder, "other.json") })).toThrow(/must name a private-tarballs.json/);
  });
});
