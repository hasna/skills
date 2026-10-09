import { afterEach, expect, test } from "bun:test";
import { closeSync, fstatSync, lstatSync, mkdirSync, mkdtempSync, openSync, realpathSync, rmSync, writeFileSync } from "node:fs";
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
  const source = corpusProcessGuardFixture(command, [root]).replace(/^import .*;$/m, "");
  const permit = new Function("child", "deny", "corpusFstat", "corpusLstat", "corpusRealpath", source + "return corpusPermits;")(
    child, () => { refusedCalls++; }, fstatSync, lstatSync, realpathSync,
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
