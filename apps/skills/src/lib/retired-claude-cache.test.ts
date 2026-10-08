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

test("retired Claude cache absence accepts matching user and canonical project registrations for one active cache",()=>{
 const home=mkdtempSync(join(tmpdir(),"skills-retired-claude-scopes-"));
 try {
  const parent=join(home,".claude/plugins/cache/probe/vendor"),old=join(parent,"1.0.0"),active=join(parent,"2.0.0");
  const settings=join(home,".claude/settings.json"),registry=join(home,".claude/plugins/installed_plugins.json"),projectPath=join(home,"project");
  put(settings,JSON.stringify({enabledPlugins:{"vendor@probe":true}}));
  const rows=[
   {scope:"user",installPath:active,version:"2.0.0"},
   {scope:"project",projectPath,installPath:active,version:"2.0.0"},
  ];
  const registryText=JSON.stringify({version:2,plugins:{"vendor@probe":rows}});put(registry,registryText);
  for(const root of [old,active]) {put(join(root,".claude-plugin/plugin.json"),JSON.stringify({name:"vendor",version:root===old ? "1.0.0":"2.0.0"}));put(join(root,"hooks/hooks.json"),'{"hooks":{}}');}
  const paths=[settings,registry,...[old,active].flatMap(root=>[join(root,".claude-plugin/plugin.json"),join(root,"hooks/hooks.json")])];
  const binding:AgentDiscoveryBinding={agent:"claude",method:"reviewed",roots:[old,active],sources:paths.map(path=>path===settings ? captureClaudeSettingsV3(path) : {path,sha256:hash(path)})};
  verifyAgentDiscovery(binding);renameSync(old,join(home,"preserved-old"));
  expect(()=>verifyAgentDiscovery(binding)).not.toThrow();
  expect(rebindAgentDiscovery(binding,new Map()).sources).toEqual(binding.sources);
  expect(rebindAgentDiscovery(binding,new Map()).sources[0]!.hashMode).toBe("claude-settings-v3");

  const expectFreshRegistryRefusal=(plugins:Record<string,unknown>)=>{
   put(registry,JSON.stringify({version:2,plugins}));
   const fresh={...binding,sources:binding.sources.map(source=>source.path===registry ? {...source,sha256:hash(registry)} : source)};
   expect(()=>verifyAgentDiscovery(fresh)).toThrow();
  };
  expectFreshRegistryRefusal({"vendor@probe":[rows[0],{...rows[1],scope:"local"}]});
  expectFreshRegistryRefusal({"vendor@probe":[rows[0],{...rows[1],projectPath:`${projectPath}/../other`} ]});
  expectFreshRegistryRefusal({"vendor@probe":[rows[0],{...rows[1],projectPath:`${projectPath}\nother`}]});
  expectFreshRegistryRefusal({"vendor@probe":[rows[0],rows[1],{...rows[1]}]});
  expectFreshRegistryRefusal({"vendor@probe":[rows[0],{...rows[1],version:"3.0.0"}]});
  expectFreshRegistryRefusal({"vendor@probe":[rows[0],{...rows[1],installPath:join(parent,"3.0.0"),version:"3.0.0"}]});
  expectFreshRegistryRefusal({"vendor@probe":[{...rows[1]}]});
  expectFreshRegistryRefusal({"vendor@probe":[rows[0],{...rows[1],installPath:old,version:"1.0.0"}]});

  const freshBinding=()=>({...binding,sources:binding.sources.map(source=>source.path===registry ? {...source,sha256:hash(registry)} : source)});
  put(registry,JSON.stringify({version:2,plugins:{"vendor@probe":rows,"unrelated@vendor":[{scope:"local",installPath:join(home,".claude/plugins/cache/unrelated/1.0.0")}]}}));
  expect(()=>verifyAgentDiscovery(freshBinding())).not.toThrow();
  put(registry,JSON.stringify({version:2,plugins:{"vendor@probe":rows,"unrelated@vendor":[{scope:"local",installPath:old}]}}));
  expect(()=>verifyAgentDiscovery(freshBinding())).toThrow();

  const manyProjectRows=Array.from({length:65},(_,index)=>({...rows[1],projectPath:join(home,`project-${index}`)}));
  put(registry,JSON.stringify({version:2,plugins:{"vendor@probe":[rows[0],...manyProjectRows]}}));
  expect(()=>verifyAgentDiscovery(freshBinding())).not.toThrow();
 } finally {rmSync(home,{recursive:true,force:true});}
});
