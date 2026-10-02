/** Reviewed native identity continuity; never starts a native consumer. */
import { hashNativeJsonControls } from "./claude-settings-witness.js";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { lstatSync, readdirSync, readlinkSync, realpathSync } from "node:fs";
import { supportsCodexNativeCapability } from "./codex-native-compatibility.js";
import { isCodexNativeSkillDisabled, projectCodexInstalledPluginEntries, projectCodexNativeSkillCatalog, remotePluginIdentifier, type CodexNativeSkillCatalog } from "./codex-native-skill-catalog.js";
export interface CodexPluginSkillControl { name:string; pluginId:string; namespace:string; pluginParent:string; manifestSha256:string; appSha256?:string; mcpSha256?:string; remotePluginId?:string }
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
/** Only the measured local stdio declaration is reviewable here. The complete
 * declaration is fingerprinted; this code never starts a command or resolves env. */
function mcpControls(path:string, read:Read):string {
  const text=read(path);
  let value:any, sha256:string; try { sha256=hashNativeJsonControls(text); value=JSON.parse(text); } catch { refuse(); }
  const object=(v:any):boolean => Boolean(v && typeof v==="object" && !Array.isArray(v));
  const textField=(v:any,empty=false):boolean => typeof v==="string" && (empty || Boolean(v.trim()))
    && Buffer.byteLength(v)<=16384 && !/[\x00-\x1f\x7f]/.test(v);
  const envName=(v:any):boolean => typeof v==="string" && /^[A-Za-z_][A-Za-z0-9_]{0,255}$/.test(v);
  if (!object(value) || Object.keys(value).length!==1 || !object(value.mcpServers)) refuse();
  const servers=Object.entries(value.mcpServers);
  if (!servers.length || servers.length>256) refuse();
  for (const [name, server] of servers as [string,any][]) {
    if (!identifier(name) || !object(server) || !Object.keys(server).every(key=>["command","args","cwd","env_vars"].includes(key))
      || !textField(server.command)
      || (server.args!==undefined && (!Array.isArray(server.args) || server.args.length>256 || !server.args.every((arg:any)=>textField(arg,true))))
      || (server.cwd!==undefined && !textField(server.cwd))) refuse();
    if (server.env_vars!==undefined) {
      if (!Array.isArray(server.env_vars) || server.env_vars.length>256) refuse();
      const names=server.env_vars.map((entry:any)=>{
        if (envName(entry)) return entry;
        if (!object(entry) || !Object.keys(entry).every(key=>["name","source"].includes(key)) || !envName(entry.name)
          || (entry.source!==undefined && entry.source!=="local")) refuse();
        return entry.name;
      });
      if (new Set(names).size!==names.length) refuse();
    }
  }
  return sha256;
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
  if (manifest.hooks!==undefined || manifest.commands!==undefined
    || (manifest.mcpServers!==undefined && manifest.mcpServers!=="./.mcp.json")
    || (manifest.apps!==undefined && manifest.apps!=="./.app.json")
    || lstatSync(join(root,"hooks"),{throwIfNoEntry:false})) refuse();
  const mcp=join(root,".mcp.json"), mcpPresent=lstatSync(mcp,{throwIfNoEntry:false});
  if (mcpPresent && (!mcpPresent.isFile() || mcpPresent.isSymbolicLink() || mcpPresent.size>1024*1024 || realpathSync(mcp)!==mcp)) refuse();
  if (Boolean(mcpPresent)!==(manifest.mcpServers!==undefined)) refuse();
  const mcpSha256=mcpPresent ? mcpControls(mcp,read) : undefined;
  const app=join(root,".app.json"), present=lstatSync(app,{throwIfNoEntry:false});
  if (present && (!present.isFile() || present.isSymbolicLink() || present.size>1024*1024)) refuse();
  if (manifest.apps!==undefined && !present) refuse();
  const appSha256=present ? appControls(app,read) : undefined;
  return {namespace:manifest.name,manifestSha256,...(appSha256 ? {appSha256} : {}),...(mcpSha256 ? {mcpSha256} : {})};
}
function identity(document:string, cache:string, read:Read): { name:string; namespace:string; pluginParent:string; manifestSha256:string; appSha256?:string; mcpSha256?:string } {
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
    const controls=rootControls(root,read);
    return {name:`${controls.namespace}:${front.name}`,pluginParent:dirname(root),...controls};
  }
  refuse();
}
/** Capability controls remain bound even after every native Skill body disappears. */
export function reviewedCodexPluginCapabilitiesUnchanged(cache:string, controls:CodexPluginSkillControl[], read:Read):boolean {
  if (!Array.isArray(controls) || controls.length>4096) return false;
  let entries=0;
  try {
    for (const parent of new Set(controls.map(control=>control.pluginParent))) {
      if (!parent.startsWith(cache+sep) || !lstatSync(parent,{throwIfNoEntry:false})?.isDirectory()) return false;
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
export function reviewCodexPluginSkillControls(catalog:CodexNativeSkillCatalog, documents:string[], cache:string, cwd:string, read:Read, rules:unknown):CodexPluginSkillControl[] {
  if (!supportsCodexNativeCapability(catalog?.version, "qualified-skill-catalog") || catalog.cwd!==cwd) refuse();
  const skills=projectCodexNativeSkillCatalog({data:[{cwd,errors:[],skills:catalog.skills}]},cwd);
  const allowed=new Set(documents), result:CodexPluginSkillControl[]=[];
  let installedPlugins:ReturnType<typeof projectCodexInstalledPluginEntries>;
  try { installedPlugins=projectCodexInstalledPluginEntries(catalog.plugins ?? []); } catch { refuse(); }
  // Legacy 0.10.19 receipts contained only skills/list. They can review listed
  // entries, but never establish the identity of a skill omitted from that list.
  const candidates=catalog.plugins === undefined ? skills.map(skill=>skill.path).filter(path=>allowed.has(path)) : allowed;
  for (const document of candidates) {
    if (!document.startsWith(cache+sep)) continue;
    const parsed=identity(document,cache,read);
    if (parsed.name==="skills-cli" || parsed.name.endsWith(":skills-cli")) refuse();
    const cacheParts=relative(cache,parsed.pluginParent).split(sep);
    if (cacheParts.length!==2 || cacheParts.some(part=>!identifier(part))) refuse();
    const [marketplace,pluginName]=cacheParts;
    if (pluginName!==parsed.namespace) refuse();
    const expectedPluginId=`${pluginName}@${marketplace}`;
    const listed=skills.filter(skill=>skill.path===document);
    if (listed.length>1) refuse();
    let remotePluginId:string|undefined;
    if (listed.length===1) {
      if (listed[0]!.name!==parsed.name || listed[0]!.pluginId!==expectedPluginId) refuse();
    } else {
      const installed=installedPlugins.filter(plugin=>plugin.id===expectedPluginId && plugin.name===pluginName);
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
      // Codex omits a path-disabled skill from skills/list. Its absence is
      // reviewable only when the exact current path is explicitly denied and
      // that rule set still evaluates the derived qualified name as disabled.
      const exactPathDeny=Array.isArray(rules) && rules.some((rule:any)=>rule?.path===document && rule?.enabled===false);
      if (!exactPathDeny || !isCodexNativeSkillDisabled({name:parsed.name,path:document,pluginId:expectedPluginId,enabled:true},rules)) refuse();
    }
    result.push({...parsed,pluginId:expectedPluginId,...(remotePluginId ? {remotePluginId} : {})});
  }
  if ((!result.length && documents.some(document=>document.startsWith(cache+sep)))
    || new Set(result.map(item=>item.name)).size!==result.length) refuse();
  return result;
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
