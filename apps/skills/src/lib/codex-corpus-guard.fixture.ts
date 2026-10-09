import { realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Child-process guard for synthetic corpus tests, never a production policy.
 * Permit the fixture inspector and the real shared-lock helper only; the
 * helper must receive a descriptor for one of the explicitly admitted roots.
 * The production admission and kernel ownership checks still run unchanged. */
export function corpusProcessGuardFixture(command: string, roots: string[]): string {
  const sharedScript = 'open(my $lock, "+<&=3") or exit 74; my $ok=flock($lock, 5); exit($ok ? 0 : ((0+$!) == ($^O eq "darwin" ? 35 : 11) ? 75 : 74));';
  const canonicalRoots = roots.map(root => realpathSync(root));
  const aclPaths = new Set<string>();
  for (const root of canonicalRoots) {
    aclPaths.add(join(root, ".native-corpus-admission.flock-v1"));
    for (let path = root; ; path = dirname(path)) {
      aclPaths.add(path);
      if (dirname(path) === path) break;
    }
  }
  const aclHelper = process.platform === "darwin"
    ? fileURLToPath(new URL("../native/kernel-lock-acl-darwin", import.meta.resolve("@hasna/contracts/kernel-lock"))) : null;
  return `
import { fstatSync as corpusFstat, lstatSync as corpusLstat, realpathSync as corpusRealpath } from "node:fs";
const corpusInspector = ${JSON.stringify(realpathSync(command))};
const corpusRoots = ${JSON.stringify(canonicalRoots)};
const corpusAclHelper = ${JSON.stringify(aclHelper)};
const corpusAclPaths = ${JSON.stringify([...aclPaths])};
const corpusSharedScript = ${JSON.stringify(sharedScript)};
function corpusPermits(method, program, args, options) {
  try {
    if (!Array.isArray(args)) return false;
    if (method === "execFileSync" && program === corpusInspector
      && args.length === 3 && args[0] === "corpus-admission-inspect" && args[1] === "--home"
      && corpusRoots.includes(args[2])) return true;
    if (method === "spawnSync" && corpusAclHelper && program === corpusAclHelper
      && args.length > 0 && args.length % 3 === 0 && args.length <= 768
      && options && JSON.stringify(options.env) === JSON.stringify({ LANG: "C" })
      && JSON.stringify(options.stdio) === JSON.stringify(["ignore", "pipe", "ignore"])) {
      for (let index = 0; index < args.length; index += 3) {
        if (!corpusAclPaths.includes(args[index])) return false;
        const stat = corpusLstat(args[index]);
        if (String(stat.dev) !== args[index + 1] || String(stat.ino) !== args[index + 2]) return false;
      }
      return true;
    }
    if (method !== "spawnSync" || program !== corpusRealpath("/usr/bin/perl")
      || args.length !== 3 || args[0] !== "-T" || args[1] !== "-e" || args[2] !== corpusSharedScript
      || !options || JSON.stringify(options.env) !== JSON.stringify({ LANG: "C" })
      || !Array.isArray(options.stdio) || options.stdio.length !== 4
      || options.stdio.slice(0, 3).some(value => value !== "ignore")
      || !Number.isInteger(options.stdio[3])) return false;
    const fd = corpusFstat(options.stdio[3]);
    return corpusRoots.some(root => {
      const lock = corpusLstat(root + "/.native-corpus-admission.flock-v1");
      return lock.isFile() && !lock.isSymbolicLink() && fd.isFile() && fd.dev === lock.dev && fd.ino === lock.ino;
    });
  } catch { return false; }
}
for (const method of ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"]) {
  const original = child[method];
  child[method] = (...args) => corpusPermits(method, ...args) ? original.apply(child, args) : deny();
}
`;
}
