import { afterEach, expect, test } from "bun:test";
import { closeSync, fstatSync, lstatSync, mkdirSync, mkdtempSync, openSync, realpathSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { useDefaultTestTimeout } from "../test-preload.js";
import { corpusProcessGuardFixture } from "./codex-corpus-guard.fixture.js";

useDefaultTestTimeout();
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

test("guard admits exact synthetic inspection and a shared lease descriptor while refusing unrelated subprocesses", () => {
  const home = mkdtempSync(join(tmpdir(), "corpus-guard-")); roots.push(home);
  const root = join(home, ".codex"), command = join(home, "inspector"), other = join(home, "other");
  mkdirSync(root, { mode: 0o700 });
  writeFileSync(command, "// Never executed by this predicate test.\n");
  writeFileSync(other, "");
  const lock = join(root, ".native-corpus-admission.flock-v1"); writeFileSync(lock, "", { mode: 0o600 });
  const fd = openSync(lock, "r+"), otherFd = openSync(other, "r+");
  let permittedCalls = 0, refusedCalls = 0;
  const child: Record<string, (...args: any[]) => void> = Object.fromEntries(["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"].map(name => [name, () => { permittedCalls++; }]));
  const source = corpusProcessGuardFixture(command, [root]).replace(/^import .*;$/gm, "");
  const permit = new Function("child", "deny", "corpusFstat", "corpusLstat", "corpusRealpath", "Bun", "corpusMock", source + "return corpusPermits;")(
    child, () => { refusedCalls++; }, fstatSync, lstatSync, realpathSync, { spawnSync() {}, spawn() {} }, { module() {} },
  );
  try {
    child.execFileSync!(command, ["corpus-admission-inspect", "--home", root]);
    const script = 'open(my $lock, "+<&=3") or exit 74; my $ok=flock($lock, 5); exit($ok ? 0 : ((0+$!) == ($^O eq "darwin" ? 35 : 11) ? 75 : 74));';
    const argv = ["-T", "-e", script], options = { env: { LANG: "C" }, stdio: ["ignore", "ignore", "ignore", fd] };
    const perl = realpathSync("/usr/bin/perl");
    expect(permit("spawnSync", perl, argv, options)).toBe(true);
    expect(permit("spawnSync", perl, argv, { ...options, stdio: ["ignore", "ignore", "ignore", otherFd] })).toBe(false);
    expect(permit("spawnSync", perl, ["-T", "-e", script + "; system('true')"], options)).toBe(false);
    expect(permit("spawnSync", perl, argv, { ...options, env: { LANG: "C", OTHER: "unexpected" } })).toBe(false);
    child.execFileSync!(command, ["corpus-admission-inspect", "--home", home]);
    child.execFileSync!(command, ["app-server", "--home", root]);
    child.spawnSync!(command, ["corpus-admission-inspect", "--home", root]);
    child.execFileSync!("/usr/bin/true", []);
    expect(permittedCalls).toBe(1);
    expect(refusedCalls).toBe(4);
  } finally { closeSync(fd); closeSync(otherFd); }
});


test("guard permits real Bun synchronous delegation only inside validated Node calls and resets after a throw", () => {
  const home = mkdtempSync(join(tmpdir(), "corpus-guard-runtime-")); roots.push(home);
  const root = join(home, ".codex"), command = join(home, "inspector"), guard = join(home, "guard.ts");
  mkdirSync(root, { mode: 0o700 });
  const lock = join(root, ".native-corpus-admission.flock-v1");
  // This tests guard mechanics only, never native admission or KernelLock trust.
  writeFileSync(lock, "", { mode: 0o600 });
  writeFileSync(command, `#!${process.execPath}
if (process.env.FIXTURE_THROW === "1") process.exit(7);
console.log("inspection-fixture-passed");
`, { mode: 0o700 });
  chmodSync(command, 0o700);
  writeFileSync(guard, `import child from "node:child_process";
import {syncBuiltinESMExports} from "node:module";
const deny=()=>{throw new Error("CORPUS_GUARD_IO_DENIED")};
globalThis.fetch=deny;
${corpusProcessGuardFixture(command, [root])}
syncBuiltinESMExports();`);
  const script = `import {execFileSync,spawnSync,spawn} from "node:child_process";
import {openSync,closeSync} from "node:fs";
const command=${JSON.stringify(command)},root=${JSON.stringify(root)};
const args=["corpus-admission-inspect","--home",root];
const variants=[await import("node:child_process"),await import("child_process"),require("node:child_process"),require("child_process")];
for(const api of variants)for(const exportObject of [api,api.default].filter(Boolean)){
 if(exportObject.execFileSync(command,args,{encoding:"utf8"}).trim()!=="inspection-fixture-passed")throw Error("Named/default/require delegation failed");
 let denied=false;try{exportObject.execFileSync("/usr/bin/true",[])}catch(error){denied=error.message==="CORPUS_GUARD_IO_DENIED"}if(!denied)throw Error("Alias denial failed");
}

if(execFileSync(command,args,{encoding:"utf8"}).trim()!=="inspection-fixture-passed")throw Error("Inspector delegation failed");
const fd=openSync(${JSON.stringify(lock)},"r+");
try{
 const script='open(my $lock, "+<&=3") or exit 74; my $ok=flock($lock, 5); exit($ok ? 0 : ((0+$!) == ($^O eq "darwin" ? 35 : 11) ? 75 : 74));';
 const result=spawnSync(${JSON.stringify(realpathSync("/usr/bin/perl"))},["-T","-e",script],{env:{LANG:"C"},stdio:["ignore","ignore","ignore",fd]});
 if(result.status!==0)throw Error("Shared helper delegation failed");
}finally{closeSync(fd)}
let thrown=false;try{execFileSync(command,args,{env:{FIXTURE_THROW:"1"},stdio:"ignore"})}catch{thrown=true}if(!thrown)throw Error("Throw control failed");
let refused=0;for(const call of [()=>Bun.spawnSync([command,...args]),()=>Bun.spawn([command,...args]),()=>execFileSync("/usr/bin/true",[]),()=>spawn("/usr/bin/true",[]),()=>spawnSync(command,args),()=>fetch("https://guard-control.invalid")]){
 try{call()}catch(error){if(error.message==="CORPUS_GUARD_IO_DENIED")refused++;else throw error;}
}
if(refused!==6)throw Error("Guard reset or denial control failed");console.log("guard-delegation-and-reset-passed");`;
  const child = Bun.spawnSync([process.execPath, "--no-env-file", "--preload", guard, "-e", script], {
    cwd: home, env: { HOME: home, TMPDIR: home, PATH: "" }, stdout: "pipe", stderr: "pipe", timeout: 10000,
  });
  expect(child.exitCode).toBe(0);
  expect(child.stderr.toString()).toBe("");
  expect(child.stdout.toString().trim()).toBe("guard-delegation-and-reset-passed");
});
