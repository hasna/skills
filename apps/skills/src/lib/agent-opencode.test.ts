import { expect, test, setDefaultTimeout } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CLI_BRIDGE_FILES } from "./agent-bridge.js";
import { createHash } from "node:crypto";
import { isManagedOpenCodePlugin, renderLegacyOpenCodePlugin, renderOpenCodePlugin } from "./agent-adapters.js";

setDefaultTimeout(30_000);

// Source-bound v2.0.32 fixture, not a native OpenCode launch. Module acceptance
// mirrors packages/core/src/plugin/module.ts; hook event shapes come from
// packages/plugin/src/promise/{session,tool,skill,registration}.ts.
const acceptsV2 = (plugin: any) => plugin !== null && typeof plugin === "object"
  && typeof plugin.id === "string" && (typeof plugin.setup === "function" || typeof plugin.effect === "function");

async function fixture(failAt?: string, missingCommand = false) {
  const root = mkdtempSync(join(tmpdir(), "skills-opencode-v2-"));
  const log = join(root, "calls"), mode = join(root, "mode"), state = join(root, "state");
  writeFileSync(mode, "normal");
  const command = join(root, "fixture-skills"), pluginPath = join(root, "plugin.js");
  writeFileSync(command, `#!${process.execPath} --no-install
import { appendFileSync, readFileSync, writeFileSync, existsSync } from "node:fs";
const input = JSON.parse(await Bun.stdin.text());
appendFileSync(${JSON.stringify(log)}, JSON.stringify({ input, args: process.argv.slice(2) }) + "\\n");
const mode = readFileSync(${JSON.stringify(mode)}, "utf8");
if (mode === "hang") await new Promise(() => { setInterval(() => {}, 1000); });
if (mode === "delay" || mode === "delay-exit") await Bun.sleep(150);
if (mode === "exit" || mode === "delay-exit") { console.error("UNTRUSTED /private/path"); process.exit(1); }
if (mode === "malformed") { console.log("bad-json"); process.exit(0); }
if (mode === "large") { console.log("x".repeat(1048577)); process.exit(0); }
if (["null","array","empty","unexpected"].includes(mode)) { console.log(JSON.stringify(mode === "null" ? null : mode === "array" ? [] : mode === "empty" ? {} : { context:"UNTRUSTED /private/path" })); process.exit(0); }
if (mode === "block" || mode === "continue-false") { console.log(JSON.stringify({ decision:mode === "block" ? "block" : undefined, continue:false, reason:"UNTRUSTED /private/path" })); process.exit(0); }
const selections = existsSync(${JSON.stringify(state)}) ? JSON.parse(readFileSync(${JSON.stringify(state)}, "utf8")) : {};
if (input.prompt === "$owner-fixture") selections[input.session_id] = "Verified synthetic selection";
writeFileSync(${JSON.stringify(state)}, JSON.stringify(selections));
console.log(JSON.stringify({nativeBridgeVerified: input.hook_event_name === "BeforeTool" && mode !== "bridge-warning",hookSpecificOutput:{hookEventName:mode === "wrong-event" ? "Wrong" : input.hook_event_name,additionalContext:mode === "wrong-context" ? 12 : selections[input.session_id] ?? ""}}));
`);
  chmodSync(command, 0o700);
  writeFileSync(pluginPath, renderOpenCodePlugin(missingCommand ? command + "-missing" : command, "engineering"));
  const plugin = (await import(pluginPath)).default;
  const hooks = new Map<string, any>(), disposed: string[] = [], removed: string[] = [];
  const register = async (name: string, callback: any) => {
    if (name === failAt) throw Error("Synthetic registration failure");
    hooks.set(name, callback);
    return { dispose: async () => { disposed.push(name); hooks.delete(name); } };
  };
  const nativeSkill = { id: "skills-cli", name: "skills-cli", path: join(root, "bridge", "SKILL.md"), content: CLI_BRIDGE_FILES["SKILL.md"]!.replace(/^---\n[\s\S]*?\n---\n/, ""), description: /^description: (.+)$/m.exec(CLI_BRIDGE_FILES["SKILL.md"]!)![1] };
  const ctx = {
    session: { get: async ({ sessionID }: any) => ({ id: sessionID, location: { directory: root }, ...(sessionID === "child" ? { parentID: "parent" } : {}) }), hook: register },
    tool: { hook: register },
    skill: { list: async () => [nativeSkill], transform: async (callback: any) => {
      callback({ list: () => [nativeSkill, {id:"foreign", name:"foreign"}, {id:"impostor", name:"skills-cli"}], remove: (id: string) => removed.push(id) });
      return register("skills", callback);
    } },
  };
  const calls = () => readFileSync(log, "utf8").trim().split("\n").map(line => JSON.parse(line));
  return { root, log, mode, command, plugin, hooks, disposed, removed, ctx, calls, nativeSkill };
}

test("v2 module contract rejects shipped v1 factory and admits the replacement", async () => {
  const f = await fixture();
  const legacy = join(f.root, "legacy.js"); writeFileSync(legacy, renderLegacyOpenCodePlugin(f.command, "engineering"));
  expect(acceptsV2((await import(legacy)).default)).toBe(false);
  expect(acceptsV2(f.plugin)).toBe(true);
});

test("prompt admission and restored system context use native custody without modifying history", async () => {
  const f = await fixture(), dispose = await f.plugin.setup(f.ctx);
  expect(f.removed).toEqual(["foreign", "impostor"]);
  await f.hooks.get("prompt")({ sessionID:"owner", prompt:{text:"$owner-fixture"} });
  const messages = [{role:"user", content:[{type:"text",text:"$foreign-history"}]}];
  const event = {sessionID:"owner", system:[] as Array<{type:string;text:string}>, messages};
  await f.hooks.get("context")(event);
  expect(event.system).toEqual([{type:"text",text:"Verified synthetic selection"}]);
  expect(event.messages).toBe(messages);
  expect(messages[0]!.content[0]!.text).toBe("$foreign-history");
  expect(f.calls().map(call => call.input.prompt)).toEqual(["$owner-fixture"]);
  expect(f.calls()[0].args).toEqual(["hook","user-prompt","--agent","opencode","--selection-profile","engineering"]);
  const historyOnly = {sessionID:"history-only",system:[] as Array<{type:string;text:string}>,messages:[{role:"user",content:[{type:"text",text:"$owner-fixture"}]}]};
  await f.hooks.get("context")(historyOnly);
  expect(historyOnly.system).toEqual([]);
  await f.hooks.get("prompt")({sessionID:"child",prompt:{text:"child prompt"}});
  await f.hooks.get("context")({sessionID:"child",system:[] as Array<{type:string;text:string}>,messages:[]});
  expect(f.calls().at(-1).input).toMatchObject({hook_event_name:"SubagentStart",parent_session_id:"parent",cwd:f.root});
  await dispose();
  const again = await f.plugin.setup(f.ctx), resumed = {sessionID:"owner",system:[] as Array<{type:string;text:string}>,messages};
  await f.hooks.get("context")(resumed);
  expect(resumed.system).toEqual(event.system);
  expect(f.calls().at(-1).input).toMatchObject({hook_event_name:"SessionStart",prompt:"",restore:true});
  await again();
});

test("native tool and prompt attachment guards refuse foreign payloads", async () => {
  const f = await fixture(), dispose = await f.plugin.setup(f.ctx);
  await expect(f.hooks.get("execute.before")({tool:"skill",input:{id:"foreign"}})).rejects.toThrow("Skills verification blocked");
  await expect(f.hooks.get("execute.before")({tool:"skill",input:{name:"skills-cli"}})).rejects.toThrow();
  await f.hooks.get("execute.before")({sessionID:"owner",tool:"skill",input:{id:"skills-cli"}});
  await f.hooks.get("execute.before")({tool:"shell",input:{}});
  await expect(f.hooks.get("prompt")({sessionID:"owner",prompt:{text:"x",skills:[{id:"foreign"}]}})).rejects.toThrow();
  writeFileSync(f.mode, "bridge-warning");
  await expect(f.hooks.get("execute.before")({sessionID:"owner",tool:"skill",input:{id:"skills-cli"}})).rejects.toThrow();
  await expect(f.hooks.get("prompt")({sessionID:"owner",prompt:{text:"",skills:[{id:"skills-cli"}]}})).rejects.toThrow();
  await f.hooks.get("prompt")({sessionID:"ordinary",prompt:{text:"ordinary prompt"}});
  const warning = {sessionID:"ordinary",system:[] as Array<{type:string;text:string}>,messages:[]};
  await f.hooks.get("context")(warning);
  await dispose();
});

test("session custody failures stop before running the child", async () => {
  const f = await fixture(), dispose = await f.plugin.setup(f.ctx);
  for (const session of [{id:"other",location:{directory:f.root}}, {id:"owner"}, {id:"owner",location:{directory:f.root},parentID:"owner"}]) {
    f.ctx.session.get = async () => session as any;
    await expect(f.hooks.get("context")({sessionID:"owner",system:[] as Array<{type:string;text:string}>,messages:[]})).rejects.toThrow();
  }
  expect(() => f.calls()).toThrow();
  await dispose();
});

test("explicit policy refusals block without exposing child output", async () => {
  const f = await fixture(), dispose = await f.plugin.setup(f.ctx);
  for (const mode of ["block","continue-false"]) {
    writeFileSync(f.mode, mode);
    const event = {sessionID:mode,system:[] as Array<{type:string;text:string}>,messages:[]};
    let error: any;
    try { await f.hooks.get("context")(event); } catch (value) { error = value; }
    expect(error?.name).toBe("SkillsHookRefusal");
    expect(error?.message).not.toContain("UNTRUSTED");
    expect(error?.message).not.toContain("/private/path");
    expect(event.system).toEqual([]);
  }
  await dispose();
});

test("optional context transport and response failures continue ordinary work with fixed diagnostics", async () => {
  const f = await fixture(), dispose = await f.plugin.setup(f.ctx);
  for (const mode of ["exit","malformed","wrong-event","wrong-context","large","null","array","unexpected","hang"]) {
    writeFileSync(f.mode, mode);
    await f.hooks.get("prompt")({sessionID:mode,prompt:{text:"genuine admitted prompt"}});
    const event = {sessionID:mode,system:[] as Array<{type:string;text:string}>,messages:[{role:"user",content:"$owner-fixture"}]};
    await f.hooks.get("context")(event);
    expect(event.system).toHaveLength(1);
    expect(event.system[0]!.text).toContain("Skills context is unavailable [SKILLS_HOOK_");
    expect(event.system[0]!.text).toContain("Ordinary work may continue.");
    expect(event.system[0]!.text).not.toContain("UNTRUSTED");
    expect(event.system[0]!.text).not.toContain("/private/path");
    expect(event.system[0]!.text).not.toContain(f.root);
    expect(event.system[0]!.text.length).toBeLessThan(600);
    expect(f.calls().at(-1).input.prompt).toBe("genuine admitted prompt");
    writeFileSync(f.mode,"normal");
    const retry={sessionID:mode,system:[] as Array<{type:string;text:string}>,messages:event.messages};
    await f.hooks.get("context")(retry);
    expect(retry.system).toEqual([]);
    expect(f.calls().at(-1).input).toMatchObject({hook_event_name:"SessionStart",prompt:""});
  }
  // The owning hookContextOutput also returns exactly {} for valid empty
  // delivery. Preserve that protocol alongside matched-event empty strings.
  for(const mode of ["empty","normal"]) {
    writeFileSync(f.mode,mode);
    await f.hooks.get("prompt")({sessionID:mode,prompt:{text:"admitted empty context"}});
    const event={sessionID:mode,system:[] as Array<{type:string;text:string}>,messages:[]};
    await f.hooks.get("context")(event); await f.hooks.get("context")(event);
    expect(event.system).toEqual([]);
    expect(f.calls().at(-1).input).toMatchObject({hook_event_name:"UserPromptSubmit",prompt:""});
  }
  await dispose();
  const missing=await fixture(undefined,true), stop=await missing.plugin.setup(missing.ctx);
  await missing.hooks.get("prompt")({sessionID:"owner",prompt:{text:"ordinary prompt"}});
  const event={sessionID:"owner",system:[] as Array<{type:string;text:string}>,messages:[]};
  await missing.hooks.get("context")(event);
  expect(event.system[0]!.text).toContain("[SKILLS_HOOK_SPAWN_FAILED]");
  expect(event.system[0]!.text).not.toContain(missing.root);
  await stop();
});

test("native tool and attachment verification fail closed on every unavailable child", async () => {
  const f=await fixture(),dispose=await f.plugin.setup(f.ctx);
  for(const mode of ["exit","malformed","wrong-event","wrong-context","large","null","array","empty","unexpected"]) {
    writeFileSync(f.mode,mode);
    await expect(f.hooks.get("execute.before")({sessionID:"owner",tool:"skill",input:{id:"skills-cli"}})).rejects.toThrow("Skills verification blocked");
    await expect(f.hooks.get("prompt")({sessionID:"owner",prompt:{text:"",skills:[{id:"skills-cli"}]}})).rejects.toThrow("Skills verification blocked");
  }
  writeFileSync(f.mode,"hang");
  const expectRefusal=(pending:Promise<unknown>)=>pending.then(() => { throw Error("Unexpected native acceptance"); }, (error:Error) => {
    expect(error.message).toContain("Skills verification blocked");
  });
  await Promise.all([
    expectRefusal(f.hooks.get("execute.before")({sessionID:"owner",tool:"skill",input:{id:"skills-cli"}})),
    expectRefusal(f.hooks.get("prompt")({sessionID:"owner",prompt:{text:"",skills:[{id:"skills-cli"}]}})),
  ]);
  await dispose();
  const missing=await fixture(undefined,true),stop=await missing.plugin.setup(missing.ctx);
  await expect(missing.hooks.get("execute.before")({sessionID:"owner",tool:"skill",input:{id:"skills-cli"}})).rejects.toThrow("Skills verification blocked");
  await expect(missing.hooks.get("prompt")({sessionID:"owner",prompt:{text:"",skills:[{id:"skills-cli"}]}})).rejects.toThrow("Skills verification blocked");
  await stop();
});

test("setup failure cleans prior registrations and disposal cancels pending hook children", async () => {
  const failed = await fixture("context");
  await expect(failed.plugin.setup(failed.ctx)).rejects.toThrow();
  expect(failed.disposed).toEqual(["prompt","execute.before","skills"]);
  const f = await fixture(), dispose = await f.plugin.setup(f.ctx);
  writeFileSync(f.mode,"hang");
  const callback = f.hooks.get("context"), event = {sessionID:"owner",system:[] as Array<{type:string;text:string}>,messages:[]};
  const pending = callback(event);
  // Attach the rejection handler without Bun's synchronous rejects matcher,
  // which waits for the 15-second timeout before disposal can run.
  const rejected = pending.then(() => { throw Error("Unexpected acceptance"); }, (error: Error) => {
    expect(error.message).toContain("Skills verification blocked");
  });
  for (let i = 0; i < 100; i++) { try { if (f.calls().length) break; } catch {} await Bun.sleep(5); }
  expect(f.calls()).toHaveLength(1);
  const start = Date.now();
  await dispose(); await rejected;
  expect(Date.now() - start).toBeLessThan(2000);
  expect(f.hooks.size).toBe(0);
  expect(event.system).toEqual([]);
  await expect(callback(event)).rejects.toThrow();
  await dispose();
  expect(f.disposed).toEqual(["context","prompt","execute.before","skills"]);
});

test("managed recognition accepts exact shipped bytes and rejects drift or a different binding", () => {
  const shipped = readFileSync(new URL("./fixtures/opencode-plugin-v1.js", import.meta.url), "utf8");
  expect(createHash("sha256").update(shipped).digest("hex")).toBe("5068eed8a097809bdb6ce73fb2bbfbc49f45a01164f4f2be6b9c9d03c0d2cbc4");
  expect(isManagedOpenCodePlugin(shipped, "skills", "default")).toBe(true);
  expect(shipped).toBe(renderLegacyOpenCodePlugin("skills", "default"));
  for (const renderer of [renderLegacyOpenCodePlugin, renderOpenCodePlugin]) {
    const text = renderer("skills", "engineering");
    expect(isManagedOpenCodePlugin(text,"skills","engineering")).toBe(true);
    expect(isManagedOpenCodePlugin(text + "\n","skills","engineering")).toBe(false);
    expect(isManagedOpenCodePlugin(text,"other","engineering")).toBe(false);
    expect(isManagedOpenCodePlugin(text,"skills","other")).toBe(false);
  }
});

test("same-session queued admissions include separators and preserve input arriving during context", async () => {
  const f = await fixture(), dispose = await f.plugin.setup(f.ctx);
  const prompt = (text: string) => f.hooks.get("prompt")({sessionID:"owner",prompt:{text}});
  const context = () => f.hooks.get("context")({sessionID:"owner",system:[] as Array<{type:string;text:string}>,messages:[]});
  await prompt("first"); await prompt("second");
  await context();
  expect(f.calls().at(-1).input.prompt).toBe("first\nsecond");
  writeFileSync(f.mode,"delay");
  await prompt("before pending context");
  const pending = context();
  for (let i=0;i<100;i++) { if(f.calls().length===2) break; await Bun.sleep(5); }
  expect(f.calls()).toHaveLength(2);
  await prompt("arrived during context");
  await pending;
  writeFileSync(f.mode,"normal");
  await context();
  expect(f.calls().at(-1).input.prompt).toBe("arrived during context");
  // One text and its separator fill the character limit exactly. Another
  // separator would exceed the same character limit the CLI applies.
  await prompt("x".repeat(128*1024-1)); await prompt("");
  await expect(prompt("")).rejects.toThrow();
  await dispose();
});

test("unavailable context consumes only captured admissions and retains newly arriving input", async () => {
  const f=await fixture(),dispose=await f.plugin.setup(f.ctx);
  const prompt=(text:string)=>f.hooks.get("prompt")({sessionID:"owner",prompt:{text}});
  const context=()=>f.hooks.get("context")({sessionID:"owner",system:[] as Array<{type:string;text:string}>,messages:[]});
  await prompt("captured before failure"); writeFileSync(f.mode,"delay-exit");
  const pending=context();
  for(let i=0;i<100;i++) { try { if(f.calls().length===1) break; } catch {} await Bun.sleep(5); }
  expect(f.calls()).toHaveLength(1);
  await prompt("arrived during failure"); await pending;
  writeFileSync(f.mode,"normal"); await context();
  expect(f.calls().at(-1).input).toMatchObject({hook_event_name:"SessionStart",prompt:"arrived during failure"});
  await context();
  expect(f.calls().at(-1).input).toMatchObject({hook_event_name:"UserPromptSubmit",prompt:""});
  await dispose();
});
