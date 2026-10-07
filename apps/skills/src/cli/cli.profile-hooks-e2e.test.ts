/** Release-compiled CLI over real HTTP/SQLite; every station/config mutation is confined to fixture homes. */
import { afterAll, beforeAll, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createHash, randomUUID } from "node:crypto";
import { buildCliFixture } from "./cli-build.fixture.js";
import { renderPinnedLauncher } from "./commands/runtime-launcher.js";
import { useDefaultTestTimeout } from "../test-preload.js";
import { SqliteSkillsStore } from "../server/sqlite-store.js";
import { SqliteGovernanceStore } from "../sdk/governance-store.js";
import { createSkillsFetchHandler, type SkillsFetchHandler } from "../server/app.js";
import { publicPrincipal } from "../server/auth.js";
import { packSkillBundle } from "../lib/skill-bundle.js";
import { admitCorpusFixture, corpusInspectorPathFixture } from "../lib/codex-corpus.fixture.js";
import { KernelLock } from "@hasna/contracts/kernel-lock";

useDefaultTestTimeout();
const scratch = mkdtempSync(join(tmpdir(), "skills-profile-hooks-cli-")), binary = join(scratch, "skills.js"), executable = join(scratch, "skills");
beforeAll(async () => {
  await buildCliFixture(resolve(import.meta.dir, "index.tsx"), binary);
  writeFileSync(executable, `#!/bin/sh\nexec '${process.execPath.replace(/'/g, "'\\''")}' '${binary.replace(/'/g, "'\\''")}' "$@"\n`); chmodSync(executable, 0o700);
});
afterAll(() => rmSync(scratch, { recursive: true, force: true }));
function put(path: string, value: string) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, value, { mode: 0o600 }); }
function json(path: string) { return JSON.parse(readFileSync(path, "utf8")); }
function objectHashes(path: string): string[] {
  if (!existsSync(path)) return [];
  return readdirSync(path, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? objectHashes(join(path, entry.name)) : entry.name.endsWith(".tar.gz") ? [createHash("sha256").update(readFileSync(join(path, entry.name))).digest("hex")] : []).sort();
}
async function fixture(documentSuffix = "", enrolled = true) {
  const root = mkdtempSync(join(scratch, "case-")), database = join(root, "server.sqlite"), token = randomUUID();
  const store = new SqliteSkillsStore(database), governanceStore = new SqliteGovernanceStore(database);
  const principal = publicPrincipal({ orgId: "workspace_e2e", orgSlug: "e2e", userId: "actor_e2e", apiKeyId: "key_e2e" });
  await store.ensureBootstrapApiKey(token, principal);
  const versions = [];
  let previous: string | undefined;
  for (const version of ["1.0.0", "2.0.0"]) {
    const source = join(root, `source-${version}`), skillMd = `---\nname: review-code\ndescription: Review changed code\nkind: instruction\n---\nPublished ${version} review instructions.\n${documentSuffix}`;
    put(join(source, "SKILL.md"), skillMd); put(join(source, "references", "example.txt"), `asset-${version}`);
    put(join(source, "package.json"), JSON.stringify({ name: "review-code", version, skills: { kind: "instruction" } }));
    const bundle = packSkillBundle(source);
    const published = await store.publishSkill({ principal, slug: "review-code", displayName: "Review code", description: "E2E fixture", category: "Development Tools", tags: ["review"], source: "custom", kind: "instruction", version, skillMd, expectedRevisionId: previous, bundle: { sha256: bundle.sha256, byteSize: bundle.bytes.length, contentType: "application/gzip", storageKind: "db", bytes: bundle.bytes } });
    previous = published.revisionId;
    const selection = { slug: "review-code", version, bundleDigest: `sha256:${bundle.sha256}`, triggers: { keywords: ["review"] } };
    const file = join(root, `profile-${version}.json`); put(file, JSON.stringify({ selections: [selection] })); versions.push({ version, file, selection, skillMd });
  }
  let handler: SkillsFetchHandler | undefined;
  const requests: string[] = [];
  let rejectStationReport = false;
  let profileResponseStatus: number | undefined;
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) { const route = `${request.method} ${new URL(request.url).pathname}`; requests.push(route); if (profileResponseStatus && route.endsWith("/profiles/engineering/resolve")) return new Response("Untrusted refusal body", { status: profileResponseStatus }); if (rejectStationReport && route.startsWith("PUT /api/v1/stations/")) return new Response("Fixture report unavailable", { status: 503 }); return handler ? handler(request) : new Response("Starting", { status: 503 }); } });
  const origin = `http://127.0.0.1:${server.port}`;
  handler = await createSkillsFetchHandler({ store, governanceStore, runtime: null, config: { publicBaseUrl: origin } });
  function station(id: string) {
    const home = join(root, id, "home"), data = join(home, ".hasna", "skills"), project = join(root, id, "project");
    // Bind the synthetic HTTP credential explicitly; never consult a station Keychain.
    const env = { PATH: `${corpusInspectorPathFixture()}:${dirname(process.execPath)}:/usr/bin:/bin`, HOME: home, USERPROFILE: home, HASNA_HOME: join(home, ".hasna"), HASNA_SKILLS_DIR: data, HASNA_SKILLS_API_KEY_OVERRIDE: token, HASNA_SKILLS_API_URL: origin, HASNA_STATION: id, NO_COLOR: "1", TERM: "dumb", BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0", TMPDIR: join(root, id, "tmp") };
    for (const path of [home, data, project, env.TMPDIR]) mkdirSync(path, { recursive: true });
    if (enrolled) admitCorpusFixture(join(home, ".codex"));
    async function run(args: string[], options: { stdin?: unknown; env?: Record<string, string>; cwd?: string; shellCommand?: string; slowPipe?: boolean } = {}) {
      const command = [process.execPath, "--no-env-file", binary, ...args];
      // A shell creates a kernel pipe, unlike Bun.spawn's socket-backed capture.
      // Delay its reader to exercise backpressure before the command returns.
      const child = Bun.spawn(options.shellCommand ? ["/bin/sh", "-c", options.shellCommand] : options.slowPipe ? ["bash", "-o", "pipefail", "-c", '"$@" | { sleep 0.2; cat; }', "skills-pipe", ...command] : command, { cwd: options.cwd ?? project, env: { ...env, ...options.env }, stdin: options.stdin === undefined ? "ignore" : new Blob([JSON.stringify(options.stdin)]), stdout: "pipe", stderr: "pipe" });
      const timer = setTimeout(() => child.kill("SIGKILL"), 12_000);
      try { const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]); return { stdout, stderr, exitCode }; }
      finally { clearTimeout(timer); }
    }
    async function ok(args: string[], options?: Parameters<typeof run>[1]) { const result = await run(args, options); expect(result.stderr).toBe(""); expect(result.exitCode).toBe(0); return JSON.parse(result.stdout); }
    async function install() { return ok(["hook", "install", "--agent", "all", "--selection-profile", "engineering", "--command", executable, "--apply", "--json"]); }
    async function hook(agent: "claude" | "codex", event: string, input: Record<string, unknown>, extra?: Record<string, string>) {
      const config = json(join(home, `.${agent}`, agent === "claude" ? "settings.json" : "hooks.json"));
      const command = config.hooks[event].flatMap((entry: any) => entry.hooks).find((entry: any) => entry.command.includes("hook user-prompt"))?.command;
      expect(typeof command).toBe("string");
      return ok([], { stdin: { cwd: project, session_id: "parent-session", hook_event_name: event, ...input }, env: extra, shellCommand: command });
    }
    return { home, data, project, env, run, ok, install, hook };
  }
  return { root, store, principal, versions, requests, refuseProfile: (status: number) => { profileResponseStatus = status; }, rejectStationReports: () => { rejectStationReport = true; }, a: station("station-a"), b: station("station-b"), close: async () => { server.stop(true); await handler?.close(); await governanceStore.close(); await store.close(); } };
}

for (const state of ["unenrolled", "exclusive"] as const) test(`built hook installation refuses ${state} corpus without changing configuration`, async () => {
  const f = await fixture("", state !== "unenrolled");
  const corpus = join(f.a.home, ".codex"), config = join(corpus, "config.toml");
  const original = 'model = "synthetic-preserved-model"\n';
  put(config, original);
  const blocker = state === "exclusive" ? new KernelLock(corpus, ".native-corpus-admission", { existingOnly: true }) : undefined;
  try {
    if (blocker) expect(blocker.trySync(1000)).toBe(true);
    const result = await f.a.run(["hook", "install", "--agent", "codex", "--selection-profile", "engineering", "--command", executable, "--apply", "--json"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("CODEX_CORPUS_ADMISSION_REQUIRED");
    expect(readFileSync(config, "utf8")).toBe(original);
    expect(existsSync(join(corpus, "skills", "skills-cli"))).toBe(false);
    expect(existsSync(join(f.a.data, "agent-policy.json"))).toBe(false);
    if (state === "unenrolled") expect(existsSync(join(corpus, ".native-corpus-admission.flock-v1"))).toBe(false);
  } finally { blocker?.close(); await f.close(); }
});

for (const location of ["home", "project"] as const) for (const state of ["unenrolled", "exclusive", "admitted"] as const) {
  test(`alternate-agent CLI migration guards ${location} shared discovery (${state})`, async () => {
    const f = await fixture("", state !== "unenrolled");
    const directory = location === "home" ? f.a.home : f.a.project;
    const skill = join(directory, ".agents", "skills", "shared"), corpus = join(f.a.home, ".codex");
    const bytes = "---\nname: shared\ndescription: Synthetic shared input\n---\nExact preserved body\n";
    put(join(skill, "SKILL.md"), bytes);
    const publication = state === "exclusive" ? new KernelLock(corpus, ".native-corpus-admission", { existingOnly: true }) : undefined;
    try {
      if (publication) expect(publication.trySync(1000)).toBe(true);
      const result = await f.a.run(["migrate", "native", "--agent", "sumi", "--include-unmanaged", "--apply", "--json"], { cwd: directory });
      if (state === "admitted") {
        expect(result.stderr).toBe(""); expect(result.exitCode).toBe(0);
        const value = JSON.parse(result.stdout); expect(value.entries).toHaveLength(1);
        expect(value.inventory[0].agent).toBe("sumi"); expect(value.inventory[0].codexHome).toBe(corpus);
        expect(readFileSync(join(value.entries[0].archive, "SKILL.md"), "utf8")).toBe(bytes);
        expect(existsSync(skill)).toBe(false);
      } else {
        expect(result.exitCode).toBe(1); expect(result.stderr).toContain("CODEX_CORPUS_ADMISSION_REQUIRED");
        expect(readFileSync(join(skill, "SKILL.md"), "utf8")).toBe(bytes);
        expect(existsSync(join(f.a.data, "migration"))).toBe(false);
        if (state === "unenrolled") expect(existsSync(join(corpus, ".native-corpus-admission.flock-v1"))).toBe(false);
      }
    } finally { publication?.close(); await f.close(); }
  });
}

test("alternate-agent CLI migration binds shared input to the selected custom Codex home", async () => {
  const f = await fixture(), corpus = join(f.a.home, "selected-codex");
  admitCorpusFixture(corpus);
  const skill = join(f.a.project, ".agents", "skills", "shared"), bytes = "Synthetic custom-home input\n";
  put(join(skill, "SKILL.md"), bytes);
  const publication = new KernelLock(corpus, ".native-corpus-admission", { existingOnly: true });
  try {
    expect(publication.trySync(1000)).toBe(true);
    const result = await f.a.run(["migrate", "native", "--agent", "sumi", "--include-unmanaged", "--apply", "--json"], { env: { CODEX_HOME: corpus } });
    expect(result.exitCode).toBe(1); expect(result.stderr).toContain("CODEX_CORPUS_ADMISSION_REQUIRED");
    expect(readFileSync(join(skill, "SKILL.md"), "utf8")).toBe(bytes);
    expect(existsSync(join(f.a.data, "migration"))).toBe(false);
  } finally { publication.close(); await f.close(); }
});

for (const relativeRoot of [".sumi/skills", ".agents/skill"]) test(`alternate-agent CLI leaves unrelated ${relativeRoot} migration usable without Codex enrollment`, async () => {
  const f = await fixture("", false), skill = join(f.a.project, relativeRoot, "unrelated"), bytes = "Synthetic unrelated input\n";
  put(join(skill, "SKILL.md"), bytes);
  try {
    const result = await f.a.run(["migrate", "native", "--agent", "sumi", "--include-unmanaged", "--apply", "--json"]);
    expect(result.stderr).toBe(""); expect(result.exitCode).toBe(0);
    const value = JSON.parse(result.stdout); expect(value.entries).toHaveLength(1);
    expect(readFileSync(join(value.entries[0].archive, "SKILL.md"), "utf8")).toBe(bytes);
    expect(value.inventory[0].codexHome).toBeUndefined();
    expect(existsSync(join(f.a.home, ".codex", ".native-corpus-admission.flock-v1"))).toBe(false);
  } finally { await f.close(); }
});

test("lifecycle sync authenticates and verifies bundles without station-report availability", async () => {
  const f = await fixture();
  try {
    await f.a.install();
    await f.a.ok(["profiles", "set", "engineering", "--file", f.versions[0]!.file, "--json"]);
    f.rejectStationReports(); f.requests.length = 0;
    const started = await f.a.hook("claude", "SessionStart", { source: "startup", prompt: "$review-code" });
    expect(started.continue).not.toBe(false);
    expect(f.requests.some(route => route.endsWith("/profiles/engineering/resolve"))).toBe(true);
    expect(objectHashes(join(f.a.data, "selection-cache"))).toEqual([f.versions[0]!.selection.bundleDigest.slice(7)]);
    expect(f.requests.some(route => route.startsWith("PUT /api/v1/stations/"))).toBe(false);
    const prompt = await f.a.hook("claude", "UserPromptSubmit", { prompt: "$review-code" });
    expect(prompt.hookSpecificOutput?.additionalContext ?? started.hookSpecificOutput?.additionalContext).toContain("Published 1.0.0");
    const normal = await f.a.run(["sync", "--selection-profile", "engineering", "--json"]);
    expect(normal.exitCode).toBe(1);
    expect(normal.stdout).toContain("PROFILE_APPLIED_REPORT_FAILED");
    expect(f.requests.some(route => route === "PUT /api/v1/stations/station-a/state")).toBe(true);
    f.requests.length = 0;
    const explicit = await f.a.ok(["sync", "--selection-profile", "engineering", "--no-station-report", "--json"]);
    expect(explicit.stationReported).toBe(false);
    expect(explicit.downloaded).toBe(0);
    expect(f.requests.some(route => route.startsWith("PUT /api/v1/stations/"))).toBe(false);
  } finally { await f.close(); }
});

test("hook children started from a hostile directory read no bunfig.toml or .env there (context and SessionStart sync)", async () => {
  const f = await fixture();
  try {
    // The hook command is a pinned launcher, as the copyfile updater writes it, so
    // the top-level hook process is already clean; the children are under test.
    const pinned = join(f.root, "skills-pinned");
    writeFileSync(pinned, renderPinnedLauncher({ runtime: realpathSync(process.execPath), cwd: realpathSync(scratch), entry: realpathSync(binary) }), { mode: 0o700 });
    await f.a.ok(["hook", "install", "--agent", "all", "--selection-profile", "engineering", "--command", pinned, "--apply", "--json"]);
    await f.a.ok(["profiles", "set", "engineering", "--file", f.versions[0]!.file, "--json"]);
    const hostile = join(f.root, "station-a", "hostile"), marker = join(hostile, "preload-marker");
    mkdirSync(hostile, { recursive: true });
    put(join(hostile, "preload.js"), `require("node:fs").writeFileSync(${JSON.stringify(marker)}, "ran\\n", { flag: "a" });\n`);
    put(join(hostile, "bunfig.toml"), `preload = [${JSON.stringify(join(hostile, "preload.js"))}]\n`);
    put(join(hostile, ".env"), "HASNA_SKILLS_API_URL=http://127.0.0.1:9\n");
    const settings = json(join(f.a.home, ".claude", "settings.json"));
    const command = (event: string) => settings.hooks[event].flatMap((entry: any) => entry.hooks).find((entry: any) => entry.command.includes("hook user-prompt"))?.command as string;
    expect(command("SessionStart")).toContain(pinned);
    // The rendered hook text is unchanged by pinned launchers; the hooks lane detects it by this pattern.
    for (const event of ["SessionStart", "UserPromptSubmit"]) expect(command(event)).toMatch(/(?:^|\s)hook user-prompt --agent (claude|codex|gemini)(?:\s|$)/);
    const codexHooks = json(join(f.a.home, ".codex", "hooks.json"));
    const codexCommand = codexHooks.hooks.UserPromptSubmit.flatMap((entry: any) => entry.hooks).find((entry: any) => entry.command.includes("hook user-prompt"))?.command as string;
    expect(codexCommand).toContain(pinned);
    expect(codexCommand).toMatch(/(?:^|\s)hook user-prompt --agent (claude|codex|gemini)(?:\s|$)/);
    const started = await f.a.ok([], { cwd: hostile, shellCommand: command("SessionStart"), stdin: { cwd: f.a.project, session_id: "hostile-cwd", hook_event_name: "SessionStart", source: "startup", prompt: "$review-code" } });
    const prompt = await f.a.ok([], { cwd: hostile, shellCommand: command("UserPromptSubmit"), stdin: { cwd: f.a.project, session_id: "hostile-cwd", hook_event_name: "UserPromptSubmit", prompt: "$review-code" } });
    expect(started.continue).not.toBe(false);
    expect(prompt.hookSpecificOutput?.additionalContext ?? started.hookSpecificOutput?.additionalContext).toContain("Published 1.0.0");
    expect(existsSync(marker)).toBe(false);
  } finally { await f.close(); }
});

for (const explicitProject of [false, true]) test(`native migration retires the same ancestor copies as the hook (${explicitProject ? "explicit project" : "current directory"})`, async () => {
  const f = await fixture();
  try {
    await f.a.install();
    await f.a.ok(["profiles", "set", "engineering", "--file", f.versions[0]!.file, "--json"]);
    const nested = join(f.a.project, "src", "nested"), ancestor = join(f.a.project, ".claude", "skills", "ancestor-copy");
    mkdirSync(nested, { recursive: true });
    put(join(ancestor, "SKILL.md"), "Synthetic ancestor migration instructions\n");
    const hook = () => f.a.ok(["hook", "user-prompt", "--agent", "claude"], { cwd: nested, stdin: { cwd: nested, hook_event_name: "UserPromptSubmit", session_id: "ancestor-migration", prompt: "$review-code" } });
    expect((await hook()).decision).toBe("block");
    const args = ["migrate", "native", "--include-unmanaged", "--include-vendor", "--json", ...(explicitProject ? ["--project", nested] : [])];
    const options = { cwd: explicitProject ? f.a.home : nested };
    const plan = await f.a.ok(args, options);
    expect(plan.applied).toBe(false);
    expect(plan.inventory.filter((entry: any) => entry.path === ancestor)).toHaveLength(1);
    expect(existsSync(join(ancestor, "SKILL.md"))).toBe(true);
    const applied = await f.a.ok([...args, "--apply"], options);
    expect(applied.entries).toHaveLength(1);
    expect(applied.entries[0].source).toBe(ancestor);
    expect(readFileSync(join(applied.entries[0].archive, "SKILL.md"), "utf8")).toBe("Synthetic ancestor migration instructions\n");
    expect((await hook()).hookSpecificOutput.additionalContext).toContain("Published 1.0.0");
    expect((await f.a.ok(args, options)).inventory.every((entry: any) => entry.bridge)).toBe(true);
  } finally { await f.close(); }
});

test("built CLI flushes a complete large skill document through a pipe", async () => {
  const f = await fixture("Unicode instructions: căutare 🧭\n".repeat(4000));
  try {
    await f.a.ok(["profiles", "set", "engineering", "--file", f.versions[0]!.file, "--json"]);
    const args = ["load", "review-code@1.0.0", "--selection-profile", "engineering"];
    const raw = await f.a.run(args, { slowPipe: true });
    expect(raw.exitCode).toBe(0); expect(raw.stderr).toBe("");
    expect(Buffer.byteLength(raw.stdout)).toBe(Buffer.byteLength(f.versions[0]!.skillMd) + 1);
    expect(raw.stdout).toBe(`${f.versions[0]!.skillMd}\n`);
    const loaded = await f.a.ok([...args, "--json"], { slowPipe: true });
    expect(loaded.content).toBe(f.versions[0]!.skillMd);
  } finally { await f.close(); }
});

test("configured prompt hook delivers both selected bodies when one exceeds the old default character budget", async () => {
  const f = await fixture();
  try {
    const slug = "synthetic-ios", version = "0.2.0", source = join(f.root, slug);
    const skillMd = `---\nname: ${slug}\ndescription: Synthetic iOS guidance\nkind: instruction\n---\n${"Synthetic iOS instruction line.\n".repeat(600)}`;
    expect(skillMd.length).toBeGreaterThan(16_000);
    put(join(source, "SKILL.md"), skillMd);
    put(join(source, "package.json"), JSON.stringify({ name: slug, version, skills: { kind: "instruction" } }));
    const bundle = packSkillBundle(source);
    await f.store.publishSkill({ principal: f.principal, slug, displayName: "Synthetic iOS", description: "Large context fixture", category: "Development Tools", tags: [], source: "custom", kind: "instruction", version, skillMd, bundle: { sha256: bundle.sha256, byteSize: bundle.bytes.length, contentType: "application/gzip", storageKind: "db", bytes: bundle.bytes } });
    const profile = join(f.root, "two-selected-large-profile.json");
    put(profile, JSON.stringify({ selections: [f.versions[0]!.selection, { slug, version, bundleDigest: `sha256:${bundle.sha256}`, triggers: { keywords: ["ios"] } }] }));
    await f.a.install();
    await f.a.ok(["profiles", "set", "engineering", "--file", profile, "--json"]);
    await f.a.ok(["sync", "--selection-profile", "engineering", "--json"]);
    const hook = await f.a.hook("claude", "UserPromptSubmit", { prompt: "review ios" });
    const context = hook.hookSpecificOutput.additionalContext as string;
    expect(context).toContain(f.versions[0]!.skillMd);
    expect(context).toContain(skillMd);
    expect(context).not.toContain("Additional selected skill");
    const receipt = await f.a.ok(["context", "--stdin", "--cached", "--json"], { stdin: { session_id: "fresh-large-context", prompt: "review ios" } });
    expect(receipt.selections.map((selection: any) => selection.slug).sort()).toEqual(["review-code", slug].sort());
    expect(receipt.omitted).toEqual([]);
    expect(receipt.context).toContain(skillMd);
    const capped = await f.a.ok(["context", "--stdin", "--cached", "--max-chars", "8000", "--json"], { stdin: { session_id: "fresh-explicit-budget", prompt: "review ios" } });
    expect(capped.context).not.toContain(skillMd);
    expect(capped.omitted).toContainEqual(expect.objectContaining({ slug, version, reason: "context-budget" }));
  } finally { await f.close(); }
});

test("built CLI flushes large profile, sync and station receipts through pipes", async () => {
  const f = await fixture();
  try {
    const selections = [];
    for (let i = 0; i < 120; i++) {
      const slug = `large-profile-skill-${i}`, source = join(f.root, slug);
      const skillMd = `---\nname: ${slug}\ndescription: Large profile fixture\n---\nInstructions for ${slug}.\n`;
      put(join(source, "SKILL.md"), skillMd);
      put(join(source, "package.json"), JSON.stringify({ name: slug, version: "1.0.0" }));
      const bundle = packSkillBundle(source);
      await f.store.publishSkill({ principal: f.principal, slug, displayName: slug, description: "Large profile fixture", category: "Development Tools", tags: [], source: "custom", kind: "instruction", version: "1.0.0", skillMd, bundle: { sha256: bundle.sha256, byteSize: bundle.bytes.length, contentType: "application/gzip", storageKind: "db", bytes: bundle.bytes } });
      selections.push({ slug, version: "1.0.0", bundleDigest: `sha256:${bundle.sha256}`, triggers: { keywords: Array.from({ length: 12 }, (_, j) => `fixture-keyword-${i}-${j}`) } });
    }
    const file = join(f.root, "large-profile.json"); put(file, JSON.stringify({ selections }));
    selections.sort((a, b) => a.slug.localeCompare(b.slug));
    const created = await f.a.run(["profiles", "set", "engineering", "--file", file, "--json"], { slowPipe: true });
    expect(created.exitCode).toBe(0); expect(created.stderr).toBe("");
    const synced = await f.a.run(["sync", "--selection-profile", "engineering", "--json"], { slowPipe: true });
    expect(synced.exitCode).toBe(0); expect(synced.stderr).toBe("");
    expect(Buffer.byteLength(synced.stdout)).toBeGreaterThan(128 * 1024);
    const receipt = JSON.parse(synced.stdout);
    expect(receipt.profile.selections).toHaveLength(selections.length);
    expect(receipt.receipt.profile).toEqual(receipt.profile);
    expect(receipt.stationReported).toBe(true);
    const checked = await f.a.ok(["sync", "--selection-profile", "engineering", "--check", "--json"], { slowPipe: true });
    expect(checked.changed).toBe(false); expect(checked.downloaded).toBe(0);
    expect(checked.profile).toEqual(receipt.profile);
    const shown = await f.a.ok(["profiles", "show", "engineering", "--json"], { slowPipe: true });
    expect(shown.selections).toEqual(selections);
    expect(JSON.parse(created.stdout).selections).toEqual(selections);
    const state = await f.a.ok(["station-state", "station-a", "--json"], { slowPipe: true });
    expect(state.profileRevision).toBe(receipt.profile.profileRevision);
    expect(state.selections).toHaveLength(selections.length);
  } finally { await f.close(); }
});

test("built CLI performs profile CAS/rollback, two-station sync, pinned hook restore and subagent inheritance over HTTP", async () => {
  const f = await fixture();
  try {
    const v1 = f.versions[0]!, v2 = f.versions[1]!;
    await f.a.install(); await f.b.install();
    const created = await f.a.ok(["profiles", "set", "engineering", "--file", v1.file, "--json"]);
    const saved = join(f.root, "rollback.json");
    const shown = await f.a.ok(["profiles", "show", "engineering", "--save", saved, "--json"]); expect(shown.revision).toBe(created.revision); expect(json(saved).selections).toEqual(created.selections);
    const duplicate = await f.a.run(["profiles", "set", "engineering", "--file", v1.file, "--json"]); expect(duplicate.exitCode).toBe(1); expect(duplicate.stderr).toContain("409");
    await f.a.ok(["sync", "--project", "--json"]); await f.b.ok(["sync", "--json"]);
    const firstHashes = objectHashes(join(f.a.data, "selection-cache")); expect(firstHashes).toEqual([v1.selection.bundleDigest.slice(7)]); expect(objectHashes(join(f.b.data, "selection-cache"))).toEqual(firstHashes);
    const receiptA = await f.a.ok(["station-state", "station-a", "--json"]), receiptB = await f.b.ok(["station-state", "station-b", "--json"]); expect(receiptA.profileRevision).toBe(created.revision); expect(receiptB.profileRevision).toBe(created.revision);
    for (const [station, agent] of [[f.a, "claude"], [f.b, "codex"]] as const) {
      const positional = await station.run(["context", "review this patch", "--cached", "--json"]); expect(positional.stdout).toContain("Published 1.0.0");
      const diagnostic = await station.run(["context", "--stdin", "--cached", "--json"], { stdin: { prompt: "review this patch", cwd: station.project } }); expect(diagnostic.stdout).toContain("Published 1.0.0");
      const context = await station.hook(agent, "UserPromptSubmit", { prompt: "review this patch" }); expect(context.hookSpecificOutput.hookEventName).toBe("UserPromptSubmit"); expect(context.hookSpecificOutput.additionalContext).toContain(v1.skillMd);
      const duplicate = await station.hook(agent, "UserPromptSubmit", { prompt: "review this patch again" }); expect(duplicate).toEqual({});
    }
    const updated = await f.a.ok(["profiles", "set", "engineering", "--file", v2.file, "--if-match", created.revision, "--json"]); expect(updated.revision).not.toBe(created.revision);
    const stale = await f.a.run(["profiles", "set", "engineering", "--file", v1.file, "--if-match", created.revision, "--json"]); expect(stale.exitCode).toBe(1); expect(stale.stderr).toContain("409");
    await f.a.ok(["sync", "--json"]); await f.b.ok(["sync", "--json"]);
    expect((await f.a.ok(["load", "review-code@1.0.0", "--json"])).content).toBe(v1.skillMd);
    expect((await f.b.ok(["load", "review-code@2.0.0", "--json"])).content).toBe(v2.skillMd);
    expect(json(join(f.a.project, ".skills", "selection.lock.json")).profile.profileRevision).toBe(created.revision);
    for (const [station, agent] of [[f.a, "claude"], [f.b, "codex"]] as const) {
      const restored = await station.hook(agent, "SessionStart", { source: "compact" }); expect(restored.hookSpecificOutput.hookEventName).toBe("SessionStart"); expect(restored.hookSpecificOutput.additionalContext).toContain(v1.skillMd); expect(restored.hookSpecificOutput.additionalContext).not.toContain(v2.skillMd);
      const child = await station.hook(agent, "SubagentStart", { agent_id: "child-one", agent_type: "explorer" }); expect(child.hookSpecificOutput.hookEventName).toBe("SubagentStart"); expect(child.hookSpecificOutput.additionalContext).toContain(v1.skillMd);
    }
    const rollback = await f.a.ok(["profiles", "set", "engineering", "--file", saved, "--if-match", updated.revision, "--json"]); expect(rollback.revision).not.toBe(updated.revision); expect(rollback.selections).toEqual(created.selections);
    await f.b.ok(["sync", "--json"]); expect((await f.b.ok(["load", "review-code@1.0.0", "--json"])).content).toBe(v1.skillMd);
    expect(f.requests.some(path => path.startsWith("PUT /api/v1/profiles/"))).toBe(true); expect(f.requests.some(path => path.startsWith("PUT /api/v1/stations/"))).toBe(true);
    expect(readdirSync(join(f.a.home, ".claude", "skills"))).toEqual(["skills-cli"]); expect(readdirSync(join(f.b.home, ".codex", "skills"))).toEqual(["skills-cli"]);
  } finally { await f.close(); }
});

test("native hooks refuse stale profile arguments before HTTP refresh or cached context writes", async () => {
  const f = await fixture();
  try {
    await f.a.install();
    for (const profile of ["engineering", "retired-profile"]) {
      await f.a.ok(["profiles", "set", profile, "--file", f.versions[0]!.file, "--json"]);
      await f.a.ok(["sync", "--selection-profile", profile, "--json"]);
    }
    const sessions = join(f.a.data, "selection-cache", "sessions");
    const before = existsSync(sessions) ? readdirSync(sessions).sort() : [];
    const requestCount = f.requests.length;
    for (const agent of ["claude", "codex"] as const) {
      for (const event of ["SessionStart", "UserPromptSubmit", "SubagentStart"]) {
        const result = await f.a.ok(["hook", "user-prompt", "--agent", agent, "--event", event, "--selection-profile", "retired-profile"], {
          stdin: { cwd: f.a.project, session_id: `stale-${agent}-${event}`, agent_id: "child", prompt: "review this patch" },
        });
        expect(JSON.stringify(result)).toContain("NATIVE_SKILL_DRIFT: the hook selection profile differs from its managed binding");
        expect(JSON.stringify(result)).not.toContain("Published 1.0.0");
        expect(f.requests).toHaveLength(requestCount);
        expect(existsSync(sessions) ? readdirSync(sessions).sort() : []).toEqual(before);
      }
    }
    const denied = await f.a.ok(["hook", "user-prompt", "--agent", "claude", "--event", "PreToolUse", "--selection-profile", "retired-profile"], {
      stdin: { cwd: f.a.project, tool_name: "Skill", tool_input: { skill: "skills-cli" } },
    });
    expect(denied.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(denied.hookSpecificOutput.permissionDecisionReason).toContain("hook selection profile differs");
    const environmentOverride = await f.a.ok(["hook", "user-prompt", "--agent", "codex", "--event", "SessionStart"], {
      stdin: { cwd: f.a.project, session_id: "stale-environment", prompt: "review this patch" },
      env: { HASNA_SKILLS_SELECTION_PROFILE: "retired-profile" },
    });
    expect(environmentOverride.continue).toBe(false);
    expect(environmentOverride.stopReason).toContain("hook selection profile differs");
    expect(f.requests).toHaveLength(requestCount);
    expect(existsSync(sessions) ? readdirSync(sessions).sort() : []).toEqual(before);
    // Explicit CLI reads of another profile remain supported outside the native bridge.
    const direct = await f.a.ok(["load", "review-code@1.0.0", "--selection-profile", "retired-profile", "--cached", "--json"]);
    expect(direct.content).toContain("Published 1.0.0");
    const accepted = await f.a.hook("claude", "UserPromptSubmit", { prompt: "review this patch" }, { HASNA_SKILLS_SELECTION_PROFILE: "retired-profile" });
    expect(accepted.hookSpecificOutput.additionalContext).toContain("Published 1.0.0");
  } finally { await f.close(); }
});

test("built CLI refuses revoked HTTP access without silent cache fallback and continues failed SessionStart with no payload", async () => {
  const f = await fixture();
  try {
    await f.a.install(); await f.a.ok(["profiles", "set", "engineering", "--file", f.versions[0]!.file, "--json"]); await f.a.ok(["sync", "--json"]);
    const before = objectHashes(join(f.a.data, "selection-cache")), invalid = { HASNA_SKILLS_API_KEY_OVERRIDE: "revoked-fixture-credential" };
    const refused = await f.a.run(["load", "review-code@1.0.0", "--json"], { env: invalid }); expect(refused.exitCode).toBe(1); expect(refused.stdout).not.toContain("Published 1.0.0"); expect(refused.stdout).toContain("SKILLS_API_UNAUTHORIZED");
    const context = await f.a.run(["context", "review this patch", "--json"], { env: invalid }); expect(context.exitCode).toBe(1); expect(context.stdout).not.toContain("Published 1.0.0");
    const denied = await f.a.hook("claude", "SessionStart", { source: "startup" }, invalid); expect(denied.continue).not.toBe(false); expect(denied.systemMessage).toContain("unavailable");
    expect(denied.systemMessage).toContain("[SKILLS_API_UNAUTHORIZED]");
    expect(denied.systemMessage).toContain("profile=engineering");
    expect(denied.systemMessage).not.toContain(invalid.HASNA_SKILLS_API_KEY_OVERRIDE);
    // Prompt hooks explicitly request verified cached mode; auth is checked at session refresh.
    const cached = await f.a.hook("claude", "UserPromptSubmit", { prompt: "review this patch" }, invalid); expect(cached.hookSpecificOutput.additionalContext).toContain("Published 1.0.0");
    expect(objectHashes(join(f.a.data, "selection-cache"))).toEqual(before);
  } finally { await f.close(); }
});

test("native hooks explain a project/session profile conflict without changing its pin or fetching a replacement", async () => {
  const f = await fixture();
  try {
    await f.a.install();
    await f.a.ok(["profiles", "set", "engineering", "--file", f.versions[0]!.file, "--json"]);
    await f.a.ok(["sync", "--json"]);
    await f.a.hook("claude", "UserPromptSubmit", { prompt: "review this patch" });
    const sessions = join(f.a.data, "selection-cache", "sessions");
    const receiptPath = join(sessions, readdirSync(sessions)[0]!);
    const before = readFileSync(receiptPath, "utf8");
    await f.a.ok(["profiles", "set", "default", "--file", f.versions[1]!.file, "--json"]);
    await f.a.ok(["sync", "--selection-profile", "default", "--project", "--json"]);
    await f.a.ok(["hook", "install", "--agent", "claude", "--selection-profile", "default", "--command", executable, "--apply", "--json"]);
    const requests = f.requests.length;
    const denied = await f.a.hook("claude", "UserPromptSubmit", { prompt: "continue" });
    expect(denied.decision).toBe("block");
    expect(denied.reason).toContain("[PROFILE_LOCK_MISMATCH]");
    expect(denied.reason).toContain("profile=engineering");
    expect(denied.reason).toContain("skills sessions show <session-id> --json");
    expect(denied.reason).toContain("Sync alone does not change that pin");
    expect(denied.reason).not.toContain(f.a.project);
    expect(denied.reason).not.toContain("parent-session");
    expect(f.requests).toHaveLength(requests);
    expect(readFileSync(receiptPath, "utf8")).toBe(before);
  } finally { await f.close(); }
});

for (const [savedProfile, configuredProfile] of [["fleet", "default"], ["default", "fleet"]] as const) {
  test(`managed hooks retain ${savedProfile} sessions while new sessions use ${configuredProfile}`, async () => {
    const f = await fixture();
    try {
      await f.a.install();
      await f.a.ok(["profiles", "set", savedProfile, "--file", f.versions[0]!.file, "--json"]);
      await f.a.ok(["profiles", "set", configuredProfile, "--file", f.versions[1]!.file, "--json"]);
      await f.a.ok(["sync", "--selection-profile", savedProfile, "--json"]);
      const install = (profile: string) => f.a.ok(["hook", "install", "--agent", "claude", "--selection-profile", profile, "--command", executable, "--apply", "--json"]);
      await install(savedProfile);
      await f.a.hook("claude", "UserPromptSubmit", { prompt: "review this patch" });
      const sessions = join(f.a.data, "selection-cache", "sessions");
      const receiptPath = join(sessions, readdirSync(sessions)[0]!);
      const before = readFileSync(receiptPath, "utf8");
      const { generation: originalGeneration, ...originalPin } = JSON.parse(before);
      const expectSamePin = () => {
        const { generation, ...currentPin } = json(receiptPath);
        expect(currentPin).toEqual(originalPin);
        expect(generation).toBeGreaterThan(originalGeneration);
      };
      await install(configuredProfile);
      const requests = f.requests.length;
      expect(await f.a.hook("claude", "UserPromptSubmit", { prompt: "continue" })).toEqual({});
      expect(f.requests).toHaveLength(requests);
      expectSamePin();
      const restored = await f.a.hook("claude", "SessionStart", { source: "resume" });
      expect(restored.hookSpecificOutput.additionalContext).toContain(f.versions[0]!.skillMd);
      expect(restored.hookSpecificOutput.additionalContext).not.toContain(f.versions[1]!.skillMd);
      const child = await f.a.hook("claude", "SubagentStart", { agent_id: "mixed-child" });
      expect(child.hookSpecificOutput.additionalContext).toContain(f.versions[0]!.skillMd);
      expectSamePin();
      const fresh = await f.a.hook("claude", "UserPromptSubmit", { session_id: "new-session", prompt: "review this patch" });
      expect(fresh.hookSpecificOutput.additionalContext).toContain(f.versions[1]!.skillMd);
      const explicit = await f.a.run(["context", "review this patch", "--session", "parent-session", "--selection-profile", configuredProfile, "--cached", "--json"]);
      expect(explicit.exitCode).toBe(1);
      expect(JSON.parse(explicit.stdout).error.code).toBe("PROFILE_LOCK_MISMATCH");
      const missing = await f.a.hook("claude", "SubagentStart", { session_id: "absent-parent", agent_id: "child" });
      expect(missing.systemMessage).toContain("[SESSION_PARENT_NOT_FOUND]");
      // Model an already reconciled parent using the separately resolved fresh
      // session snapshot. An existing child owns its original independent pin.
      const parentBeforeChange = readFileSync(receiptPath, "utf8");
      const freshReceipt = readdirSync(sessions).map(name => json(join(sessions, name))).find(receipt => receipt.sessionId === "new-session");
      put(receiptPath, JSON.stringify({ ...freshReceipt, sessionId: "parent-session", generation: json(receiptPath).generation + 1 }));
      const retainedChild = await f.a.hook("claude", "SubagentStart", { agent_id: "mixed-child", restore: true });
      expect(retainedChild.hookSpecificOutput.additionalContext).toContain(f.versions[0]!.skillMd);
      expect(retainedChild.hookSpecificOutput.additionalContext).not.toContain(f.versions[1]!.skillMd);
      put(receiptPath, parentBeforeChange);
      // Expiry must authorize the old pinned profile, never silently adopt the
      // newly configured one or use its already warm cache on authentication failure.
      const expired = json(receiptPath); expired.verifiedAt = new Date(0).toISOString();
      put(receiptPath, JSON.stringify(expired));
      const expiredBytes = readFileSync(receiptPath, "utf8");
      const denied = await f.a.hook("claude", "UserPromptSubmit", { prompt: "$review-code" }, { HASNA_SKILLS_API_KEY_OVERRIDE: "revoked-fixture-credential" });
      expect(denied.decision).toBeUndefined();
      expect(denied.systemMessage).toContain("[SKILLS_API_UNAUTHORIZED]");
      expect(denied.systemMessage).toContain(`profile=${savedProfile}`);
      expect(readFileSync(receiptPath, "utf8")).toBe(expiredBytes);
    } finally { await f.close(); }
  });
}

test("expired native hooks safely reconcile unchanged loaded selections on prompt and resume", async () => {
  const f = await fixture();
  try {
    await f.a.install();
    const first = await f.a.ok(["profiles", "set", "engineering", "--file", f.versions[0]!.file, "--json"]);
    await f.a.ok(["sync", "--json"]);
    await f.a.hook("claude", "UserPromptSubmit", { prompt: "review this patch" });
    const sessions = join(f.a.data, "selection-cache", "sessions");
    const receiptPath = join(sessions, readdirSync(sessions)[0]!);
    const receipt = json(receiptPath);
    receipt.verifiedAt = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    put(receiptPath, JSON.stringify(receipt));
    await f.a.ok(["profiles", "set", "engineering", "--file", f.versions[0]!.file, "--if-match", first.revision, "--json"]);
    await f.a.ok(["sync", "--json"]);
    const before = readFileSync(receiptPath);
    const plain = await f.a.hook("claude", "UserPromptSubmit", { prompt: "ok so we are all good?" });
    expect(plain).toEqual({});
    expect(json(receiptPath).verifiedAt).not.toBe(receipt.verifiedAt);
    expect(json(receiptPath).loaded).toEqual(receipt.loaded);
    const archiveRoot = join(f.a.data, "selection-cache", "session-reconciliations");
    const firstArchive = join(archiveRoot, readdirSync(archiveRoot)[0]!, "original.json");
    expect(readFileSync(firstArchive)).toEqual(before);
    const current = json(receiptPath);
    current.verifiedAt = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    put(receiptPath, JSON.stringify(current));
    const restored = await f.a.hook("claude", "SessionStart", { source: "resume" });
    expect(restored.hookSpecificOutput.additionalContext).toContain("Published 1.0.0");
    expect(json(receiptPath).loaded).toEqual(receipt.loaded);
    expect(readdirSync(archiveRoot)).toHaveLength(2);
    const cached = await f.a.run(["context", "--stdin", "--cached", "--json"], { stdin: { session_id: "parent-session", prompt: "$review-code" } });
    expect(cached.exitCode).toBe(0);
  } finally { await f.close(); }
});

test("expired native hooks retain authorized historical bodies after a selected version upgrade", async () => {
  const f = await fixture();
  try {
    await f.a.install();
    const first = await f.a.ok(["profiles", "set", "engineering", "--file", f.versions[0]!.file, "--json"]);
    await f.a.ok(["sync", "--json"]);
    await f.a.hook("claude", "UserPromptSubmit", { prompt: "$review-code" });
    const sessions = join(f.a.data, "selection-cache", "sessions");
    const receiptPath = join(sessions, readdirSync(sessions)[0]!);
    const expired = json(receiptPath); expired.verifiedAt = new Date(0).toISOString();
    put(receiptPath, JSON.stringify(expired));
    const before = readFileSync(receiptPath);
    await f.a.ok(["profiles", "set", "engineering", "--file", f.versions[1]!.file, "--if-match", first.revision, "--json"]);
    await f.a.ok(["sync", "--json"]);
    for (const agent of ["claude", "codex"] as const) for (const event of ["UserPromptSubmit", "SessionStart"] as const) {
      const result = await f.a.hook(agent, event, event === "SessionStart" ? { source: "resume" } : { prompt: "$review-code" });
      expect(result.decision).toBeUndefined();
      expect(result.continue).not.toBe(false);
      expect(JSON.stringify(result)).not.toContain("SESSION_RECONCILIATION_REQUIRED");
      expect(JSON.stringify(result)).not.toContain("Published 2.0.0");
      if (event === "SessionStart") expect(result.hookSpecificOutput.additionalContext).toContain("Published 1.0.0");
      expect(json(receiptPath).profile).toEqual(expired.profile);
      expect(json(receiptPath).loaded).toEqual(expired.loaded);
    }
    const archives = join(f.a.data, "selection-cache", "session-reconciliations");
    expect(readFileSync(join(archives, readdirSync(archives)[0]!, "original.json"))).toEqual(before);
    expect(f.requests).toContain("GET /api/v1/skills/review-code/versions/1.0.0/bundle");
  } finally { await f.close(); }
});

test("expired hook sessions continue without payload when hosted authentication fails", async () => {
  const f = await fixture();
  try {
    await f.a.install();
    await f.a.ok(["profiles", "set", "engineering", "--file", f.versions[0]!.file, "--json"]);
    await f.a.ok(["sync", "--json"]);
    await f.a.hook("claude", "UserPromptSubmit", { prompt: "review this patch" });
    const sessions = join(f.a.data, "selection-cache", "sessions");
    const receiptPath = join(sessions, readdirSync(sessions)[0]!);
    const receipt = json(receiptPath); receipt.verifiedAt = new Date(0).toISOString();
    put(receiptPath, JSON.stringify(receipt));
    const before = readFileSync(receiptPath, "utf8"), requests = f.requests.length;
    const denied = await f.a.hook("claude", "UserPromptSubmit", { prompt: "$review-code" }, { HASNA_SKILLS_API_KEY_OVERRIDE: "revoked-fixture-credential" });
    expect(denied.decision).toBeUndefined();
    expect(denied.systemMessage).toContain("[SKILLS_API_UNAUTHORIZED]");
    expect(denied.systemMessage).toContain("profile=engineering");
    expect(denied.systemMessage).not.toContain("revoked-fixture-credential");
    expect(JSON.stringify(denied)).not.toContain("Published 1.0.0");
    expect(f.requests.length).toBeGreaterThan(requests);
    expect(readFileSync(receiptPath, "utf8")).toBe(before);
  } finally { await f.close(); }
});

test("missing hook cache resolves from the API but malformed receipts never trigger recovery", async () => {
  const f = await fixture();
  try {
    await f.a.install();
    await f.a.ok(["profiles", "set", "engineering", "--file", f.versions[0]!.file, "--json"]);
    const recovered = await f.a.hook("claude", "UserPromptSubmit", { prompt: "$review-code" });
    expect(recovered.hookSpecificOutput.additionalContext).toContain("Published 1.0.0");
    const sessions = join(f.a.data, "selection-cache", "sessions");
    const receiptPath = join(sessions, readdirSync(sessions)[0]!);
    put(receiptPath, "{invalid");
    const before = f.requests.length;
    const refused = await f.a.hook("claude", "UserPromptSubmit", { prompt: "$review-code" });
    expect(refused.decision).toBe("block");
    expect(refused.reason).toContain("[INVALID_RECEIPT]");
    expect(f.requests).toHaveLength(before);
    expect(readFileSync(receiptPath, "utf8")).toBe("{invalid");
  } finally { await f.close(); }
});

test("built Gemini hook selects the user's request after its native SessionStart policy prefix", async () => {
  const f = await fixture();
  try {
    const selections = [];
    for (const [slug, length, keywords] of [["skills-author", 7500, ["skills", "skill", "authoring", "workspace"]], ["backup-verify", 1000, ["backup", "verify"]]] as const) {
      const source = join(f.root, slug), skillMd = `---\nname: ${slug}\ndescription: A synthetic procedure\nkind: instruction\n---\n${"x".repeat(length)}\n`;
      put(join(source, "SKILL.md"), skillMd);
      put(join(source, "package.json"), JSON.stringify({ name: slug, version: "1.0.0", skills: { kind: "instruction" } }));
      const bundle = packSkillBundle(source);
      await f.store.publishSkill({ principal: f.principal, slug, displayName: slug, description: "Gemini hook fixture", category: "Development Tools", tags: [], source: "custom", kind: "instruction", version: "1.0.0", skillMd, bundle: { sha256: bundle.sha256, byteSize: bundle.bytes.length, contentType: "application/gzip", storageKind: "db", bytes: bundle.bytes } });
      selections.push({ slug, version: "1.0.0", bundleDigest: `sha256:${bundle.sha256}`, triggers: { keywords: [...keywords] } });
    }
    const profile = join(f.root, "gemini-profile.json"); put(profile, JSON.stringify({ selections }));
    await f.a.install();
    await f.a.ok(["profiles", "set", "engineering", "--file", profile, "--json"]);
    const start = await f.a.ok(["hook", "user-prompt", "--agent", "gemini", "--event", "SessionStart", "--selection-profile", "engineering"], { stdin: { cwd: f.a.project, hook_event_name: "SessionStart" } });
    const user = "Use backup-verify to explain the backup verification process briefly; respond without tools.";
    const invoke = (prompt: string) => f.a.ok(["hook", "user-prompt", "--agent", "gemini", "--event", "BeforeAgent", "--selection-profile", "engineering"], { stdin: { cwd: f.a.project, hook_event_name: "BeforeAgent", session_id: randomUUID(), prompt } });
    const requestsBefore = f.requests.length;
    const result = await invoke(`<hook_context>${start.hookSpecificOutput.additionalContext}</hook_context>\n\n${user}`);
    expect(result.hookSpecificOutput.hookEventName).toBe("BeforeAgent");
    expect(result.hookSpecificOutput.additionalContext).toContain("name: backup-verify");
    expect(result.hookSpecificOutput.additionalContext).not.toContain("name: skills-author");
    // Arbitrary hook context still participates in keyword selection; it is not erased.
    const arbitrary = await invoke(`<hook_context>skills skill authoring workspace</hook_context>\n\n${user.replace("backup-verify", "backup verify")}`);
    expect(arbitrary.hookSpecificOutput.additionalContext).toContain("name: skills-author");
    expect(arbitrary.hookSpecificOutput.additionalContext).toContain("name: backup-verify");
    expect(arbitrary.hookSpecificOutput.additionalContext.indexOf("Skill skills-author@")).toBeLessThan(arbitrary.hookSpecificOutput.additionalContext.indexOf("Skill backup-verify@"));
    // A complete name takes priority even when other context matches more keywords.
    const named = await invoke(`<hook_context>skills skill authoring workspace</hook_context>\n\n${user}`);
    expect(named.hookSpecificOutput.additionalContext).toContain("name: backup-verify");
    expect(named.hookSpecificOutput.additionalContext).toContain("name: skills-author");
    expect(named.hookSpecificOutput.additionalContext.indexOf("Skill backup-verify@")).toBeLessThan(named.hookSpecificOutput.additionalContext.indexOf("Skill skills-author@"));
    expect(f.requests).toHaveLength(requestsBefore);
  } finally { await f.close(); }
});

test("native payload project roots are guarded even when the host launches hooks from its home", async () => {
  const f = await fixture();
  try {
    await f.a.install(); await f.a.ok(["profiles", "set", "engineering", "--file", f.versions[0]!.file, "--json"]); await f.a.ok(["sync", "--json"]);
    for (const [agent, event, root] of [["claude", "UserPromptSubmit", ".claude"], ["gemini", "BeforeAgent", ".gemini"], ["cursor", "beforeSubmitPrompt", ".cursor"]]) {
      const native = join(f.a.project, root!, "skills", "unexpected", "SKILL.md");
      put(native, "Unexpected project instructions\n");
      const requestsBefore = f.requests.length;
      const response = await f.a.ok(["hook", "user-prompt", "--agent", agent!, "--event", event!], { cwd: f.a.home, stdin: { hook_event_name: event, prompt: "review", ...(agent === "cursor" ? { workspace_roots: [f.a.project], conversation_id: "cursor-test" } : { cwd: f.a.project, session_id: "test" }) } });
      expect(JSON.stringify(response)).toContain("NATIVE_SKILL_DRIFT");
      expect(f.requests).toHaveLength(requestsBefore);
      if (agent === "cursor") expect(response.continue).toBe(false);
      else expect(response.decision).toBe(agent === "gemini" ? "deny" : "block");
      rmSync(join(native, ".."), { recursive: true });
    }
  } finally { await f.close(); }
});

test("managed prompt hook refuses new native copies and missing or modified bridges before loading cached context", async () => {
  const f = await fixture();
  try {
    await f.a.install();
    await f.a.ok(["profiles", "set", "engineering", "--file", f.versions[0]!.file, "--json"]);
    await f.a.ok(["sync", "--json"]);
    const settings = join(f.a.home, ".claude", "settings.json"), config = json(settings);
    expect(config.syncClaudeAiSkills).toBe(false);
    put(settings, JSON.stringify({ ...config, syncClaudeAiSkills: true }));
    const requestsBefore = f.requests.length;
    const syncRefused = await f.a.hook("claude", "UserPromptSubmit", { prompt: "review this patch" });
    expect(syncRefused.decision).toBe("block");
    expect(syncRefused.reason).toContain("syncClaudeAiSkills");
    expect(f.requests).toHaveLength(requestsBefore);
    expect(JSON.stringify(syncRefused)).not.toContain("Published 1.0.0");
    put(settings, JSON.stringify(config));
    const bridge = join(f.a.home, ".claude", "skills", "skills-cli", "SKILL.md"), original = readFileSync(bridge, "utf8");
    const unexpected = join(f.a.home, ".claude", "skills", "unexpected", "SKILL.md");
    put(unexpected, "Unexpected native instructions must not be accepted.\n");
    const refused = await f.a.hook("claude", "UserPromptSubmit", { prompt: "review this patch" });
    expect(refused.decision).toBe("block"); expect(refused.reason).toContain("native");
    expect(JSON.stringify(refused)).not.toContain("Published 1.0.0");
    rmSync(dirname(unexpected), { recursive: true });
    writeFileSync(bridge, `${original}\nUnexpected bridge edit.\n`);
    expect((await f.a.hook("claude", "UserPromptSubmit", { prompt: "review again" })).decision).toBe("block");
    rmSync(bridge);
    expect((await f.a.hook("claude", "UserPromptSubmit", { prompt: "review again" })).decision).toBe("block");
    put(bridge, original);
    const loaded = await f.a.hook("claude", "UserPromptSubmit", { prompt: "review the repaired setup" });
    expect(loaded.hookSpecificOutput.additionalContext).toContain("Published 1.0.0");
  } finally { await f.close(); }
});

test("native Skill invocation admits only the verified bridge and never dispatches a payload skill", async () => {
  const f = await fixture();
  try {
    await f.a.install();
    const before = [...f.requests];
    const denied = await f.a.hook("claude", "PreToolUse", { tool_name: "Skill", tool_input: { skill: "other-skill" } });
    expect(denied.hookSpecificOutput.permissionDecision).toBe("deny");
    const allowed = await f.a.hook("claude", "PreToolUse", { tool_name: "Skill", tool_input: { skill: "skills-cli" } });
    expect(allowed.hookSpecificOutput.permissionDecision).toBe("allow");
    expect(f.requests).toEqual(before);
  } finally { await f.close(); }
});

test("built hook installation preserves config and migration preserves unique edited skills and vendor separation", async () => {
  const f = await fixture();
  try {
    const settings = join(f.a.home, ".claude", "settings.json"), codex = join(f.a.home, ".codex", "config.toml");
    const original = JSON.stringify({ model: "preserved-model", permissions: { allow: ["Bash(git status)"], deny: ["Read(.env)"] }, hooks: { Stop: [{ hooks: [{ type: "command", command: "existing-stop-command" }] }] } });
    put(settings, original); put(codex, 'model = "preserved-codex-model"\n\n[mcp_servers.existing]\ncommand = "preserved-mcp"\n');
    const managed = join(f.a.home, ".claude", "skills", "managed"), unique = join(f.a.home, ".agents", "skills", "unique"), vendor = join(f.a.home, ".codex", "skills", ".system", "vendor");
    put(join(managed, "SKILL.md"), "Managed copy with a unique edit."); put(join(managed, ".hasna-skills.json"), JSON.stringify({ managedBy: "@hasna/skills" })); put(join(managed, "references", "asset.txt"), "Unique managed asset.");
    put(join(unique, "SKILL.md"), "Unmanaged authoring draft."); put(join(vendor, "SKILL.md"), "Vendor-provided system skill.");
    const plan = await f.a.ok(["hook", "install", "--selection-profile", "engineering", "--command", executable, "--json"]); expect(plan.applied).toBe(false); expect(readFileSync(settings, "utf8")).toBe(original);
    const installed = await f.a.install(); expect(installed.backups.some((path: string) => readFileSync(path, "utf8") === original)).toBe(true);
    const configured = json(settings); expect(configured.model).toBe("preserved-model"); expect(configured.permissions.allow).toEqual(["Bash(git status)"]); expect(configured.permissions.deny).toEqual(["Read(.env)", "Skill"]); expect(configured.hooks.Stop[0].hooks[0].command).toBe("existing-stop-command");
    const codexConfig = Bun.TOML.parse(readFileSync(codex, "utf8")) as any; expect(codexConfig.model).toBe("preserved-codex-model"); expect(codexConfig.mcp_servers.existing.command).toBe("preserved-mcp"); expect(codexConfig.skills.config).toEqual([{ path: join(vendor, "SKILL.md"), enabled: false }, { path: join(unique, "SKILL.md"), enabled: false }]);
    expect((await f.a.install()).changed).toEqual([]);
    const archived = await f.a.ok(["migrate", "native", "--apply", "--json"]); expect(archived.entries).toHaveLength(1); expect(readFileSync(join(archived.entries[0].archive, "SKILL.md"), "utf8")).toBe("Managed copy with a unique edit."); expect(readFileSync(join(archived.entries[0].archive, "references", "asset.txt"), "utf8")).toBe("Unique managed asset."); expect(existsSync(managed)).toBe(false); expect(existsSync(unique)).toBe(true); expect(existsSync(vendor)).toBe(true);
    const authored = await f.a.ok(["migrate", "native", "--include-unmanaged", "--apply", "--json"]); expect(authored.entries).toHaveLength(1); expect(readFileSync(join(authored.entries[0].archive, "SKILL.md"), "utf8")).toBe("Unmanaged authoring draft."); expect(existsSync(vendor)).toBe(true);
  } finally { await f.close(); }
});

// Explicit local proof only: CI does not require a separately installed Codex binary.
// All hook sources are this test's generated configuration. No production provider or credential is used.
const nativeCodex = process.env.HASNA_SKILLS_NATIVE_CODEX_BIN;
test.skipIf(!nativeCodex)("installed Codex delivers managed context without reseeding bundled native skills", async () => {
  const f = await fixture(); let modelServer: ReturnType<typeof Bun.serve> | undefined;
  try {
    await f.a.install(); await f.a.ok(["profiles", "set", "engineering", "--file", f.versions[0]!.file, "--json"]);
    const requests: string[] = [];
    modelServer = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
      if (request.method !== "POST") return Response.json({ data: [] });
      requests.push(await request.text());
      const message = { id: "msg_fixture", type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: "Fixture complete.", annotations: [] }] };
      const events = [
        { type: "response.created", response: { id: "resp_fixture", object: "response", status: "in_progress", output: [] } },
        { type: "response.output_item.added", output_index: 0, item: { ...message, status: "in_progress", content: [] } },
        { type: "response.output_item.done", output_index: 0, item: message },
        { type: "response.completed", response: { id: "resp_fixture", object: "response", status: "completed", output: [message], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } },
      ];
      return new Response(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(""), { headers: { "Content-Type": "text/event-stream" } });
    } });
    const codexHome = join(f.a.home, ".codex"), localProvider = `http://127.0.0.1:${modelServer.port}/v1`;
    put(join(codexHome, "config.toml"), `model = "fixture-model"\nmodel_provider = "fixture"\n[model_providers.fixture]\nname = "Local fixture"\nbase_url = ${JSON.stringify(localProvider)}\nwire_api = "responses"\nrequires_openai_auth = false\nrequest_max_retries = 0\nstream_max_retries = 0\n`);
    // Re-enroll after editing the fixture's model provider. The very first
    // Codex startup must leave bundled documents absent and the bridge usable.
    await f.a.install();
    const child = Bun.spawn([nativeCodex!, "exec", "--json", "--skip-git-repo-check", "--dangerously-bypass-hook-trust", "--sandbox", "read-only", "review this fixture; respond without tools"], { cwd: f.a.project, env: { ...f.a.env, CODEX_HOME: codexHome }, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
    const timer = setTimeout(() => child.kill("SIGKILL"), 15_000);
    try {
      const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
      expect({ code, stdout: stdout.slice(-2000), stderr: stderr.slice(-2000) }).toMatchObject({ code: 0 });
      expect({ requests: requests.length, stdout: stdout.slice(-4000), stderr: stderr.slice(-2000) }).toMatchObject({ requests: expect.any(Number) });
      if (!requests.length) throw new Error(`Native Codex made no model request: ${stdout.slice(-4000)} ${stderr.slice(-2000)}`);
      expect(requests).toHaveLength(1);
      expect(requests.some(body => body.includes("Published 1.0.0 review instructions."))).toBe(true);
      expect(requests[0]).toContain("skills-cli");
      expect(requests[0]).not.toContain("skill-creator");
      expect(requests[0]).not.toContain("skill-installer");
      expect(existsSync(join(codexHome, "skills", ".system"))).toBe(false);
      expect(f.requests.some(path => path === "GET /api/v1/profiles/engineering/resolve")).toBe(true);
      expect(f.requests.some(path => path === "PUT /api/v1/stations/station-a/state")).toBe(false);
    } finally { clearTimeout(timer); }
  } finally { modelServer?.stop(true); await f.close(); }
});

const nativeClaude = process.env.HASNA_SKILLS_NATIVE_CLAUDE_BIN;
test.skipIf(!nativeClaude)("installed Claude delivers selected context and advertises the owned native Skills bridge", async () => {
  const f = await fixture(); let modelServer: ReturnType<typeof Bun.serve> | undefined;
  try {
    put(join(f.a.home, ".claude", "skills", "native-sentinel", "SKILL.md"), "---\nname: native-sentinel\ndescription: Review fixture using native instructions\n---\nNative sentinel instructions must not be loaded.\n");
    await f.a.install(); await f.a.ok(["profiles", "set", "engineering", "--file", f.versions[0]!.file, "--json"]);
    await f.a.ok(["migrate", "native", "--include-unmanaged", "--include-vendor", "--apply", "--json"]); await f.a.install();
    const requests: any[] = [];
    modelServer = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
      const route = new URL(request.url).pathname;
      if (route.endsWith("/count_tokens")) return Response.json({ input_tokens: 1 });
      if (!route.endsWith("/messages")) return Response.json({ data: [] });
      const body = await request.json() as any; requests.push(body);
      const message = { id: "msg_fixture", type: "message", role: "assistant", model: body.model, content: [{ type: "text", text: "Fixture complete." }], stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } };
      if (!body.stream) return Response.json(message);
      const events = [
        { type: "message_start", message: { ...message, content: [], stop_reason: null, usage: { input_tokens: 1, output_tokens: 0 } } },
        { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
        { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Fixture complete." } },
        { type: "content_block_stop", index: 0 },
        { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 1 } },
        { type: "message_stop" },
      ];
      return new Response(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(""), { headers: { "Content-Type": "text/event-stream" } });
    } });
    const child = Bun.spawn([nativeClaude!, "--print", "--output-format", "json", "--model", "fixture-model", "review this fixture; respond without tools"], { cwd: f.a.project, env: { ...f.a.env, CLAUDE_CONFIG_DIR: join(f.a.home, ".claude"), ANTHROPIC_BASE_URL: `http://127.0.0.1:${modelServer.port}`, ANTHROPIC_API_KEY: "fixture-local-provider", CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1" }, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
    const timer = setTimeout(() => child.kill("SIGKILL"), 15_000);
    try {
      const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
      expect({ code, stdout: stdout.slice(-2000), stderr: stderr.slice(-2000) }).toMatchObject({ code: 0 });
      expect(requests.length).toBeGreaterThan(0);
      expect(requests.some(body => JSON.stringify(body).includes("Published 1.0.0 review instructions."))).toBe(true);
      expect(requests.some(body => body.tools?.some((tool: any) => tool.name === "Skill"))).toBe(true);
      expect(requests.some(body => JSON.stringify(body).includes("skills-cli"))).toBe(true);
      expect(requests.every(body => !JSON.stringify(body).includes("Native sentinel instructions must not be loaded."))).toBe(true);
      expect(f.requests.some(route => route === "GET /api/v1/profiles/engineering/resolve")).toBe(true);
      expect(f.requests.some(route => route === "PUT /api/v1/stations/station-a/state")).toBe(false);
    } finally { clearTimeout(timer); }
  } finally { modelServer?.stop(true); await f.close(); }
});

test("Hermes compiled native adapter emits selected context through shlex commands and blocks native fallback", async () => {
  const f = await fixture();
  try {
    await f.a.ok(["hook", "install", "--agent", "hermes", "--selection-profile", "engineering", "--command", executable, "--apply", "--json"]);
    const config = Bun.YAML.parse(readFileSync(join(f.a.home, ".hermes/config.yaml"), "utf8")) as any;
    const definitions = ["pre_llm_call", "pre_tool_call"].map(event => ({ event, command: config.hooks[event][0].command }));
    // Normal trust records in an isolated fixture HOME; no native client is launched.
    put(join(f.a.home, ".hermes/shell-hooks-allowlist.json"), JSON.stringify({ approvals: definitions }));
    await f.a.ok(["profiles", "set", "engineering", "--file", f.versions[0]!.file, "--json"]);
    const python = Bun.which("python3"); if (!python) throw new Error("Python shlex is required for Hermes adapter verification");
    async function invoke(event: string, payload: unknown, terminalCwd = f.a.project) {
      const command = definitions.find(entry => entry.event === event)!.command;
      // Native Hermes supplies TERMINAL_CWD before invoking these commands.
      const child = Bun.spawn([python!, "-c", "import shlex,subprocess,sys; sys.exit(subprocess.call(shlex.split(sys.argv[1])))", command], { cwd: f.a.project, env: { ...f.a.env, TERMINAL_CWD: terminalCwd }, stdin: new Blob([JSON.stringify(payload)]), stdout: "pipe", stderr: "pipe" });
      const timeout = setTimeout(() => child.kill("SIGKILL"), 12_000);
      try { const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]); expect(stderr).toBe(""); expect(exitCode).toBe(0); return JSON.parse(stdout); }
      finally { clearTimeout(timeout); }
    }
    const input = { cwd: f.a.project, session_id: "hermes-fixture", hook_event_name: "pre_llm_call", extra: { user_message: "$review-code", is_first_turn: true } };
    const result = await invoke("pre_llm_call", input);
    expect(result.context).toContain(f.versions[0]!.skillMd); expect(result.context).toContain("Skills loading policy");
    expect(result.hookSpecificOutput).toBeUndefined();
    const requestCount = f.requests.length;
    const tool = { cwd: f.a.project, hook_event_name: "pre_tool_call", tool_name: "skill_view", tool_input: { name: "skills-cli" } };
    expect(await invoke("pre_tool_call", tool)).toEqual({ action: "continue" });
    for (const terminalCwd of [f.a.home, "."]) {
      expect((await invoke("pre_llm_call", input, terminalCwd)).context).toContain("Required Skills context is unavailable");
      expect((await invoke("pre_tool_call", tool, terminalCwd)).action).toBe("block");
    }
    for (const body of [[], { ...tool, tool_input: { name: "review-code" } }, { ...tool, tool_name: "skill_manage" }]) expect((await invoke("pre_tool_call", body)).action).toBe("block");
    expect(f.requests).toHaveLength(requestCount);
    put(join(f.a.home, ".hermes/skills/reintroduced/SKILL.md"), "Native fallback must never load.\n");
    expect((await invoke("pre_tool_call", { ...tool, tool_name: "terminal", tool_input: {} })).action).toBe("block");
    const refused = await invoke("pre_llm_call", { ...input, extra: { user_message: "continue", is_first_turn: false } });
    expect(refused.context).toContain("Required Skills context is unavailable"); expect(refused.context).not.toContain("Native fallback must never load");
    expect(f.requests).toHaveLength(requestCount);
  } finally { await f.close(); }
});


test("actual busy and malformed locks preserve exact receipts while distinguishing delivery availability", async () => {
  const f = await fixture();
  try {
    await f.a.install(); await f.a.ok(["profiles", "set", "engineering", "--file", f.versions[0]!.file, "--json"]); await f.a.ok(["sync", "--json"]);
    await f.a.hook("claude", "UserPromptSubmit", { prompt: "$review-code" });
    const sessions = join(f.a.data, "selection-cache", "sessions"), receiptPath = join(sessions, readdirSync(sessions)[0]!);
    const before = readFileSync(receiptPath), lockPath = `${receiptPath}.write-lock`;
    const lock = JSON.stringify({ schemaVersion: 1, operationId: randomUUID(), sessionId: "parent-session", pid: process.pid });
    put(lockPath, lock);
    for (const agent of ["claude", "codex"] as const) for (const event of ["UserPromptSubmit", "SessionStart", "SubagentStart"]) {
      const result = await f.a.hook(agent, event, { prompt: "$review-code", source: "compact", ...(event === "SubagentStart" ? { agent_id: `${agent}-child` } : {}) });
      expect(result.decision).toBeUndefined(); expect(result.continue).not.toBe(false);
      expect(result.systemMessage).toContain("SESSION_WRITE_BUSY"); expect(JSON.stringify(result)).not.toContain("Published");
      expect(readFileSync(receiptPath)).toEqual(before); expect(readFileSync(lockPath, "utf8")).toBe(lock);
    }
    const direct = await f.a.run(["context", "review", "--cached", "--session", "parent-session", "--json"]);
    expect(direct.exitCode).toBe(1); expect(direct.stdout).toContain("SESSION_WRITE_BUSY");
    put(lockPath, "malformed lock");
    const refused = await f.a.hook("claude", "UserPromptSubmit", { prompt: "$review-code" });
    expect(refused.decision).toBe("block"); expect(refused.reason).toContain("SESSION_WRITE_LOCKED");
    expect(readFileSync(receiptPath)).toEqual(before);
  } finally { await f.close(); }
});

test("typed hosted delivery refusals continue with no payload and direct loads fail closed", async () => {
  const f = await fixture();
  try {
    await f.a.install(); await f.a.ok(["profiles", "set", "engineering", "--file", f.versions[0]!.file, "--json"]); await f.a.ok(["sync", "--json"]);
    await f.a.hook("claude", "UserPromptSubmit", { prompt: "$review-code" });
    const sessions = join(f.a.data, "selection-cache", "sessions"), receiptPath = join(sessions, readdirSync(sessions)[0]!);
    const expired = json(receiptPath); expired.verifiedAt = new Date(0).toISOString(); put(receiptPath, JSON.stringify(expired));
    const before = readFileSync(receiptPath);
    for (const [status, code] of [[401, "SKILLS_API_UNAUTHORIZED"], [403, "SKILLS_API_FORBIDDEN"], [404, "SKILLS_API_RESOURCE_UNAVAILABLE"], [410, "SKILLS_API_RESOURCE_UNAVAILABLE"], [429, "SKILLS_API_UNAVAILABLE"], [503, "SKILLS_API_UNAVAILABLE"]] as const) {
      f.refuseProfile(status);
      for (const agent of ["claude", "codex"] as const) {
        const result = await f.a.hook(agent, "UserPromptSubmit", { prompt: "$review-code" });
        expect(result.decision).toBeUndefined(); expect(result.systemMessage).toContain(code);
        expect(JSON.stringify(result)).not.toContain("Published"); expect(JSON.stringify(result)).not.toContain("Untrusted refusal body");
        expect(readFileSync(receiptPath)).toEqual(before);
      }
      const direct = await f.a.run(["load", "review-code", "--session", "parent-session", "--json"]);
      expect(direct.exitCode).toBe(1); expect(direct.stdout).toContain(code); expect(direct.stdout).not.toContain("Published");
    }
  } finally { await f.close(); }
});

test("benign Claude and Codex preferences change without native discovery drift", async () => {
  const f = await fixture();
  try {
    await f.a.install(); await f.a.ok(["profiles", "set", "engineering", "--file", f.versions[0]!.file, "--json"]); await f.a.ok(["sync", "--json"]);
    const claudeSettings = join(f.a.home, ".claude", "settings.json"), settings = json(claudeSettings);
    put(claudeSettings, JSON.stringify({ ...settings, effortLevel: "high", model: "claude-sonnet-4-6", verbose: true }));
    const codexConfig = join(f.a.home, ".codex", "config.toml");
    put(codexConfig, `model = "fixture-model"\nmodel_reasoning_effort = "high"\n${readFileSync(codexConfig, "utf8")}`);
    for (const agent of ["claude", "codex"] as const) {
      const result = await f.a.hook(agent, "UserPromptSubmit", { session_id: `preferences-${agent}`, prompt: "$review-code" });
      expect(result.decision).toBeUndefined(); expect(result.hookSpecificOutput.additionalContext).toContain("Published 1.0.0");
    }
    settings.enabledPlugins = { "unreviewed@fixture": true }; put(claudeSettings, JSON.stringify(settings));
    const denied = await f.a.hook("claude", "UserPromptSubmit", { prompt: "ordinary prompt" });
    expect(denied.decision).toBe("block"); expect(denied.reason).toContain("NATIVE_SKILL_DRIFT");
  } finally { await f.close(); }
});


test("missing owned credential denies delivery without blocking prompts and future receipts stay hard", async () => {
  const f = await fixture();
  try {
    await f.a.install(); await f.a.ok(["profiles", "set", "engineering", "--file", f.versions[0]!.file, "--json"]); await f.a.ok(["sync", "--json"]);
    for (const agent of ["claude", "codex"] as const) {
      const unavailable = await f.a.hook(agent, "SessionStart", {session_id:`missing-${agent}`}, {HASNA_SKILLS_API_KEY_OVERRIDE:""});
      expect(unavailable.decision).toBeUndefined(); expect(unavailable.systemMessage).toContain("SKILLS_API_CREDENTIAL_UNAVAILABLE"); expect(JSON.stringify(unavailable)).not.toContain("Published");
    }
    const direct = await f.a.run(["load", "review-code", "--selection-profile", "engineering", "--json"], {env:{HASNA_SKILLS_API_KEY_OVERRIDE:""}}); expect(direct.exitCode).toBe(1); expect(direct.stdout).not.toContain("Published");
    await f.a.hook("claude","UserPromptSubmit",{prompt:"$review-code"});
    const sessions=join(f.a.data,"selection-cache","sessions"), path=join(sessions,readdirSync(sessions)[0]!);
    const receipt=json(path); receipt.verifiedAt=new Date(Date.now()+3600000).toISOString(); put(path,JSON.stringify(receipt)); const before=readFileSync(path);
    const result=await f.a.hook("claude","UserPromptSubmit",{prompt:"$review-code"}); expect(result.decision).toBe("block"); expect(result.reason).toContain("INVALID_RECEIPT"); expect(readFileSync(path)).toEqual(before);
  } finally { await f.close(); }
});


test("installed Codex prompt continues after reviewed Pages app and qualified skill cache relocation", async () => {
 const f=await fixture();
 try {
  await f.a.install(); await f.a.ok(["profiles","set","engineering","--file",f.versions[0]!.file,"--json"]); await f.a.ok(["sync","--json"]);
  const parent=join(f.a.home,".codex/plugins/cache/probe/pages"), names=["maintain-space","manage-schedules","organize-space","write-page"];
  const app='{"apps":{"pages":{"id":"synthetic_pages_connector","required":true}}}';
  const add=(version:string,skills=names)=>{const root=join(parent,version);put(join(root,".codex-plugin/plugin.json"),JSON.stringify({name:"pages",version,apps:"./.app.json"}));put(join(root,".app.json"),app);for(const name of skills)put(join(root,"skills",name,"SKILL.md"),`---\nname: ${name}\ndescription: Synthetic native fixture\n---\nUNMANAGED_NATIVE_PAYLOAD\n`);return root;};
  const original=add("1.0.0"), file=join(f.root,"native-review.json");
  put(file,JSON.stringify({version:"codex-cli 0.159.2",cwd:f.a.project,skills:names.map(name=>({name:`pages:${name}`,path:join(original,"skills",name,"SKILL.md"),enabled:true,pluginId:"pages@probe"})),plugins:[{id:"pages@probe",name:"pages",installed:true,enabled:true,localVersion:"1.0.0"}]}));
  const receipt=await f.a.ok(["hook","install","--agent","codex","--codex-native-catalog",file,"--apply","--json"]);
  expect(receipt.codexPluginSkills).toHaveLength(4);expect(receipt.codexPluginSkills[0].name).toBe("pages:maintain-space");expect(receipt.codexPluginSkills[0].appSha256).toMatch(/^[a-f0-9]{64}$/);expect(receipt.codexPluginSkillReview.version).toBe("codex-cli 0.159.2");
  for (const version of ["3.0.0","4.0.0"]) {
   add(version); const result=await f.a.hook("codex","UserPromptSubmit",{prompt:"$review-code"});expect(result.decision).toBeUndefined();expect(result.hookSpecificOutput.additionalContext).toContain("Published 1.0.0");expect(JSON.stringify(result)).not.toContain("UNMANAGED_NATIVE_PAYLOAD");
  }
  const appPath=join(parent,"4.0.0/.app.json");
  put(appPath,app.replace("true","false"));const changed=await f.a.hook("codex","UserPromptSubmit",{prompt:"ordinary coding"});expect(changed.decision).toBe("block");expect(changed.reason).toContain("NATIVE_SKILL_DRIFT");expect(changed.hookSpecificOutput).toBeUndefined();
  put(appPath,app);add("4.0.0",["unknown"]); const unsafe=await f.a.hook("codex","UserPromptSubmit",{prompt:"$review-code"});expect(unsafe.decision).toBe("block");expect(unsafe.reason).toContain("NATIVE_SKILL_DRIFT");expect(unsafe.hookSpecificOutput).toBeUndefined();
 } finally { await f.close(); }
});

// Exercise the exact public context command used by managed hooks, with a real
// authenticated HTTP store and complete old/current profiles. No native process.
test("public expired cached hook context renews the old complete pin after routine upgrade", async () => {
  const f = await fixture("", false);
  try {
    const first = await f.a.ok(["profiles", "set", "engineering", "--file", f.versions[0]!.file, "--json"]);
    await f.a.ok(["sync", "--selection-profile", "engineering", "--json"]);
    const command = ["context", "review", "--session", "parent-session", "--selection-profile", "engineering", "--cached", "--auto-reconcile-safe", "--restore", "--json"];
    expect((await f.a.ok(command)).context).toContain("Published 1.0.0");
    const sessions = join(f.a.data, "selection-cache", "sessions"), receiptPath = join(sessions, readdirSync(sessions)[0]!);
    const old = json(receiptPath); old.verifiedAt = new Date(0).toISOString(); put(receiptPath, JSON.stringify(old));
    const before = readFileSync(receiptPath);
    await f.a.ok(["profiles", "set", "engineering", "--file", f.versions[1]!.file, "--if-match", first.revision, "--json"]);
    const result = await f.a.ok(command);
    expect(result.context).toContain("Published 1.0.0"); expect(result.context).not.toContain("Published 2.0.0");
    const current = json(receiptPath);
    expect(current.profile).toEqual(old.profile); expect(current.loaded).toEqual(old.loaded);
    expect(Date.parse(current.verifiedAt)).toBeGreaterThan(Date.parse(old.verifiedAt));
    const archives = join(f.a.data, "selection-cache", "session-reconciliations");
    expect(readFileSync(join(archives, readdirSync(archives)[0]!, "original.json"))).toEqual(before);
    expect(f.requests).toContain("GET /api/v1/skills/review-code/versions/1.0.0/bundle");
  } finally { await f.close(); }
});

for (const change of ["removed", "revived", "legacy-upgrade", "corrupt-old-bundle"] as const) test(`public expired cached hook renewal refuses ${change} without receipt or body leakage`, async () => {
  const f = await fixture("", false);
  try {
    const first = await f.a.ok(["profiles", "set", "engineering", "--file", f.versions[0]!.file, "--json"]);
    await f.a.ok(["sync", "--selection-profile", "engineering", "--json"]);
    const command = ["context", "review", "--session", "parent-session", "--selection-profile", "engineering", "--cached", "--auto-reconcile-safe", "--restore", "--json"];
    expect((await f.a.ok(command)).context).toContain("Published 1.0.0");
    const sessions = join(f.a.data, "selection-cache", "sessions"), receiptPath = join(sessions, readdirSync(sessions)[0]!);
    const old = json(receiptPath); old.verifiedAt = new Date(0).toISOString();
    if (change === "legacy-upgrade") for (const selection of old.profile.selections) delete selection.authorizationEpoch;
    put(receiptPath, JSON.stringify(old)); const before = readFileSync(receiptPath);
    if (change === "revived") {
      const prior = (await f.store.getSkill(f.principal, "review-code"))!;
      await f.store.deleteSkill(f.principal, "review-code", 60_000);
      await f.store.publishSkill({ principal: f.principal, slug: prior.slug, displayName: prior.displayName, description: prior.description, category: prior.category, tags: prior.tags, source: prior.source, kind: prior.kind, version: "3.0.0" });
      // Leave the current profile at exactly the original selected bytes. Epoch alone refuses revival.
    } else {
      const file = change === "removed" ? join(f.root, "empty.json") : f.versions[1]!.file;
      if (change === "removed") put(file, JSON.stringify({ selections: [] }));
      await f.a.ok(["profiles", "set", "engineering", "--file", file, "--if-match", first.revision, "--json"]);
    }
    if (change === "corrupt-old-bundle") f.store.database.query("UPDATE skills_bundles SET body_blob = ? WHERE org_id = ? AND sha256 = ?").run(new Uint8Array([0]), f.principal.orgId, f.versions[0]!.selection.bundleDigest.slice(7));
    const result = await f.a.run(command);
    expect(result.exitCode).toBe(1);
    expect(result.stdout + result.stderr).not.toContain("Published 1.0.0");
    expect(result.stdout + result.stderr).not.toContain("Published 2.0.0");
    expect(readFileSync(receiptPath)).toEqual(before);
    expect(existsSync(join(f.a.data, "selection-cache", "session-reconciliations"))).toBe(false);
  } finally { await f.close(); }
});
