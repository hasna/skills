import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { isManagedSumiPlugin, renderSumiPlugin } from "./agent-sumi.js";
import { packSkillBundle } from "./skill-bundle.js";
import { buildCliFixture } from "../cli/cli-build.fixture.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

async function fixture() {
  const root = mkdtempSync(join(tmpdir(), "skills-sumi-context-")); roots.push(root);
  const log = join(root, "calls.jsonl"), mode = join(root, "mode"), cache = join(root, "cache");
  writeFileSync(mode, "normal");
  writeFileSync(join(root, "SKILL.md"), "---\nname: owner-fixture\ndescription: Synthetic owner prompt fixture\nkind: instruction\n---\nExact owner-selected instructions.\n");
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "owner-fixture", version: "1.0.0", skills: { kind: "instruction" } }));
  const bundle = packSkillBundle(root), archive = join(root, "bundle.tar.gz"); writeFileSync(archive, bundle.bytes);
  const command = join(root, "fixture-skills"), pluginPath = join(root, "plugin.js");
  // Real input parsing, selection matching, bundle verification and persisted
  // session restoration; only the hosted profile/bundle transport is synthetic.
  writeFileSync(command, `#!${process.execPath}
import { appendFileSync, readFileSync } from "node:fs";
import { buildSkillContext } from ${JSON.stringify(resolve(import.meta.dir, "skill-context.ts"))};
import { parseSkillContextInput } from ${JSON.stringify(resolve(import.meta.dir, "../cli/commands/context.ts"))};
import { HookDiagnosticError, hookFailureReason } from ${JSON.stringify(resolve(import.meta.dir, "hook-diagnostics.ts"))};
const raw = await Bun.stdin.text();
appendFileSync(${JSON.stringify(log)}, JSON.stringify({ bytes: Buffer.byteLength(raw), input: JSON.parse(raw) }) + "\\n");
const mode = readFileSync(${JSON.stringify(mode)}, "utf8");
if (mode === "foreign-refusal") { console.log(JSON.stringify({decision:"block",reason:"UNTRUSTED /private/path",stopReason:"UNTRUSTED",error:{code:"FOREIGN_CODE"}})); }
else if (mode === "native-refusal") { console.log(JSON.stringify({decision:"block",reason:"NATIVE_SKILL_DRIFT: synthetic test boundary"})); }
else if (mode === "malformed") { console.log("invalid"); }
else try {
  const input = parseSkillContextInput(raw);
  const authority = "https://skills.example.com/api/v1", workspaceId = "workspace-fixture", profileRevision = "revision-one";
  const profile = { authority, workspaceId, profileRevision, profileId:"engineering", selections:[{authority,workspaceId,profileRevision,slug:"owner-fixture",version:"1.0.0",bundleDigest:${JSON.stringify(`sha256:${bundle.sha256}`)},triggers:{keywords:["owner"]}}] };
  const client = { authority, resolveProfile:async()=>profile, getBundle:async()=>new Response(mode === "integrity-refusal" ? new Uint8Array([1,2,3]) : readFileSync(${JSON.stringify(archive)}), {headers:{"X-Skill-Bundle-Sha256":${JSON.stringify(bundle.sha256)},"X-Skill-Version":"1.0.0"}}), recordStation:async()=>{throw Error("No station writes")} };
  const result = await buildSkillContext({...input,profileId:"engineering"}, {client,cacheDir:${JSON.stringify(cache)}});
  console.log(JSON.stringify({hookSpecificOutput:{hookEventName:JSON.parse(raw).hook_event_name,additionalContext:result.context}}));
} catch (error) {
  console.log(JSON.stringify({decision:"block",reason:hookFailureReason(new HookDiagnosticError(error.code ?? "SKILLS_CONTEXT_FAILED","context"))}));
}
`); chmodSync(command, 0o700);
  writeFileSync(pluginPath, renderSumiPlugin(command, "engineering"));
  const plugin = (await import(pluginPath)).default;
  async function reload() {
    const hooks = new Map<string, (event: any) => Promise<void>>();
    await plugin.setup({
      session: { get: async ({ sessionID }: { sessionID: string }) => ({ id: sessionID, location: { directory: root } }), hook: async (name: string, callback: any) => { hooks.set(name, callback); return { dispose: async () => {} }; } },
      tool: { hook: async (name: string, callback: any) => { hooks.set(name, callback); return { dispose: async () => {} }; } },
      skill: { transform: async () => ({ dispose: async () => {} }) },
    });
    return hooks;
  }
  const hooks = await reload();
  const calls = () => readFileSync(log, "utf8").trim().split("\n").map(line => JSON.parse(line));
  const context = (sessionID: string, text: string) => ({ sessionID, system: [] as Array<{ type: string; text: string }>, messages: [{ role: "user", content: [{ type: "text", text }] }] });
  return { root, mode, hooks, calls, context, reload };
}

test("real owner prompt selects new Skills and oversized checkpoint restores them without altering native history", async () => {
  const f = await fixture();
  await f.hooks.get("prompt")!({ sessionID: "owner", prompt: { text: "$owner-fixture" } });
  const checkpoint = `<conversation-checkpoint>\n${"historical context ".repeat(90_000)}\n</conversation-checkpoint>`;
  const event = f.context("owner", checkpoint), messages = event.messages, before = JSON.stringify(messages);
  await f.hooks.get("context")!(event);
  expect(event.system[0]?.text).toContain("Exact owner-selected instructions.");
  expect(event.messages).toBe(messages); expect(JSON.stringify(messages)).toBe(before);
  expect(f.calls().map(call => call.input.prompt)).toEqual(["$owner-fixture", ""]);
  expect(f.calls().every(call => call.bytes < 256 * 1024)).toBe(true);
  // A newly activated plugin has no in-memory prompt history. It restores the
  // genuine receipt from the first invocation without consulting model messages.
  const resumed = f.context("owner", checkpoint), afterReload = await f.reload();
  await afterReload.get("context")!(resumed);
  expect(resumed.system[0]?.text).toContain("Exact owner-selected instructions.");
  expect(f.calls().at(-1)?.input).toMatchObject({ hook_event_name: "SessionStart", prompt: "", restore: true });
  expect(JSON.stringify(resumed.messages)).toBe(before);
});

test("resumed context never matches checkpoints or ordinary-looking historical user messages", async () => {
  const f = await fixture();
  for (const text of ["$owner-fixture", "<conversation-checkpoint>\n$owner-fixture\n</conversation-checkpoint>", "x".repeat(300_000)]) {
    const event = f.context(`resumed-${text.length}`, text), before = JSON.stringify(event.messages);
    await f.hooks.get("context")!(event);
    expect(event.system).toEqual([]); expect(JSON.stringify(event.messages)).toBe(before);
  }
  expect(f.calls().every(call => call.input.prompt === "" && call.input.restore === true)).toBe(true);
  await f.hooks.get("prompt")!({ sessionID: "ordinary", prompt: { text: "owner request" } });
  const event = f.context("ordinary", "under-limit checkpoint");
  await f.hooks.get("context")!(event);
  expect(event.system[0]?.text).toContain("Exact owner-selected instructions.");
});

test("real oversized owner input still refuses, retaining only a safe typed reason", async () => {
  const f = await fixture();
  for (const size of [129 * 1024, 300_000, 1_100_000]) {
    let error: any;
    try { await f.hooks.get("prompt")!({ sessionID: `large-${size}`, prompt: { text: "x".repeat(size) } }); } catch (value) { error = value; }
    expect(error?.name).toBe("SkillsHookRefusal");
    expect(error?.skillsHookRefusal).toEqual({ version: 1, code: "SKILLS_HOOK_REFUSED", reasonCode: "CONTEXT_INPUT_TOO_LARGE" });
    expect(JSON.stringify(error)).not.toContain("x".repeat(100));
  }
});

test("actual CLI raw-input guard still blocks oversized owner input before any native or API operation", async () => {
  const root = mkdtempSync(join(tmpdir(), "skills-sumi-raw-guard-")); roots.push(root);
  const entry = join(root, "entry.ts"), binary = join(root, "cli.js");
  writeFileSync(entry, `import { Command } from ${JSON.stringify(require.resolve("commander"))};\nimport { registerAgentIntegration } from ${JSON.stringify(resolve(import.meta.dir, "../cli/commands/agent-integration.ts"))};\nconst program = new Command(); registerAgentIntegration(program); await program.parseAsync(process.argv);\n`);
  await buildCliFixture(entry, binary);
  const child = Bun.spawn([process.execPath, "--no-env-file", binary, "hook", "user-prompt", "--agent", "sumi"], {
    cwd: root, env: { HOME: root, PATH: "/usr/bin:/bin", NO_COLOR: "1" },
    stdin: new Blob([JSON.stringify({ prompt: "x".repeat(1_100_000) })]), stdout: "pipe", stderr: "pipe",
  });
  const [stdout, stderr, status] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  expect(status).toBe(0); expect(stderr).toBe("");
  expect(JSON.parse(stdout)).toMatchObject({ decision: "block" });
  expect(stdout).toContain("[SKILLS_HOOK_FAILED]"); expect(stdout).not.toContain("x".repeat(100));
});

test("context restoration keeps native and bundle integrity refusals blocking without leaking child diagnostics", async () => {
  const f = await fixture();
  for (const mode of ["native-refusal", "integrity-refusal", "foreign-refusal", "malformed"]) {
    writeFileSync(f.mode, "normal");
    await f.hooks.get("prompt")!({ sessionID: mode, prompt: { text: "$owner-fixture" } });
    writeFileSync(f.mode, mode);
    let error: any;
    try { await f.hooks.get("context")!(f.context(mode, "checkpoint")); } catch (value) { error = value; }
    expect(error?.name).toBe("SkillsHookRefusal");
    expect(error?.skillsHookRefusal?.code).toBe("SKILLS_HOOK_REFUSED");
    if (mode === "native-refusal") expect(error?.skillsHookRefusal?.reasonCode).toBe("NATIVE_SKILL_DRIFT");
    if (mode === "integrity-refusal") expect(error?.skillsHookRefusal?.reasonCode).toBe("BUNDLE_DIGEST_MISMATCH");
    expect(JSON.stringify(error)).not.toContain("UNTRUSTED"); expect(JSON.stringify(error)).not.toContain("FOREIGN_CODE");
    expect(error?.message).not.toContain("/private/"); expect(error?.cause).toBeUndefined();
  }
});

test("exact two shipped Sumi renderers remain recognized and modified bytes refuse", () => {
  for (const [name, digest] of [
    ["sumi-plugin-v1.js", "19e3798e4924ef9ef4004ace2addfc581d7fdd60172825cf1dbdc0a8e881de7c"],
    ["sumi-plugin-v2.js", "9d41d2e8312a379df3eb6af19e5b2deb709e1b1a63c04a69f40065a056b5a3f1"],
  ]) {
    const text = readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
    expect(createHash("sha256").update(text).digest("hex")).toBe(digest!);
    expect(isManagedSumiPlugin(text, "skills", "default")).toBe(true);
    expect(isManagedSumiPlugin(text + "\n", "skills", "default")).toBe(false);
    expect(isManagedSumiPlugin(text, "other-command", "default")).toBe(false);
    expect(isManagedSumiPlugin(text, "skills", "other-profile")).toBe(false);
  }
});
