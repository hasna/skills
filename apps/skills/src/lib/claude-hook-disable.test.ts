import { KernelLock } from "@hasna/contracts/kernel-lock";
import { afterEach, expect, spyOn, test } from "bun:test";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { disableClaudeHooks, type ClaudeHookDisableOptions } from "./claude-hook-disable.js";
import { renderAgentHookCommand } from "./agent-adapters.js";
import { parseNativeJsonObject } from "./claude-settings-witness.js";
import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();
const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const roots: string[] = [];
afterEach(() => { if (process.env.SKILLS_KEEP_TEST_FIXTURES !== "1") for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
const events = ["SessionStart", "UserPromptSubmit", "SubagentStart"] as const;
function fixture() {
  const root = fs.mkdtempSync(join(fs.realpathSync(tmpdir()), "skills-disable-claude-")); roots.push(root);
  const native = join(root, "native"), command = join(root, "pkg", "bin", "index.js"), settings = join(native, "settings.json");
  for (const directory of [native, dirname(command)]) fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  fs.writeFileSync(command, "#!/usr/bin/env bun\n// synthetic Skills command\n", { mode: 0o700 });
  fs.writeFileSync(join(root, "pkg", "package.json"), JSON.stringify({ name: "@hasna/skills", bin: { skills: "bin/index.js" } }), { mode: 0o600 });
  const hooks = Object.fromEntries(events.map(event => [event, [{ hooks: [{ type: "command", command: renderAgentHookCommand(command, "claude", "default", event), timeout: 15 }] }]]));
  const unrelated = { hooks: [{ type: "command", command: "echo unrelated", timeout: 8 }], matcher: "kept" };
  hooks.SessionStart.unshift(unrelated as never);
  hooks.SessionStart.push({ hooks: [] });
  const before = `${JSON.stringify({ hooks: { ...hooks, PreToolUse: [{ matcher: "Skill", hooks: [{ type: "command", command: "native-denial", timeout: 15 }] }] }, permissions: { deny: ["Skill", "Skill(*)"] }, theme: "kept", unknown: "private text" }, null, 2)}\n`;
  fs.writeFileSync(settings, before, { mode: 0o600 });
  const options: ClaudeHookDisableOptions = { settings, expectedSettingsSha256: sha(before), expectedMode: "0600", command,
    expectedCommandSha256: sha(fs.readFileSync(command, "utf8")), profile: "default" };
  return { root, native, command, settings, before, options, preservation: join(root, "preserved"),
    write(text: string) { fs.writeFileSync(settings, text); options.expectedSettingsSha256 = sha(text); } };
}

test("preview finds exact owning registrations and writes no file", () => {
  const f = fixture(), listing = fs.readdirSync(f.native), stat = fs.lstatSync(f.settings);
  const result = disableClaudeHooks(f.options);
  expect(result).toMatchObject({ state: "preview", mutationOccurred: false, settingsWitness: "not-renewed" });
  expect(result.removed).toEqual([{ event: "UserPromptSubmit", groupIndex: 0, hookIndex: 0 }, { event: "SessionStart", groupIndex: 1, hookIndex: 0 }, { event: "SubagentStart", groupIndex: 0, hookIndex: 0 }]);
  expect(fs.readdirSync(f.native)).toEqual(listing);
  expect(fs.lstatSync(f.settings).ino).toBe(stat.ino);
  expect(fs.readFileSync(f.settings, "utf8")).toBe(f.before);
  expect(JSON.stringify(result)).not.toContain("private text");
  expect(JSON.stringify(result)).not.toContain("native-denial");
});

test("apply preserves readable private originals and removes only context hooks with exact mode and readback", () => {
  const f = fixture();
  const policy = join(f.root, "agent-policy.json"), profile = join(f.root, "profile.json"), session = join(f.root, "session.json");
  for (const file of [policy, profile, session]) fs.writeFileSync(file, "untouched\n", { mode: 0o600 });
  const result = disableClaudeHooks({ ...f.options, apply: true, preimageDir: f.preservation });
  expect(result).toMatchObject({ state: "applied", mutationOccurred: true, beforeSha256: sha(f.before), settingsWitness: "not-renewed" });
  expect(result.removed).toHaveLength(3);
  expect(fs.readFileSync(result.preimage!, "utf8")).toBe(f.before);
  expect(fs.readFileSync(result.displaced!, "utf8")).toBe(f.before);
  expect(fs.lstatSync(result.preimage!).mode & 0o777).toBe(0o600);
  expect(fs.lstatSync(f.preservation).mode & 0o777).toBe(0o700);
  expect(fs.lstatSync(f.settings).mode & 0o777).toBe(0o600);
  expect(sha(fs.readFileSync(f.settings, "utf8"))).toBe(result.afterSha256!);
  const after = JSON.parse(fs.readFileSync(f.settings, "utf8")), before = JSON.parse(f.before);
  expect(after.permissions).toEqual(before.permissions);
  expect(after.hooks.PreToolUse).toEqual(before.hooks.PreToolUse);
  expect(after.hooks.SessionStart).toEqual([before.hooks.SessionStart[0], { hooks: [] }]);
  expect(after.hooks.UserPromptSubmit).toEqual([]);
  expect(after.hooks.SubagentStart).toEqual([]);
  delete after.hooks; delete before.hooks; expect(after).toEqual(before);
  for (const file of [policy, profile, session]) expect(fs.readFileSync(file, "utf8")).toBe("untouched\n");
  expect(JSON.parse(fs.readFileSync(result.receipt!, "utf8"))).toMatchObject({ state: "applied", mutationOccurred: true, beforeSha256: result.beforeSha256, afterSha256: result.afterSha256 });
});

test("mixed groups retain foreign handler order and group metadata, including a newly empty attributed group", () => {
  const f = fixture(), value = JSON.parse(f.before), own = value.hooks.UserPromptSubmit[0].hooks[0];
  value.hooks.UserPromptSubmit = [{ hooks: [{ type: "command", command: "first" }, own, { type: "command", command: "last" }], matcher: "context", custom: 3 }, { hooks: [own], matcher: "owned-context" }, { hooks: [], matcher: "unrelated-empty" }];
  f.write(JSON.stringify(value));
  disableClaudeHooks({ ...f.options, apply: true, preimageDir: f.preservation });
  expect(JSON.parse(fs.readFileSync(f.settings, "utf8")).hooks.UserPromptSubmit).toEqual([
    { hooks: [{ type: "command", command: "first" }, { type: "command", command: "last" }], matcher: "context", custom: 3 },
    { hooks: [], matcher: "owned-context" }, { hooks: [], matcher: "unrelated-empty" },
  ]);
});

test("unknown numeric settings retain their exact spelling rather than rounding", () => {
  const f = fixture(); f.write(f.before.replace('"theme": "kept"', '"large": 9007199254740993, "negativeZero": -0, "exponent": 1e+001'));
  disableClaudeHooks({ ...f.options, apply: true, preimageDir: f.preservation });
  const after = fs.readFileSync(f.settings, "utf8");
  for (const literal of ["9007199254740993", "-0", "1e+001"]) expect(after).toContain(literal);
  expect(parseNativeJsonObject(after)).toBeDefined();
});

for (const text of ['{"theme":"kept"}\n', '{"hooks":{"SessionStart":[],"UserPromptSubmit":[{"hooks":[]}]}}\n']) {
  test("no matching registration is a no-op with byte-identical settings and no preservation artifacts", () => {
    const f = fixture(); f.write(text); const stat = fs.lstatSync(f.settings), listing = fs.readdirSync(f.native);
    expect(disableClaudeHooks({ ...f.options, apply: true, preimageDir: f.preservation })).toMatchObject({ state: "no-op", mutationOccurred: false, removed: [], beforeSha256: sha(text), afterSha256: sha(text) });
    expect(fs.readFileSync(f.settings, "utf8")).toBe(text); expect(fs.lstatSync(f.settings).ino).toBe(stat.ino);
    expect(fs.readdirSync(f.native)).toEqual(listing); expect(fs.existsSync(f.preservation)).toBe(false);
  });
}

test("an explicitly absent file is no-data, not a successful disable or zero populated matches", () => {
  const f = fixture(), target = join(f.root, "missing", "settings.json"); fs.mkdirSync(dirname(target), { mode: 0o700 });
  expect(disableClaudeHooks({ ...f.options, settings: target, expectedSettingsSha256: "absent", expectedMode: "absent", apply: true }))
    .toMatchObject({ state: "no-data", mutationOccurred: false, beforeSha256: null, afterSha256: null, removed: [] });
  expect(fs.readdirSync(dirname(target))).toEqual([]);
});

for (const [label, mutate] of [
  ["stale hash", (f: ReturnType<typeof fixture>) => { f.options.expectedSettingsSha256 = "0".repeat(64); }],
  ["stale mode", (f: ReturnType<typeof fixture>) => { f.options.expectedMode = "absent"; }],
  ["changed command", (f: ReturnType<typeof fixture>) => { f.options.expectedCommandSha256 = "0".repeat(64); }],
  ["wrong profile", (f: ReturnType<typeof fixture>) => { f.options.profile = "other"; }],
  ["unsafe mode", (f: ReturnType<typeof fixture>) => { fs.chmodSync(f.settings, 0o644); }],
  ["unowned package", (f: ReturnType<typeof fixture>) => { fs.writeFileSync(join(f.root, "pkg", "package.json"), '{"name":"other","bin":{"skills":"bin/index.js"}}'); }],
] as const) {
  test(`${label} refuses before a settings mutation`, () => {
    const f = fixture(); mutate(f);
    expect(() => disableClaudeHooks({ ...f.options, apply: true, preimageDir: f.preservation })).toThrow();
    expect(fs.readFileSync(f.settings, "utf8")).toBe(f.before); expect(fs.existsSync(f.preservation)).toBe(false);
  });
}

for (const text of ['{"hooks":{},"hooks":{}}', '{"hooks":{"SessionStart":[],"Session\\u0053tart":[]}}', '{"other":{"key":1,"key":2}}']) {
  test("duplicate decoded JSON keys refuse without normalization or mutation", () => {
    const f = fixture(); f.write(text);
    expect(() => disableClaudeHooks({ ...f.options, apply: true, preimageDir: f.preservation })).toThrow("duplicate");
    expect(fs.readFileSync(f.settings, "utf8")).toBe(text); expect(fs.existsSync(f.preservation)).toBe(false);
  });
}

for (const delta of [' --extra', ' && echo unexpected']) {
  test("a near-match command is refused, never removed by a substring matcher", () => {
    const f = fixture(), value = JSON.parse(f.before); value.hooks.SessionStart[1].hooks[0].command += delta; f.write(JSON.stringify(value));
    expect(() => disableClaudeHooks({ ...f.options, apply: true, preimageDir: f.preservation })).toThrow("REGISTRATION_AMBIGUOUS");
    expect(fs.readFileSync(f.settings, "utf8")).toBe(JSON.stringify(value));
  });
}

test("target aliases and hardlinks are refused", () => {
  const f = fixture(), link = join(f.root, "settings.json"); fs.symlinkSync(f.settings, link);
  expect(() => disableClaudeHooks({ ...f.options, settings: link })).toThrow();
  const hard = join(f.root, "second.json"); fs.linkSync(f.settings, hard);
  expect(() => disableClaudeHooks(f.options)).toThrow();
  expect(fs.readFileSync(f.settings, "utf8")).toBe(f.before);
});

test("a pre-existing preservation destination refuses without overwriting it", () => {
  const f = fixture(); fs.mkdirSync(f.preservation, { mode: 0o700 }); fs.writeFileSync(join(f.preservation, "held"), "keep");
  expect(() => disableClaudeHooks({ ...f.options, apply: true, preimageDir: f.preservation })).toThrow();
  expect(fs.readFileSync(f.settings, "utf8")).toBe(f.before); expect(fs.readFileSync(join(f.preservation, "held"), "utf8")).toBe("keep");
});

test("preimage readback failure stops before target exchange", () => {
  const f = fixture(), write = fs.writeFileSync;
  const spy = spyOn(fs, "writeFileSync").mockImplementation(((path: unknown, ...args: unknown[]) => {
    const result = (write as (...args: unknown[]) => unknown)(path, ...args);
    // save writes through its descriptor, so inspect only this operation's preimage after the write.
    const preimage = join(f.preservation, "settings.preimage.json");
    if (fs.existsSync(preimage)) write(preimage, "changed preservation");
    return result;
  }) as typeof fs.writeFileSync);
  try { expect(() => disableClaudeHooks({ ...f.options, apply: true, preimageDir: f.preservation })).toThrow("PRESERVATION_FAILED"); }
  finally { spy.mockRestore(); }
  expect(fs.readFileSync(f.settings, "utf8")).toBe(f.before);
});

test("a pre-exchange target race refuses without replacing the concurrent bytes", () => {
  const f = fixture(), sync = fs.fsyncSync; let injected = false;
  const spy = spyOn(fs, "fsyncSync").mockImplementation((fd) => {
    sync(fd);
    if (!injected && fs.existsSync(join(f.preservation, "settings.preimage.json"))) { injected = true; fs.writeFileSync(f.settings, "concurrent target"); }
  });
  try { expect(() => disableClaudeHooks({ ...f.options, apply: true, preimageDir: f.preservation })).toThrow(); }
  finally { spy.mockRestore(); }
  expect(injected).toBe(true); expect(fs.readFileSync(f.settings, "utf8")).toBe("concurrent target");
  expect(fs.readFileSync(join(f.preservation, "settings.preimage.json"), "utf8")).toBe(f.before);
});

for (const [stageRead, timing] of [[5, "before"], [6, "after"]] as const) {
test(`${timing === "before" ? "A before" : "An after"}-exchange race retains recovery bytes and explicitly reports mutation ambiguity`, () => {
  const f = fixture(), lstat = fs.lstatSync; let stageReads = 0, injected = false;
  const spy = spyOn(fs, "lstatSync").mockImplementation(((path: fs.PathLike, ...args: unknown[]) => {
    const result = (lstat as (...args: unknown[]) => unknown)(path, ...args);
    if (typeof path === "string" && path.startsWith(join(f.native, ".settings.skills-disable-")) && ++stageReads === stageRead) {
      injected = true;
      const raced = join(f.native, "concurrent.json"); fs.writeFileSync(raced, "concurrent replacement", { mode: 0o600 }); fs.renameSync(raced, f.settings);
    }
    return result;
  }) as typeof fs.lstatSync);
  let result;
  try { result = disableClaudeHooks({ ...f.options, apply: true, preimageDir: f.preservation }); }
  finally { spy.mockRestore(); }
  expect(injected).toBe(true); expect(result).toMatchObject({ state: "ambiguous", mutationOccurred: true, reason: "POST_EXCHANGE_VERIFICATION_FAILED" });
  expect(fs.readFileSync(result.preimage!, "utf8")).toBe(f.before);
  expect(result.afterSha256).toBeNull();
  expect(fs.readFileSync(result.displaced!, "utf8")).toBe(timing === "before" ? "concurrent replacement" : f.before);
  if (timing === "before") expect(sha(fs.readFileSync(f.settings, "utf8"))).toBe(result.plannedAfterSha256!);
  else expect(fs.readFileSync(f.settings, "utf8")).toBe("concurrent replacement");
});
}

test("normal CLI previews exact targets and does not expose private settings", async () => {
  const f = fixture(), cli = resolve(import.meta.dir, "../cli/index.tsx");
  const command = [process.execPath, "--no-install", "--no-env-file", "--no-macros", "--config=/dev/null", cli, "hook", "disable-claude-context", "--settings", f.settings,
    "--expected-settings-sha256", f.options.expectedSettingsSha256, "--expected-mode", "0600", "--skills-command", f.command,
    "--expected-command-sha256", f.options.expectedCommandSha256, "--selection-profile", "default", "--json"];
  const child = Bun.spawnSync(command, { cwd: f.root, env: { ...process.env, HOME: f.root, SKILLS_API_URL: "http://127.0.0.1:9", HASNA_SKILLS_API_URL: "http://127.0.0.1:9" }, stdout: "pipe", stderr: "pipe" });
  expect(child.stderr.toString()).toBe(""); expect(child.exitCode).toBe(0);
  expect(JSON.parse(child.stdout.toString())).toMatchObject({ state: "preview", mutationOccurred: false });
  expect(child.stdout.toString()).not.toContain("private text");
  expect(child.stdout.toString()).not.toContain("native-denial");
  expect(fs.readFileSync(f.settings, "utf8")).toBe(f.before);
});

test("a built CLI previews and applies without credentials, hosted requests or startup state writes", async () => {
  const f = fixture(), cli = resolve(import.meta.dir, "../cli/index.tsx"), artifactRoot = join(f.root, "artifact"), home = join(f.root, "clean-home");
  fs.mkdirSync(home, { mode: 0o700 });
  const build = await Bun.build({ entrypoints: [cli], outdir: join(artifactRoot, "bin"), target: "bun", external: ["@hasna/contracts/kernel-lock"] });
  expect(build.success).toBe(true);
  const builtCli = join(artifactRoot, "bin", "index.js"), artifactSha256 = sha(fs.readFileSync(builtCli, "utf8"));
  fs.symlinkSync(resolve(import.meta.dir, "../../node_modules"), join(artifactRoot, "node_modules"));
  const guard = join(f.root, "fetch-guard.ts"), requests = join(f.root, "requests"), control = join(f.root, "positive-control");
  fs.writeFileSync(guard, 'import {appendFileSync} from "node:fs"; const original = globalThis.fetch; globalThis.fetch = ((input: string | Request | URL, init?: RequestInit) => { const url = input instanceof Request ? input.url : String(input); if (new URL(url).protocol === "data:") return original(input, init); appendFileSync(process.env.REQUEST_PROBE_PATH!, "attempted\\n"); throw new Error("HOSTED_REQUEST_ATTEMPTED"); }) as typeof fetch;\n', { mode: 0o600 });
  const environment = { HOME: home, TMPDIR: tmpdir(), PATH: process.env.PATH!, SKILLS_API_URL: "http://127.0.0.1:9", HASNA_SKILLS_API_URL: "http://127.0.0.1:9", BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0" };
  const flags = ["--no-install", "--no-env-file", "--no-macros", "--config=/dev/null", "--preload", guard];
  const positive = Bun.spawnSync([process.execPath, ...flags, "-e", 'await fetch("http://127.0.0.1:9")'], {
    cwd: f.root, env: { ...environment, REQUEST_PROBE_PATH: control }, stdout: "pipe", stderr: "pipe",
  });
  expect(positive.exitCode).not.toBe(0); expect(fs.readFileSync(control, "utf8")).toBe("attempted\n");
  const command = [process.execPath, ...flags, builtCli, "hook", "disable-claude-context", "--settings", f.settings,
    "--expected-settings-sha256", f.options.expectedSettingsSha256, "--expected-mode", "0600", "--skills-command", f.command,
    "--expected-command-sha256", f.options.expectedCommandSha256, "--selection-profile", "default", "--json"];
  for (const apply of [false, true]) {
    const child = Bun.spawnSync([...command, ...(apply ? ["--apply", "--preimage-dir", f.preservation] : [])], {
      cwd: f.root, env: { ...environment, REQUEST_PROBE_PATH: requests }, stdout: "pipe", stderr: "pipe",
    });
    expect(child.stderr.toString()).toBe(""); expect(child.exitCode).toBe(0);
    expect(JSON.parse(child.stdout.toString())).toMatchObject({ state: apply ? "applied" : "preview", mutationOccurred: apply });
    expect(fs.existsSync(requests)).toBe(false);
    expect(fs.readdirSync(home)).toEqual([]);
    expect(child.stdout.toString()).not.toContain("private text");
    expect(sha(fs.readFileSync(builtCli, "utf8"))).toBe(artifactSha256);
  }
});


test("only a Boolean apply authorizes mutation", () => {
  const f = fixture();
  expect(() => disableClaudeHooks({ ...f.options, apply: "false" as never, preimageDir: f.preservation })).toThrow("APPLY_INVALID");
  expect(fs.readFileSync(f.settings, "utf8")).toBe(f.before);
  expect(fs.existsSync(f.preservation)).toBe(false);
});

test("a concurrent package operation holds the real owning lock and refuses before preservation or target change", () => {
  const f = fixture(), lock = new KernelLock(f.native, "skills-claude-hook-disable", { mode: "exclusive" });
  try {
    expect(lock.trySync(1000)).toBe(true);
    expect(() => disableClaudeHooks({ ...f.options, apply: true, preimageDir: f.preservation })).toThrow("LOCK_BUSY");
    expect(fs.readFileSync(f.settings, "utf8")).toBe(f.before);
    expect(fs.existsSync(f.preservation)).toBe(false);
  } finally { lock.close(); }
});
