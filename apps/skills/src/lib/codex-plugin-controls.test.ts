import { test, expect, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { useDefaultTestTimeout } from "../test-preload.js";
import { planAgentIntegration, applyAgentIntegration, assertManagedAgentBridge } from "./agent-integration.js";
import { reviewCodexPluginSkillControls, isReviewedCodexPluginSkillDisabled } from "./codex-plugin-skill-controls.js";
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
