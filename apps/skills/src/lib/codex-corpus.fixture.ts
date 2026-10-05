import { afterEach, expect } from "bun:test";
import { KernelLock } from "@hasna/contracts/kernel-lock";
import { chmodSync, renameSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const fixtures: string[] = [];
afterEach(() => { for (const path of fixtures.splice(0)) rmSync(path, { recursive: true, force: true }); });
export function corpusFixture(enrolled = true) {
  const home = mkdtempSync(join(tmpdir(), "corpus-admission-")); fixtures.push(home);
  const root = join(home, ".codex"); mkdirSync(root, { mode: 0o700 });
  if (enrolled) { const lock = new KernelLock(root, ".native-corpus-admission"); lock.close(); }
  const command = join(home, "native-fixture");
  // A protocol fixture, not proof of a released native implementation.
  writeFileSync(command, `#!${process.execPath}
import { lstatSync, readFileSync, existsSync } from "node:fs";
if (process.argv[2] === "--version") { console.log("codex-cli 0.160.0"); process.exit(0); }
if (process.argv[2] === "app-server") {
  let buffer="";
  process.stdin.on("data",bytes=>{buffer+=bytes.toString();for (;;) {const end=buffer.indexOf("\\n");if(end<0)break;const line=buffer.slice(0,end);buffer=buffer.slice(end+1);const request=JSON.parse(line);if(request.id)console.log(JSON.stringify({id:request.id,result:{userAgent:request.params.clientInfo.name+"/0.160.0"}}));}});
  process.stdin.on("end",()=>{setTimeout(()=>process.exit(0),250);});
} else {
const home = process.argv.at(-1);
if (process.argv[2] !== "corpus-admission-inspect" || process.argv[3] !== "--home") process.exit(2);
const id = path => { const s = lstatSync(path, {bigint:true}); return {device:String(s.dev),inode:String(s.ino)}; };
const mode = existsSync(home+"/fixture-mode") ? readFileSync(home+"/fixture-mode","utf8") : "committed-v2";
if (mode === "pending") process.exit(1);
const result = {schema:"codex-corpus-admission-status/v1",state:mode === "wrong-identity" || mode === "extra" ? "committed-v2" : mode,root:id(home),lock:id(home+"/.native-corpus-admission.flock-v1")};
if (mode === "wrong-identity") result.lock.inode="0";
if (mode === "extra") result.extra=true;
console.log(JSON.stringify(result));
}
`); chmodSync(command, 0o700);
  return {home,root,command,options:{codexCommand:command}};
}
export function assertPublication(root: string, expected: boolean) {
  const lock = new KernelLock(root, ".native-corpus-admission", { existingOnly: true });
  try { expect(lock.trySync(1000)).toBe(expected); } finally { lock.close(); }
}

/** Synthetic admission only; production enrollment remains the native owner's job. */
export function admitCorpusFixture(root: string): void {
  mkdirSync(root,{recursive:true,mode:0o700});
  new KernelLock(root,".native-corpus-admission").close();
}
export function installCorpusInspectorFixture(): () => void {
  const f=corpusFixture(false), before=process.env.PATH;
  renameSync(f.command,join(f.home,"codex"));
  process.env.PATH=f.home+":"+(before??"");
  return ()=>{if(before===undefined)delete process.env.PATH;else process.env.PATH=before;};
}

/** Teach a transport fixture the inspection command without changing its RPC behavior. */
export function wrapNativeInspectionFixture(script: string): string {
  if(!script.startsWith("#!")) return script;
  const f=corpusFixture(false), end=script.indexOf("\n"), head=script.slice(0,end+1), body=script.slice(end+1);
  const command="'"+f.command.replaceAll("'", "'\\''")+"'";
  const query=head.includes("/bin/sh")
    ? `if [ "$1" = "corpus-admission-inspect" ]; then exec ${command} "$@"; fi\n`
    : `if(process.argv[2]==="corpus-admission-inspect"){process.stdout.write(require("node:child_process").execFileSync(${JSON.stringify(f.command)},process.argv.slice(2)));process.exit(0); }\n`;
  return head+query+body;
}
