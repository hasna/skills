import { test, expect, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, symlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { useDefaultTestTimeout } from "../test-preload.js";
import { planAgentIntegration, applyAgentIntegration, assertManagedAgentBridge } from "./agent-integration.js";
import { reviewCodexPluginControls, isReviewedCodexPluginInactive, reviewCodexPluginSkillControls, isReviewedCodexPluginSkillDisabled, reviewedCodexPluginCapabilitiesUnchanged } from "./codex-plugin-skill-controls.js";
import { createHash } from "node:crypto";
import { hashNativeJsonControls } from "./claude-settings-witness.js";
import { inventoryNativeSkills } from "./agent-integration.js";
import { reviewedCodexPluginSourceRoots } from "./codex-plugin-skill-controls.js";
import { assertAgentPolicyCollections } from "./agent-policy-limits.js";
import { captureDiscoveryDirectories } from "./agent-discovery.js";
useDefaultTestTimeout();
const roots:string[]=[]; afterEach(()=>{for(const root of roots.splice(0)) rmSync(root,{recursive:true,force:true});});
const put=(p:string,s:string)=>{mkdirSync(join(p,".."),{recursive:true});writeFileSync(p,s);};
test("reviewed qualified native plugin name remains denied after cache version regeneration",()=>{
 const home=mkdtempSync(join(tmpdir(),"skills-plugin-continuity-")); roots.push(home);
 const f={home,dataDir:join(home,"data"),projectDir:home};
 const parent=join(home,".codex/plugins/cache/probe/vendor"), old=join(parent,"1.0.0"), next=join(parent,"3.0.0");
 const payload='---\nname: deploy\ndescription: Synthetic review fixture\n---\nSynthetic native instructions\n';
 const add=(root:string,version:string)=>{put(join(root,".codex-plugin/plugin.json"),JSON.stringify({name:"vendor",version,description:"Synthetic plugin"}));put(join(root,"skills/deploy/SKILL.md"),payload);};
 add(old,"1.0.0");
 applyAgentIntegration(planAgentIntegration({...f,agents:["codex"]}));
 add(next,"3.0.0");
 expect(()=>assertManagedAgentBridge("codex",f)).toThrow("NATIVE_SKILL_DRIFT");
 const receipt={version:"codex-cli 0.159.2",cwd:home,skills:[{name:"vendor:deploy",path:join(old,"skills/deploy/SKILL.md"),enabled:false,pluginId:"vendor@probe"}],plugins:[{id:"vendor@probe",name:"vendor",installed:true,enabled:true,localVersion:"1.0.0"}]};
 const plan=planAgentIntegration({...f,agents:["codex"],codexNativeCatalog:receipt}); applyAgentIntegration(plan);
 const config=join(home,".codex/config.toml"), before=readFileSync(config,"utf8");
 expect(before).toContain('name = "vendor:deploy"');expect(before).toContain(JSON.stringify(join(old,"skills/deploy/SKILL.md")));
 add(join(parent,"4.0.0"),"4.0.0");
 symlinkSync(join(parent,"4.0.0"),join(parent,"latest"));
 expect(()=>assertManagedAgentBridge("codex",f)).not.toThrow();
 put(join(next,"skills/deploy/SKILL.md"),payload.replace("Synthetic native instructions","Updated native payload"));
 expect(()=>assertManagedAgentBridge("codex",f)).not.toThrow();
 put(join(next,"hooks/hooks.json"),'{}'); expect(()=>assertManagedAgentBridge("codex",f)).toThrow("NATIVE_SKILL_DRIFT");
 rmSync(join(next,"hooks"),{recursive:true});
 put(join(next,"skills/unknown/SKILL.md"),payload.replace("name: deploy","name: unknown")); expect(()=>assertManagedAgentBridge("codex",f)).toThrow("NATIVE_SKILL_DRIFT");
 rmSync(join(next,"skills/unknown"),{recursive:true});
 put(config,before+'\n[[skills.config]]\nname = "vendor:deploy"\nenabled = true\n');expect(()=>assertManagedAgentBridge("codex",f)).toThrow("NATIVE_SKILL_DRIFT");
});
test("legacy listed catalog remains valid without plugins while omitted identity refuses",()=>{
 const home=mkdtempSync(join(tmpdir(),"skills-plugin-legacy-catalog-")); roots.push(home);
 const cache=join(home,".codex/plugins/cache"), root=join(cache,"probe/vendor/1.0.0"), document=join(root,"skills/deploy/SKILL.md");
 put(join(root,".codex-plugin/plugin.json"),'{"name":"vendor","version":"1.0.0"}');
 put(document,'---\nname: deploy\ndescription: Synthetic legacy catalog\n---\nFixture');
 const catalog={version:"codex-cli 0.159.2",cwd:home,skills:[{name:"vendor:deploy",path:document,enabled:false,pluginId:"vendor@probe"}]};
 const read=(path:string)=>readFileSync(path,"utf8"), rules=[{path:document,enabled:false}];
 expect(reviewCodexPluginSkillControls(catalog,[document],cache,home,read,rules)).toHaveLength(1);
 expect(()=>reviewCodexPluginSkillControls({...catalog,skills:[]},[document],cache,home,read,rules)).toThrow("IDENTITY_UNSUPPORTED");
});
test("reviewed native names reject bare names, unexpected namespace and conflicting enable",()=>{
 const home=mkdtempSync(join(tmpdir(),"skills-plugin-boundary-")); roots.push(home); const f={home,dataDir:join(home,"data"),projectDir:home};
 const root=join(home,".codex/plugins/cache/probe/vendor/1.0.0"),document=join(root,"skills/deploy/SKILL.md");
 put(join(root,".codex-plugin/plugin.json"),'{"name":"vendor","version":"1.0.0"}');put(document,'---\nname: deploy\ndescription: Synthetic\n---\nfixture');
 const catalog={version:"codex-cli 0.159.2",cwd:home,skills:[{name:"deploy",path:document,enabled:true,pluginId:"vendor@probe"}],plugins:[{id:"vendor@probe",name:"vendor",installed:true,enabled:true,localVersion:"1.0.0"}]};
 expect(()=>planAgentIntegration({...f,agents:["codex"],codexNativeCatalog:catalog})).toThrow("IDENTITY_UNSUPPORTED");
 put(join(home,".codex/config.toml"),'[[skills.config]]\nname = "vendor:deploy"\nenabled = true\n');
 expect(()=>planAgentIntegration({...f,agents:["codex"],codexNativeCatalog:{...catalog,skills:[{...catalog.skills[0]!,name:"vendor:deploy"}]}})).toThrow("NAME_CONFLICT");
});

test("reviewed Pages app declarations stay exactly bound across plugin cache versions", () => {
  const home=mkdtempSync(join(tmpdir(),"skills-pages-controls-")); roots.push(home);
  const cache=join(home,".codex/plugins/cache"), parent=join(cache,"probe/pages");
  const names=["maintain-space","manage-schedules","organize-space","write-page"];
  const app='{"apps":{"pages":{"id":"synthetic_pages_connector","required":true}}}';
  const add=(version:string, apps=app) => {
    const root=join(parent,version);
    put(join(root,".codex-plugin/plugin.json"),JSON.stringify({name:"pages",version,apps:"./.app.json"}));
    put(join(root,".app.json"),apps);
    for (const name of names) put(join(root,"skills",name,"SKILL.md"),`---\nname: ${name}\ndescription: Synthetic Pages fixture\n---\nSynthetic disabled body`);
    return root;
  };
  const old=add("1.0.0"), documents=names.map(name=>join(old,"skills",name,"SKILL.md"));
  const read=(path:string)=>readFileSync(path,"utf8");
  const catalog={version:"codex-cli 0.159.2",cwd:home,skills:documents.map((path,i)=>({name:`pages:${names[i]}`,path,enabled:false,pluginId:"pages@probe"})),plugins:[{id:"pages@probe",name:"pages",installed:true,enabled:true,localVersion:"1.0.0"}]};
  const controls=reviewCodexPluginSkillControls(catalog,documents,cache,home,read,[]);
  expect(controls).toHaveLength(4);
  expect(new Set(controls.map(control=>control.appSha256)).size).toBe(1);
  expect(controls[0]!.appSha256).toMatch(/^[a-f0-9]{64}$/);
  const rules=controls.map(control=>({name:control.name,enabled:false}));
  const next=add("3.0.0",'{ "apps": { "pages": { "required": true, "id": "synthetic_pages_connector" } } }');
  const document=join(next,"skills/maintain-space/SKILL.md");
  const accepts=()=>isReviewedCodexPluginSkillDisabled(document,cache,controls,rules,read);
  expect(accepts()).toBe(true);
  for (const changed of [
    app.replace("synthetic_pages_connector","different_connector"),
    app.replace('"pages":','"other":'),
    app.replace("true","false"),
    '{"apps":{"pages":{"id":"synthetic_pages_connector"}}}',
    '{"apps":{"pages":{"id":"synthetic_pages_connector","required":true},"extra":{"id":"extra"}}}',
  ]) { put(join(next,".app.json"),changed); expect(accepts()).toBe(false); }
  put(join(next,".app.json"),app);
  expect(accepts()).toBe(true);
  rmSync(join(next,".app.json")); expect(accepts()).toBe(false);
  put(join(next,".app.json"),app);
  const f={home,dataDir:join(home,"data"),projectDir:home};
  const plan=planAgentIntegration({...f,agents:["codex"],codexNativeCatalog:catalog});
  put(join(old,".app.json"),app.replace("true","false"));
  expect(()=>applyAgentIntegration(plan)).toThrow();
  put(join(old,".app.json"),app);
  applyAgentIntegration(planAgentIntegration({...f,agents:["codex"],codexNativeCatalog:catalog}));
  rmSync(join(old,"skills"),{recursive:true}); rmSync(join(next,"skills"),{recursive:true});
  expect(()=>assertManagedAgentBridge("codex",f)).not.toThrow();
  put(join(next,".app.json"),app.replace("true","false"));
  expect(()=>assertManagedAgentBridge("codex",f)).toThrow("NATIVE_SKILL_DRIFT");
  put(join(next,".app.json"),app); rmSync(join(next,".app.json"));
  expect(()=>assertManagedAgentBridge("codex",f)).toThrow("NATIVE_SKILL_DRIFT");
});

test("native app controls refuse unsupported schema, references and newly appearing capabilities", () => {
  const home=mkdtempSync(join(tmpdir(),"skills-app-boundaries-")); roots.push(home);
  const cache=join(home,".codex/plugins/cache"), root=join(cache,"probe/pages/1.0.0"), document=join(root,"skills/write-page/SKILL.md");
  const manifest=join(root,".codex-plugin/plugin.json"), appPath=join(root,".app.json"), app='{"apps":{"pages":{"id":"synthetic_pages_connector","required":true}}}';
  put(manifest,'{"name":"pages","version":"1.0.0"}');
  put(document,'---\nname: write-page\ndescription: Synthetic Pages\n---\nDisabled body');
  const read=(path:string)=>readFileSync(path,"utf8"), catalog={version:"codex-cli 0.159.2",cwd:home,skills:[{name:"pages:write-page",path:document,enabled:false,pluginId:"pages@probe"}],plugins:[{id:"pages@probe",name:"pages",installed:true,enabled:true,localVersion:"1.0.0"}]};
  const productionPlan=()=>planAgentIntegration({home,dataDir:join(home,"data"),projectDir:home,agents:["codex"],codexNativeCatalog:catalog});
  const review=()=>reviewCodexPluginSkillControls(catalog,[document],cache,home,read,[]);
  const legacy=review(), rules=[{name:"pages:write-page",enabled:false}];
  put(appPath,app);
  expect(isReviewedCodexPluginSkillDisabled(document,cache,legacy,rules,read)).toBe(false);
  for (const invalid of [
    '{"apps":{},"instructions":"unreviewed"}',
    ...["instructions","hooks","command","path","mcpServers","version"].map(key=>JSON.stringify({apps:{pages:{id:"synthetic_pages_connector",required:true,[key]:"unreviewed"}}})),
    '{"apps":{"pages":{"id":"first","id":"second"}}}',
    '{"apps":{"pages":{"id":"synthetic_pages_connector","required":"true"}}}',
    '{"apps":{"pages":{"id":12}}}',
    '{"apps":{"pages":{"id":""}}}',
    '{"apps":{"pages":{"id":"synthetic_pages_connector","category":null}}}',
    '{"apps":{"pages":{"id":"synthetic_pages_connector"},"pages":{"id":"other"}}}',
    '{"apps":[]}', 'null', '{', ' '.repeat(1024*1024)+app,
  ]) { put(appPath,invalid); expect(review).toThrow(); }
  expect(productionPlan).toThrow();
  put(appPath,app);
  for (const apps of ["other.json","./other.json","/absolute.json","./../outside.json"]) {
    put(manifest,JSON.stringify({name:"pages",apps})); expect(review).toThrow();
  }
  for (const key of ["hooks","mcpServers","commands"]) {
    put(manifest,JSON.stringify({name:"pages",[key]:"./external.json"})); expect(review).toThrow();
  }
  put(manifest,'{"name":"pages","apps":"./.app.json"}');
  expect(review()).toHaveLength(1);
  const external=join(home,"external-app.json"); put(external,app);
  rmSync(appPath); symlinkSync(external,appPath); expect(review).toThrow(); expect(productionPlan).toThrow();
  rmSync(appPath); put(appPath,app);
  for (const path of ["hooks/hooks.json",".mcp.json"]) {
    put(join(root,path),'{}'); expect(review).toThrow(); rmSync(join(root,path===".mcp.json"?path:"hooks"),{recursive:true});
  }
});

for (const nativeVersion of ["codex-cli 0.159.2", "codex-cli 0.160.0"]) test(`path-disabled ${nativeVersion} plugin omission enrolls a stable name across cache versions`, () => {
  const home=mkdtempSync(join(tmpdir(),"skills-disabled-plugin-omission-")); roots.push(home);
  const f={home,dataDir:join(home,"data"),projectDir:home}, cache=join(home,".codex/plugins/cache");
  const parent=join(cache,"openai-curated-remote/codex-browser-recorder"), old=join(parent,"0.4.0");
  const document=join(old,"skills/record-browser/SKILL.md"), config=join(home,".codex/config.toml");
  const payload="---\nname: record-browser\ndescription: Synthetic browser recorder fixture\n---\nDisabled skill body\n";
  const add=(version:string)=>{const root=join(parent,version);put(join(root,".codex-plugin/plugin.json"),JSON.stringify({name:"codex-browser-recorder",version}));put(join(root,"skills/record-browser/SKILL.md"),payload);return root;};
  add("0.4.0");
  put(config,`[[skills.config]]\npath = ${JSON.stringify(document)}\nenabled = false\n`);
  const catalog={version:nativeVersion,cwd:home,skills:[],plugins:[{id:"codex-browser-recorder@openai-curated-remote",name:"codex-browser-recorder",installed:true,enabled:true,localVersion:"0.4.0"}]};
  const read=(path:string)=>readFileSync(path,"utf8");
  const plan=planAgentIntegration({...f,agents:["codex"],codexNativeCatalog:catalog});
  applyAgentIntegration(plan);
  const configAfter=readFileSync(config,"utf8");
  expect(configAfter).toContain(`path = ${JSON.stringify(document)}`);
  expect(configAfter).toContain('name = "codex-browser-recorder:record-browser"');
  expect(()=>assertManagedAgentBridge("codex",f)).not.toThrow();
  add("0.4.1");
  expect(()=>assertManagedAgentBridge("codex",f)).not.toThrow();

  expect(()=>planAgentIntegration({...f,agents:["codex"],codexNativeCatalog:{...catalog,plugins:[]}})).toThrow("IDENTITY_UNSUPPORTED");
  expect(()=>planAgentIntegration({...f,agents:["codex"],codexNativeCatalog:{...catalog,skills:[{name:"codex-browser-recorder:record-browser",path:document,enabled:true,pluginId:"other@openai-curated-remote"}]}})).toThrow("IDENTITY_UNSUPPORTED");
  const mismatchedManifest=join(parent,"0.4.2");
  put(join(mismatchedManifest,".codex-plugin/plugin.json"),JSON.stringify({name:"other-plugin",version:"0.4.2"}));
  put(join(mismatchedManifest,"skills/record-browser/SKILL.md"),payload);
  const mismatchedPath=join(mismatchedManifest,"skills/record-browser/SKILL.md");
  put(config,`[[skills.config]]\npath = ${JSON.stringify(mismatchedPath)}\nenabled = false\n`);
  const mismatchedCatalog={...catalog,plugins:[{...catalog.plugins[0]!,localVersion:"0.4.2"}]};
  expect(()=>planAgentIntegration({...f,agents:["codex"],codexNativeCatalog:mismatchedCatalog})).toThrow("IDENTITY_UNSUPPORTED");
  const versionRoot=join(parent,"0.4.3"), versionPath=join(versionRoot,"skills/record-browser/SKILL.md");
  put(join(versionRoot,".codex-plugin/plugin.json"),JSON.stringify({name:"codex-browser-recorder",version:"0.4.2"}));put(versionPath,payload);
  put(config,`[[skills.config]]\npath = ${JSON.stringify(versionPath)}\nenabled = false\n`);
  expect(()=>planAgentIntegration({...f,agents:["codex"],codexNativeCatalog:{...catalog,plugins:[{...catalog.plugins[0]!,localVersion:"0.4.3"}]}})).toThrow("IDENTITY_UNSUPPORTED");

  const defaultRoot=join(cache,"probe/default-plugin/1.0.0"), defaultPath=join(defaultRoot,"skills/default-skill/SKILL.md");
  put(join(defaultRoot,".codex-plugin/plugin.json"),JSON.stringify({name:"default-plugin"}));
  put(defaultPath,"---\nname: default-skill\ndescription: Default version compatibility\n---\nFixture\n");
  const defaultControls=reviewCodexPluginSkillControls({version:nativeVersion,cwd:home,skills:[],plugins:[{id:"default-plugin@probe",name:"default-plugin",installed:true,enabled:true,localVersion:"1.0.0"}]},[defaultPath],cache,home,read,[{path:defaultPath,enabled:false}]);
  expect(defaultControls.map(control=>control.name)).toEqual(["default-plugin:default-skill"]);
});


test("remote null-version denied materialization binds the native installation receipt without guessing a cache version", () => {
 const home=mkdtempSync(join(tmpdir(),"skills-remote-null-version-")); roots.push(home);
 const cache=join(home,".codex/plugins/cache"), parent=join(cache,"openai-curated-remote/pages"), root=join(parent,"0.1.18"), document=join(root,"skills/write-page/SKILL.md");
 put(join(root,".codex-plugin/plugin.json"),JSON.stringify({name:"pages",version:"0.1.18"}));
 put(document,"---\nname: write-page\ndescription: Synthetic denied Pages fixture\n---\nFixture\n");
 const remotePluginId="plugins~Plugin_00000000000000000000000000000001";
 put(join(parent,".codex-remote-plugin-install.json"),JSON.stringify({schema_version:1,remote_plugin_id:remotePluginId}));
 const catalog={version:"codex-cli 0.160.0",cwd:home,skills:[],plugins:[{id:"pages@openai-curated-remote",name:"pages",installed:true,enabled:true,localVersion:null,remotePluginId,sourceType:"remote" as const}]};
 const read=(path:string)=>readFileSync(path,"utf8"), rules=[{path:document,enabled:false}];
 const controls=reviewCodexPluginSkillControls(catalog,[document],cache,home,read,rules);
 expect(controls.map(control=>control.name)).toEqual(["pages:write-page"]);
 expect(controls[0]?.remotePluginId).toBe(remotePluginId);
 expect(reviewedCodexPluginCapabilitiesUnchanged(cache,controls,read)).toBe(true);
 expect(isReviewedCodexPluginSkillDisabled(document,cache,controls,rules,read)).toBe(true);
 put(join(home,".codex/config.toml"),`[[skills.config]]\npath = ${JSON.stringify(document)}\nenabled = false\n`);
 const f={home,dataDir:join(home,"data"),projectDir:home};
 const plan=planAgentIntegration({...f,agents:["codex"],codexNativeCatalog:catalog});
 applyAgentIntegration(plan);
 expect(read(join(home,".codex/config.toml"))).toContain('name = "pages:write-page"');
 expect(()=>assertManagedAgentBridge("codex",f)).not.toThrow();
 for (const plugin of [{...catalog.plugins[0]!,remotePluginId:undefined},{...catalog.plugins[0]!,sourceType:undefined},{...catalog.plugins[0]!,installed:false},{...catalog.plugins[0]!,enabled:false},{...catalog.plugins[0]!,remotePluginId:"plugins~Plugin_00000000000000000000000000000002"}])
   expect(()=>reviewCodexPluginSkillControls({...catalog,plugins:[plugin]},[document],cache,home,read,rules)).toThrow("IDENTITY_UNSUPPORTED");
 expect(()=>reviewCodexPluginSkillControls(catalog,[document],cache,home,read,[])).toThrow("IDENTITY_UNSUPPORTED");
 expect(()=>reviewCodexPluginSkillControls(catalog,[document],cache,home,read,[...rules,{name:"pages:write-page",enabled:true}])).toThrow("IDENTITY_UNSUPPORTED");
 const receipt=join(parent,".codex-remote-plugin-install.json");
 for (const metadata of [{schema_version:2,remote_plugin_id:remotePluginId},{schema_version:1,remote_plugin_id:remotePluginId,unknown:true},{schema_version:1},{remote_plugin_id:remotePluginId}]) {
   put(receipt,JSON.stringify(metadata));
   expect(()=>reviewCodexPluginSkillControls(catalog,[document],cache,home,read,rules)).toThrow("IDENTITY_UNSUPPORTED");
 }
 put(receipt,`{"schema_version":1,"remote_plugin_id":"wrong","remote_plugin_id":${JSON.stringify(remotePluginId)}}`);
 expect(()=>reviewCodexPluginSkillControls(catalog,[document],cache,home,read,rules)).toThrow("IDENTITY_UNSUPPORTED");
 const preservedReceipt=join(home,"receipt-copy.json");put(preservedReceipt,JSON.stringify({schema_version:1,remote_plugin_id:remotePluginId}));
 rmSync(receipt);symlinkSync(preservedReceipt,receipt);
 expect(()=>reviewCodexPluginSkillControls(catalog,[document],cache,home,read,rules)).toThrow("IDENTITY_UNSUPPORTED");
 expect(reviewedCodexPluginCapabilitiesUnchanged(cache,controls,read)).toBe(false);
 rmSync(receipt);put(receipt,JSON.stringify({schema_version:1,remote_plugin_id:remotePluginId}));
 const historical=join(parent,"0.1.17"), stale=join(historical,"skills/write-page/SKILL.md");
 put(join(historical,".codex-plugin/plugin.json"),JSON.stringify({name:"pages",version:"0.1.17"}));
 put(stale,read(document));
 // An unlisted historical cache does not become executable or silently current.
 expect(()=>reviewCodexPluginSkillControls(catalog,[document,stale],cache,home,read,rules)).toThrow("IDENTITY_UNSUPPORTED");
 const alias=join(root,"skills/alias/SKILL.md");mkdirSync(join(alias,".."),{recursive:true});symlinkSync(document,alias);
 expect(()=>reviewCodexPluginSkillControls(catalog,[alias],cache,home,read,[{path:alias,enabled:false}])).toThrow("IDENTITY_UNSUPPORTED");
 put(join(parent,".codex-remote-plugin-install.json"),JSON.stringify({schema_version:1,remote_plugin_id:"plugins~Plugin_00000000000000000000000000000002"}));
 expect(reviewedCodexPluginCapabilitiesUnchanged(cache,controls,read)).toBe(false);
 expect(isReviewedCodexPluginSkillDisabled(document,cache,controls,rules,read)).toBe(false);
 expect(()=>reviewCodexPluginSkillControls(catalog,[document],cache,home,read,rules)).toThrow("IDENTITY_UNSUPPORTED");
});


test("inert disabled plugin documents do not block qualified review while active hook controls still refuse", () => {
 const home=mkdtempSync(join(tmpdir(),"skills-inert-plugin-review-")); roots.push(home);
 const cache=join(home,".codex/plugins/cache"), inactiveRoot=join(cache,"probe/inactive/1.0.0"), activeRoot=join(cache,"probe/active/1.0.0");
 const inactive=join(inactiveRoot,"skills/inert-skill/SKILL.md"), active=join(activeRoot,"skills/active-skill/SKILL.md");
 put(join(inactiveRoot,".codex-plugin/plugin.json"),JSON.stringify({name:"inactive",version:"1.0.0",hooks:{SessionStart:[{hooks:[{type:"command",command:"synthetic-never-executed"}]}]}}));
 put(join(home,"source/inactive/.codex-plugin/plugin.json"),JSON.stringify({name:"inactive",version:"1.0.0"}));
 put(inactive,"---\nname: inert-skill\ndescription: Synthetic inactive plugin fixture\n---\nFixture\n");
 put(join(activeRoot,".codex-plugin/plugin.json"),JSON.stringify({name:"active",version:"1.0.0"}));
 put(active,"---\nname: active-skill\ndescription: Synthetic active plugin fixture\n---\nFixture\n");
 const catalog={version:"codex-cli 0.160.0",cwd:home,skills:[{name:"active:active-skill",path:active,enabled:true,pluginId:"active@probe"}],plugins:[
   {id:"inactive@probe",name:"inactive",installed:true,enabled:false,localVersion:"1.0.0",sourceType:"local" as const,sourceSha256:hashNativeJsonControls(JSON.stringify({type:"local",path:join(home,"source/inactive")})),sourcePath:join(home,"source/inactive")},
   {id:"active@probe",name:"active",installed:true,enabled:true,localVersion:"1.0.0"}]};
 const read=(path:string)=>readFileSync(path,"utf8"), rules=[{path:inactive,enabled:false}], settings={"inactive@probe":{enabled:false}};
 const review=(snapshot=catalog,config:unknown=settings,denials:unknown=rules)=>reviewCodexPluginSkillControls(snapshot,[inactive,active],cache,home,read,denials,config);
 expect(review().map(control=>control.name)).toEqual(["active:active-skill"]);
 const reviewed=reviewCodexPluginControls(catalog,[inactive,active],cache,home,read,rules,settings);
 expect(reviewed.inactivePlugins).toHaveLength(1);
 const inert=(path=inactive,config:unknown=settings,denials:unknown=rules)=>isReviewedCodexPluginInactive(path,cache,reviewed.inactivePlugins,config,denials,read);
 expect(inert()).toBe(true);
 for (const source of [{sourceType:undefined,sourceSha256:undefined,sourcePath:undefined},{sourceType:"remote" as const,sourceSha256:undefined,sourcePath:undefined},{sourceType:"local" as const,sourceSha256:hashNativeJsonControls(JSON.stringify({type:"local",path:join(home,"source/inactive")})),sourcePath:join(home,"source/inactive"),remotePluginId:"remote_identity"}]) {
   const snapshot={...catalog,plugins:catalog.plugins.map(plugin=>plugin.id==="inactive@probe" ? {...plugin,...source} : plugin)};
   expect(()=>reviewCodexPluginControls(snapshot,[inactive,active],cache,home,read,rules,settings)).toThrow("IDENTITY_UNSUPPORTED");
 }
 expect(inert(inactive,{"inactive@probe":{enabled:true}})).toBe(false);
 expect(inert(inactive,settings,[...rules,{name:"inactive:inert-skill",enabled:true}])).toBe(false);
 expect(inert(inactive,settings,[...rules,{path:inactive,enabled:true}])).toBe(false);
 expect(isReviewedCodexPluginInactive(inactive,cache,[...reviewed.inactivePlugins,...reviewed.inactivePlugins],settings,rules,read)).toBe(false);
 expect(()=>assertAgentPolicyCollections({bridge:{codexInactivePlugins:reviewed.inactivePlugins}})).toThrow();
 expect(()=>assertAgentPolicyCollections({bridge:{codexInactivePlugins:reviewed.inactivePlugins,codexPluginSkillReview:{version:"codex-cli 0.160.0",catalogSha256:"b".repeat(64)}}})).not.toThrow();

 expect(reviewCodexPluginSkillControls({...catalog,skills:[]},[inactive],cache,home,read,rules,settings)).toEqual([]);
 // A native snapshot alone never proves continuing disablement.
 expect(()=>reviewCodexPluginSkillControls(catalog,[inactive,active],cache,home,read,rules)).toThrow("IDENTITY_UNSUPPORTED");
 expect(()=>review(catalog,{"inactive@probe":{enabled:true}})).toThrow("IDENTITY_UNSUPPORTED");
 expect(()=>review({...catalog,plugins:catalog.plugins.map(plugin=>({...plugin,enabled:true}))})).toThrow("IDENTITY_UNSUPPORTED");
 expect(()=>review(catalog,settings,[])).toThrow("IDENTITY_UNSUPPORTED");
 expect(()=>review(catalog,settings,[...rules,{name:"inactive:inert-skill",enabled:true}])).toThrow("IDENTITY_UNSUPPORTED");
 expect(()=>review(catalog,settings,[...rules,{path:inactive,enabled:true}])).toThrow("IDENTITY_UNSUPPORTED");
 expect(()=>review({...catalog,skills:[...catalog.skills,{name:"inactive:inert-skill",path:inactive,enabled:false,pluginId:"inactive@probe"}]})).toThrow("IDENTITY_UNSUPPORTED");
 const config=join(home,".codex/config.toml"), initial=`[plugins."inactive@probe"]\nenabled = false\n\n[[skills.config]]\npath = ${JSON.stringify(inactive)}\nenabled = false\n`;
 put(config,initial);
 const f={home,dataDir:join(home,"data"),projectDir:home,agents:["codex" as const],codexNativeCatalog:catalog};
 const stale=planAgentIntegration(f);
 put(config,initial.replace("enabled = false","enabled = true"));
 expect(()=>applyAgentIntegration(stale)).toThrow();
 put(config,initial);
 const plan=planAgentIntegration(f); applyAgentIntegration(plan);
 expect(read(config)).toContain('name = "active:active-skill"');
 expect(read(config)).not.toContain('name = "inactive:inert-skill"');
 expect(()=>assertManagedAgentBridge("codex",f)).not.toThrow();
 const activeNext=join(cache,"probe/active/2.0.0");
 put(join(activeNext,".codex-plugin/plugin.json"),JSON.stringify({name:"active",version:"2.0.0"}));
 put(join(activeNext,"skills/active-skill/SKILL.md"),read(active));
 // The enrolled active plugin keeps its qualified denial across cache versions.
 expect(()=>assertManagedAgentBridge("codex",f)).not.toThrow();
 const nextRoot=join(cache,"probe/inactive/2.0.0"), next=join(nextRoot,"skills/inert-skill/SKILL.md");
 put(join(nextRoot,".codex-plugin/plugin.json"),JSON.stringify({name:"inactive",version:"2.0.0",hooks:{}}));put(next,read(inactive));
 // A fresh review still needs the current exact path denial; the persisted
 // config-owned inactive proof survives a regular cache version refresh.
 expect(()=>reviewCodexPluginSkillControls(catalog,[next],cache,home,read,rules,settings)).toThrow("IDENTITY_UNSUPPORTED");
 expect(()=>assertManagedAgentBridge("codex",f)).not.toThrow();
 expect(inert(next,settings,[])).toBe(true);
 const refreshedSettings={"inactive@probe":{enabled:false}};
 expect(inert(next,refreshedSettings,[{path:next,enabled:true}])).toBe(false);
 expect(inert(next,{},[])).toBe(false);
 const sourceMissing={...catalog,plugins:catalog.plugins.map(plugin=>plugin.id==="inactive@probe" ? {...plugin,sourceType:undefined,sourceSha256:undefined,sourcePath:undefined} : plugin)};
 expect(()=>reviewCodexPluginControls(sourceMissing,[inactive,active],cache,home,read,rules,settings)).toThrow("IDENTITY_UNSUPPORTED");

 const alias=join(nextRoot,"skills/alias/SKILL.md");mkdirSync(dirname(alias),{recursive:true});symlinkSync(next,alias);
 expect(inert(alias,settings,[])).toBe(false);
 const malformed=join(cache,"probe/inactive/3.0.0");
 put(join(malformed,".codex-plugin/plugin.json"),JSON.stringify({name:"different",version:"3.0.0",hooks:{}}));
 const malformedDoc=join(malformed,"skills/inert-skill/SKILL.md");put(malformedDoc,read(inactive));
 expect(inert(malformedDoc,settings,[])).toBe(false);
 put(config,read(config).replace("enabled = false","enabled = true"));
 expect(()=>assertManagedAgentBridge("codex",f)).toThrow("NATIVE_SKILL_DRIFT");
});

test("native local installation inputs remain inventoried for evidence but are not loaded skill roots", () => {
 const home=mkdtempSync(join(tmpdir(),"skills-native-install-input-"));roots.push(home);
 const cache=join(home,".codex/plugins/cache"), installedRoot=join(cache,"probe/vendor/1.0.0"), sourceRoot=join(home,"installation-input/vendor");
 const installedDoc=join(installedRoot,"skills/deploy/SKILL.md"), sourceDoc=join(sourceRoot,"skills/deploy/SKILL.md"), sourceManifest=join(sourceRoot,".codex-plugin/plugin.json");
 put(join(installedRoot,".codex-plugin/plugin.json"),'{"name":"vendor","version":"1.0.0"}');
 put(sourceManifest,'{"name":"vendor","version":"2.0.0","hooks":{}}');
 put(installedDoc,'---\nname: deploy\ndescription: Synthetic installed fixture\n---\nInstalled body');
 put(sourceDoc,'---\nname: deploy\ndescription: Synthetic installation input\n---\nDifferent input body');
 const config=join(home,".codex/config.toml");put(config,"");
 const read=(path:string)=>readFileSync(path,"utf8"), hash=(path:string)=>createHash("sha256").update(read(path)).digest("hex");
 const catalog={version:"codex-cli 0.160.0",cwd:home,skills:[{name:"vendor:deploy",path:installedDoc,enabled:true,pluginId:"vendor@probe"}],plugins:[{id:"vendor@probe",name:"vendor",installed:true,enabled:true,localVersion:"1.0.0",sourceType:"local" as const,sourcePath:sourceRoot,sourceSha256:hashNativeJsonControls(JSON.stringify({type:"local",path:sourceRoot}))}]};
 const review=reviewCodexPluginControls(catalog,[installedDoc,sourceDoc],cache,home,read,[]);
 expect(review.skills).toHaveLength(1);expect(review.sourceInputs).toHaveLength(1);
 const sourceRoots=reviewedCodexPluginSourceRoots(cache,review.sourceInputs,read);
 const inventoryOptions={includeVendor:true,agents:["codex" as const],agentRoots:[{agent:"codex",path:sourceRoot}]};
 expect(inventoryNativeSkills(home,inventoryOptions).filter(entry=>!entry.bridge)).toHaveLength(2);
 expect(inventoryNativeSkills(home,{...inventoryOptions,codexInstallationInputRoots:sourceRoots}).filter(entry=>!entry.bridge).map(entry=>entry.path)).toEqual([dirname(installedDoc)]);
 const f={home,dataDir:join(home,"data"),projectDir:home,agents:["codex" as const],codexNativeCatalog:catalog,discoveryInputs:{version:1 as const,agents:[{agent:"codex" as const,roots:[sourceRoot],sources:[config,sourceManifest,sourceDoc].map(path=>({path,sha256:hash(path)})),directories:captureDiscoveryDirectories([dirname(sourceRoot),sourceRoot]),pluginHooks:"reviewed-no-skill-injection" as const}]}};
 const plan=planAgentIntegration(f);applyAgentIntegration(plan);
 expect(()=>assertManagedAgentBridge("codex",f)).not.toThrow();
 const stored=JSON.parse(read(join(f.dataDir,"agent-policy.json"))).bridge.discovery.codex;
 // Input-body and recursive membership churn never changes native loaded roots.
 put(sourceDoc,'---\nname: deploy\ndescription: Updated installation input\n---\nChanged upstream template');
 put(join(sourceRoot,"skills/new-template/SKILL.md"),'---\nname: template-only\ndescription: Synthetic template addition\n---\nNew input directory');
 expect(()=>assertManagedAgentBridge("codex",f)).not.toThrow();
 expect(()=>planAgentIntegration({home,dataDir:f.dataDir,projectDir:home,agents:["codex"]})).not.toThrow();
 expect(JSON.parse(read(join(f.dataDir,"agent-policy.json"))).bridge.discovery.codex).toEqual(stored);
 // Installation identity and installed capabilities remain witnessed.
 const beforeSourceManifest=read(sourceManifest);
 put(sourceManifest,'{"name":"different","version":"2.0.0"}');
 expect(()=>assertManagedAgentBridge("codex",f)).toThrow("NATIVE_SKILL_DRIFT");
 put(sourceManifest,beforeSourceManifest);
 const beforeManifest=read(join(installedRoot,".codex-plugin/plugin.json"));
 put(join(installedRoot,".codex-plugin/plugin.json"),'{"name":"vendor","version":"1.0.0","hooks":{}}');
 expect(reviewedCodexPluginCapabilitiesUnchanged(cache,review.skills,read)).toBe(false);
 expect(()=>assertManagedAgentBridge("codex",f)).toThrow("NATIVE_SKILL_DRIFT");
 put(join(installedRoot,".codex-plugin/plugin.json"),beforeManifest);
 put(join(dirname(sourceRoot),"unmapped/SKILL.md"),'---\nname: unmapped\ndescription: Synthetic unrelated root\n---\nUnreviewed input');
 expect(()=>assertManagedAgentBridge("codex",f)).toThrow("NATIVE_SKILL_DRIFT");
 // A template is not admitted by pathname, shared bytes, or missing provenance.
 expect(()=>reviewedCodexPluginSourceRoots(cache,[{...review.sourceInputs[0]!,sourceRoot:installedRoot}],read)).toThrow();
 expect(()=>reviewedCodexPluginSourceRoots(cache,[...review.sourceInputs,...review.sourceInputs],read)).toThrow();
 expect(()=>reviewCodexPluginControls({...catalog,skills:[...catalog.skills,{name:"vendor:deploy",path:sourceDoc,enabled:true,pluginId:"vendor@probe"}]},[installedDoc,sourceDoc],cache,home,read,[])).toThrow("IDENTITY_UNSUPPORTED");
 const link=join(home,"source-link");symlinkSync(sourceRoot,link);
 expect(()=>reviewedCodexPluginSourceRoots(cache,[{...review.sourceInputs[0]!,sourceRoot:link}],read)).toThrow();
 expect(()=>inventoryNativeSkills(home,{...inventoryOptions,codexInstallationInputRoots:[home]})).toThrow("unconditional skill-loading root");
 const nestedNative=join(home,".codex/skills/nested-input");mkdirSync(nestedNative,{recursive:true});
 expect(()=>inventoryNativeSkills(home,{...inventoryOptions,codexInstallationInputRoots:[nestedNative]})).toThrow("unconditional skill-loading root");
});

test("native review accepts an empty plugin cache while preserving catalog and cached-identity refusals", () => {
 const home=mkdtempSync(join(tmpdir(),"skills-empty-plugin-cache-")); roots.push(home);
 const cache=join(home,".codex/plugins/cache"), bridge=join(home,".codex/skills/skills-cli/SKILL.md"), system=join(home,".codex/skills/.system/probe/SKILL.md");
 applyAgentIntegration(planAgentIntegration({home,dataDir:join(home,"data"),projectDir:home,agents:["codex"]}));
 put(system,"---\nname: probe\ndescription: Synthetic system skill\n---\nFixture");
 const catalog={version:"codex-cli 0.160.0",cwd:home,skills:[{name:"skills-cli",path:bridge,enabled:true,pluginId:null}],plugins:[]};
 const read=(path:string)=>readFileSync(path,"utf8");
 expect(reviewCodexPluginSkillControls(catalog,[],cache,home,read,[])).toEqual([]);
 expect(reviewCodexPluginSkillControls(catalog,[bridge,system],cache,home,read,[])).toEqual([]);
 // An installed plugin need not supply skill documents.
 expect(reviewCodexPluginSkillControls({...catalog,plugins:[{id:"vendor@probe",name:"vendor",installed:true,enabled:true,localVersion:"1.0.0"}]},[system],cache,home,read,[])).toEqual([]);
 expect(()=>planAgentIntegration({home,dataDir:join(home,"data"),projectDir:home,agents:["codex"],codexNativeCatalog:catalog})).not.toThrow();
 expect(()=>reviewCodexPluginSkillControls({...catalog,version:"codex-cli 0.161.0"},[],cache,home,read,[])).toThrow("IDENTITY_UNSUPPORTED");
 expect(()=>reviewCodexPluginSkillControls({...catalog,cwd:join(home,"other")},[],cache,home,read,[])).toThrow("IDENTITY_UNSUPPORTED");
 expect(()=>reviewCodexPluginSkillControls({...catalog,skills:[{...catalog.skills[0]!,enabled:"true" as any}]},[],cache,home,read,[])).toThrow("CATALOG_INVALID");
 expect(()=>reviewCodexPluginSkillControls({...catalog,plugins:[{id:"vendor@probe",name:"vendor",installed:"true" as any,enabled:true,localVersion:"1.0.0"}]},[],cache,home,read,[])).toThrow("IDENTITY_UNSUPPORTED");
 const documents=["1.0.0","2.0.0"].map(version=>{
  const root=join(cache,"probe/vendor",version), document=join(root,"skills/deploy/SKILL.md");
  put(join(root,".codex-plugin/plugin.json"),JSON.stringify({name:"vendor",version}));
  put(document,"---\nname: deploy\ndescription: Synthetic cached identity\n---\nFixture");
  return document;
 });
 expect(()=>reviewCodexPluginSkillControls(catalog,[documents[0]!],cache,home,read,[])).toThrow("IDENTITY_UNSUPPORTED");
 expect(()=>reviewCodexPluginSkillControls({...catalog,plugins:undefined},[documents[0]!],cache,home,read,[])).toThrow("IDENTITY_UNSUPPORTED");
 const listed={...catalog,skills:documents.map(path=>({name:"vendor:deploy",path,enabled:false,pluginId:"vendor@probe"}))};
 expect(()=>reviewCodexPluginSkillControls(listed,documents,cache,home,read,[])).toThrow("IDENTITY_UNSUPPORTED");
});


test("reviewed stdio MCP capabilities stay available and bound when only the native skill name is denied", () => {
 const home=mkdtempSync(join(tmpdir(),"skills-mcp-controls-")); roots.push(home);
 const cache=join(home,".codex/plugins/cache"), parent=join(cache,"probe/vendor"), root=join(parent,"1.0.0"), document=join(root,"skills/deploy/SKILL.md"), mcp=join(root,".mcp.json"), manifest=join(root,".codex-plugin/plugin.json");
 const manifestText=JSON.stringify({name:"vendor",version:"1.0.0",mcpServers:"./.mcp.json"});
 const mcpText=JSON.stringify({mcpServers:{probe:{command:"synthetic-never-executed",args:["--fixture"],cwd:"${CODEX_PLUGIN_ROOT}",env_vars:["SKILLS_SYNTHETIC_NAME"]}}});
 const add=(r:string,version:string)=>{
  put(join(r,".codex-plugin/plugin.json"),JSON.stringify({name:"vendor",version,mcpServers:"./.mcp.json"}));
  put(join(r,".mcp.json"),mcpText);
  put(join(r,"skills/deploy/SKILL.md"),"---\nname: deploy\ndescription: Synthetic MCP skill fixture\n---\nDisabled body");
 };
 add(root,"1.0.0");
 const read=(path:string)=>readFileSync(path,"utf8"), catalog={version:"codex-cli 0.160.0",cwd:home,skills:[{name:"vendor:deploy",path:document,enabled:false,pluginId:"vendor@probe"}],plugins:[{id:"vendor@probe",name:"vendor",installed:true,enabled:true,localVersion:"1.0.0"}]};
 const controls=reviewCodexPluginSkillControls(catalog,[document],cache,home,read,[]);
 expect(controls[0]?.mcpSha256).toMatch(/^[a-f0-9]{64}$/);
 expect(()=>assertAgentPolicyCollections({bridge:{codexPluginSkills:controls}})).not.toThrow();
 expect(()=>assertAgentPolicyCollections({bridge:{codexPluginSkills:[{...controls[0],mcpSha256:"invalid"}]}})).toThrow();
 const f={home,dataDir:join(home,"data"),projectDir:home};
 const plan=planAgentIntegration({...f,agents:["codex"],codexNativeCatalog:catalog});
 expect(read(mcp)).toBe(mcpText);
 expect(plan.changes.some(file=>file.path===mcp || file.path===manifest)).toBe(false);
 applyAgentIntegration(plan);
 expect(read(mcp)).toBe(mcpText);expect(read(manifest)).toBe(manifestText);
 expect(read(join(home,".codex/config.toml"))).toContain('name = "vendor:deploy"');
 expect(()=>assertManagedAgentBridge("codex",f)).not.toThrow();
 const next=join(parent,"2.0.0"), nextDocument=join(next,"skills/deploy/SKILL.md");add(next,"2.0.0");
 const rules=[{name:"vendor:deploy",enabled:false}];
 expect(isReviewedCodexPluginSkillDisabled(nextDocument,cache,controls,rules,read)).toBe(true);
 for(const changed of [mcpText.replace("--fixture","--changed"),JSON.stringify({mcpServers:{probe:{command:"synthetic-never-executed",args:[]}}}),JSON.stringify({mcpServers:{probe:{command:"synthetic-never-executed"},extra:{command:"other"}}})]) {
  put(join(next,".mcp.json"),changed);
  expect(isReviewedCodexPluginSkillDisabled(nextDocument,cache,controls,rules,read)).toBe(false);
  expect(reviewedCodexPluginCapabilitiesUnchanged(cache,controls,read)).toBe(false);
  expect(()=>assertManagedAgentBridge("codex",f)).toThrow("NATIVE_SKILL_DRIFT");
 }
 put(join(next,".mcp.json"),mcpText);
 rmSync(join(next,".mcp.json"));expect(isReviewedCodexPluginSkillDisabled(nextDocument,cache,controls,rules,read)).toBe(false);expect(reviewedCodexPluginCapabilitiesUnchanged(cache,controls,read)).toBe(false);
 put(join(next,".mcp.json"),mcpText);
 const stale=planAgentIntegration({...f,agents:["codex"],codexNativeCatalog:catalog});
 put(mcp,mcpText.replace("--fixture","--stale"));expect(()=>applyAgentIntegration(stale)).toThrow();put(mcp,mcpText);
 const review=()=>reviewCodexPluginSkillControls(catalog,[document],cache,home,read,[]);
 for(const invalid of [
  '{"mcpServers":{"probe":{"command":"first","command":"second"}}}',
  '{"mcpServers":{"probe":{"command":"synthetic-never-executed"}},"unknown":true}',
  JSON.stringify({mcpServers:{probe:{url:"https://example.invalid/mcp"}}}),
  ...["hooks","instructions","auth","oauth","unknown"].map(key=>JSON.stringify({mcpServers:{probe:{command:"synthetic-never-executed",[key]:"unsupported"}}})),
  JSON.stringify({mcpServers:{probe:{command:12}}}),JSON.stringify({mcpServers:{probe:{command:"synthetic-never-executed",args:[12]}}}),
  JSON.stringify({mcpServers:{probe:{command:"synthetic-never-executed",cwd:12}}}),JSON.stringify({mcpServers:{probe:{command:"synthetic-never-executed",env_vars:["INVALID-NAME"]}}}),
 ]) {put(mcp,invalid);expect(review).toThrow("IDENTITY_UNSUPPORTED");}
 put(mcp,mcpText);
 for(const reference of ["other.json","./../outside.json","/absolute.json"]) {put(manifest,JSON.stringify({name:"vendor",version:"1.0.0",mcpServers:reference}));expect(review).toThrow("IDENTITY_UNSUPPORTED");}
 put(manifest,manifestText);
 const external=join(home,"external-mcp.json");put(external,mcpText);rmSync(mcp);symlinkSync(external,mcp);expect(review).toThrow("IDENTITY_UNSUPPORTED");
 rmSync(mcp);put(mcp,mcpText);put(manifest,JSON.stringify({name:"vendor",version:"1.0.0"}));expect(review).toThrow("IDENTITY_UNSUPPORTED");
 rmSync(mcp);const beforeMcp=review();
 put(mcp,mcpText);put(manifest,manifestText);
 expect(isReviewedCodexPluginSkillDisabled(document,cache,beforeMcp,rules,read)).toBe(false);
 expect(reviewedCodexPluginCapabilitiesUnchanged(cache,beforeMcp,read)).toBe(false);
});

test("Codex stdio tool metadata preserves capabilities during exact skill denial", () => {
 const home=mkdtempSync(join(tmpdir(),"skills-mcp-tool-metadata-")); roots.push(home);
 const f={home,dataDir:join(home,"data"),projectDir:home}, cache=join(home,".codex/plugins/cache"), parent=join(cache,"probe/vendor"), root=join(parent,"1.0.0"), document=join(root,"skills/deploy/SKILL.md"), mcp=join(root,".mcp.json");
 const server={command:"synthetic-never-executed",args:["--fixture"],cwd:"${CODEX_PLUGIN_ROOT}",env:{},env_vars:["SKILLS_SYNTHETIC_NAME"],enabled:false,default_tools_approval_mode:"approve",omit_tools_from:["deferred"],startup_timeout_sec:30,tool_timeout_sec:60,tools:{synthetic_tool:{approval_mode:"prompt"}}};
 const text=JSON.stringify({mcpServers:{probe:server}}), read=(path:string)=>readFileSync(path,"utf8");
 const add=(dir:string,version:string)=>{put(join(dir,".codex-plugin/plugin.json"),JSON.stringify({name:"vendor",version,mcpServers:"./.mcp.json"}));put(join(dir,".mcp.json"),text);put(join(dir,"skills/deploy/SKILL.md"),"---\nname: deploy\ndescription: Synthetic tool metadata\n---\nDisabled body");};
 add(root,"1.0.0");
 const catalog={version:"codex-cli 0.160.0",cwd:home,skills:[{name:"vendor:deploy",path:document,enabled:false,pluginId:"vendor@probe"}],plugins:[{id:"vendor@probe",name:"vendor",installed:true,enabled:true,localVersion:"1.0.0"}]};
 const review=()=>reviewCodexPluginSkillControls(catalog,[document],cache,home,read,[]), controls=review();
 const plan=planAgentIntegration({...f,agents:["codex"],codexNativeCatalog:catalog});
 expect(plan.changes.some(change=>change.path===mcp)).toBe(false);
 applyAgentIntegration(plan);expect(read(mcp)).toBe(text);expect(()=>assertManagedAgentBridge("codex",f)).not.toThrow();
 expect(read(join(home,".codex/config.toml"))).toContain('name = "vendor:deploy"');
 const next=join(parent,"2.0.0"), nextDocument=join(next,"skills/deploy/SKILL.md"), rules=[{name:"vendor:deploy",enabled:false}];add(next,"2.0.0");
 expect(isReviewedCodexPluginSkillDisabled(nextDocument,cache,controls,rules,read)).toBe(true);
 for (const changed of [
  {...server,enabled:true},{...server,env:{SKILLS_SYNTHETIC_VALUE:"public-fixture"}},
  {...server,default_tools_approval_mode:"prompt"},{...server,omit_tools_from:["direct"]},
  {...server,startup_timeout_sec:31},{...server,tool_timeout_sec:61},
  {...server,tools:{synthetic_tool:{approval_mode:"writes",output_token_limit:100}}},
  {...server,enabled_tools:["synthetic_tool"]},{...server,tools:{}},
 ]) {put(join(next,".mcp.json"),JSON.stringify({mcpServers:{probe:changed}}));expect(isReviewedCodexPluginSkillDisabled(nextDocument,cache,controls,rules,read)).toBe(false);expect(reviewedCodexPluginCapabilitiesUnchanged(cache,controls,read)).toBe(false);}
 put(join(next,".mcp.json"),text);
 const stale=planAgentIntegration({...f,agents:["codex"],codexNativeCatalog:catalog});
 put(mcp,JSON.stringify({mcpServers:{probe:{...server,tools:{}}}}));expect(()=>applyAgentIntegration(stale)).toThrow();put(mcp,text);
 for (const metadata of [
  {args:null,cwd:null,env:null,env_vars:null,enabled:null,required:null,tools:null,default_tools_approval_mode:null,omit_tools_from:null,startup_timeout_sec:null,tool_timeout_sec:null},
  {env:{SKILLS_SYNTHETIC_VALUE:"public-fixture"},enabled_tools:[],disabled_tools:["synthetic_tool"],required:false,startup_readiness:"catalog",environment_id:"local",supports_parallel_tool_calls:true,tool_input_schema_max_bytes:100,startup_timeout_ms:0,tools:{synthetic_tool:{approval_mode:"auto",output_token_limit:100}}},
 ]) {put(mcp,JSON.stringify({mcpServers:{probe:{...server,...metadata}}}));expect(review).not.toThrow();}
 for (const invalid of [
  {enabled:"false"},{env:{SKILLS_SYNTHETIC_VALUE:12}},{env:["unsupported"]},{environment_id:"remote"},
  {default_tools_approval_mode:"always"},{startup_timeout_sec:-1},{tool_timeout_sec:"60"},{startup_timeout_ms:0.5},
  {omit_tools_from:["unknown"]},{enabled_tools:[12]},{disabled_tools:"synthetic_tool"},
  {tools:{synthetic_tool:{approval_mode:"unknown"}}},{tools:{synthetic_tool:{output_token_limit:0}}},{tools:{synthetic_tool:{instructions:"unsupported"}}},
  {tools:{synthetic_tool:"unsupported"}},{auth:"oauth"},{url:"https://example.invalid/mcp"},{oauth:{}},{http_headers:{}},
  {hooks:{}},{instructions:"unreviewed"},{env_vars:[{name:"SKILLS_SYNTHETIC_NAME",source:"remote"}]},
 ]) {put(mcp,JSON.stringify({mcpServers:{probe:{...server,...invalid}}}));expect(review).toThrow("IDENTITY_UNSUPPORTED");}
 put(mcp,'{"mcpServers":{"probe":{"command":"synthetic-never-executed","tools":{"synthetic_tool":{"approval_mode":"auto","approval_mode":"approve"}}}}}');expect(review).toThrow("IDENTITY_UNSUPPORTED");
});
