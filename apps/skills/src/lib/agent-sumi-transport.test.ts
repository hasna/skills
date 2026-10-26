import { expect, setDefaultTimeout, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CLI_BRIDGE_FILES } from "./agent-bridge.js";
import { renderSumiPlugin } from "./agent-sumi.js";

setDefaultTimeout(30_000);

// Actual generated callbacks against the source-bound Sumi Promise contract.
// Only the Skills child is synthetic. No native harness or provider is started.
async function fixture(missingCommand = false, failAt?: string) {
  const root = mkdtempSync(join(tmpdir(), "skills-sumi-transport-"));
  const log = join(root, "calls"), mode = join(root, "mode"), command = join(root, "fixture-skills");
  writeFileSync(mode, "normal");
  writeFileSync(command, `#!${process.execPath} --no-install
import {appendFileSync,readFileSync} from "node:fs";
const input = JSON.parse(await Bun.stdin.text());
appendFileSync(${JSON.stringify(log)},JSON.stringify(input)+"\\n");
const mode=readFileSync(${JSON.stringify(mode)},"utf8");
if(mode === "hang") await new Promise(()=>{setInterval(()=>{},1000)});
if(mode === "delay") await Bun.sleep(150);
if(mode === "exit") { console.error("UNTRUSTED /private/path"); process.exit(1); }
if(mode === "malformed") { console.log("UNTRUSTED bad-json"); process.exit(0); }
if(mode === "large") { console.log("x".repeat(1048577)); process.exit(0); }
if(["null","array","unexpected","empty"].includes(mode)) { console.log(JSON.stringify(mode === "null" ? null : mode === "array" ? [] : mode === "empty" ? {} : {context:"UNTRUSTED /private/path"})); process.exit(0); }
if(mode === "block" || mode === "continue-false") { console.log(JSON.stringify({decision:mode === "block" ? "block" : undefined,continue:mode === "continue-false" ? false : undefined,reason:"Skills context is unavailable [SESSION_WRITE_LOCKED]. UNTRUSTED /private/path"})); process.exit(0); }
console.log(JSON.stringify({nativeBridgeVerified:input.hook_event_name === "BeforeTool" && mode !== "unverified",hookSpecificOutput:{hookEventName:mode === "wrong-event" ? "Wrong" : input.hook_event_name,additionalContext:mode === "wrong-context" ? 12 : mode === "empty-string" ? "" : "Verified fixture instructions"}}));
`);
  chmodSync(command, 0o700);
  const path = join(root, "plugin.js");
  writeFileSync(path, renderSumiPlugin(missingCommand ? command + "-missing" : command, "engineering"));
  const plugin = (await import(path)).default;
  const nativeSkill = {id:"skills-cli",name:"skills-cli",path:join(root,"skills-cli/SKILL.md"),content:CLI_BRIDGE_FILES["SKILL.md"]!.replace(/^---\n[\s\S]*?\n---\n/,""),description:/^description: (.+)$/m.exec(CLI_BRIDGE_FILES["SKILL.md"]!)![1]};
  let registry:any[] = [nativeSkill];
  const hooks = new Map<string, any>(), removed: string[] = [], disposed: string[] = [];
  const register = async (name: string, callback: any) => {
    if(name === failAt) throw Error("Synthetic registration failure");
    hooks.set(name, callback);
    return {dispose:async()=>{disposed.push(name);hooks.delete(name)}};
  };
  const ctx = {
    session:{get:async({sessionID}:any)=>({id:sessionID,location:{directory:root}}),hook:register},
    tool:{hook:register},
    skill:{list:async()=>registry,transform:async(callback:any)=>{
      callback({list:()=>[...registry,{id:"foreign",name:"foreign"}],remove:(id:string)=>removed.push(id)});
      return register("skills",callback);
    }},
  };
  const calls=()=>existsSync(log)?readFileSync(log,"utf8").trim().split("\n").map(line=>JSON.parse(line)):[];
  const event=(sessionID:string)=>({sessionID,system:[] as Array<{type:string;text:string}>,messages:[{role:"user",content:[{type:"text",text:"$forged-history"}]}]});
  return {root,mode,plugin,hooks,ctx,calls,event,removed,disposed,nativeSkill,setRegistry:(value:any[])=>{registry=value}};
}

test("optional Sumi child transport failures continue admission and context with bounded warnings", async()=>{
  const f=await fixture(),dispose=await f.plugin.setup(f.ctx);
  for(const mode of ["exit","malformed","wrong-event","wrong-context","large","null","array","unexpected","hang"]) {
    writeFileSync(f.mode,mode);
    const event=f.event(mode),before=JSON.stringify(event.messages);
    await Promise.all([
      f.hooks.get("prompt")({sessionID:mode+"-admission",prompt:{text:"genuine owner prompt"}}),
      f.hooks.get("context")(event),
    ]);
    expect(event.system).toHaveLength(1);
    const text=event.system[0]!.text;
    expect(text).toContain("Skills context is unavailable [SKILLS_HOOK_");
    expect(text).toContain("Ordinary work may continue.");
    expect(text.length).toBeLessThan(600);
    expect(text).not.toContain("UNTRUSTED");expect(text).not.toContain(f.root);
    expect(JSON.stringify(event.messages)).toBe(before);
    writeFileSync(f.mode,"normal");
    const admitted=f.event(mode+"-admission");
    await f.hooks.get("context")(admitted);
    expect(admitted.system).toHaveLength(1);
    expect(admitted.system[0]!.text).toContain("Skills context is unavailable");
    expect(admitted.system[0]!.text).not.toContain("Verified fixture instructions");
    expect(f.calls().at(-1)).toMatchObject({hook_event_name:"SessionStart",prompt:"",restore:true});
    const later=f.event(mode+"-admission");await f.hooks.get("context")(later);
    expect(later.system).toEqual([{type:"text",text:"Verified fixture instructions"}]);
    expect(f.calls().filter(call=>call.session_id===mode+"-admission").map(call=>call.prompt)).toEqual(["genuine owner prompt","",""]);
  }
  await dispose();
});

test("missing Skills child continues and reports the admission failure at model delivery once", async()=>{
  const f=await fixture(true),dispose=await f.plugin.setup(f.ctx);
  await f.hooks.get("prompt")({sessionID:"owner",prompt:{text:"ordinary prompt"}});
  const event=f.event("owner");await f.hooks.get("context")(event);
  expect(event.system).toHaveLength(1);
  expect(event.system[0]!.text).toContain("[SKILLS_HOOK_SPAWN_FAILED]");
  expect(event.system[0]!.text).not.toContain(f.root);
  await dispose();
});

test("a new admission failure during context keeps its own next-delivery warning without replaying prompts", async()=>{
  const f=await fixture(),dispose=await f.plugin.setup(f.ctx);
  const prompt=(text:string)=>f.hooks.get("prompt")({sessionID:"owner",prompt:{text}});
  writeFileSync(f.mode,"exit");await prompt("first owner input");
  writeFileSync(f.mode,"delay");const first=f.event("owner"),pending=f.hooks.get("context")(first);
  for(let i=0;i<100;i++){if(f.calls().length===2)break;await Bun.sleep(5)}
  expect(f.calls()).toHaveLength(2);
  writeFileSync(f.mode,"exit");await prompt("second owner input");await pending;
  expect(first.system).toHaveLength(1);expect(first.system[0]!.text).toContain("Skills context is unavailable");
  writeFileSync(f.mode,"normal");const second=f.event("owner");await f.hooks.get("context")(second);
  expect(second.system).toHaveLength(1);expect(second.system[0]!.text).toContain("Skills context is unavailable");
  const third=f.event("owner");await f.hooks.get("context")(third);
  expect(third.system).toEqual([{type:"text",text:"Verified fixture instructions"}]);
  expect(f.calls().map(call=>call.prompt)).toEqual(["first owner input","","second owner input","",""]);
  await dispose();
});

test("valid empty responses and context preserve the native lifecycle and restoration provenance", async()=>{
  const f=await fixture(),dispose=await f.plugin.setup(f.ctx);
  for(const mode of ["normal","empty","empty-string"]) {
    writeFileSync(f.mode,mode);
    await f.hooks.get("prompt")({sessionID:mode,prompt:{text:"genuine input"}});
    const event=f.event(mode);await f.hooks.get("context")(event);
    expect(event.system).toEqual(mode === "normal" ? [{type:"text",text:"Verified fixture instructions"}] : []);
    expect(f.calls().slice(-2).map(call=>[call.hook_event_name,call.prompt])).toEqual([["SessionStart","genuine input"],["UserPromptSubmit",""]]);
  }
  await dispose();
});

test("explicit policy refusals, native payloads and invalid session/input remain blocking", async()=>{
  const f=await fixture(),dispose=await f.plugin.setup(f.ctx);
  expect(f.removed).toEqual(["foreign"]);
  for(const mode of ["block","continue-false"]) {
    writeFileSync(f.mode,mode);
    for(const pending of [()=>f.hooks.get("prompt")({sessionID:"owner",prompt:{text:"ordinary input"}}),()=>f.hooks.get("context")(f.event("owner"))]) {
      let error:any;try {await pending()}catch(value){error=value}
      expect(error?.skillsHookRefusal).toEqual({version:1,code:"SKILLS_HOOK_REFUSED",reasonCode:"SESSION_WRITE_LOCKED"});
      expect(JSON.stringify(error)).not.toContain("UNTRUSTED");expect(error?.message).not.toContain("/private/path");
    }
  }
  writeFileSync(f.mode,"normal");
  const count=f.calls().length;
  await expect(f.hooks.get("prompt")({sessionID:"owner",prompt:{text:"x",skills:[{id:"foreign"}]}})).rejects.toThrow("Skills verification blocked");
  await expect(f.hooks.get("prompt")({sessionID:"owner",prompt:{text:12}})).rejects.toThrow();
  await expect(f.hooks.get("prompt")({sessionID:"owner",prompt:{text:"x".repeat(129*1024)}})).rejects.toThrow();
  await expect(f.hooks.get("execute.before")({tool:"skill",input:{id:"foreign"}})).rejects.toThrow("Skills verification blocked");
  await expect(f.hooks.get("execute.before")({tool:"skill",input:{name:"skills-cli"}})).rejects.toThrow();
  const getSession=f.ctx.session.get;
  for(const session of [{id:"other",location:{directory:f.root}},{id:"owner"},{id:"owner",location:{directory:f.root},parentID:"owner"},{id:"owner",location:{directory:f.root},parentID:" "},{id:"owner",location:{directory:"relative/path"}},{id:"owner",location:{directory:f.root+"\0"}}]) {
    f.ctx.session.get=async()=>session as any;
    await expect(f.hooks.get("context")(f.event("owner"))).rejects.toThrow();
  }
  f.ctx.session.get=getSession;
  for(const sessionID of [""," ","x".repeat(10000),12]) {
    await expect(f.hooks.get("context")(f.event(sessionID as any))).rejects.toThrow();
  }
  await expect(f.hooks.get("prompt")({sessionID:"owner",prompt:{text:"\0".repeat(50_000)}})).rejects.toThrow();
  expect(f.calls()).toHaveLength(count);
  await dispose();
});

test("disposal cancels owned pending children and refuses stale callbacks; setup failure cleans registrations", async()=>{
  const failed=await fixture(false,"context");
  await expect(failed.plugin.setup(failed.ctx)).rejects.toThrow();
  expect(failed.hooks.size).toBe(0);
  const f=await fixture(),dispose=await f.plugin.setup(f.ctx);
  writeFileSync(f.mode,"hang");
  const callback=f.hooks.get("context"),event=f.event("owner");
  const pending=callback(event).then(()=>{throw Error("Unexpected disposed delivery")},(error:Error)=>{expect(error.message).toContain("Skills verification blocked")});
  for(let i=0;i<100;i++){if(f.calls().length)break;await Bun.sleep(5)}
  expect(f.calls()).toHaveLength(1);
  const start=Date.now();await dispose();await pending;
  expect(Date.now()-start).toBeLessThan(2000);
  expect(f.hooks.size).toBe(0);expect(event.system).toEqual([]);
  await expect(callback(event)).rejects.toThrow();
  await dispose();
});


test("Sumi native bridge content is canonical at transform and current consumption even when the optional child is missing",async()=>{
  const f=await fixture(true);
  f.setRegistry([{...f.nativeSkill,content:"altered instructions"}]);
  const dispose=await f.plugin.setup(f.ctx);
  expect(f.removed).toContain("skills-cli");
  await expect(Promise.resolve().then(()=>f.hooks.get("execute.before")({sessionID:"owner",tool:"skill",input:{id:"skills-cli"}}))).rejects.toThrow("Skills verification blocked");
  await expect(f.hooks.get("prompt")({sessionID:"owner",prompt:{text:"ordinary",skills:[{id:"skills-cli"}]}})).rejects.toThrow("Skills verification blocked");
  f.setRegistry([f.nativeSkill]);
  await expect(Promise.resolve().then(()=>f.hooks.get("execute.before")({sessionID:"owner",tool:"skill",input:{id:"skills-cli"}}))).rejects.toThrow("Skills verification blocked");
  await f.hooks.get("prompt")({sessionID:"owner",prompt:{text:"ordinary"}});
  const event=f.event("owner");await f.hooks.get("context")(event);expect(event.system[0]!.text).toContain("Ordinary work may continue");
  await dispose();
});


test("native consumption rechecks canonical metadata and requires the strict child attestation",async()=>{
  const f=await fixture(),dispose=await f.plugin.setup(f.ctx);
  const tool=()=>f.hooks.get("execute.before")({sessionID:"owner",tool:"skill",input:{id:"skills-cli"}});
  const attachment=()=>f.hooks.get("prompt")({sessionID:"owner",prompt:{text:"ordinary",skills:[{id:"skills-cli"}]}});
  await tool();await attachment();
  expect(f.calls().filter(call=>call.hook_event_name === "BeforeTool")).toHaveLength(2);
  expect(f.calls()[0]).toMatchObject({delivery_phase:"native",prompt:"",tool_input:{id:"skills-cli"},native_skill:{id:"skills-cli",name:"skills-cli",path:f.nativeSkill.path}});
  const originalCalls=f.calls().length;
  for(const patch of [{content:"altered instructions"},{description:"altered description"},{autoinvoke:true},{name:"other"},{path:null}]) {
    f.setRegistry([{...f.nativeSkill,...patch}]);
    await expect(tool()).rejects.toThrow("Skills verification blocked");
    await expect(attachment()).rejects.toThrow("Skills verification blocked");
  }
  for(const registry of [[],[f.nativeSkill,f.nativeSkill],null]) {
    f.setRegistry(registry as any);await expect(tool()).rejects.toThrow("Skills verification blocked");
  }
  expect(f.calls()).toHaveLength(originalCalls);
  f.setRegistry([f.nativeSkill]);
  for(const mode of ["exit","malformed","large","empty","unverified","wrong-event","wrong-context","null","array","unexpected","block","continue-false","hang"]) {
    writeFileSync(f.mode,mode);
    const results=await Promise.allSettled([tool(),attachment()]);
    for(const result of results) {expect(result.status).toBe("rejected");if(result.status === "rejected") expect(result.reason.name).toBe("SkillsHookRefusal")}
  }
  writeFileSync(f.mode,"empty-string");await tool();await attachment();
  writeFileSync(f.mode,"normal");await tool();await dispose();
});

test("transform removes altered body, description and autoinvoke without adopting native payloads",async()=>{
  for(const patch of [{content:"altered"},{description:"altered"},{autoinvoke:true}]) {
    const f=await fixture();f.setRegistry([{...f.nativeSkill,...patch}]);
    const dispose=await f.plugin.setup(f.ctx);expect(f.removed).toEqual(["skills-cli","foreign"]);await dispose();
  }
});
