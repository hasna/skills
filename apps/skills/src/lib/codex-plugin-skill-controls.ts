/** Reviewed native identity continuity; never starts a native consumer. */
import { createHash } from "node:crypto";
import { isCodexLocalStdioMcpServer } from "./codex-local-mcp-controls.js";
import { hashNativeJsonControls } from "./claude-settings-witness.js";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { lstatSync, readdirSync, readFileSync, readlinkSync, realpathSync } from "node:fs";
import { supportsCodexNativeCapability } from "./codex-native-compatibility.js";
import { CODEX_PLUGIN_DEFAULT_SKILLS_PATHS, CODEX_PLUGIN_MANIFEST_DIRECTORIES, CODEX_PLUGIN_MANIFEST_KNOWN_KEYS, CODEX_PLUGIN_MANIFEST_LOCATIONS, codexPluginRootCapabilityEntry, foldCodexPluginEntryName, isCodexSkillDocumentName } from "./codex-plugin-capability-paths.js";
import { canonicalCacheRoot, codexPluginIsRemote, codexPluginSourceIsConfigControlled, isCodexNativeSkillDisabled, projectCodexInstalledPluginEntries, projectCodexNativeSkillCatalog, projectCodexRemoteReceiptSnapshot, remotePluginIdentifier, type CodexInstalledPlugin, type CodexNativeSkillCatalog, type CodexRemoteReceiptSnapshot } from "./codex-native-skill-catalog.js";
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
/** The remote plugin identifier from the exact native install receipt Codex
 * writes beside a remote plugin's versions, or null when it is absent or invalid. */
export function codexRemoteInstallReceipt(parent:string, read:Read):string|null {
  try {
    if (!lstatSync(parent).isDirectory() || realpathSync(parent)!==parent) return null;
    const path=join(parent,".codex-remote-plugin-install.json"), stat=lstatSync(path,{throwIfNoEntry:false});
    if (!stat?.isFile() || stat.isSymbolicLink() || stat.size>16384) return null;
    const text=read(path);
    hashNativeJsonControls(text); // Reject duplicate decoded keys as Codex serde does.
    const value=JSON.parse(text);
    return value && typeof value==="object" && !Array.isArray(value) && Object.keys(value).length===2 && value.schema_version===1
      && remotePluginIdentifier(value.remote_plugin_id) ? value.remote_plugin_id : null;
  } catch { return null; }
}
/** Codex's schema-1 receipt identifies a remote installation, not its current
 * version. It can support review of an explicitly denied cache materialization;
 * it never establishes that the materialization is the native selected root. */
function remoteInstallationMatches(parent:string, remotePluginId:string, read:Read):boolean {
  try {
    return remotePluginIdentifier(remotePluginId) && codexRemoteInstallReceipt(parent,read)===remotePluginId;
  } catch { return false; }
}
/** Named install refusals for a plugin Codex's catalog reports as remote. */
export const CODEX_REMOTE_RECEIPT_MISSING = "CODEX_REMOTE_RECEIPT_MISSING";
export const CODEX_REMOTE_RECEIPT_MISMATCH = "CODEX_REMOTE_RECEIPT_MISMATCH";
export const CODEX_REMOTE_RECEIPT_SNAPSHOT_REQUIRED = "CODEX_REMOTE_RECEIPT_SNAPSHOT_REQUIRED";
function receiptRefusal(code:string, pluginId:string, kind:"missing"|"mismatch"):never {
  throw new Error(`${code}: remote plugin ${JSON.stringify(pluginId)} has no matching install receipt (${kind}); repair the receipt (reinstall the plugin in Codex), then re-enroll it with \`skills hook install\` to record it`);
}
/** The catalog's remote identity, decided by the receipt as it was on disk
 * before the capture started Codex: the app-server rewrites receipts on start,
 * so current bytes can only confirm. MISSING when it was absent then, MISMATCH
 * when its identity was invalid or differed from the catalog's. The current
 * receipt must also still match. Messages name only the catalog plugin id. */
function requireRemoteInstallReceipt(parent:string, plugin:{ id:string; remotePluginId?:string }, snapshot:CodexRemoteReceiptSnapshot, read:Read):string {
  const observed=snapshot.plugins.find(item=>item.pluginId===plugin.id);
  if (!observed || observed.receipt==="absent") receiptRefusal(CODEX_REMOTE_RECEIPT_MISSING,plugin.id,"missing");
  if (plugin.remotePluginId===undefined || observed.remotePluginId!==plugin.remotePluginId) receiptRefusal(CODEX_REMOTE_RECEIPT_MISMATCH,plugin.id,"mismatch");
  if (!remoteInstallationMatches(parent,plugin.remotePluginId!,read)) {
    let missing=false;
    try { missing=!lstatSync(join(parent,".codex-remote-plugin-install.json"),{throwIfNoEntry:false}); } catch { /* an unreadable entry is present and unmatched */ }
    receiptRefusal(missing ? CODEX_REMOTE_RECEIPT_MISSING : CODEX_REMOTE_RECEIPT_MISMATCH,plugin.id,missing ? "missing" : "mismatch");
  }
  return plugin.remotePluginId!;
}
/** The remote identity the reconcile may bind for a plugin Codex reports as
 * remote: the catalog's id when the receipt read before Codex started named it
 * and the current receipt still does; null otherwise. A catalog without a
 * valid pre-start reading for this cache refuses (SNAPSHOT_REQUIRED). */
export function codexPreStartRemoteReceipt(catalog:CodexNativeSkillCatalog, cache:string, parent:string, plugin:{ id:string; remotePluginId?:string }, read:Read):string|null {
  const observed=requireRemoteReceiptSnapshot(catalog,cache).plugins.find(item=>item.pluginId===plugin.id);
  if (!observed || observed.receipt!=="present" || plugin.remotePluginId===undefined || observed.remotePluginId!==plugin.remotePluginId) return null;
  return remoteInstallationMatches(parent,plugin.remotePluginId,read) ? plugin.remotePluginId : null;
}
/** Whether an enrolled parent's bound receipt was not there, with that id,
 * before Codex started. Applies when a control binds a receipt and the parent
 * exists (an absent parent is left to its own rules); a catalog without a
 * valid pre-start reading for this cache then refuses (SNAPSHOT_REQUIRED). */
export function codexPreStartReceiptChanged(catalog:CodexNativeSkillCatalog, cache:string, parentControls:CodexPluginSkillControl[]):boolean {
  const template=parentControls[0];
  if (!template || !parentControls.some(control=>control.remotePluginId!==undefined) || !lstatSync(template.pluginParent,{throwIfNoEntry:false})) return false;
  const observed=requireRemoteReceiptSnapshot(catalog,cache).plugins.find(item=>item.pluginId===template.pluginId);
  return parentControls.some(control=>control.remotePluginId!==undefined && (!observed || observed.receipt!=="present" || observed.remotePluginId!==control.remotePluginId));
}
/** What a reconcile does with an enrolled parent whose stored controls do not
 * all carry its receipt (policies stored before every control recorded it).
 * A plugin Codex reports as remote is healed: every control gets the catalog's
 * id, on exactly the fresh-install proof (requireRemoteInstallReceipt: the
 * pre-start reading and the current receipt both name it; MISSING or MISMATCH
 * otherwise), and only when every bound control already agrees ("refuse").
 * A plugin Codex does not report as remote refuses when only some controls are
 * bound. null: nothing to heal (every control bound, none bound and not
 * reported remote, or the parent is absent and left to its own rules). */
export function codexStoredReceiptHeal(catalog:CodexNativeSkillCatalog, cache:string, parentControls:CodexPluginSkillControl[], plugin:CodexInstalledPlugin|undefined, read:Read):{ heal:string }|"refuse"|null {
  const template=parentControls[0];
  if (!template || !lstatSync(template.pluginParent,{throwIfNoEntry:false})) return null;
  const unbound=parentControls.filter(control=>control.remotePluginId===undefined).length;
  if (!unbound) return null;
  if (!codexPluginIsRemote(plugin)) return unbound===parentControls.length ? null : "refuse";
  const identity=requireRemoteInstallReceipt(template.pluginParent,plugin!,requireRemoteReceiptSnapshot(catalog,cache),read);
  return parentControls.every(control=>control.remotePluginId===undefined || control.remotePluginId===identity) ? { heal:identity } : "refuse";
}
/** The catalog's pre-start receipt snapshot for this exact plugin cache, or a
 * refusal: an older capture, or one of another Codex home, cannot show it. */
function requireRemoteReceiptSnapshot(catalog:CodexNativeSkillCatalog, cache:string):CodexRemoteReceiptSnapshot {
  const snapshot=projectCodexRemoteReceiptSnapshot(catalog.remoteReceipts);
  if (!snapshot || snapshot.cacheRoot!==canonicalCacheRoot(cache)) throw new Error(`${CODEX_REMOTE_RECEIPT_SNAPSHOT_REQUIRED}: the native catalog has no remote install receipt snapshot read before Codex started for this plugin cache; re-capture it with \`skills hook native-catalog\``);
  return snapshot;
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
/** Whether a vendor refresh's `.app.json` connector declaration is valid under
 * the same appControls validation rootControls applies (duplicate keys, the
 * single `apps` object, app names, `id`/`category`/`required` only, types and
 * caps), read as a regular, unlinked file of at most 1 MiB in strict UTF-8.
 * Every failure is false. */
export function codexAppDeclarationValid(path:string):boolean {
  try {
    const stat=lstatSync(path,{throwIfNoEntry:false});
    if (!stat?.isFile() || stat.isSymbolicLink() || stat.size>1024*1024) return false;
    appControls(path,file=>new TextDecoder("utf-8",{fatal:true}).decode(readFileSync(file)));
    return true;
  } catch { return false; }
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
export interface CodexPluginRootControls { namespace:string; manifestSha256:string; appSha256?:string; mcpSha256?:string }
/** Reuse the strict package-owned capability parser for an explicitly reviewed
 * plugin materialization. This does not establish parent or receipt identity. */
export function readCodexPluginRootControls(root:string, read:Read): CodexPluginRootControls {
  return rootControls(root, read);
}
function rootControls(root:string, read:Read): CodexPluginRootControls {
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
  // A catalog without the receipt reading taken before its capture started
  // Codex is an older capture: re-capture it. Remote receipts are decided on it.
  const receiptSnapshot=requireRemoteReceiptSnapshot(catalog,cache);
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
    // A plugin Codex's catalog reports as remote (codexPluginIsRemote: a remote
    // source or any remote id) binds its exact native install receipt on every
    // control (listed or omitted, whatever its localVersion), so a later
    // receipt change is a reviewed capability change; an absent or mismatched
    // receipt refuses. Any other plugin has no receipt and is not checked here.
    const remote=installed.length===1 && codexPluginIsRemote(installed[0]) ? installed[0]! : undefined;
    const receiptPluginId=remote ? requireRemoteInstallReceipt(parsed.pluginParent,remote,receiptSnapshot,read) : undefined;
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
        if (!codexPluginIsRemote(plugin) || !plugin.remotePluginId
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
    result.push({...parsed,pluginId:expectedPluginId,...(receiptPluginId ? {remotePluginId:receiptPluginId} : {}),...(skillsOnly ? {skillsOnly:true as const} : {})});
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
/** Refusal code for a plugin change that touches more than its skill names: a
 * new or changed app, MCP, hooks, manifest or remote installation capability. */
export const CODEX_PLUGIN_CAPABILITY_REVIEW_REQUIRED = "CODEX_PLUGIN_CAPABILITY_REVIEW_REQUIRED";
export type CodexPluginCapabilityReason = "app" | "mcp" | "hooks" | "commands" | "agents" | "manifest" | "manifest-location" | "remote" | "unsupported";
const capabilityRefusal = (detail:string):never => { throw new Error(`${CODEX_PLUGIN_CAPABILITY_REVIEW_REQUIRED}: ${detail}; it stays quarantined until reviewed with skills hook install and a fresh native catalog and discovery review`); };
/** Version roots of one plugin cache parent; a `latest` alias must name a sibling. */
function pluginVersionRoots(parent:string):string[]|null {
  const names=readdirSync(parent); if (names.length>4096) return null;
  const roots:string[]=[];
  for (const name of names) {
    if (name===".codex-remote-plugin-install.json") continue;
    const root=join(parent,name), stat=lstatSync(root);
    if (stat.isSymbolicLink()) {
      const target=resolve(parent,readlinkSync(root));
      if (name!=="latest" || dirname(target)!==parent || !lstatSync(target,{throwIfNoEntry:false})?.isDirectory()) return null;
      continue;
    }
    if (!stat.isDirectory()) return null;
    roots.push(root);
  }
  return roots;
}
/** The capability kind a shared root capability entry denotes. Membership comes
 * only from codex-plugin-capability-paths.ts; an entry added there and not named
 * here is still refused, as unsupported. */
function capabilityKind(entry:string):CodexPluginCapabilityReason {
  if (CODEX_PLUGIN_MANIFEST_LOCATIONS.includes(entry) || CODEX_PLUGIN_MANIFEST_DIRECTORIES.includes(entry)) return "manifest-location";
  return entry==="hooks" || entry==="hooks.json" ? "hooks" : entry===".mcp.json" ? "mcp" : entry===".app.json" ? "app"
    : entry==="commands" ? "commands" : entry==="agents" ? "agents" : "unsupported";
}
/** Declaration files that stay capability controls at any depth: the shared root
 * capability entries that are JSON files and not a manifest location. */
const nestedControlEntry=(name:string):string|null => {
  const entry=codexPluginRootCapabilityEntry(name);
  return entry!==null && entry.endsWith(".json") && !CODEX_PLUGIN_MANIFEST_LOCATIONS.includes(entry) ? entry : null;
};
/** The kind a manifest key outside the shared metadata set declares. */
const manifestKeyKind=(key:string):CodexPluginCapabilityReason => key==="hooks" ? "hooks" : key==="mcpServers" ? "mcp" : key==="apps" ? "app" : key==="commands" ? "commands" : key==="agents" ? "agents" : "unsupported";
/** Strict, read-only scan of one plugin version root against every location Codex
 * reads (codex-plugin-capability-paths.ts): direct entries matched without regard
 * to case, declaration files and manifest directories at any depth, skill
 * documents not spelled exactly SKILL.md, and links or special files anywhere.
 * `reviewed` (an enrolled plugin): the exact `.codex-plugin` manifest is bound
 * by the reviewed tuple, as are an exact root `.app.json` or `.mcp.json` when the
 * tuple declares one. Otherwise the manifest's own capability keys count too.
 * Returns the manifest path read, or null when there is none to read. */
function scanCodexPluginRoot(root:string, read:Read, reasons:Set<CodexPluginCapabilityReason>, reviewed?:{ app:boolean; mcp:boolean }):string|null {
  let entries=0;
  const walk=(directory:string, depth:number):void => {
    if (depth>64) { reasons.add("unsupported"); return; }
    for (const name of readdirSync(directory)) {
      if (++entries>16384) { reasons.add("unsupported"); return; }
      const path=join(directory,name), stat=lstatSync(path);
      if (stat.isSymbolicLink() || !stat.isDirectory() && !stat.isFile()) { reasons.add("unsupported"); continue; }
      if (isCodexSkillDocumentName(name) && name!=="SKILL.md") reasons.add("unsupported");
      const control=nestedControlEntry(name);
      if (control) reasons.add(capabilityKind(control));
      if (CODEX_PLUGIN_MANIFEST_DIRECTORIES.includes(foldCodexPluginEntryName(name))) reasons.add("manifest-location");
      if (stat.isDirectory()) walk(path,depth+1);
    }
  };
  for (const name of readdirSync(root)) {
    if (++entries>16384) { reasons.add("unsupported"); break; }
    const path=join(root,name), stat=lstatSync(path);
    if (stat.isSymbolicLink() || !stat.isDirectory() && !stat.isFile()) { reasons.add("unsupported"); continue; }
    if (isCodexSkillDocumentName(name) && name!=="SKILL.md") reasons.add("unsupported");
    const entry=codexPluginRootCapabilityEntry(name);
    if (entry===".codex-plugin" && name===".codex-plugin" && stat.isDirectory()) {
      const inside=readdirSync(path);
      if (inside.length!==1 || inside[0]!=="plugin.json" || !lstatSync(join(path,"plugin.json")).isFile()) reasons.add("manifest-location");
      continue;
    }
    if (entry!==null) {
      const bound=reviewed && stat.isFile() && (name===".app.json" && reviewed.app || name===".mcp.json" && reviewed.mcp);
      if (!bound) reasons.add(capabilityKind(entry));
      continue;
    }
    if (stat.isDirectory()) walk(path,1);
  }
  const manifestPath=join(root,".codex-plugin","plugin.json");
  const manifestStat=lstatSync(manifestPath,{throwIfNoEntry:false});
  if (!manifestStat?.isFile() || manifestStat.isSymbolicLink()) { reasons.add("unsupported"); return null; }
  if (reviewed) return manifestPath;
  try {
    const text=read(manifestPath); hashNativeJsonControls(text);
    const manifest=JSON.parse(text);
    if (!manifest || typeof manifest!=="object" || Array.isArray(manifest)) { reasons.add("unsupported"); return null; }
    // Allowlist, not a denylist: every key outside the shared metadata set (and
    // `apps`, the connector capability) counts, so an unknown declaration refuses.
    for (const key of Object.keys(manifest)) if (key==="apps" || !CODEX_PLUGIN_MANIFEST_KNOWN_KEYS.includes(key)) reasons.add(manifestKeyKind(key));
    // A skills source outside the plugin's own skills directory loads unreviewed skills.
    if (manifest.skills!==undefined && !CODEX_PLUGIN_DEFAULT_SKILLS_PATHS.includes(manifest.skills)) reasons.add("unsupported");
    return manifestPath;
  } catch { reasons.add("unsupported"); return null; }
}
/** Strict scan of a plugin cache parent: only version roots, the native install
 * receipt and a `latest` alias to a sibling may sit beside the versions. A
 * capability-named or skill-document-named entry is never a materialization. */
function scanCodexPluginParent(parent:string, read:Read, reasons:Set<CodexPluginCapabilityReason>, reviewed?:{ app:boolean; mcp:boolean }):string[] {
  const manifests:string[]=[];
  const stat=lstatSync(parent,{throwIfNoEntry:false});
  if (!stat?.isDirectory() || stat.isSymbolicLink() || realpathSync(parent)!==parent) { reasons.add("unsupported"); return manifests; }
  const names=readdirSync(parent);
  if (names.length>4096) { reasons.add("unsupported"); return manifests; }
  for (const name of names) {
    const path=join(parent,name), entry=lstatSync(path);
    if (name===".codex-remote-plugin-install.json") { if (!entry.isFile()) reasons.add("unsupported"); continue; }
    if (entry.isSymbolicLink()) {
      const target=resolve(parent,readlinkSync(path));
      if (name!=="latest" || dirname(target)!==parent || !lstatSync(target,{throwIfNoEntry:false})?.isDirectory()) reasons.add("unsupported");
      continue;
    }
    if (!entry.isDirectory() || !/^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/.test(name) || codexPluginRootCapabilityEntry(name)!==null || isCodexSkillDocumentName(name)) {
      const capability=codexPluginRootCapabilityEntry(name);
      reasons.add(capability===null ? "unsupported" : capabilityKind(capability));
      continue;
    }
    const manifest=scanCodexPluginRoot(path,read,reasons,reviewed);
    if (manifest) manifests.push(manifest);
  }
  if (!manifests.length) reasons.add("unsupported");
  return manifests.sort();
}
/** Why a plugin Skills has not enrolled needs a review before its skills can be
 * enrolled automatically. Empty only when every version root holds nothing but
 * a supported skills-only manifest and skills. A remote installation is not
 * itself a capability; its receipt is checked separately. */
export function unenrolledCodexPluginCapabilities(parent:string, read:Read):CodexPluginCapabilityReason[] {
  return unenrolledCodexPluginEvidence(parent,read).reasons;
}
/** The same classification with its evidence: every manifest path read. A
 * skills-only result (no reasons) always names at least one manifest. */
export function unenrolledCodexPluginEvidence(parent:string, read:Read):{ reasons:CodexPluginCapabilityReason[]; manifests:string[] } {
  const reasons=new Set<CodexPluginCapabilityReason>();
  let manifests:string[]=[];
  try {
    manifests=scanCodexPluginParent(parent,read,reasons);
    for (const manifest of manifests) { try { rootControls(dirname(dirname(manifest)),read); } catch { reasons.add("unsupported"); } }
  } catch { reasons.add("unsupported"); }
  if (!manifests.length) reasons.add("unsupported");
  return { reasons:[...reasons].sort(), manifests };
}
/** Capability evidence for a plugin root outside the plugin cache (a Codex
 * runtime), where the version-directory contract does not apply. */
export function codexPluginRootEvidence(root:string, read:Read):{ reasons:CodexPluginCapabilityReason[]; manifests:string[] } {
  const reasons=new Set<CodexPluginCapabilityReason>();
  let manifest:string|null=null;
  try { manifest=scanCodexPluginRoot(root,read,reasons); } catch { reasons.add("unsupported"); }
  if (!manifest) reasons.add("unsupported");
  return { reasons:[...reasons].sort(), manifests:manifest ? [manifest] : [] };
}
/** The strict scan for an enrolled plugin, run in addition to the reviewed-tuple
 * check over every current version root: anything the reviewed tuple does not
 * bind (a root plugin.json, hooks.json, commands/ or agents/, another manifest
 * directory, a case variant, a nested declaration, a link) is a capability. */
export function enrolledCodexPluginStrictChanges(parentControls:CodexPluginSkillControl[], read:Read):CodexPluginCapabilityReason[] {
  const template=parentControls[0];
  if (!template) return ["unsupported"];
  const reasons=new Set<CodexPluginCapabilityReason>();
  try { scanCodexPluginParent(template.pluginParent,read,reasons,{ app:template.appSha256!==undefined, mcp:template.mcpSha256!==undefined }); }
  catch { reasons.add("unsupported"); }
  return [...reasons].sort();
}
/** Which capability of an enrolled plugin parent no longer matches its reviewed
 * controls. Empty exactly when reviewedCodexPluginCapabilitiesUnchanged accepts it. */
export function codexPluginCapabilityChanges(cache:string, parentControls:CodexPluginSkillControl[], read:Read, rules?:unknown):CodexPluginCapabilityReason[] {
  if (reviewedCodexPluginCapabilitiesUnchanged(cache,parentControls,read,rules)) return [];
  const reasons=new Set<CodexPluginCapabilityReason>(), template=parentControls[0];
  try {
    if (!template) return ["unsupported"];
    // Any control may carry the bound receipt (policies stored before every
    // control recorded it can be mixed); one mismatch is a remote change.
    if (parentControls.some(control=>control.remotePluginId!==undefined && codexRemoteInstallReceipt(control.pluginParent,read)!==control.remotePluginId)) reasons.add("remote");
    const roots=pluginVersionRoots(template.pluginParent);
    if (!roots) reasons.add("unsupported");
    for (const root of roots ?? []) {
      let parsed:CodexPluginRootControls;
      try { parsed=rootControls(root,read); } catch {
        // Unparseable under the reviewed parser: name only what the reviewed tuple does not cover.
        const declared=new Set<CodexPluginCapabilityReason>(); scanCodexPluginRoot(root,read,declared,{ app:template.appSha256!==undefined, mcp:template.mcpSha256!==undefined });
        const added=[...declared];
        for (const reason of added.length ? added : ["unsupported" as const]) reasons.add(reason);
        continue;
      }
      if (parsed.namespace!==template.namespace || parsed.manifestSha256!==template.manifestSha256) reasons.add("manifest");
      if (parsed.appSha256!==template.appSha256) reasons.add("app");
      if (parsed.mcpSha256!==template.mcpSha256) reasons.add("mcp");
    }
  } catch { reasons.add("unsupported"); }
  if (!reasons.size) reasons.add("unsupported");
  return [...reasons].sort();
}
/** Add newly enrolled qualified names to the reviewed control set. Never removes
 * an existing control, and changes one only to bind `remoteIdentities[parent]`,
 * the caller-verified native install receipt, onto an enrolled control stored
 * without it (codexStoredReceiptHeal). A name under an enrolled plugin parent
 * takes that parent's reviewed identity, and the native review must report the
 * same capability tuple for it; it never drops a receipt the review verified.
 * A name under a plugin Skills has not enrolled is admitted only for a
 * skills-only plugin, and binds `remoteIdentities[parent]` when it is remote. */
export function mergeReconciledCodexPluginControls(prior:CodexPluginSkillControl[], reviewed:CodexPluginSkillControl[], names:string[], remoteIdentities:Record<string,string>={}):CodexPluginSkillControl[] {
  if (!Array.isArray(prior) || !Array.isArray(reviewed) || !Array.isArray(names) || prior.length+names.length>4096) refuse();
  const tuple=(control:CodexPluginSkillControl) => JSON.stringify([control.namespace,control.pluginId,control.pluginParent,control.manifestSha256,control.appSha256 ?? null,control.mcpSha256 ?? null]);
  for (const control of reviewed) {
    const enrolled=prior.filter(item=>item.pluginParent===control.pluginParent);
    if (enrolled.some(item=>tuple(item)!==tuple(control) || item.remotePluginId!==undefined && control.remotePluginId!==undefined && item.remotePluginId!==control.remotePluginId)) capabilityRefusal(`plugin ${JSON.stringify(control.pluginId)} changed a reviewed capability`);
  }
  const healed=prior.map(item=>{
    if (!Object.hasOwn(remoteIdentities,item.pluginParent)) return item;
    const remote=remoteIdentities[item.pluginParent];
    if (!remotePluginIdentifier(remote) || item.remotePluginId!==undefined && item.remotePluginId!==remote) capabilityRefusal(`plugin ${JSON.stringify(item.pluginId)} has an unverified remote installation`);
    return item.remotePluginId===undefined ? {...item,remotePluginId:remote} : item;
  });
  const result=[...healed];
  for (const name of [...new Set(names)].sort()) {
    if (prior.some(item=>item.name===name)) continue;
    const matches=reviewed.filter(item=>item.name===name);
    if (matches.length!==1) refuse();
    const control=matches[0]!, template=healed.find(item=>item.pluginParent===control.pluginParent);
    if (template) {
      // A new name copies its parent's bound receipt: the parent's controls must
      // agree on it, and it must be the one the review verified, if any.
      if (healed.some(item=>item.pluginParent===control.pluginParent && item.remotePluginId!==template.remotePluginId)
        || control.remotePluginId!==undefined && template.remotePluginId!==control.remotePluginId) capabilityRefusal(`plugin ${JSON.stringify(control.pluginId)} has an unverified remote installation`);
      result.push({...template,name}); continue;
    }
    if (control.skillsOnly!==true || control.appSha256!==undefined || control.mcpSha256!==undefined) capabilityRefusal(`plugin ${JSON.stringify(control.pluginId)} is not enrolled and carries a capability`);
    const remote=Object.hasOwn(remoteIdentities,control.pluginParent) ? remoteIdentities[control.pluginParent] : undefined;
    const receipt=lstatSync(join(control.pluginParent,".codex-remote-plugin-install.json"),{throwIfNoEntry:false});
    if (Boolean(receipt)!==(remote!==undefined) || remote!==undefined && (!remotePluginIdentifier(remote) || control.remotePluginId!==undefined && control.remotePluginId!==remote)) capabilityRefusal(`plugin ${JSON.stringify(control.pluginId)} has an unverified remote installation`);
    result.push(remote===undefined ? control : {...control,remotePluginId:remote});
  }
  if (new Set(result.map(item=>item.name)).size!==result.length) refuse();
  return result;
}
export function disableReviewedCodexPluginNames(text:string, controls:CodexPluginSkillControl[]):string {
  const rules=(Bun.TOML.parse(text) as any).skills?.config??[];
  for (const control of controls) {
    if (rules.some((rule:any)=>rule.name===control.name && rule.enabled!==false)) throw new Error("CODEX_NATIVE_SKILL_NAME_CONFLICT: review an existing native name enable rule");
    if (!rules.some((rule:any)=>rule.name===control.name && rule.enabled===false)) text+=`\n[[skills.config]]\nname = ${JSON.stringify(control.name)}\nenabled = false\n`;
  }
  return text;
}
