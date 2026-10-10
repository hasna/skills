import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Stats } from "node:fs";

const assetName = "kernel-lock-acl-darwin";
const hash = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");
const sameEntry = (a: Stats, b: Stats): boolean => a.dev === b.dev && a.ino === b.ino;

function readStableFile(path: string, installed = false): Buffer {
  if (realpathSync(path) !== path) throw new Error("Kernel lock asset path must be physical");
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = fstatSync(fd);
    if (!before.isFile() || before.size > 1_048_576 ||
        (before.uid !== 0 && before.uid !== process.getuid?.()) ||
        (installed && (before.nlink !== 1 || (before.mode & 0o777) !== 0o755))) {
      throw new Error("Unsafe kernel lock asset");
    }
    const bytes = readFileSync(fd);
    const after = fstatSync(fd);
    if (!sameEntry(before, after) || !sameEntry(after, lstatSync(path)) ||
        before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) {
      throw new Error("Owning kernel lock asset changed while reading");
    }
    return bytes;
  } finally { closeSync(fd); }
}

/** Bundle the owning code without changing its literal ../native asset lookup or runtime guards. */
export function stageKernelLockAssets(modulePath: string, packageRoot: string, expectedVersion: string): string {
  const module = realpathSync(modulePath);
  const contractsRoot = dirname(dirname(module));
  const identity = JSON.parse(readStableFile(join(contractsRoot, "package.json")).toString());
  if (identity.name !== "@hasna/contracts" || identity.version !== expectedVersion) {
    throw new Error("Kernel lock assets must come from the pinned Contracts package");
  }
  const code = readStableFile(module).toString();
  const pin = code.match(/(?:const|var) DARWIN_HELPER_SHA256 = "([a-f0-9]{64})";/)?.[1];
  if (!pin || !code.includes('new URL("../native/kernel-lock-acl-darwin", import.meta.url)')) {
    throw new Error("Owning kernel lock asset contract changed");
  }
  const metadata = JSON.parse(readStableFile(join(contractsRoot, "native", `${assetName}.json`)).toString());
  // Package-manager cache files may be writable/hard-linked. Never execute them;
  // verify stable bytes against the owning pin, then create independent runtime copies.
  const bytes = readStableFile(join(contractsRoot, "native", assetName));
  if (metadata.schemaVersion !== 1 || metadata.platform !== "darwin" ||
      JSON.stringify(metadata.architectures) !== '["arm64","x86_64"]' ||
      metadata.artifactSha256 !== pin || metadata.artifactBytes !== bytes.length || hash(bytes) !== pin ||
      bytes.length < 48 || bytes.readUInt32BE(0) !== 0xcafebabe || bytes.readUInt32BE(4) !== 2 ||
      JSON.stringify([bytes.readUInt32BE(8), bytes.readUInt32BE(28)].sort()) !== JSON.stringify([0x01000007, 0x0100000c].sort())) {
    throw new Error("Owning kernel lock universal asset or runtime pin is invalid");
  }
  const root = realpathSync(packageRoot);
  // bin/mcp.js and dist/index.js resolve package/native; dist/sdk/index.js resolves dist/native.
  for (const directory of [join(root, "native"), join(root, "dist", "native")]) {
    if (realpathSync(dirname(directory)) !== dirname(directory)) {
      throw new Error("Bundled kernel lock asset parent must be physical");
    }
    try { mkdirSync(directory, { mode: 0o755 }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
    if (realpathSync(directory) !== directory || !lstatSync(directory).isDirectory()) {
      throw new Error("Bundled kernel lock asset directory must be physical");
    }
    const target = join(directory, assetName);
    try { writeFileSync(target, bytes, { flag: "wx", mode: 0o755 }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
    const installed = readStableFile(target, true);
    const info = lstatSync(target);
    if (hash(installed) !== pin || !installed.equals(bytes) || info.nlink !== 1 ||
        (info.mode & 0o777) !== 0o755) throw new Error("Bundled kernel lock asset readback failed");
  }
  return pin;
}
