import { test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, renameSync, rmSync, symlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { planAgentIntegration, applyAgentIntegration, assertManagedAgentBridge } from "./agent-integration.js";
import { reviewedCodexPluginCapabilitiesUnchanged } from "./codex-plugin-skill-controls.js";
import { captureCodexSettingsV3 } from "./codex-settings-witness.js";
import { captureDiscoveryDirectories, verifyAgentDiscovery } from "./agent-discovery.js";
import { parseManagedSkillPolicy } from "./managed-policy.js";
import { admitCorpusFixture, installCorpusInspectorFixture } from "./codex-corpus.fixture.js";
import { useDefaultTestTimeout } from "../test-preload.js";
useDefaultTestTimeout();
const put=(p:string,s:string)=>{mkdirSync(dirname(p),{recursive:true});writeFileSync(p,s);};
const hash=(p:string)=>createHash("sha256").update(readFileSync(p)).digest("hex");
for (const wholeParent of [false,true]) for (const directoryKind of ["none","parent","cache"] as const) test(`reviewed Codex retirement: whole parent=${wholeParent}, directory=${directoryKind}`,()=>{
  const includeDirectories=directoryKind!=="none";
  const restore=installCorpusInspectorFixture();
  let home:string|undefined;
  try {
    home=mkdtempSync(join(tmpdir(),"skills-retired-lifecycle-"));admitCorpusFixture(join(home,".codex"));
    const f={home,dataDir:join(home,"data"),projectDir:home};
    const cache=join(home,".codex/plugins/cache"),parent=join(cache,"openai-curated-remote/recorder"),old=join(parent,"0.4.0"),active=join(parent,"0.4.1");
    const oldManifest=join(old,".codex-plugin/plugin.json"),manifest=join(active,".codex-plugin/plugin.json"),document=join(active,"skills/record-browser/SKILL.md"),config=join(home,".codex/config.toml"),receipt=join(parent,".codex-remote-plugin-install.json");
    const remotePluginId="plugins~Plugin_00000000000000000000000000000003";
    // A previously archived old payload leaves its manifest; both manifests are capability-identical apart from version.
    put(oldManifest,JSON.stringify({name:"recorder",version:"0.4.0",description:"Recorder"}));
    put(manifest,JSON.stringify({name:"recorder",version:"0.4.1",description:"Recorder"}));
    put(document,"---\nname: record-browser\ndescription: Synthetic lifecycle fixture\n---\nFixture\n");
    put(receipt,JSON.stringify({schema_version:1,remote_plugin_id:remotePluginId}));
    put(config,`[plugins."recorder@openai-curated-remote"]\nenabled = true\n[[skills.config]]\nname = "recorder:record-browser"\nenabled = false\n`);
    const catalog={version:"codex-cli 0.160.0",cwd:home,skills:[],plugins:[{id:"recorder@openai-curated-remote",name:"recorder",installed:true,enabled:true,localVersion:null,remotePluginId,sourceType:"remote" as const}]};
    const sibling=join(cache,"unrelated/retained/data");put(sibling,"Retained membership");
    const review={version:1 as const,agents:[{agent:"codex" as const,roots:[cache],sources:[captureCodexSettingsV3(config),...[oldManifest,manifest,receipt].map(path=>({path,sha256:hash(path)}))],...(includeDirectories ? {directories:captureDiscoveryDirectories([directoryKind==="cache" ? cache : parent])}:{}),pluginHooks:"reviewed-no-skill-injection" as const}]};
    const plan=planAgentIntegration({...f,agents:["codex"],codexNativeCatalog:catalog,discoveryInputs:review});
    applyAgentIntegration(plan);
    expect(()=>assertManagedAgentBridge("codex",f)).not.toThrow();
    const before=readFileSync(config,"utf8"),saved=readFileSync(join(f.dataDir,"agent-policy.json"),"utf8"),controls=parseManagedSkillPolicy(saved).bridge.codexPluginSkills;
    const target=wholeParent ? parent : old,preserved=join(home,"preserved-disabled-graph");
    renameSync(target,preserved);
    expect(readFileSync(config,"utf8")).toBe(before);
    expect(reviewedCodexPluginCapabilitiesUnchanged(cache,controls,p=>readFileSync(p,"utf8"),(Bun.TOML.parse(before) as any).skills.config)).toBe(true);
    let message:string|null=null;try { assertManagedAgentBridge("codex",f); } catch(e) {message=(e as Error).message;}
    console.log(JSON.stringify({includeDirectories,plannerCreatedPolicy:true,beforePromptGuardPassed:true,afterActiveCapabilityGuardPassed:true,afterPromptGuard:message}));
    expect(message).toBeNull();
    const legacy:any={...parseManagedSkillPolicy(saved).bridge.discovery.codex,codexDisabledPluginSkills:controls.map(({skillsOnly,...control}:any)=>control)};delete legacy.codexRetiredMaterializations;
    expect(()=>verifyAgentDiscovery(legacy)).toThrow();
    applyAgentIntegration(planAgentIntegration({...f,agents:["codex"]}));
    expect(()=>assertManagedAgentBridge("codex",f)).not.toThrow();
    const rebound=parseManagedSkillPolicy(readFileSync(join(f.dataDir,"agent-policy.json"),"utf8")).bridge.discovery.codex;
    expect(rebound.sources).toEqual(parseManagedSkillPolicy(saved).bridge.discovery.codex.sources);
    expect(rebound.directories).toEqual(parseManagedSkillPolicy(saved).bridge.discovery.codex.directories);
    const refuse=()=>expect(()=>assertManagedAgentBridge("codex",f)).toThrow();
    if(directoryKind==="cache") {put(join(cache,"unrelated/retained/unknown"),"Unreviewed member");refuse();rmSync(join(cache,"unrelated/retained/unknown"));}
    put(config,before+'\n[[skills.config]]\nname = " recorder:record-browser "\nenabled = true\n');refuse();put(config,before);
    symlinkSync(preserved,target);refuse();rmSync(target);renameSync(preserved,target);
    put(receipt,JSON.stringify({schema_version:1,remote_plugin_id:"plugins~Plugin_00000000000000000000000000000004"}));refuse();put(receipt,JSON.stringify({schema_version:1,remote_plugin_id:remotePluginId}));
    const metadata=readFileSync(manifest,"utf8");put(manifest,metadata.replace('Recorder','Unreviewed'));refuse();put(manifest,metadata);
    const stale=planAgentIntegration({...f,agents:["codex"]});put(join(active,"hooks/hooks.json"),"{}");expect(()=>applyAgentIntegration(stale)).toThrow();expect(readFileSync(config,"utf8")).toBe(before);rmSync(join(active,"hooks"),{recursive:true});
    expect(()=>assertManagedAgentBridge("codex",f)).not.toThrow();

  } finally {restore();if(home) rmSync(home,{recursive:true,force:true});}
});
