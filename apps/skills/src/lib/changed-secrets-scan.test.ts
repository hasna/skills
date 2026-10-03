import { expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const script = resolve(import.meta.dir, "../../scripts/scan-changed-secrets.ts");
const paths = ["apps/skills/src/caller.ts", "apps/skills/scripts/consumer.ts", "apps/skills/src/caller.test.ts"];

async function fixture(credentialPath?: string, options: { targetHead?: boolean; empty?: boolean; invalidBase?: boolean } = {}) {
  const root = await mkdtemp(join(tmpdir(), "skills-changed-scan-"));
  const env = {
    PATH: `${dirname(process.execPath)}:${process.env.PATH ?? "/usr/bin:/bin"}`,
    HOME: root, TMPDIR: root, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null",
  };
  function git(...args: string[]) {
    const child = Bun.spawnSync(["git", "-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", ...args], { cwd: root, env });
    if (child.exitCode !== 0) throw new Error("Synthetic Git fixture failed");
    return child.stdout.toString().trim();
  }
  try {
    git("init", "-q");
    await writeFile(join(root, "README.md"), "Synthetic scan fixture\n");
    git("add", "."); git("commit", "-qm", "fixture base");
    const base = git("rev-parse", "HEAD");
    // Deliberately synthetic detector input; never a real provider credential.
    const marker = ["gh", "p_", "SYNTHETIC".repeat(5)].join("");
    for (const path of options.empty ? [] : paths) {
      await mkdir(dirname(join(root, path)), { recursive: true });
      await writeFile(join(root, path), path === credentialPath ? `export const fixtureValue = "${marker}";\n` : "export const fixtureValue = 7;\n");
    }
    git("add", "."); git("commit", "--allow-empty", "-qm", "fixture candidate");
    const target = options.invalidBase ? "refs/heads/missing-base" : options.targetHead ? "HEAD" : base;
    const child = Bun.spawnSync([process.execPath, "--no-env-file", script, target], { cwd: root, env });
    const output = child.stdout.toString() + child.stderr.toString();
    expect(output).not.toContain(marker);
    expect(child.exitCode).toBe(options.invalidBase ? 2 : credentialPath ? 1 : 0);
    if (options.invalidBase) {
      expect(child.stdout.toString()).toBe("");
      return;
    }
    const rows = child.stdout.toString().trim().split("\n").map((line) => JSON.parse(line));
    expect(rows.at(-1).filesScanned).toBe(options.empty ? 0 : paths.length);
    expect(rows.at(-1).base).toBe(base);
    if (credentialPath) expect(rows.some((row) => row.path === credentialPath && row.findingCount > 0)).toBe(true);
    else expect(rows.filter((row) => row.path).every((row) => row.complete && row.findingCount === 0)).toBe(true);
  } finally {
    // Only this fresh synthetic fixture is writable; no station credentials or
    // existing checkout files enter its HOME or Git configuration.
    await rm(root, { recursive: true, force: true });
  }
}

test("changed credential scan accepts a complete clean source/script/test delta", () => fixture());
for (const path of paths) test(`changed credential scan refuses a credential-shaped addition in ${path}`, () => fixture(path));
test("main/tag validation scans the current commit when its target already equals HEAD", () => fixture(paths[0], { targetHead: true }));
test("a resolved deliberately empty commit reports an explicit zero population", () => fixture(undefined, { targetHead: true, empty: true }));
test("an unresolved base refuses instead of reporting a clean empty range", () => fixture(undefined, { empty: true, invalidBase: true }));
