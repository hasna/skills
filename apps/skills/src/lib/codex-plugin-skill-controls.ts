/** Reviewed native identity continuity; never starts a native consumer. */
import { createHash } from "node:crypto";
import { isCodexLocalStdioMcpServer } from "./codex-local-mcp-controls.js";
import { hashNativeJsonControls } from "./claude-settings-witness.js";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { lstatSync, readdirSync, readlinkSync, realpathSync } from "node:fs";
import { supportsCodexNativeCapability } from "./codex-native-compatibility.js";
import { codexPluginSourceIsConfigControlled, isCodexNativeSkillDisabled, projectCodexInstalledPluginEntries, projectCodexNativeSkillCatalog, remotePluginIdentifier, type CodexNativeSkillCatalog } from "./codex-native-skill-catalog.js";
export interface CodexPluginSkillControl { name:string; pluginId:string; namespace:string; pluginParent:string; manifestSha256:string; appSha256?:string; mcpSha256?:string; remotePluginId?:string; skillsOnly?:true }
/** A native nonremote installation disabled by the witnessed configuration.
 * Its cache is inert; this makes no claim about reviewed hook capabilities. */
export interface CodexInactivePluginControl { pluginId:string; namespace:string; pluginParent:string; sourceType:"local"|"git"|"npm"; sourceSha256:string }
export interface ReviewedCodexSkillDenial { name:string; path:string; sha256:string }
export interface CodexPluginSourceInput { pluginId:string; namespace:string; pluginParent:string; sourceRoot:string; sourceSha256:string }
const identifier = (v:unknown):v is string => typeof v === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(v);
const CODEX_DEFAULT_AGENT_PLUGIN_VERSION = "1.0.0";
function refuse():never { throw new Error("CODEX_NATIVE_SKILL_IDENTITY_UNSUPPORTED: review native plugin names and hook controls"); }
type Read = (path:string) => string;
/** Codex's schema-1 receipt identifies a remote installation, not its current
 * version. It can support review of an explicitly denied cache materialization;
 * it never establishes that the materialization is the native selected root. */
function remoteInstallationMatches(parent:string, remotePluginId:string, read:Read):boolean {
  try {
    if (!remotePluginIdentifier(remotePluginId) || !lstatSync(parent).isDirectory() || realpathSync(parent)!==parent) return false;
    const path=join(parent,".codex-remote-plugin-install.json"), stat=lstatSync(path,{throwIfNoEntry:false});
    if (!stat?.isFile() || stat.isSymbolicLink() || stat.size>16384) return false;
    const text=read(path);
    hashNativeJsonControls(text); // Reject duplicate decoded keys as Codex serde does.
    const value=JSON.parse(text);
    return Boolean(value && typeof value==="object" && !Array.isArray(value)
      && Object.keys(value).length===2 && value.schema_version===1 && value.remote_plugin_id===remotePluginId);
  } catch { return false; }
}
function appControls(path:string, read:Read):string {
  const text=read(path);
  let value:any, sha256:string; try { sha256=hashNativeJsonControls(text); value=JSON.parse(text); } catch { refuse(); }
  const object=(v:any):boolean => Boolean(v && typeof v==="object" && !Array.isArray(v));
  if (!object(value) || Object.keys(value).length!==1 || !object(value.apps)) refuse();
  const apps=Object.entries(value.apps);
  if (!apps.length || apps.length>256) refuse();
  for (const [name, entry] of apps as [string,any][]) {
    if (!identifier(name) || !object(entry) || !Object.keys(entry).every(key=>["id","category","required"].includes(key))
      || typeof entry.id!=="string" || !/^[A-Za-z0-9_-]{1,256}$/.test(entry.id)
      || (entry.category!==undefined && (typeof entry.category!=="string" || !entry.category.trim() || entry.category.length>256 || /[\x00-\x1f\x7f]/.test(entry.category)))
      || (entry.required!==undefined && typeof entry.required!=="boolean")) refuse();
  }
  return sha256;
}
/** Codex 0.160 local stdio controls, including its optional tool metadata.
 * The complete declaration stays fingerprinted; no command or env is resolved. */
function mcpControls(path:string, read:Read):string {
  const text=read(path);
  let value:any, sha256:string; try { sha256=hashNativeJsonControls(text); value=JSON.parse(text); } catch { refuse(); }
  const object=(v:any):boolean => Boolean(v && typeof v==="object" && !Array.isArray(v));
  if (!object(value) || Object.keys(value).length!==1 || !object(value.mcpServers)) refuse();
  const servers=Object.entries(value.mcpServers);
  if (!servers.length || servers.length>256) refuse();
  for (const [name, server] of servers) if (!isCodexLocalStdioMcpServer(name, server)) refuse();
  return sha256;
}
/** Verified subset of Codex 0.159.2/0.160.0 plugin/src/bundled_hooks.rs.
 * These native cleanup calls use structured event values, never executable text.
 * The entire inline declaration remains included in manifestSha256. This is
 * capability review, not plugin signing, enablement or native hook trust. */
function isBundledCleanupHooks(root:string, namespace:string, value:unknown):boolean {
  const object=(v:unknown):v is Record<string,unknown> => Boolean(v && typeof v==="object" && !Array.isArray(v));
  const exactKeys=(v:Record<string,unknown>, keys:string[]) => Object.keys(v).length===keys.length && keys.every(key=>Object.hasOwn(v,key));
  if (basename(dirname(root))!==namespace || basename(dirname(dirname(root)))!=="openai-bundled") return false;
  const server=namespace==="unified-computer-use" ? "cua_repl"
    : ["browser","chrome","chrome-dev","chrome-internal","computer-use"].includes(namespace) ? "node_repl" : undefined;
  if (!server || !object(value) || !exactKeys(value,["hooks"]) || !object(value.hooks)) return false;
  const events=Object.entries(value.hooks);
  if (!events.length || events.length>3) return false;
  for (const [event,groups] of events) {
    if (!["Interrupt","SubagentStop","Stop"].includes(event) || !Array.isArray(groups) || groups.length!==1) return false;
    const group=groups[0];
    if (!object(group) || !exactKeys(group,["hooks"]) || !Array.isArray(group.hooks) || group.hooks.length!==1) return false;
    const handler=group.hooks[0];
    if (!object(handler) || !exactKeys(handler,["type","server","tool","input"])
      || handler.type!=="mcp_tool" || handler.server!==server || handler.tool!=="turn_ended"
      || !object(handler.input) || !exactKeys(handler.input,["hook_event_name","session_id","turn_id"])
      || handler.input.hook_event_name!=="${hook_event_name}" || handler.input.turn_id!=="${turn_id}"
      || handler.input.session_id!==(event==="SubagentStop" ? "${agent_id}" : "${session_id}")) return false;
  }
  return true;
}
function rootControls(root:string, read:Read): { namespace:string; manifestSha256:string; appSha256?:string; mcpSha256?:string } {
  const manifestPath=join(root,".codex-plugin/plugin.json"), manifestFile=lstatSync(manifestPath,{throwIfNoEntry:false});
  if (!lstatSync(join(root,".codex-plugin"),{throwIfNoEntry:false})?.isDirectory() || !manifestFile?.isFile() || manifestFile.size>1024*1024) refuse();
  let manifest:any, manifestSha256:string;
  try { const text=read(manifestPath); manifestSha256=hashNativeJsonControls(text,"version"); manifest=JSON.parse(text); } catch { refuse(); }
  if (!manifest || typeof manifest!=="object" || Array.isArray(manifest) || !identifier(manifest.name)) refuse();
  const cacheVersion=basename(root), declaredVersion=manifest.version === undefined ? "" : typeof manifest.version === "string" ? manifest.version.trim() : null;
  // Codex 0.159.2 treats a missing/blank Agent Plugin version as 1.0.0;
  // any declared version must agree with the exact installed cache directory.
  if (declaredVersion === null || (declaredVersion ? declaredVersion !== cacheVersion : cacheVersion !== CODEX_DEFAULT_AGENT_PLUGIN_VERSION)) refuse();
  // Exact name controls suppress Skills bodies, not other capabilities.
  // Reviewed app declarations preserve connector availability and native hints;
  // their entire content and presence stay bound across cache versions.
  if ((manifest.hooks!==undefined && !isBundledCleanupHooks(root,manifest.name,manifest.hooks)) || manifest.commands!==undefined
    || (manifest.mcpServers!==undefined && manifest.mcpServers!=="./.mcp.json")
    || (manifest.apps!==undefined && manifest.apps!=="./.app.json")
    || lstatSync(join(root,"hooks"),{throwIfNoEntry:false})) refuse();
  const mcp=join(root,".mcp.json"), mcpPresent=lstatSync(mcp,{throwIfNoEntry:false});
  // Cleanup support proves only the builtin target. Do not admit a plugin MCP
  // declaration alongside it, even when that declaration is otherwise valid.
  if (manifest.hooks!==undefined && (manifest.mcpServers!==undefined || mcpPresent)) refuse();
  if (mcpPresent && (!mcpPresent.isFile() || mcpPresent.isSymbolicLink() || mcpPresent.size>1024*1024 || realpathSync(mcp)!==mcp)) refuse();
  if (Boolean(mcpPresent)!==(manifest.mcpServers!==undefined)) refuse();
  const mcpSha256=mcpPresent ? mcpControls(mcp,read) : undefined;
  const app=join(root,".app.json"), present=lstatSync(app,{throwIfNoEntry:false});
  if (present && (!present.isFile() || present.isSymbolicLink() || present.size>1024*1024)) refuse();
  if (manifest.apps!==undefined && !present) refuse();
  const appSha256=present ? appControls(app,read) : undefined;
  return {namespace:manifest.name,manifestSha256,...(appSha256 ? {appSha256} : {}),...(mcpSha256 ? {mcpSha256} : {})};
}
function documentIdentity(document:string, cache:string, read:Read): { name:string; namespace:string; pluginParent:string; root:string } {
  if (!document.startsWith(cache+sep) || !document.endsWith(sep+"SKILL.md")) refuse();
  const text = read(document);
  if (Buffer.byteLength(text)>1024*1024) refuse();
  const lines = text.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") refuse();
  const end = lines.findIndex((line,i) => i>0 && line.trim()==="---");
  if (end<2) refuse();
  const yaml = lines.slice(1,end).join("\n");
  // This deliberately bounded YAML subset excludes aliases, tags, merge keys,
  // duplicate name fields and native repair/fallback. It never guesses a name.
  if (/(?:^|\s)[&*!]|<<\s*:/.test(yaml) || lines.slice(1,end).filter(line => /^name\s*:/.test(line)).length!==1) refuse();
  let front:any; try { front=Bun.YAML.parse(yaml); } catch { refuse(); }
  if (!front || typeof front!=="object" || !identifier(front.name) || typeof front.description!=="string" || !front.description.trim()) refuse();
  for (let root=dirname(document), depth=0; root.startsWith(cache+sep) && depth<12; root=dirname(root),depth++) {
    const path=join(root,".codex-plugin","plugin.json");
    if (!lstatSync(path,{throwIfNoEntry:false})) continue;
    const manifestFile=lstatSync(path);
    if (!lstatSync(join(root,".codex-plugin")).isDirectory() || !manifestFile.isFile() || manifestFile.size>1024*1024) refuse();
    let manifest:any;
    try { const text=read(path); hashNativeJsonControls(text); manifest=JSON.parse(text); } catch { refuse(); }
    if (!manifest || typeof manifest!=="object" || Array.isArray(manifest) || !identifier(manifest.name)) refuse();
    const declaredVersion=manifest.version === undefined ? "" : typeof manifest.version === "string" ? manifest.version.trim() : null;
    if (declaredVersion === null || (declaredVersion ? declaredVersion!==basename(root) : basename(root)!==CODEX_DEFAULT_AGENT_PLUGIN_VERSION)) refuse();
    return {name:`${manifest.name}:${front.name}`,namespace:manifest.name,pluginParent:dirname(root),root};
  }
  refuse();
}
function identity(document:string, cache:string, read:Read): { name:string; namespace:string; pluginParent:string; manifestSha256:string; appSha256?:string; mcpSha256?:string } {
  const parsed=documentIdentity(document,cache,read);
  const controls=rootControls(parsed.root,read);
  if (controls.namespace!==parsed.namespace) refuse();
  return {name:parsed.name,pluginParent:parsed.pluginParent,...controls};
}
export interface CodexPluginCacheDocumentIdentity { name:string; namespace:string; pluginId:string; pluginParent:string; root:string; manifestSha256:string }
/** Classify one cache document as installed-plugin content through the same
 * manifest identity, capability review and real-path binding the reviewed
 * predicates use. This is identity only: it consults no enable rule, reviewed
 * control or native catalog, and it never admits anything by itself. */
export function classifyCodexPluginCacheDocument(document:string, cache:string, read:Read):CodexPluginCacheDocumentIdentity|null {
  if (!document.startsWith(cache+sep)) return null;
  try {
    const located=documentIdentity(document,cache,read), parsed=identity(document,cache,read);
    if (!lstatSync(document).isFile() || realpathSync(document)!==document || realpathSync(located.root)!==located.root || realpathSync(located.pluginParent)!==located.pluginParent
      || realpathSync(join(located.root,".codex-plugin/plugin.json"))!==join(located.root,".codex-plugin/plugin.json")) return null;
    const parts=relative(cache,parsed.pluginParent).split(sep);
    if (parts.length!==2 || parts.some(part=>!identifier(part)) || parts[1]!==parsed.namespace) return null;
    return {name:parsed.name,namespace:parsed.namespace,pluginId:`${parts[1]}@${parts[0]}`,pluginParent:parsed.pluginParent,root:located.root,manifestSha256:parsed.manifestSha256};
  } catch { return null; }
}
/** Establish the reviewed denial/skills-only role for an exact remote parent.
 * Walk every ancestor: a dangling alias or non-directory is never absence. */
export function reviewedDisabledCodexPluginParent(cache:string, parent:string, controls:CodexPluginSkillControl[], rules:unknown):boolean {
  try {
    const parts=relative(cache,parent).split(sep), enrolled=controls.filter(control=>control.pluginParent===parent);
    if (resolve(parent)!==parent || parts.length!==2 || parts.some(part=>!identifier(part)) || !enrolled.length || !Array.isArray(rules)) return false;
    for (let cursor=parent;;cursor=dirname(cursor)) {
      const stat=lstatSync(cursor,{throwIfNoEntry:false});
      if (stat && (!stat.isDirectory() || stat.isSymbolicLink())) return false;
      if (dirname(cursor)===cursor) break;
    }
    return enrolled.every(control=>control.namespace===parts[1] && control.pluginId===`${parts[1]}@${parts[0]}`
      && remotePluginIdentifier(control.remotePluginId) && control.skillsOnly===true && !control.appSha256 && !control.mcpSha256
      && control.name.startsWith(control.namespace+":") && /^[a-f0-9]{64}$/.test(control.manifestSha256)
      && rules.some((rule:any)=>typeof rule?.name==="string" && rule.name.trim()===control.name && rule.enabled===false)
      && !rules.some((rule:any)=>(typeof rule?.name==="string" && rule.name.trim()===control.name || typeof rule?.path==="string" && (rule.path===parent || rule.path.startsWith(parent+sep))) && rule.enabled!==false));
  } catch { return false; }
}
export function absentDisabledCodexPluginParent(cache:string, parent:string, controls:CodexPluginSkillControl[], rules:unknown):boolean {
  return reviewedDisabledCodexPluginParent(cache,parent,controls,rules) && !lstatSync(parent,{throwIfNoEntry:false});
}
/** A body-free historical remote version has no remaining native skill entry.
 * Bind its capability-identical, skills-only identity before projecting it. */
export function reviewedRetiredCodexRoot(cache:string, root:string, controls:CodexPluginSkillControl[], rules:unknown, read:Read, allowAbsent=false):boolean {
  try {
    const parent=dirname(root),parts=relative(cache,parent).split(sep),enrolled=controls.filter(control=>control.pluginParent===parent);
    if (resolve(root)!==root || parts.length!==2 || parts.some(part=>!identifier(part)) || !basename(root) || basename(root)==="latest" || !enrolled.length || !Array.isArray(rules)) return false;
    for(let cursor=root;;cursor=dirname(cursor)) {
      const stat=lstatSync(cursor,{throwIfNoEntry:false});
      if(stat && (!stat.isDirectory() || stat.isSymbolicLink())) return false;
      if(dirname(cursor)===cursor) break;
    }
    if (!enrolled.every(control=>control.namespace===parts[1] && control.pluginId===`${parts[1]}@${parts[0]}`
      && remotePluginIdentifier(control.remotePluginId) && control.skillsOnly===true && !control.appSha256 && !control.mcpSha256
      && control.name.startsWith(control.namespace+":") && /^[a-f0-9]{64}$/.test(control.manifestSha256)
      && rules.some((rule:any)=>typeof rule?.name==="string" && rule.name.trim()===control.name && rule.enabled===false)
      && !rules.some((rule:any)=>(typeof rule?.name==="string" && rule.name.trim()===control.name || typeof rule?.path==="string" && (rule.path===parent || rule.path===root || rule.path.startsWith(root+sep))) && rule.enabled!==false))) return false;
    if (!lstatSync(root,{throwIfNoEntry:false})) return allowAbsent && (lstatSync(parent,{throwIfNoEntry:false})
      ? enrolled.every(control=>remoteInstallationMatches(parent,control.remotePluginId!,read))
      : absentDisabledCodexPluginParent(cache,parent,controls,rules));
    if (!enrolled.every(control=>remoteInstallationMatches(parent,control.remotePluginId!,read))) return false;
    const parsed=rootControls(root,read);
    if(JSON.parse(read(join(root,".codex-plugin/plugin.json"))).hooks!==undefined) return false;
    if (!enrolled.some(control=>control.namespace===parsed.namespace && control.manifestSha256===parsed.manifestSha256 && !parsed.appSha256 && !parsed.mcpSha256)) return false;
    let entries=0;
    const emptySkills=(directory:string,depth:number):boolean=>depth<=64 && readdirSync(directory).every(name=>{
      if(++entries>4096 || name==="SKILL.md") return false;
      const path=join(directory,name),stat=lstatSync(path);
      return !stat.isSymbolicLink() && (stat.isFile() || stat.isDirectory() && emptySkills(path,depth+1));
    });
    return emptySkills(root,0);
  } catch {return false;}
}
/** Capability controls remain bound even after every native Skill body disappears. */
export function reviewedCodexPluginCapabilitiesUnchanged(cache:string, controls:CodexPluginSkillControl[], read:Read, rules?:unknown):boolean {
  if (!Array.isArray(controls) || controls.length>4096) return false;
  let entries=0;
  try {
    for (const parent of new Set(controls.map(control=>control.pluginParent))) {
      if (absentDisabledCodexPluginParent(cache,parent,controls,rules)) continue;
      if (!parent.startsWith(cache+sep) || !lstatSync(parent,{throwIfNoEntry:false})?.isDirectory() || realpathSync(parent)!==parent) return false;
      for (const control of controls.filter(control=>control.pluginParent===parent)) {
        if (control.remotePluginId !== undefined && !remoteInstallationMatches(parent,control.remotePluginId,read)) return false;
      }
      const names=readdirSync(parent); entries+=names.length; if (entries>4096) return false;
      for (const name of names) {
        let root=join(parent,name), stat=lstatSync(root);
        if (stat.isSymbolicLink()) {
          const target=resolve(parent,readlinkSync(root));
          if (name!=="latest" || dirname(target)!==parent || !lstatSync(target).isDirectory() || realpathSync(target)!==target) return false;
          root=target; stat=lstatSync(root);
        }
        if (!stat.isDirectory() || ![".codex-plugin/plugin.json",".app.json","hooks",".mcp.json"].some(path=>lstatSync(join(root,path),{throwIfNoEntry:false}))) continue;
        const parsed=rootControls(root,read);
        if (!controls.some(control=>control.pluginParent===parent && control.namespace===parsed.namespace && control.manifestSha256===parsed.manifestSha256 && control.appSha256===parsed.appSha256 && control.mcpSha256===parsed.mcpSha256)) return false;
      }
    }
    return true;
  } catch { return false; }
}
export function reviewCodexPluginControls(catalog:CodexNativeSkillCatalog, documents:string[], cache:string, cwd:string, read:Read, rules:unknown, pluginSettings?:unknown, plannedRules?:unknown, denials:ReviewedCodexSkillDenial[]=[]): { skills:CodexPluginSkillControl[]; inactivePlugins:CodexInactivePluginControl[]; sourceInputs:CodexPluginSourceInput[] } {
  if (!supportsCodexNativeCapability(catalog?.version, "qualified-skill-catalog") || catalog.cwd!==cwd) refuse();
  const installedPluginReview=supportsCodexNativeCapability(catalog.version, "installed-plugin-review");
  if (!Array.isArray(denials) || denials.length>4096 || new Set(denials.map(item=>item?.path)).size!==denials.length
    || denials.some(item=>!item || Object.keys(item).sort().join(",")!=="name,path,sha256" || typeof item.name!=="string" || typeof item.path!=="string" || !/^[a-f0-9]{64}$/.test(item.sha256))) refuse();
  const usedDenials=new Set<string>();
  const skills=projectCodexNativeSkillCatalog({data:[{cwd,errors:[],skills:catalog.skills}]},cwd);
  const allowed=new Set(documents), result:CodexPluginSkillControl[]=[], inertDocuments=new Set<string>();
  const inactivePlugins=new Map<string,CodexInactivePluginControl>();
  const sourceInputs=new Map<string,CodexPluginSourceInput>();
  let installedPlugins:ReturnType<typeof projectCodexInstalledPluginEntries>;
  try { installedPlugins=projectCodexInstalledPluginEntries(catalog.plugins ?? []); } catch { refuse(); }
  // Legacy 0.10.19 receipts contained only skills/list. They can review listed
  // entries, but never establish the identity of a skill omitted from that list.
  const candidates=catalog.plugins === undefined ? skills.map(skill=>skill.path).filter(path=>allowed.has(path)) : allowed;
  for (const document of candidates) {
    if (!document.startsWith(cache+sep)) continue;
    const located=documentIdentity(document,cache,read);
    if (located.name==="skills-cli" || located.name.endsWith(":skills-cli")) refuse();
    const cacheParts=relative(cache,located.pluginParent).split(sep);
    if (cacheParts.length!==2 || cacheParts.some(part=>!identifier(part))) refuse();
    const [marketplace,pluginName]=cacheParts;
    if (pluginName!==located.namespace) refuse();
    const expectedPluginId=`${pluginName}@${marketplace}`;
    const listed=skills.filter(skill=>skill.path===document);
    if (listed.length>1) refuse();
    const installed=installedPlugins.filter(plugin=>plugin.id===expectedPluginId && plugin.name===pluginName);
    // The native loader reads an installed cache root, never this declared
    // Local installation input. Keep a separate, positively attested role;
    // shared bytes or a temporary-directory name do not establish that role.
    if (installedPluginReview && installed.length===1 && installed[0]!.installed
      && installed[0]!.localVersion===basename(located.root) && installed[0]!.sourceType==="local"
      && codexPluginSourceIsConfigControlled(installed[0]!)) {
      const plugin=installed[0]!, input={pluginId:expectedPluginId,namespace:located.namespace,pluginParent:located.pluginParent,sourceRoot:plugin.sourcePath!,sourceSha256:plugin.sourceSha256!};
      if (input.sourceRoot!==located.root && !input.sourceRoot.startsWith(cache+sep)
        && (lstatSync(input.sourceRoot,{throwIfNoEntry:false}) || documents.some(path=>path.startsWith(input.sourceRoot+sep)))) {
        if (skills.some(skill=>skill.path===input.sourceRoot || skill.path.startsWith(input.sourceRoot+sep)) || !sourceInputUnchanged(input,cache,read)) refuse();
        sourceInputs.set(expectedPluginId,input);
      }
    }
    // Codex 0.160 returns before loading any capability of a disabled plugin.
    // This is an inert cache document, not a reviewed qualified-name control.
    // The caller supplies the current config covered by its discovery witness;
    // a catalog snapshot alone cannot establish continuing disablement.
    const settings=pluginSettings && typeof pluginSettings==="object" && !Array.isArray(pluginSettings) ? pluginSettings as Record<string,any> : undefined;
    if (installedPluginReview && !listed.length && !skills.some(skill=>skill.pluginId===expectedPluginId) && installed.length===1 && installed[0]!.installed && !installed[0]!.enabled
      && codexPluginSourceIsConfigControlled(installed[0]!)
      && settings && Object.hasOwn(settings,expectedPluginId) && settings[expectedPluginId]?.enabled===false) {
      if (!Array.isArray(rules)) refuse();
      const exactPathDeny=rules.some((rule:any)=>rule?.path===document && rule?.enabled===false);
      if (!lstatSync(document).isFile() || realpathSync(document)!==document || realpathSync(located.root)!==located.root || realpathSync(located.pluginParent)!==located.pluginParent
        || realpathSync(join(located.root,".codex-plugin/plugin.json"))!==join(located.root,".codex-plugin/plugin.json")
        || !exactPathDeny || rules.some((rule:any)=>typeof rule?.name==="string" && rule.name.trim()===located.name && rule?.enabled!==false)
        || !isCodexNativeSkillDisabled({name:located.name,path:document,pluginId:expectedPluginId,enabled:true},rules)) refuse();
      inertDocuments.add(document);
      const plugin=installed[0]!;
      // Remote enablement can override local config in Codex's loader. Only a
      // positively declared nonremote source establishes config-owned state.
      inactivePlugins.set(expectedPluginId,{pluginId:expectedPluginId,namespace:located.namespace,pluginParent:located.pluginParent,sourceType:plugin.sourceType as CodexInactivePluginControl["sourceType"],sourceSha256:plugin.sourceSha256!});
      continue;
    }
    const parsed={name:located.name,pluginParent:located.pluginParent,...rootControls(located.root,read)};
    if (parsed.namespace!==located.namespace) refuse();
    let remotePluginId:string|undefined;
    if (listed.length===1) {
      if (listed[0]!.name!==parsed.name || listed[0]!.pluginId!==expectedPluginId) refuse();
    } else {
      if (installed.length!==1 || !installed[0]!.installed || !installed[0]!.enabled) refuse();
      const plugin=installed[0]!;
      if (plugin.localVersion !== null) {
        // A measured installed version excludes historical materializations.
        if (plugin.localVersion!==basename(dirname(dirname(dirname(document))))) continue;
      } else {
        // Remote 0.160 inventories may omit the installed release version, and
        // plugin/read exposes no local root. Do not infer either from latest or
        // advertised metadata. Review only an already denied materialization,
        // tied to the exact native remote installation and bound capabilities.
        if (plugin.sourceType!=="remote" || !plugin.remotePluginId
          || !remoteInstallationMatches(parsed.pluginParent,plugin.remotePluginId,read)
          || !lstatSync(document).isFile() || realpathSync(document)!==document) refuse();
        remotePluginId=plugin.remotePluginId;
      }
      // Codex omits disabled skills from skills/list. The current rules must
      // still evaluate the derived qualified name as disabled.
      const exactPathDeny=Array.isArray(rules) && rules.some((rule:any)=>rule?.path===document && rule?.enabled===false);
      const nativeSkill={name:parsed.name,path:document,pluginId:expectedPluginId,enabled:true};
      // A fresh remote version can already be omitted by its qualified-name
      // deny before Skills has added a deny for the new cache path. Admit only
      // that stronger planned control, with the current name still disabled.
      // Never use planned denies to manufacture an inactive/unknown identity.
      const denial=denials.find(item=>item.path===document);
      const explicitDeny=denial!==undefined && remotePluginId!==undefined && installedPluginReview
        && denial.name===parsed.name && denial.sha256===createHash("sha256").update(read(document)).digest("hex")
        && Array.isArray(rules) && !rules.some((rule:any)=>(rule?.path===document || typeof rule?.name==="string" && rule.name.trim()===parsed.name) && rule.enabled!==false)
        && Array.isArray(plannedRules) && plannedRules.some((rule:any)=>rule?.path===document && rule.enabled===false);
      if (denial && !explicitDeny) refuse();
      if (explicitDeny) usedDenials.add(document);
      const plannedPathDeny=installedPluginReview && remotePluginId!==undefined
        && Array.isArray(rules) && rules.some((rule:any)=>typeof rule?.name==="string" && rule.name.trim()===parsed.name && rule.enabled===false)
        && !rules.some((rule:any)=>(rule?.path===document || typeof rule?.name==="string" && rule.name.trim()===parsed.name) && rule.enabled!==false)
        && Array.isArray(plannedRules) && plannedRules.some((rule:any)=>rule?.path===document && rule.enabled===false)
        && isCodexNativeSkillDisabled(nativeSkill,plannedRules);
      if (!explicitDeny && ((!exactPathDeny && !plannedPathDeny) || !isCodexNativeSkillDisabled(nativeSkill,rules))) refuse();
    }
    const skillsOnly=!parsed.appSha256 && !parsed.mcpSha256 && JSON.parse(read(join(located.root,".codex-plugin/plugin.json"))).hooks===undefined;
    result.push({...parsed,pluginId:expectedPluginId,...(remotePluginId ? {remotePluginId} : {}),...(skillsOnly ? {skillsOnly:true as const} : {})});
  }
  if (usedDenials.size!==denials.length) refuse();
  if ((!result.length && documents.some(document=>document.startsWith(cache+sep) && !inertDocuments.has(document)))
    || new Set(result.map(item=>item.name)).size!==result.length) refuse();
  return {skills:result,inactivePlugins:[...inactivePlugins.values()],sourceInputs:[...sourceInputs.values()]};
}
function sourceInputUnchanged(input:CodexPluginSourceInput, cache:string, read:Read):boolean {
  try {
    const parts=relative(cache,input.pluginParent).split(sep);
    if (parts.length!==2 || parts.some(part=>!identifier(part)) || parts[1]!==input.namespace || input.pluginId!==`${parts[1]}@${parts[0]}`
      || !codexPluginSourceIsConfigControlled({id:input.pluginId,sourceType:"local",sourceSha256:input.sourceSha256})
      || input.sourceSha256!==hashNativeJsonControls(JSON.stringify({type:"local",path:input.sourceRoot}))
      || resolve(input.sourceRoot)!==input.sourceRoot || !lstatSync(input.sourceRoot).isDirectory() || realpathSync(input.sourceRoot)!==input.sourceRoot
      || input.sourceRoot===cache || input.sourceRoot.startsWith(cache+sep) || cache.startsWith(input.sourceRoot+sep)) return false;
    const path=join(input.sourceRoot,".codex-plugin/plugin.json"), stat=lstatSync(path);
    if (!stat.isFile() || stat.size>1024*1024 || realpathSync(path)!==path) return false;
    const text=read(path);hashNativeJsonControls(text);const manifest=JSON.parse(text);
    return Boolean(manifest && typeof manifest==="object" && !Array.isArray(manifest) && manifest.name===input.namespace);
  } catch { return false; }
}
/** Validate installation-input roles before omitting them from runtime inventory.
 * Discovery witnesses still cover the sources; migration inventory stays full. */
export function reviewedCodexPluginSourceRoots(cache:string, inputs:CodexPluginSourceInput[], read:Read):string[] {
  if (!Array.isArray(inputs) || inputs.length>4096 || new Set(inputs.map(input=>input.pluginId)).size!==inputs.length
    || new Set(inputs.map(input=>input.sourceRoot)).size!==inputs.length || inputs.some(input=>!sourceInputUnchanged(input,cache,read))) refuse();
  const roots=inputs.map(input=>input.sourceRoot);
  if (roots.some(root=>roots.some(other=>root!==other && root.startsWith(other+sep)))) refuse();
  return roots;
}
export function reviewCodexPluginSkillControls(catalog:CodexNativeSkillCatalog, documents:string[], cache:string, cwd:string, read:Read, rules:unknown, pluginSettings?:unknown):CodexPluginSkillControl[] {
  return reviewCodexPluginControls(catalog,documents,cache,cwd,read,rules,pluginSettings).skills;
}
/** Cache refresh cannot reactivate a config-controlled disabled installation.
 * The caller verifies discovery/config witnesses before consuming this result. */
export function isReviewedCodexPluginInactive(document:string, cache:string, controls:CodexInactivePluginControl[], pluginSettings:unknown, rules:unknown, read:Read):boolean {
  if (!Array.isArray(controls) || controls.length>4096 || !pluginSettings || typeof pluginSettings!=="object" || Array.isArray(pluginSettings) || !Array.isArray(rules)) return false;
  try {
    const parsed=documentIdentity(document,cache,read), matches=controls.filter(control=>control.pluginParent===parsed.pluginParent && control.namespace===parsed.namespace);
    if (matches.length!==1 || !lstatSync(document).isFile() || realpathSync(document)!==document || realpathSync(parsed.root)!==parsed.root || realpathSync(parsed.pluginParent)!==parsed.pluginParent
      || realpathSync(join(parsed.root,".codex-plugin/plugin.json"))!==join(parsed.root,".codex-plugin/plugin.json")) return false;
    const control=matches[0]!, parts=relative(cache,parsed.pluginParent).split(sep);
    if (parts.length!==2 || parts.some(part=>!identifier(part)) || parts[1]!==parsed.namespace || control.pluginId!==`${parts[1]}@${parts[0]}`
      || !codexPluginSourceIsConfigControlled({...control,id:control.pluginId})
      || !Object.hasOwn(pluginSettings,control.pluginId) || (pluginSettings as Record<string,any>)[control.pluginId]?.enabled!==false) return false;
    return !rules.some((rule:any)=>(rule?.path===document || typeof rule?.name==="string" && rule.name.trim()===parsed.name) && rule?.enabled!==false);
  } catch { return false; }
}
export function isReviewedCodexPluginSkillDisabled(document:string, cache:string, controls:CodexPluginSkillControl[], rules:unknown, read:Read):boolean {
  if (!document.startsWith(cache+sep) || !Array.isArray(controls) || controls.length>4096) return false;
  let parsed:ReturnType<typeof identity>; try { parsed=identity(document,cache,read); } catch { return false; }
  const reviewed=controls.find(item=>item.name===parsed.name && item.namespace===parsed.namespace && item.pluginParent===parsed.pluginParent && item.manifestSha256===parsed.manifestSha256 && item.appSha256===parsed.appSha256 && item.mcpSha256===parsed.mcpSha256);
  if (!reviewed || (reviewed.remotePluginId !== undefined && !remoteInstallationMatches(reviewed.pluginParent,reviewed.remotePluginId,read))) return false;
  return isCodexNativeSkillDisabled({name:parsed.name,path:document,pluginId:reviewed.pluginId,enabled:true},rules);
}
export function disableReviewedCodexPluginNames(text:string, controls:CodexPluginSkillControl[]):string {
  const rules=(Bun.TOML.parse(text) as any).skills?.config??[];
  for (const control of controls) {
    if (rules.some((rule:any)=>rule.name===control.name && rule.enabled!==false)) throw new Error("CODEX_NATIVE_SKILL_NAME_CONFLICT: review an existing native name enable rule");
    if (!rules.some((rule:any)=>rule.name===control.name && rule.enabled===false)) text+=`\n[[skills.config]]\nname = ${JSON.stringify(control.name)}\nenabled = false\n`;
  }
  return text;
}
