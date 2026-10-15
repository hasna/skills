import { installSumiPathsFixture } from "../lib/sumi-paths.fixture.js";
import { afterAll, beforeAll, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { buildCliFixture } from "./cli-build.fixture.js";
import { useDefaultTestTimeout } from "../test-preload.js";
import { corpusInspectorPathFixture, type CorpusFixtureBuild } from "../lib/codex-corpus.fixture.js";
import { captureCodexSettingsV4 } from "../lib/codex-settings-witness.js";

useDefaultTestTimeout();
const scratch = realpathSync(mkdtempSync(join(tmpdir(), "skills-admission-fallback-")));
const entry = join(scratch, "entry.ts"), binary = join(scratch, "skills.js");
// The real registered hook command, release-compiled, across a process boundary.
beforeAll(async () => {
  writeFileSync(entry, `import { Command } from ${JSON.stringify(require.resolve("commander"))};
import { registerAgentIntegration } from ${JSON.stringify(resolve(import.meta.dir, "commands/agent-integration.ts"))};
const program = new Command(); registerAgentIntegration(program); await program.parseAsync(process.argv);
`);
  await buildCliFixture(entry, binary);
});
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

/** A station whose Codex home has no native admission lock. */
function station(build: CorpusFixtureBuild) {
  const home = mkdtempSync(join(scratch, "home-")), data = join(home, ".hasna", "skills"), corpus = join(home, ".codex");
  mkdirSync(data, { recursive: true, mode: 0o700 }); mkdirSync(corpus, { mode: 0o700 });
  const inspector = corpusInspectorPathFixture(build), config = join(corpus, "config.toml");
  writeFileSync(config, 'model = "synthetic-preserved-model"\n', { mode: 0o600 });
  const review = join(scratch, `review-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(review, JSON.stringify({ version: 1, agents: [{ agent: "codex", roots: [], sources: [captureCodexSettingsV4(config)], pluginHooks: "reviewed-no-skill-injection" }] }));
  const env = { PATH: `${installSumiPathsFixture(home)}:${inspector}:${dirname(process.execPath)}:/usr/bin:/bin`, HOME: home, USERPROFILE: home, HASNA_HOME: join(home, ".hasna"), HASNA_SKILLS_DIR: data, NO_COLOR: "1", TMPDIR: scratch };
  const install = async () => {
    const child = Bun.spawn([process.execPath, "--no-env-file", binary, "hook", "install", "--agent", "codex", "--selection-profile", "engineering", "--command", binary, "--discovery-inputs", review, "--apply", "--json"],
      { cwd: home, env, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, status] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    return { stdout, stderr, status };
  };
  return { home, data, corpus, config, inspector, install };
}

test("hook install applies on an upstream Codex build through the interim fallback and records it", async () => {
  const s = station("upstream"), installed = await s.install();
  expect([installed.status, installed.stderr]).toEqual([0, ""]);
  const receipt = JSON.parse(installed.stdout);
  expect(receipt.applied).toBe(true);
  expect(receipt.nativeAdmission).toBe("unavailable");
  expect(receipt.nativeAdmissionProbe).toMatchObject({ kind: "help-unrecognized-subcommand", executable: realpathSync(join(s.inspector, "codex")), version: "codex-cli 0.160.0", probeExitCode: 2, controlExitCode: 0 });
  expect(receipt.nativeAdmissionProbe.sha256).toMatch(/^[a-f0-9]{64}$/);
  expect(installed.stdout).not.toMatch(/unrecognized subcommand '|Usage:/);
  // The persisted migration receipt records the same admission.
  const [operation] = readdirSync(join(s.data, "migration"));
  const saved = JSON.parse(readFileSync(join(s.data, "migration", operation!, "receipt.json"), "utf8"));
  expect([saved.nativeAdmission, saved.nativeAdmissionProbe]).toEqual(["unavailable", receipt.nativeAdmissionProbe]);
  // Nothing native was bootstrapped; the exclusive lock lives in Skills state.
  expect(existsSync(join(s.corpus, ".native-corpus-admission.flock-v1"))).toBe(false);
  expect(readdirSync(join(s.data, "codex-corpus-locks"))).toEqual([expect.stringMatching(/^codex-corpus-[a-f0-9]{64}\.flock-v1$/)]);
  // Upstream's per-launch helper aliases went to the private probe home, not the Codex home.
  expect(existsSync(join(s.corpus, "tmp"))).toBe(false);
  expect(readdirSync(join(s.data, "codex-probe-home", "tmp", "arg0")).length).toBeGreaterThan(0);
  expect(existsSync(join(s.inspector, "inspect-invoked"))).toBe(false);
  expect(existsSync(join(s.corpus, "hooks.json"))).toBe(true);
});

test("hook install still refuses an admission-capable Codex build that has no native lock", async () => {
  const s = station("admission"), installed = await s.install();
  expect(installed.status).toBe(1);
  expect(installed.stderr).toContain("CODEX_CORPUS_ADMISSION_REQUIRED");
  expect(installed.stderr).toContain("(command-present)");
  expect(readFileSync(s.config, "utf8")).toBe('model = "synthetic-preserved-model"\n');
  expect(existsSync(join(s.data, "agent-policy.json"))).toBe(false);
  expect(existsSync(join(s.corpus, ".native-corpus-admission.flock-v1"))).toBe(false);
});
