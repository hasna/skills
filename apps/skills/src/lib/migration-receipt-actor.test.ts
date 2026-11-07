import { admitCorpusFixture, installCorpusInspectorFixture } from "./codex-corpus.fixture.js";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { useDefaultTestTimeout } from "../test-preload.js";
import { applyAgentIntegration, archiveNativeSkills, inventoryNativeSkills, planAgentIntegration } from "./agent-integration.js";
import { OBSERVED_FIELDS, expectMeasuredActor, frozenRecord, isolateIdentityEnvironment, readMigrationRecord, recordShape, thisProcess, withEnvironment } from "./migration-actor.fixture.js";

// The integration receipt (hook install and the other --apply rebinds) and the native
// archive journal (migrate native) carry the actor block, and carry it additively: a
// reader written before the block existed parses both. The Codex reconcile receipt is
// covered where its fixture lives, in codex-plugin-reconcile.test.ts.

useDefaultTestTimeout();
const roots: string[] = [];
let restoreInspector: () => void, restoreIdentity: () => void;
beforeEach(() => { restoreInspector = installCorpusInspectorFixture(); restoreIdentity = isolateIdentityEnvironment(); });
afterEach(() => { restoreInspector(); restoreIdentity(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

const SESSION = "0f1e2d3c-4b5a-4968-8776-655443322110";
const SDK = { app: "hooks", command: "install", version: "0.4.2" } as const;
const ENVIRONMENT = { SKILLS_AGENT_ID: "agent-fixture-0a1b2c3d4e5f", HASNA_AGENT_ID: undefined, AGENT_ID: undefined, CLAUDE_CODE_SESSION_ID: SESSION };

/** The scenario the frozen integration fixtures were emitted from: a first apply that
 * installs the bridge, then a second apply that rebinds the profile. */
function station() {
  const home = mkdtempSync(join(tmpdir(), "skills-migration-actor-")); roots.push(home);
  admitCorpusFixture(join(home, ".codex"));
  const dataDir = join(home, ".hasna", "skills"); mkdirSync(dataDir, { recursive: true });
  mkdirSync(join(home, ".claude"), { recursive: true });
  writeFileSync(join(home, ".claude", "settings.json"), JSON.stringify({ owner: { keep: true } }));
  const homes = [home, realpathSync(home)];
  const receipts = (): string[] => existsSync(join(dataDir, "migration")) ? readdirSync(join(dataDir, "migration")).map(name => readFileSync(join(dataDir, "migration", name, "receipt.json"), "utf8")) : [];
  return { home, homes, dataDir, receipts };
}
function install(s: ReturnType<typeof station>, profileId: string, options: Parameters<typeof applyAgentIntegration>[1] = {}): string {
  const before = new Set(s.receipts());
  applyAgentIntegration(planAgentIntegration({ home: s.home, dataDir: s.dataDir, agents: ["claude"], profileId, projectDir: s.home }), options);
  const fresh = s.receipts().filter(text => !before.has(text));
  expect(fresh).toHaveLength(1);
  return fresh[0]!;
}
function archive(s: ReturnType<typeof station>, options: Parameters<typeof archiveNativeSkills>[1]): string {
  const native = join(s.home, ".claude", "skills", "archive-me");
  mkdirSync(native, { recursive: true }); writeFileSync(join(native, "SKILL.md"), "Synthetic instructions\n");
  const inventory = inventoryNativeSkills(s.home, { agents: ["claude"], projectDir: s.home });
  const archived = archiveNativeSkills(inventory, options);
  expect(archived.entries).toHaveLength(1);
  return readFileSync(archived.receiptPath!, "utf8");
}

// ---- the integration receipt ------------------------------------------------
for (const field of OBSERVED_FIELDS) test(`the integration receipt records observed.${field}`, () => {
  const s = station(), from = Date.now();
  const receipt = JSON.parse(install(s, "synthetic", { actor: SDK }));
  expectMeasuredActor(receipt.actor, thisProcess(), { from, to: Date.now() }, { authenticated: false, sdk: SDK });
  expect(receipt.actor.observed[field]).not.toBeUndefined();
});

test("the integration receipt keeps what the environment and the SDK caller said under supplied only", () => {
  const s = station(), from = Date.now();
  const receipt = JSON.parse(withEnvironment(ENVIRONMENT, () => install(s, "synthetic", { actor: SDK })));
  expectMeasuredActor(receipt.actor, thisProcess(), { from, to: Date.now() }, {
    authenticated: false, agent: { id: ENVIRONMENT.SKILLS_AGENT_ID, source: "SKILLS_AGENT_ID" }, parentSession: { id: SESSION, source: "CLAUDE_CODE_SESSION_ID" }, sdk: SDK,
  });
  const observedText = JSON.stringify(receipt.actor.observed);
  for (const label of [ENVIRONMENT.SKILLS_AGENT_ID, SESSION, "hooks", "0.4.2", "install"]) expect(observedText).not.toContain(label);
  expect(Object.keys(receipt.actor.observed).sort()).toEqual([...OBSERVED_FIELDS].sort());
});

test("an SDK caller cannot overwrite what the process measured, and an unlisted label is dropped by name", () => {
  const s = station(), from = Date.now();
  const hostile = { app: "hooks", command: "install --token sentinel-secret", version: "0.4.2", writtenAt: "1999-01-01T00:00:00.000Z", pid: 1, ppid: 1, uid: 0, cliVersion: "0.0.1", hostname: "forged", execPath: "/forged" };
  const receipt = JSON.parse(install(s, "synthetic", { actor: hostile as never }));
  expectMeasuredActor(receipt.actor, thisProcess(), { from, to: Date.now() }, { authenticated: false, sdk: { app: "hooks", version: "0.4.2" }, rejected: ["sdk.command"] });
  expect(JSON.stringify(receipt)).not.toContain("sentinel-secret");
  expect(JSON.stringify(receipt.actor)).not.toContain("forged");
});

test("a process that is not a listed Skills command records no invocation", () => {
  const receipt = JSON.parse(install(station(), "synthetic"));
  expect("invocation" in receipt.actor.observed).toBe(false);
});

test("the receipt stays version 1 and gains only the actor key", () => {
  const s = station();
  const first = install(s, "synthetic"), second = install(s, "second");
  for (const [text, frozen] of [[first, "integration-first-apply"], [second, "integration-second-apply"]] as const) {
    expect(JSON.parse(text).version).toBe(1);
    expect(Object.keys(JSON.parse(text)).filter(key => key !== "actor")).toEqual(Object.keys(JSON.parse(frozenRecord(frozen))));
    expect(recordShape(text, s.homes)).toEqual(recordShape(frozenRecord(frozen)));
  }
});

// ---- the native archive journal ---------------------------------------------
for (const field of OBSERVED_FIELDS) test(`the archive journal records observed.${field}`, () => {
  const s = station(), from = Date.now();
  const journal = JSON.parse(archive(s, { dataDir: s.dataDir, includeUnmanaged: true, actor: SDK }));
  expect(journal.status).toBe("completed");
  expectMeasuredActor(journal.actor, thisProcess(), { from, to: Date.now() }, { authenticated: false, sdk: SDK });
  expect(journal.actor.observed[field]).not.toBeUndefined();
});

test("the archive journal keeps environment labels under supplied only", () => {
  const s = station();
  const journal = JSON.parse(withEnvironment(ENVIRONMENT, () => archive(s, { dataDir: s.dataDir, includeUnmanaged: true })));
  expect(journal.actor.supplied).toEqual({ authenticated: false, agent: { id: ENVIRONMENT.SKILLS_AGENT_ID, source: "SKILLS_AGENT_ID" }, parentSession: { id: SESSION, source: "CLAUDE_CODE_SESSION_ID" } });
  expect(JSON.stringify(journal.actor.observed)).not.toContain(SESSION);
  expect(JSON.stringify(journal.actor.observed)).not.toContain(ENVIRONMENT.SKILLS_AGENT_ID);
});

test("the archive journal stays version 2 and gains only the actor key", () => {
  const s = station();
  const text = archive(s, { dataDir: s.dataDir, includeUnmanaged: true });
  expect(JSON.parse(text).version).toBe(2);
  expect(Object.keys(JSON.parse(text)).filter(key => key !== "actor")).toEqual(Object.keys(JSON.parse(frozenRecord("native-archive-journal"))));
  expect(recordShape(text, s.homes)).toEqual(recordShape(frozenRecord("native-archive-journal")));
});

// ---- existing readers still read old and new records ------------------------
test("a reader that knows only the original keys parses frozen old records and new ones alike", () => {
  const s = station();
  const first = install(s, "synthetic"), second = install(s, "second"), journal = archive(s, { dataDir: s.dataDir, includeUnmanaged: true });
  const pairs: Array<[string, Parameters<typeof frozenRecord>[0]]> = [[first, "integration-first-apply"], [second, "integration-second-apply"], [journal, "native-archive-journal"]];
  for (const [fresh, frozen] of pairs) {
    const oldView = readMigrationRecord(frozenRecord(frozen)), newView = readMigrationRecord(fresh);
    expect(JSON.stringify(recordShape(JSON.stringify(newView), s.homes))).toBe(JSON.stringify(recordShape(JSON.stringify(oldView))));
    expect(JSON.parse(fresh).actor).toBeDefined();
    expect(JSON.parse(frozenRecord(frozen)).actor).toBeUndefined();
  }
  expect(readMigrationRecord(frozenRecord("codex-reconcile"))).toMatchObject({ kind: "receipt", codexReconcile: { codexVersion: "0.166.0" } });
});

test("a migration directory holding old and new records lists and parses as one set", () => {
  const s = station();
  install(s, "synthetic");
  const migration = join(s.dataDir, "migration"), legacy = join(migration, "00000000-0000-4000-8000-000000000001");
  mkdirSync(legacy, { recursive: true }); writeFileSync(join(legacy, "receipt.json"), frozenRecord("integration-second-apply"));
  const views = readdirSync(migration).sort().map(name => readMigrationRecord(readFileSync(join(migration, name, "receipt.json"), "utf8")));
  expect(views).toHaveLength(2);
  expect(views.every(view => (view as { kind: string }).kind === "receipt")).toBe(true);
});

test("a credential-shaped environment label never reaches either record", () => {
  const agent = ["sk_live_", "FIXTUREVALUE0123456789"].join(""), session = ["fixture-user", ":", "fixture-pw", "@", "host.example"].join("");
  const environment = { SKILLS_AGENT_ID: agent, HASNA_AGENT_ID: undefined, AGENT_ID: undefined, CLAUDE_CODE_SESSION_ID: session };
  const s = station();
  const receipt = withEnvironment(environment, () => install(s, "synthetic")), journal = withEnvironment(environment, () => archive(s, { dataDir: s.dataDir, includeUnmanaged: true }));
  for (const text of [receipt, journal]) {
    expect(JSON.parse(text).actor.supplied).toEqual({ authenticated: false, rejected: ["agent", "parentSession"] });
    for (const value of [agent, session, "FIXTUREVALUE", "fixture-pw"]) expect(text).not.toContain(value);
  }
});

test("recordShape normalises a symlinked temp root whichever spelling comes first", () => {
  // macOS: /var is a link to /private/var, so a real path contains the lexical one.
  const lexical = "/var/folders/ab/T/home", real = "/private/var/folders/ab/T/home";
  for (const homes of [[lexical, real], [real, lexical]]) {
    expect(recordShape(JSON.stringify({ path: `${real}/.claude`, other: `${lexical}/.hasna` }), homes)).toEqual({ path: "/home/fixture/.claude", other: "/home/fixture/.hasna" });
  }
});
