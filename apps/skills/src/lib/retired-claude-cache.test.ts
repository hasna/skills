import { test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, renameSync, rmSync, symlinkSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { captureClaudeSettingsV3 } from "./claude-settings-witness.js";
import { verifyAgentDiscovery, rebindAgentDiscovery, type AgentDiscoveryBinding } from "./agent-discovery.js";
const put=(path:string,text:string)=>{mkdirSync(dirname(path),{recursive:true});writeFileSync(path,text);};
const hash=(path:string)=>createHash("sha256").update(readFileSync(path)).digest("hex");
test("retired Claude cache absence preserves its witness while active missing hooks and registration drift refuse",()=>{
 const home=mkdtempSync(join(tmpdir(),"skills-retired-claude-"));
 try {
  const parent=join(home,".claude/plugins/cache/probe/vendor"), old=join(parent,"1.0.0"), active=join(parent,"2.0.0");
  const settings=join(home,".claude/settings.json"), registry=join(home,".claude/plugins/installed_plugins.json");
  put(settings,JSON.stringify({enabledPlugins:{"vendor@probe":true}}));
  const currentRegistry=JSON.stringify({version:2,plugins:{"vendor@probe":[{scope:"user",installPath:active,version:"2.0.0"}]}});put(registry,currentRegistry);
  for(const root of [old,active]) {put(join(root,".claude-plugin/plugin.json"),JSON.stringify({name:"vendor",version:root===old ? "1.0.0":"2.0.0"}));put(join(root,"hooks/hooks.json"),'{"hooks":{}}');}
  const paths=[settings,registry,...[old,active].flatMap(root=>[join(root,".claude-plugin/plugin.json"),join(root,"hooks/hooks.json")])];
  const binding:AgentDiscoveryBinding={agent:"claude",method:"reviewed",roots:[old,active],sources:paths.map(path=>path===settings ? captureClaudeSettingsV3(path) : {path,sha256:hash(path)})};
  verifyAgentDiscovery(binding);renameSync(old,join(home,"preserved-old"));
  expect(()=>verifyAgentDiscovery(binding)).not.toThrow();
  expect(rebindAgentDiscovery(binding,new Map()).sources).toEqual(binding.sources);
  expect(rebindAgentDiscovery(binding,new Map()).sources[0]!.hashMode).toBe("claude-settings-v3");
  renameSync(active,join(home,"preserved-active"));expect(()=>verifyAgentDiscovery(binding)).toThrow();renameSync(join(home,"preserved-active"),active);
  const activeHooks=join(active,"hooks/hooks.json"), hookText=readFileSync(activeHooks,"utf8");rmSync(activeHooks);
  expect(()=>verifyAgentDiscovery(binding)).toThrow("Native discovery input changed");put(activeHooks,hookText);
  const originalSettings=readFileSync(settings,"utf8"), direct={enabledPlugins:{"vendor@probe":true},hooks:{Stop:[{hooks:[{type:"command",command:join(old,"hooks/run.js")}]}]}};
  put(settings,JSON.stringify(direct));const directBinding={...binding,sources:binding.sources.map(source=>source.path===settings ? captureClaudeSettingsV3(settings):source)};expect(()=>verifyAgentDiscovery(directBinding)).toThrow();put(settings,originalSettings);
  put(registry,currentRegistry.replace(active,old));expect(()=>verifyAgentDiscovery(binding)).toThrow();put(registry,currentRegistry);
  symlinkSync(join(home,"preserved-old"),old);expect(()=>verifyAgentDiscovery(binding)).toThrow();rmSync(old);
  renameSync(join(home,"preserved-old"),old);put(join(old,"hooks/hooks.json"),'{"hooks":{"changed":[]}}');expect(()=>verifyAgentDiscovery(binding)).toThrow();
 } finally {rmSync(home,{recursive:true,force:true});}
});
