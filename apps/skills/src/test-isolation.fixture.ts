/** Test-only startup checks. Never import migration code to establish isolation. */
import { execFileSync } from "node:child_process";
import { lstatSync, readdirSync, realpathSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { NATIVE_SKILL_ROOTS } from "./lib/native-discovery-roots.js";

function fail(reason: string): never {
  throw new Error(`SKILLS_TEST_TEMP_ROOT_UNSAFE: ${reason}. Set TMPDIR to an existing isolated directory outside account homes and native discovery ancestry (for example /tmp).`);
}

/** Bun's os.userInfo().homedir can follow HOME, so use the numeric OS account. */
export function accountHomeFromRecord(platform: string, uid: number, output: string): string {
  let home: string | undefined;
  if (platform === "linux") {
    const rows = output.trim().split(/\r?\n/).map(line => line.split(":"));
    if (rows.length !== 1 || rows[0]?.length !== 7 || rows[0]?.[2] !== String(uid)) fail("account lookup is ambiguous");
    home = rows[0]![5];
  } else if (platform === "darwin") {
    const records = output.trim().split(/\r?\n\s*\r?\n/);
    if (records.length !== 1) fail("account lookup is ambiguous");
    const fields = records[0]!.split(/\r?\n/).map(line => /^([a-z_]+): (.*)$/.exec(line));
    const values = (name: string) => fields.filter(field => field?.[1] === name).map(field => field![2]);
    const ids = values("uid"), homes = values("dir");
    if (ids.length !== 1 || ids[0] !== String(uid) || homes.length !== 1) fail("account lookup is ambiguous");
    home = homes[0];
  } else fail("unsupported OS account lookup");
  if (!home || !isAbsolute(home) || /[\0\r\n]/.test(home)) fail("account home is invalid");
  return home;
}

export function operatingSystemAccountHome(): string {
  const uid = process.getuid?.();
  if (uid === undefined) fail("OS account identity is unavailable");
  const platform = process.platform;
  const command = platform === "linux" ? "/usr/bin/getent" : platform === "darwin" ? "/usr/bin/dscacheutil" : undefined;
  if (!command) fail("unsupported OS account lookup");
  let output: string;
  try {
    output = execFileSync(command, platform === "linux" ? ["passwd", String(uid)] : ["-q", "user", "-a", "uid", String(uid)], {
      encoding: "utf8", timeout: 5000, maxBuffer: 64 * 1024,
      env: { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C" }, stdio: ["ignore", "pipe", "pipe"],
    });
  } catch { return fail("OS account lookup failed"); }
  return accountHomeFromRecord(platform, uid, output);
}

// Containers also cover native configuration, plugins and legacy commands.
// Derive them from the owner inventory so new agents cannot silently miss this guard.
const discoveryContainers = [...new Set(NATIVE_SKILL_ROOTS.map(([, path]) => dirname(path)))];
const projectDiscoveryFiles = ["opencode.json", "opencode.jsonc"];
const contains = (parent: string, child: string) => {
  const rel = relative(parent, child);
  return rel === "" || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`));
};

/** Inputs are injectable only for disposable fixtures; preload supplies OS identity. */
export function assertSafeTestTempRoot(tempRoot: string, accountHome: string): void {
  if (!isAbsolute(tempRoot) || !isAbsolute(accountHome) || /[\0\r\n]/.test(tempRoot + accountHome)) fail("temporary root or account home is invalid");
  let canonicalTemp: string, canonicalHome: string;
  try {
    canonicalTemp = realpathSync(tempRoot);
    canonicalHome = realpathSync(accountHome);
    if (!statSync(canonicalTemp).isDirectory() || !statSync(canonicalHome).isDirectory()) fail("temporary root or account home is not a directory");
  } catch { return fail("temporary root or account home cannot be resolved"); }
  for (const root of new Set([resolve(tempRoot), canonicalTemp])) {
    if ([resolve(accountHome), canonicalHome].some(home => contains(home, root))) fail("temporary root is inside the OS account home");
    for (let ancestor = root; ; ancestor = dirname(ancestor)) {
      for (const marker of [...discoveryContainers, ...projectDiscoveryFiles]) {
        try {
          // Inspect each segment so aliases such as .config -> another tree,
          // including dangling aliases, cannot hide discovery. Never read config.
          let path = ancestor;
          for (const part of marker.split("/")) {
            path = join(path, part);
            const stat = lstatSync(path, { throwIfNoEntry: false });
            if (!stat) break;
            if (projectDiscoveryFiles.includes(marker) || stat.isSymbolicLink() || !stat.isDirectory()) fail("temporary ancestry exposes native agent discovery");
            if (path === join(ancestor, marker) && readdirSync(path).length > 0) fail("temporary ancestry exposes native agent discovery");
          }
        } catch (error) {
          if (error instanceof Error && error.message.startsWith("SKILLS_TEST_TEMP_ROOT_UNSAFE:")) throw error;
          return fail("temporary ancestry cannot be inspected");
        }
      }
      if (dirname(ancestor) === ancestor) break;
    }
  }
}

export function assertTestStartupIsolation(): void {
  assertSafeTestTempRoot(tmpdir(), operatingSystemAccountHome());
}
