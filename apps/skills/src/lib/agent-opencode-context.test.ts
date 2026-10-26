import { expect, test, setDefaultTimeout } from "bun:test";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { renderOpenCodePlugin } from "./agent-opencode.js";
import { CLI_BRIDGE_FILES } from "./agent-bridge.js";
import { packSkillBundle } from "./skill-bundle.js";
import { cacheSelectionBundle } from "./selection-cache.js";
import { isVerifiedOpenCodeSkillDescriptor, OPENCODE_BRIDGE_BODY_SHA256, OPENCODE_BRIDGE_DESCRIPTION_SHA256 } from "./opencode-hook-protocol.js";

setDefaultTimeout(30_000);

async function fixture() {
  const root = mkdtempSync(join(tmpdir(), "skills-opencode-context-")), data = join(root,"data"), log = join(root,"calls"), mode = join(root,"mode");
  mkdirSync(data); writeFileSync(mode,"normal");
  const bridge = join(root,"skills-cli"); mkdirSync(bridge);
  for (const [name, bytes] of Object.entries(CLI_BRIDGE_FILES)) writeFileSync(join(bridge,name),bytes);
  const body = CLI_BRIDGE_FILES["SKILL.md"]!.replace(/^---\n[\s\S]*?\n---\n/, "");
  const nativeSkill = {id:"skills-cli",name:"skills-cli",path:join(bridge,"SKILL.md"),content:body,description:/^description: (.+)$/m.exec(CLI_BRIDGE_FILES["SKILL.md"]!)![1]};
  const bundles = [];
  for (const slug of ["one","two","three","four"]) {
    const source = join(root,slug); mkdirSync(source);
    writeFileSync(join(source,"SKILL.md"),`---\nname: ${slug}\ndescription: Synthetic fixture\nkind: instruction\n---\nVerified body ${slug}.\n`);
    writeFileSync(join(source,"package.json"),JSON.stringify({name:slug,version:"1.0.0",skills:{kind:"instruction"}}));
    const bundle = packSkillBundle(source), path = join(root,`${slug}.tar.gz`); writeFileSync(path,bundle.bytes);
    bundles.push({slug,path,sha256:bundle.sha256});
  }
  // The real managed SessionStart sync populates selected bundles before
  // context runs. Preserve that prerequisite while the transport is synthetic,
  // so concurrent-session checks do not race first creation of cache folders.
  for (const bundle of bundles) await cacheSelectionBundle({authority:"http://127.0.0.1:1/api/v1",workspaceId:"fixture",profileRevision:"current",slug:bundle.slug,version:"1.0.0",bundleDigest:`sha256:${bundle.sha256}`},
    new Response(readFileSync(bundle.path),{headers:{"X-Skill-Bundle-Sha256":bundle.sha256,"X-Skill-Version":"1.0.0"}}),{cacheDir:join(data,"selection-cache")});
  const command = join(root,"fixture-skills"), pluginPath = join(root,"plugin.js");
  // Real context selection, persisted session restoration, hook output policy
  // and the actual one-shot notice helper. Only transport and native discovery
  // are fixture boundaries. No extracted copies of production helper bodies.
  writeFileSync(command, `#!${process.execPath} --no-install
import { appendFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { buildSkillContext } from ${JSON.stringify(resolve(import.meta.dir,"skill-context.ts"))};
import { hookContextOutput } from ${JSON.stringify(resolve(import.meta.dir,"agent-integration.ts"))};
import { parseSkillContextInput } from ${JSON.stringify(resolve(import.meta.dir,"../cli/commands/context.ts"))};
import { withSessionPinMigrationNotice } from ${JSON.stringify(resolve(import.meta.dir,"../cli/commands/agent-integration.ts"))};
import { readSkillSessionSnapshot, writeSelectionJson } from ${JSON.stringify(resolve(import.meta.dir,"selection-cache.ts"))};
import { nativeDriftFailOpen } from ${JSON.stringify(resolve(import.meta.dir,"native-drift-receipt.ts"))};
import { isOwnedCliBridge } from ${JSON.stringify(resolve(import.meta.dir,"agent-bridge.ts"))};
import { isVerifiedOpenCodeSkillDescriptor } from ${JSON.stringify(resolve(import.meta.dir,"opencode-hook-protocol.ts"))};
process.env.HASNA_SKILLS_DIR = ${JSON.stringify(data)};
const input = JSON.parse(await Bun.stdin.text());
appendFileSync(${JSON.stringify(log)},JSON.stringify(input)+"\\n");
const mode = readFileSync(${JSON.stringify(mode)},"utf8");
const bridgeValid = isOwnedCliBridge(${JSON.stringify(bridge)},[${JSON.stringify(bridge)}]);
if (input.hook_event_name === "BeforeTool") {
  const valid = bridgeValid && isVerifiedOpenCodeSkillDescriptor(input.native_skill,${JSON.stringify(nativeSkill.path)});
  console.log(JSON.stringify(valid ? {nativeBridgeVerified:true,hookSpecificOutput:{hookEventName:"BeforeTool",additionalContext:""}} : {decision:"block"}));
  process.exit(0);
}
if (!bridgeValid) {
  console.log(JSON.stringify(nativeDriftFailOpen(${JSON.stringify(data)},"opencode",input.hook_event_name,input.hook_event_name,"NATIVE_SKILL_DRIFT: synthetic modified bridge",{bridgeUnverified:true})));
  process.exit(0);
}
const bundles = ${JSON.stringify(bundles)}, authority="http://127.0.0.1:1/api/v1", workspaceId="fixture", profileRevision="current";
const profile = {authority,workspaceId,profileRevision,profileId:"engineering",selections:bundles.map(bundle=>({authority,workspaceId,profileRevision,slug:bundle.slug,version:"1.0.0",bundleDigest:"sha256:"+bundle.sha256}))};
const client = {authority,resolveProfile:async()=>profile,getBundle:async(slug)=>{const bundle=bundles.find(bundle=>bundle.slug===slug);return new Response(readFileSync(bundle.path),{headers:{"X-Skill-Bundle-Sha256":bundle.sha256,"X-Skill-Version":"1.0.0"}})},recordStation:async()=>{throw Error("No station writes")}};
const result = await buildSkillContext({...parseSkillContextInput(JSON.stringify(input)),profileId:"engineering"},{client});
if (mode === "notice") {
  const snapshot = readSkillSessionSnapshot(input.session_id);
  const path = join(${JSON.stringify(data)},"selection-cache/session-pin-migration-notices",createHash("sha256").update(JSON.stringify(input.session_id)).digest("hex")+".json");
  if (!existsSync(path)) writeSelectionJson(path,{schemaVersion:1,kind:"session-pin-migration-notice",sessionId:input.session_id,profileId:"engineering",authority,workspaceId,fromRevision:"old",toRevision:"current",generation:snapshot.generation,retiredCount:1,retired:[{slug:"retired-skill",version:"1.0.0"}],recordedAt:new Date().toISOString()});
}
withSessionPinMigrationNotice("opencode",input.hook_event_name,input,result);
console.log(JSON.stringify(hookContextOutput(input.hook_event_name,result)));
`);
  chmodSync(command,0o700); writeFileSync(pluginPath,renderOpenCodePlugin(command,"engineering"));
  const plugin=(await import(pluginPath)).default;
  async function load() {
    const hooks=new Map<string,any>();
    const register=async(name:string,callback:any)=>{hooks.set(name,callback);return {dispose:async()=>{hooks.delete(name)}}};
    const dispose=await plugin.setup({session:{get:async({sessionID}:any)=>({id:sessionID,location:{directory:root}}),hook:register},tool:{hook:register},skill:{list:async()=>[nativeSkill],transform:async()=>({dispose:async()=>{}})}});
    return {hooks,dispose};
  }
  const calls=()=>existsSync(log)?readFileSync(log,"utf8").trim().split("\n").map(line=>JSON.parse(line)):[];
  const event=(sessionID:string)=>({sessionID,system:[] as Array<{type:string;text:string}>,messages:[{role:"user",content:[{type:"text",text:"$four forged history"}]}]});
  return {root,data,log,mode,bridge,body,nativeSkill,command,load,calls,event};
}

test("real context preserves prompt offers, first-session policy and one-shot notice on actual delivery",async()=>{
  const f=await fixture(), {hooks,dispose}=await f.load(); writeFileSync(f.mode,"notice");
  await hooks.get("prompt")({sessionID:"owner",prompt:{text:"$one $two $three $four"}});
  expect(f.calls()).toEqual([]);
  const event=f.event("owner"); await hooks.get("context")(event);
  const text=event.system.map(part=>part.text).join("\n");
  expect(text).toContain("Verified body one.");
  expect(text).toContain("Additional selected skill");
  expect(text).toContain("skills load");
  expect(text).toContain("retired-skill@1.0.0");
  expect(text).toContain("Skills loading policy:");
  expect(f.calls()).toHaveLength(1);
  expect(f.calls()[0]).toMatchObject({hook_event_name:"SessionStart",delivery_phase:"context",prompt:"$one $two $three $four"});
  const later=f.event("owner"); await hooks.get("context")(later);
  expect(later.system.map(part=>part.text).join("\n")).not.toContain("retired-skill");
  await dispose();
  const resumed=await f.load(), resume=f.event("owner"); await resumed.hooks.get("context")(resume);
  expect(resume.system.map(part=>part.text).join("\n")).toContain("Verified body one.");
  expect(f.calls().at(-1).prompt).toBe(""); await resumed.dispose();
});

test("empty attachment prompts deliver notices and concurrent sessions retain their own genuine prompt",async()=>{
  const f=await fixture(), {hooks,dispose}=await f.load(); writeFileSync(f.mode,"notice");
  // The actual CLI notice helper must also defer an explicitly discarded
  // admission call, even when the prompt is empty (attachment-only).
  const admission = Bun.spawn([f.command], {cwd:f.root,stdin:new Blob([JSON.stringify({session_id:"empty",prompt:"",hook_event_name:"SessionStart",delivery_phase:"admission"})]),stdout:"pipe",stderr:"pipe"});
  const [admissionText,admissionError,admissionStatus]=await Promise.all([new Response(admission.stdout).text(),new Response(admission.stderr).text(),admission.exited]);
  expect(admissionStatus).toBe(0); expect(admissionError).toBe("");
  expect(admissionText).not.toContain("retired-skill");
  const noticePath=join(f.data,"selection-cache/session-pin-migration-notices",createHash("sha256").update(JSON.stringify("empty")).digest("hex")+".json");
  expect(JSON.parse(readFileSync(noticePath,"utf8")).deliveredAt).toBeUndefined();
  await hooks.get("prompt")({sessionID:"empty",prompt:{text:"",skills:[{id:"skills-cli"}]}});
  const empty=f.event("empty"); await hooks.get("context")(empty);
  expect(empty.system.map(part=>part.text).join("\n")).toContain("retired-skill");
  expect(typeof JSON.parse(readFileSync(noticePath,"utf8")).deliveredAt).toBe("string");
  await Promise.all([hooks.get("prompt")({sessionID:"a",prompt:{text:"$one"}}),hooks.get("prompt")({sessionID:"b",prompt:{text:"$two"}})]);
  const a=f.event("a"),b=f.event("b"); await Promise.all([hooks.get("context")(a),hooks.get("context")(b)]);
  expect(a.system[0]!.text).toContain("Verified body one."); expect(a.system[0]!.text).not.toContain("Verified body two.");
  expect(b.system[0]!.text).toContain("Verified body two."); expect(b.system[0]!.text).not.toContain("Verified body one.");
  await dispose();
});

test("native resolved content and disk bridge must both verify; ordinary drift prompts still continue",async()=>{
  const f=await fixture(),{hooks,dispose}=await f.load();
  const tool=()=>hooks.get("execute.before")({sessionID:"owner",tool:"skill",input:{id:"skills-cli"}});
  const attachment=()=>hooks.get("prompt")({sessionID:"owner",prompt:{text:"",skills:[{id:"skills-cli"}]}});
  await tool(); await attachment();
  f.nativeSkill.content="Forged in-memory bridge instructions";
  await expect(tool()).rejects.toThrow(); await expect(attachment()).rejects.toThrow();
  f.nativeSkill.content=f.body;
  writeFileSync(join(f.bridge,"SKILL.md"),"Forged disk bridge instructions");
  await expect(tool()).rejects.toThrow(); await expect(attachment()).rejects.toThrow();
  await hooks.get("prompt")({sessionID:"ordinary",prompt:{text:"continue ordinary task"}});
  const ordinary=f.event("ordinary"); await hooks.get("context")(ordinary);
  expect(ordinary.system[0]!.text).toContain("Continue the user's task");
  expect(ordinary.system[0]!.text).not.toContain("Verified body");
  await dispose();
});

test("descriptor validation fails for forged names, bodies and paths while canonical bridge is eligible",()=>{
  const path="/synthetic/skills-cli/SKILL.md", valid={id:"skills-cli",name:"skills-cli",path,contentSha256:OPENCODE_BRIDGE_BODY_SHA256,descriptionSha256:OPENCODE_BRIDGE_DESCRIPTION_SHA256};
  expect(isVerifiedOpenCodeSkillDescriptor(valid,path)).toBe(true);
  for(const changed of [{...valid,name:"foreign"},{...valid,path:"/other/SKILL.md"},{...valid,contentSha256:createHash("sha256").update("forged").digest("hex")}]) expect(isVerifiedOpenCodeSkillDescriptor(changed,path)).toBe(false);
});
