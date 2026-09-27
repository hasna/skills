import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, relative } from "node:path";

type Fields = { dependencies?: Record<string,string>; devDependencies?: Record<string,string>; optionalDependencies?: Record<string,string>; peerDependencies?: Record<string,string>; optionalPeers?: string[] };
type Manifest = Fields & { name:string; version:string; peerDependenciesMeta?:Record<string,{optional?:boolean}> };
type Tuple = [string,string,Fields,string];
type Lock = { lockfileVersion:number; workspaces:Record<string,Fields & {name:string}>; packages:Record<string,Tuple> };
const sha = (bytes:string|Buffer) => createHash("sha256").update(bytes).digest("hex");
const canonical = (record:Record<string,string> = {}) => JSON.stringify(Object.entries(record).sort(([a],[b])=>a.localeCompare(b)));
function insist(value:unknown,label:string):asserts value { if(!value) throw new Error(`Producer dependency verification refused: ${label}`); }
function inside(parent:string,child:string) { const value=relative(parent,child);return value===""||(!value.startsWith("../")&&value!==".."&&!isAbsolute(value)); }
function scopes(key:string) {
 const parts=key.split("/"), names:string[]=[];
 for(let i=0;i<parts.length;i++) names.push(parts[i]!.startsWith("@")?`${parts[i]}/${parts[++i]}`:parts[i]!);
 return names.map((_,i)=>names.slice(0,i+1).join("/")).reverse();
}
type Context = Record<string,string|null>;
function lockedEdge(lock:Lock,parentKey:string|undefined,context:Context,name:string,peer:boolean) {
 for(const prefix of parentKey?scopes(parentKey):[]) {const key=`${prefix}/${name}`;if(lock.packages[key])return {key,tuple:lock.packages[key]!};}
 if(peer&&name in context) {const key=context[name];return key&&lock.packages[key]?{key,tuple:lock.packages[key]!}:null;}
 return lock.packages[name]?{key:name,tuple:lock.packages[name]!}:null;
}
function dependencies(metadata:Fields) {
 return Object.keys({...metadata.dependencies,...metadata.optionalDependencies,...metadata.peerDependencies}).map(name=>({
  name,peer:name in (metadata.peerDependencies??{})&&!(name in (metadata.dependencies??{}))&&!(name in (metadata.optionalDependencies??{})),
  optional:name in (metadata.optionalDependencies??{})||(metadata.optionalPeers??[]).includes(name),
 }));
}
function installedPackage(parent:string,name:string) {
 insist(/^(@[a-z0-9._-]+\/)?[a-z0-9._-]+$/.test(name),"unsupported package name");
 const paths=createRequire(join(parent,"package.json")).resolve.paths("__skills_dependency_graph__");insist(paths,`package resolution paths for ${name}`);
 for(const candidate of paths) {
  const directory=join(candidate,name);
  if(!existsSync(directory))continue;
  const manifest=join(realpathSync(directory),"package.json");insist(existsSync(manifest)&&statSync(manifest).isFile(),`missing resolved manifest for ${name}`);
  return {directory:realpathSync(directory),owner:realpathSync(dirname(candidate)),manifest,bytes:readFileSync(manifest)};
 }
 return null;
}

/** Verifies installed resolution against the selected standalone frozen lock.
 * This is a graph/version check; the separate frozen installer receipt binds
 * registry integrity. Package payload attestation is not inferred from version. */
export function verifyProducerDependencies(packageRoot:string) {
 const root=realpathSync(packageRoot), manifestBytes=readFileSync(join(root,"package.json")), lockBytes=readFileSync(join(root,"bun.lock"));
 const manifest=JSON.parse(manifestBytes.toString()) as Manifest, lock=Bun.JSONC.parse(lockBytes.toString()) as Lock;
 insist(lock.lockfileVersion===1&&lock.workspaces[""]?.name===manifest.name&&Object.keys(lock.workspaces).length===1,"selected standalone lock authority");
 for(const field of ["dependencies","devDependencies","optionalDependencies","peerDependencies"] as const) insist(canonical(manifest[field])===canonical(lock.workspaces[""]![field]),`root ${field} mismatch`);
 // Peer installations inherit their installation scope's effective bindings,
 // not a caller that reaches them through hoisting. Ordinary
 // dependencies replace earlier bindings: a hoisted adapter's broad ordinary
 // Zod dependency can use root Zod4 even beneath an importer that uses Zod3.
 // Only peer names matter; each maps to one exact key (or absence) in this
 // frozen lock. This finite, sorted context also makes cyclic walks stable.
 const peerNames=new Set(Object.values(lock.packages).flatMap(tuple=>Object.keys(tuple[2]?.peerDependencies??{})));
 const normalize=(context:Context):Context=>Object.fromEntries(Object.entries(context).sort(([a],[b])=>a.localeCompare(b)));
 const inherited=(context:Context,key:string|undefined,name:string|undefined,metadata:Fields):Context=>{
  const next={...context};if(key&&name&&peerNames.has(name))next[name]=key;
  for(const edge of dependencies(metadata)) if(peerNames.has(edge.name))next[edge.name]=lockedEdge(lock,key,context,edge.name,edge.peer)?.key??null;
  return normalize(next);
 };
 const initial=inherited({},undefined,undefined,{dependencies:{...manifest.dependencies,...manifest.devDependencies,...manifest.optionalDependencies,...manifest.peerDependencies}});
 const scopeContexts=new Map<string,Context>([[root,initial]]);
 const graphRoot=realpathSync(join(root,"node_modules")), queue:{parent:string;parentKey?:string;context:Context;name:string;peer:boolean;optional:boolean}[]=[];
 const nodes:{lockKey:string;name:string;version:string;manifestSha256:string;relativePath:string;context:Context}[]=[], edges:{from:string;name:string;to:string|null;optionalAbsent?:boolean}[]=[];
 const visited=new Set<string>();
 for(const [name] of Object.entries({...manifest.dependencies,...manifest.devDependencies,...manifest.optionalDependencies,...manifest.peerDependencies})) queue.push({parent:root,context:initial,name,peer:false,optional:name in (manifest.optionalDependencies??{})});
 while(queue.length) {
  const edge=queue.shift()!, selected=lockedEdge(lock,edge.parentKey,edge.context,edge.name,edge.peer), installed=installedPackage(edge.parent,edge.name);
  if(!installed) { insist(edge.optional,`missing required ${edge.name}`);edges.push({from:edge.parentKey??"root",name:edge.name,to:null,optionalAbsent:true});continue; }
  insist(selected,`unlocked installed ${edge.name}`);
  const at=selected.tuple[0].lastIndexOf("@"), name=selected.tuple[0].slice(0,at), version=selected.tuple[0].slice(at+1);
  insist(at>0&&version&&!version.startsWith("workspace:"),`unsupported lock identity ${selected.key}`);
  const value=JSON.parse(installed.bytes.toString()) as Manifest;
  insist(value.name===name&&value.version===version,`${edge.name} resolved ${value.name}@${value.version}, lock requires ${name}@${version}`);
  insist(inside(graphRoot,installed.directory),`resolved ${edge.name} escapes selected dependency graph`);
  edges.push({from:edge.parentKey??"root",name:edge.name,to:selected.key});
  // Keep the lookup owner before resolving package symlinks. A genuinely
  // hoisted package uses its ancestor scope; a nested alias cannot rescue a
  // substituted peer by adopting the target's different scope.
  const scope=installed.owner===edge.parent?edge.context:scopeContexts.get(installed.owner);
  insist(scope,`unknown installation scope for ${edge.name}`);
  const context=inherited(scope,selected.key,name,selected.tuple[2]);
  const identity=JSON.stringify([selected.key,installed.directory,context]);if(visited.has(identity))continue;visited.add(identity);
  scopeContexts.set(installed.directory,context);
  nodes.push({lockKey:selected.key,name,version,manifestSha256:sha(installed.bytes),relativePath:relative(graphRoot,installed.directory),context});
  const metadata=selected.tuple[2];
  // Only the package root's dev dependencies are build inputs. Nested dev
  // dependencies are not installed. Optional peer absence is explicit.
  for(const field of ["dependencies","optionalDependencies","peerDependencies"] as const) {
   const actual={...value[field]};
   // Bun elides an identical peer declaration already present as a required
   // dependency. Keep conflicting ranges visible; only exact duplicates fold.
   if(field==="peerDependencies") {
    for(const [dependency,details] of Object.entries(value.peerDependenciesMeta??{})) if(details.optional&&!actual[dependency]) actual[dependency]="*";
    for(const [dependency,range] of Object.entries(actual)) if(value.dependencies?.[dependency]===range) delete actual[dependency];
   }
   insist(canonical(actual)===canonical(metadata[field]),`locked metadata differs for ${selected.key} ${field}`);
  }
  for(const dependency of dependencies(metadata)) queue.push({parent:installed.directory,parentKey:selected.key,context,...dependency});
 }
 nodes.sort((a,b)=>a.lockKey.localeCompare(b.lockKey)||a.relativePath.localeCompare(b.relativePath)||JSON.stringify(a.context).localeCompare(JSON.stringify(b.context)));
 return {status:"verified",package:{name:manifest.name,version:manifest.version},manifestSha256:sha(manifestBytes),lockSha256:sha(lockBytes),nodeCount:nodes.length,edgeCount:edges.length,nodes,edges};
}
