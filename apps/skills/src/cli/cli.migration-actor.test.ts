import { installSumiPathsFixture } from "../lib/sumi-paths.fixture.js";
import { afterAll, beforeAll, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { buildCliFixture } from "./cli-build.fixture.js";
import { useDefaultTestTimeout } from "../test-preload.js";
import { admitCorpusFixture, corpusInspectorPathFixture } from "../lib/codex-corpus.fixture.js";
import { captureCodexSettingsV4 } from "../lib/codex-settings-witness.js";
import { expectMeasuredActor, readMigrationRecord } from "../lib/migration-actor.fixture.js";

// The real hook and migrate commands, compiled, across a process boundary: the actor
// block a persisted record carries is what the child process measured about itself,
// plus the allowlisted command and flag names it was started with.

useDefaultTestTimeout();
const scratch = realpathSync(mkdtempSync(join(tmpdir(), "skills-migration-actor-cli-")));
const entry = join(scratch, "entry.ts"), binary = join(scratch, "skills.js");
beforeAll(async () => {
  writeFileSync(entry, `import { Command } from ${JSON.stringify(require.resolve("commander"))};
import { registerAgentIntegration } from ${JSON.stringify(resolve(import.meta.dir, "commands/agent-integration.ts"))};
const program = new Command(); registerAgentIntegration(program); await program.parseAsync(process.argv);
`);
  await buildCliFixture(entry, binary);
});
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const SESSION = "0f1e2d3c-4b5a-4968-8776-655443322110", AGENT = "agent-fixture-0a1b2c3d4e5f";
const put = (path: string, text: string) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text); };

function station() {
  const home = mkdtempSync(join(scratch, "home-")), data = join(home, ".hasna", "skills");
  mkdirSync(data, { recursive: true });
  admitCorpusFixture(join(home, ".codex"));
  const config = join(home, ".codex", "config.toml");
  put(config, 'model = "synthetic-preserved-model"\n');
  const review = join(scratch, `review-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(review, JSON.stringify({ version: 1, agents: [{ agent: "codex", roots: [], sources: [captureCodexSettingsV4(config)], pluginHooks: "reviewed-no-skill-injection" }] }));
  const env = {
    PATH: `${installSumiPathsFixture(home)}:${corpusInspectorPathFixture()}:${dirname(process.execPath)}:/usr/bin:/bin`, HOME: home, USERPROFILE: home, HASNA_HOME: join(home, ".hasna"), HASNA_SKILLS_DIR: data, NO_COLOR: "1", TMPDIR: scratch,
    SKILLS_AGENT_ID: AGENT, CLAUDE_CODE_SESSION_ID: SESSION, HOSTNAME: "forged-host", USER: "forged-user",
  };
  const run = async (args: string[], cwd = home) => {
    const from = Date.now();
    const child = Bun.spawn([process.execPath, "--no-env-file", binary, ...args], { cwd, env, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, status] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    return { stdout, stderr, status, pid: child.pid, from, to: Date.now() };
  };
  const identity = (result: { pid: number; from: number }) => ({ pid: result.pid, ppid: process.pid, uid: process.getuid?.(), execPath: process.execPath, startedBetween: [result.from - 2000, Date.now()] as [number, number] });
  return { home, data, review, run, identity };
}
const SUPPLIED = { authenticated: false, agent: { id: AGENT, source: "SKILLS_AGENT_ID" }, parentSession: { id: SESSION, source: "CLAUDE_CODE_SESSION_ID" } };

test("hook install --apply writes a receipt naming the process, the command and only the listed flag names", async () => {
  const s = station();
  const installed = await s.run(["hook", "install", "--agent", "codex", "--selection-profile", "engineering", "--command", binary, "--discovery-inputs", s.review, "--apply", "--json"]);
  expect([installed.status, installed.stderr]).toEqual([0, ""]);
  const [operation] = readdirSync(join(s.data, "migration"));
  const text = readFileSync(join(s.data, "migration", operation!, "receipt.json"), "utf8"), receipt = JSON.parse(text);
  expect(receipt.version).toBe(1);
  expectMeasuredActor(receipt.actor, s.identity(installed), { from: installed.from, to: installed.to }, SUPPLIED);
  expect(receipt.actor.observed.invocation).toEqual({
    command: "hook install", flags: ["--agent", "--apply", "--command", "--discovery-inputs", "--json", "--selection-profile"], flagValues: { "--agent": "codex" },
  });
  // Values of the named flags never reach the record: not the executable, the review file, nor the profile id.
  const actorText = JSON.stringify(receipt.actor);
  for (const value of [binary, s.review, scratch, "engineering", "review-"]) expect(actorText).not.toContain(value);
  for (const label of [AGENT, SESSION, "forged-host", "forged-user"]) expect(JSON.stringify(receipt.actor.observed)).not.toContain(label);
  expect(readMigrationRecord(text)).toMatchObject({ kind: "receipt" });
});

test("migrate native --apply writes an archive journal naming the same", async () => {
  const s = station();
  const installed = await s.run(["hook", "install", "--agent", "codex", "--selection-profile", "engineering", "--command", binary, "--discovery-inputs", s.review, "--apply", "--json"]);
  expect([installed.status, installed.stderr]).toEqual([0, ""]);
  const user = join(s.home, ".agents", "skills", "user-copy"), project = mkdtempSync(join(scratch, "project-"));
  put(join(user, "SKILL.md"), "---\nname: user-copy\ndescription: Synthetic native copy\n---\nSynthetic native instructions\n");
  const applied = await s.run(["migrate", "native", "--agent", "codex", "--project", project, "--include-unmanaged", "--apply", "--json"], project);
  expect([applied.status, applied.stderr]).toEqual([0, ""]);
  const result = JSON.parse(applied.stdout);
  expect(existsSync(user)).toBe(false);
  const text = readFileSync(result.receiptPath, "utf8"), journal = JSON.parse(text);
  expect([journal.version, journal.status]).toEqual([2, "completed"]);
  expectMeasuredActor(journal.actor, s.identity(applied), { from: applied.from, to: applied.to }, SUPPLIED);
  expect(journal.actor.observed.invocation).toEqual({
    command: "migrate native", flags: ["--agent", "--apply", "--include-unmanaged", "--json", "--project"], flagValues: { "--agent": "codex" },
  });
  for (const value of [project, s.home, scratch]) expect(JSON.stringify(journal.actor)).not.toContain(value);
  expect(readMigrationRecord(text)).toMatchObject({ kind: "archive-journal", status: "completed" });
});
