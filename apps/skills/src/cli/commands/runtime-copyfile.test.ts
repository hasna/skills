import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { Command } from "commander";
import { registerRuntime } from "./runtime.js";
import { createHash, randomUUID } from "node:crypto";
import { gzipSync } from "node:zlib";
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, readdirSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { basename, delimiter, dirname, join, relative } from "node:path";
import { tmpdir } from "node:os";
import { adoptCopyfileAliases, preflightTarball, readBodyCapped, rollbackCopyfileAliases, rollbackCopyfileRuntime, updateCopyfileRuntime } from "./runtime-copyfile.js";
import { inspectLauncher, launcherTarget, parsePinnedLauncher, renderPinnedLauncher } from "./runtime-launcher.js";
import * as launcherModule from "./runtime-launcher.js";
import * as nodeFs from "node:fs";
import { version as prerequisiteTargetVersion } from "../../../package.json";
import { installSumiPathsFixture } from "../../lib/sumi-paths.fixture.js";
import { useDefaultTestTimeout } from "../../test-preload.js";

useDefaultTestTimeout();

// A switched launcher is a pinned regular file; this reads the entry it runs
// and asserts the shape, so a regression to a bare symlink fails here too.
function pinnedTarget(path: string): string {
  const launcher = inspectLauncher(path);
  expect(launcher.kind).toBe("pinned");
  expect(lstatSync(path).isSymbolicLink()).toBe(false);
  expect(lstatSync(path).mode & 0o777).toBe(0o755);
  return launcher.kind === "pinned" ? launcher.target : "";
}

const BIN = {
  skills: "bin/index.js",
  "skills-mcp": "bin/mcp.js",
  "skills-serve": "bin/server.js",
  "skills-server": "bin/server.js",
  "skills-worker": "bin/worker.js",
  "skills-maintenance": "bin/maintenance.js",
  "skills-migrate": "bin/migrate.js",
};
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixtureHome() {
  const home = join(tmpdir(), `skills-copyfile-${crypto.randomUUID()}`);
  roots.push(home);
  const runtime = join(home, ".hasna", "skills", "runtime");
  const oldPackage = join(runtime, "0.10.6-copyfile", "node_modules", "@hasna", "skills");
  const localBin = join(home, ".local", "bin"), bunBin = join(home, ".bun", "bin");
  for (const dir of [runtime, oldPackage, localBin, bunBin, join(home, ".claude"), join(home, ".codex"), join(home, ".hasna", "skills")]) mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(runtime, 0o700);
  for (const [name, path] of Object.entries(BIN)) {
    const target = join(oldPackage, path);
    mkdirSync(join(target, ".."), { recursive: true, mode: 0o700 });
    writeFileSync(target, `#!/usr/bin/env bun\nconsole.log("0.10.6 ${name}");\n`, { mode: 0o755 });
    for (const dir of [localBin, bunBin]) symlinkSync(relative(dir, target), join(dir, name));
  }
  writeFileSync(join(oldPackage, "package.json"), JSON.stringify({ name: "@hasna/skills", version: "0.10.6", bin: BIN }), { mode: 0o600 });
  const configs = [
    [join(home, ".claude", "settings.json"), "{\"fixture\":\"claude\"}\n"],
    [join(home, ".codex", "config.toml"), "fixture = true\n"],
    [join(home, ".codex", "hooks.json"), "{\"fixture\":\"hooks\"}\n"],
    [join(home, ".hasna", "skills", "agent-policy.json"), "{\"fixture\":\"policy\"}\n"],
  ] as const;
  for (const [path, text] of configs) writeFileSync(path, text, { mode: 0o600 });
  const externalBin = join(tmpdir(), `skills-external-bin-${crypto.randomUUID()}`);
  roots.push(externalBin);
  mkdirSync(externalBin, { mode: 0o700 });
  for (const [name, path] of Object.entries(BIN)) symlinkSync(relative(externalBin, join(oldPackage, path)), join(externalBin, name));
  return { home, runtime, oldPackage, localBin, bunBin, externalBin, configs };
}

async function serverWithArtifact(dependencies: Record<string, string> = {}, optionalDependencies: Record<string, string> = {}, entryBody: (name: string) => string = name => `console.log("0.10.8 ${name}");`, version = "0.10.8", prerequisites?: { declaration: unknown; entry: string | null }) {
  const artifact = await new Bun.Archive({
    "package/package.json": JSON.stringify({ name: "@hasna/skills", version, bin: BIN, dependencies, ...(Object.keys(optionalDependencies).length ? { optionalDependencies } : {}), ...(prerequisites ? { skillsRuntimePrerequisites: prerequisites.declaration } : {}) }),
    "package/README.md": "Synthetic package fixture.\n",
    ...Object.fromEntries(Object.entries(BIN).map(([name, file]) => [`package/${file}`, `#!/usr/bin/env bun\n${entryBody(name)}\n`])),
    ...(prerequisites?.entry !== null && prerequisites?.entry !== undefined ? { "package/dist/runtime-prerequisites.js": prerequisites.entry } : {}),
  }, { compress: "gzip" }).bytes();
  const integrity = `sha512-${createHash("sha512").update(artifact).digest("base64")}`;
  let server: ReturnType<typeof Bun.serve>;
  server = Bun.serve({
    port: 0,
    fetch(request) {
      const url = new URL(request.url);
      if (url.pathname.endsWith(`/${version}`)) return Response.json({
        _id: `@hasna/skills@${version}`, name: "@hasna/skills", version,
        dist: { integrity, tarball: `${server.url.origin}/skills-${version}.tgz` },
      });
      if (url.pathname === `/skills-${version}.tgz`) return new Response(artifact);
      return new Response("not found", { status: 404 });
    },
  });
  return { server, artifact, integrity };
}

// A hostile working directory: a bunfig.toml preload that writes a marker on
// every load, plus a .env the entry would otherwise see. The launcher under
// test is invoked from here with a BUN_OPTIONS preload in its environment.
function hostileDirectory() {
  const dir = join(tmpdir(), `skills-hostile-cwd-${crypto.randomUUID()}`);
  roots.push(dir);
  mkdirSync(dir, { mode: 0o700 });
  const marker = join(dir, "preload-marker");
  writeFileSync(join(dir, "preload.js"), `require("node:fs").writeFileSync(${JSON.stringify(marker)}, "ran\\n", { flag: "a" });\n`, { mode: 0o600 });
  writeFileSync(join(dir, "bunfig.toml"), `preload = [${JSON.stringify(join(dir, "preload.js"))}]\n`, { mode: 0o600 });
  writeFileSync(join(dir, ".env"), "HOSTILE_DOTENV=leaked\n", { mode: 0o600 });
  const markers = () => (existsSync(marker) ? readFileSync(marker, "utf8").split("\n").filter(Boolean).length : 0);
  const launch = (launcher: string, extraEnv: Record<string, string> = {}) => {
    const run = Bun.spawnSync([launcher, "probe-arg"], {
      cwd: dir,
      env: { HOME: process.env.HOME ?? "", PATH: process.env.PATH ?? "", ...extraEnv },
      stdin: "ignore", stdout: "pipe", stderr: "pipe",
    });
    return { code: run.exitCode, stdout: run.stdout.toString("utf8"), stderr: run.stderr.toString("utf8") };
  };
  return { dir, marker, markers, launch };
}

// Every managed launcher path of a fixture: each bin in ~/.local/bin and ~/.bun/bin.
function binPaths(f: { localBin: string; bunBin: string }): string[] {
  return [f.localBin, f.bunBin].flatMap(dir => Object.keys(BIN).map(name => join(dir, name)));
}

// The exact shape and identity of each launcher: symlink text or file text, and inode.
function launcherSnapshot(paths: Iterable<string>) {
  return new Map([...paths].map(path => {
    const stat = lstatSync(path);
    return [path, { symlink: stat.isSymbolicLink(), text: stat.isSymbolicLink() ? readlinkSync(path) : readFileSync(path, "utf8"), ino: stat.ino }] as const;
  }));
}

// The state an updater from before pinned launchers (0.10.48) leaves after it
// installs a newer runtime: every launcher it switched is a bare absolute symlink
// to the new runtime's entry, and its rollout receipt and preimage manifest carry
// no launcher shape fields. This rewrites a fresh rollout into exactly that state
// and returns each launcher's link text.
function asPrePinnedRollout(targetRoot: string): Map<string, string> {
  const receiptPath = join(targetRoot, "rollout-receipt.json");
  const receipt = JSON.parse(readFileSync(receiptPath, "utf8"));
  const links = new Map<string, string>();
  receipt.launchers = receipt.launchers.map((item: Record<string, string>) => {
    expect(inspectLauncher(item.path!).kind).toBe("pinned");
    const temp = `${item.path}.synthetic-pre-pinned`;
    symlinkSync(item.newTarget!, temp);
    renameSync(temp, item.path!);
    links.set(item.path!, item.newTarget!);
    return { path: item.path, oldTarget: item.oldTarget, oldLinkTarget: item.oldLinkTarget, newTarget: item.newTarget, backupPath: item.backupPath };
  });
  const manifestPath = join(targetRoot, "preimage", "manifest.json");
  const manifest = Buffer.from(`${JSON.stringify({ schema: "skills.copyfile-preimage.v1", configs: receipt.configs, launchers: receipt.launchers }, null, 2)}\n`);
  chmodSync(manifestPath, 0o600);
  writeFileSync(manifestPath, manifest);
  chmodSync(manifestPath, 0o400);
  receipt.preimageSha256 = createHash("sha256").update(manifest).digest("hex");
  writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  for (const [path, text] of links) expect(inspectLauncher(path)).toEqual({ kind: "symlink", linkTarget: text, target: text });
  return links;
}

// Replay a .60 rollout: its new launchers are exact V1 bytes, and receipt
// format/profile metadata is absent. Rebuild the synthetic preimage binding.
function asV1Rollout(targetRoot: string): Map<string, string> {
  const receiptPath = join(targetRoot, "rollout-receipt.json");
  const receipt = JSON.parse(readFileSync(receiptPath, "utf8"));
  const texts = new Map<string, string>();
  for (const item of receipt.launchers) {
    const text = renderPinnedLauncher({ runtime: item.newRuntime, cwd: item.newCwd, entry: item.newTarget, format: "v1" });
    writeFileSync(item.path, text);
    item.newSha256 = createHash("sha256").update(text).digest("hex");
    delete item.oldFormat; delete item.oldProfile; delete item.newFormat; delete item.newProfile;
    texts.set(item.path, text);
  }
  const manifestPath = join(targetRoot, "preimage", "manifest.json");
  const manifest = Buffer.from(`${JSON.stringify({ schema: "skills.copyfile-preimage.v1", configs: receipt.configs, launchers: receipt.launchers }, null, 2)}\n`);
  chmodSync(manifestPath, 0o600); writeFileSync(manifestPath, manifest); chmodSync(manifestPath, 0o400);
  receipt.preimageSha256 = createHash("sha256").update(manifest).digest("hex");
  writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  return texts;
}

describe("exact-version copyfile runtime update", () => {
  test("original V1 active fleet launchers upgrade to V2 bin roles and rollback byte-exact", async () => {
    const f = fixtureHome(), fixture = await serverWithArtifact();
    const oldTexts = new Map<string, string>();
    for (const dir of [f.localBin, f.bunBin]) for (const [name, bin] of Object.entries(BIN)) {
      const path = join(dir, name), text = renderPinnedLauncher({ runtime: realpathSync(process.execPath),
        cwd: join(f.runtime, "0.10.6-copyfile"), entry: join(f.oldPackage, bin), format: "v1" });
      const temp = `${path}.synthetic-v1`; writeFileSync(temp, text, { mode: 0o755 }); renameSync(temp, path);
      oldTexts.set(path, text);
    }
    try {
      const result = await updateCopyfileRuntime("0.10.8", { homeDir: f.home,
        pathValue: `${f.localBin}${delimiter}${f.bunBin}`, registryOrigin: fixture.server.url.origin });
      const receipt = JSON.parse(readFileSync(join(f.runtime, "0.10.8-copyfile", "rollout-receipt.json"), "utf8"));
      for (const item of receipt.launchers) {
        const profile = launcherModule.launcherProfileForBin(basename(item.path), BIN[basename(item.path) as keyof typeof BIN]);
        expect(item).toMatchObject({ oldFormat: "v1", newFormat: "v2", newProfile: profile });
        expect(readFileSync(item.backupPath, "utf8")).toBe(oldTexts.get(item.path)!);
        expect(inspectLauncher(item.path)).toMatchObject({ kind: "pinned", format: "v2", profile });
      }
      expect(rollbackCopyfileRuntime(String(result.receiptId), { homeDir: f.home })).toMatchObject({ rolledBack: true });
      for (const [path, text] of oldTexts) expect(readFileSync(path, "utf8")).toBe(text);
    } finally { fixture.server.stop(true); }
  });

  test("old V1 rollout receipts without format metadata rollback and preserve exact V1 after-images", async () => {
    const f = fixtureHome(), fixture = await serverWithArtifact();
    try {
      const result = await updateCopyfileRuntime("0.10.8", { homeDir: f.home,
        pathValue: `${f.localBin}${delimiter}${f.bunBin}`, registryOrigin: fixture.server.url.origin });
      const texts = asV1Rollout(join(f.runtime, "0.10.8-copyfile"));
      expect(rollbackCopyfileRuntime(String(result.receiptId), { homeDir: f.home })).toMatchObject({ rolledBack: true });
      for (const [path, text] of texts) {
        expect(lstatSync(path).isSymbolicLink()).toBe(true);
        expect(readFileSync(`${path}.skills-after-${result.receiptId}`, "utf8")).toBe(text);
      }
    } finally { fixture.server.stop(true); }
  });

  test("old V1 alias receipts without format metadata restore exact V1 prior launchers", async () => {
    const f = fixtureHome(), fixture = await serverWithArtifact();
    const pathValue = `${f.localBin}${delimiter}${f.bunBin}`;
    try {
      await updateCopyfileRuntime("0.10.8", { homeDir: f.home, pathValue, registryOrigin: fixture.server.url.origin });
      const root = join(f.runtime, "0.10.8-copyfile"), texts = asV1Rollout(root);
      // Half the aliases still point to the previous .60 runtime, forcing an
      // actual V1 rollback reconstruction rather than a same-state no-op.
      for (const [name, bin] of Object.entries(BIN)) {
        const path = join(f.bunBin, name), text = renderPinnedLauncher({ runtime: realpathSync(process.execPath),
          cwd: join(f.runtime, "0.10.6-copyfile"), entry: join(f.oldPackage, bin), format: "v1" });
        writeFileSync(path, text); texts.set(path, text);
      }
      const adopted = adoptCopyfileAliases({ homeDir: f.home, pathValue });
      expect(adopted.aliasCount).toBe(14);
      const receiptPath = join(root, "alias-adoptions", `${adopted.receiptId}.json`);
      const receipt = JSON.parse(readFileSync(receiptPath, "utf8"));
      const before = launcherSnapshot(receipt.aliases.map((item: { path: string }) => item.path));
      for (const tamper of ["profile", "digest", "format"] as const) {
        const changed = structuredClone(receipt), item = changed.aliases.find((item: { path: string }) => basename(item.path) === "skills");
        if (tamper === "profile") {
          item.newProfile = "server";
          // Even a self-consistent server profile is refused for the client bin.
          item.newSha256 = launcherModule.pinnedLauncherState(item.newRuntime, item.newCwd, item.newTarget,
            { format: "v2", profile: "server" }).sha256;
        } else if (tamper === "digest") item.newSha256 = "0".repeat(64);
        else delete item.newFormat;
        writeFileSync(receiptPath, `${JSON.stringify(changed, null, 2)}\n`);
        expect(() => rollbackCopyfileAliases(String(adopted.receiptId), { homeDir: f.home, pathValue })).toThrow("RECEIPT_LAUNCHER_SHAPE_INVALID");
        expect(launcherSnapshot(before.keys())).toEqual(before);
      }
      for (const item of receipt.aliases) {
        // Reproduce a legacy alias receipt whose new state also used V1.
        const text = renderPinnedLauncher({ runtime: item.newRuntime, cwd: item.newCwd, entry: item.newTarget, format: "v1" });
        writeFileSync(item.path, text); item.newSha256 = createHash("sha256").update(text).digest("hex");
        delete item.oldFormat; delete item.oldProfile; delete item.newFormat; delete item.newProfile;
      }
      writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
      expect(rollbackCopyfileAliases(String(adopted.receiptId), { homeDir: f.home, pathValue })).toMatchObject({ rolledBack: true, restoredAliasCount: 7 });
      for (const [path, text] of texts) expect(readFileSync(path, "utf8")).toBe(text);
    } finally { fixture.server.stop(true); }
  });

  test("reviewed lock skips registry resolution and preserves exact bytes through real npm ci", async () => {
    const reviewed = fixtureHome(), consumer = fixtureHome();
    const fixture = await serverWithArtifact();
    const originalPath = process.env.PATH;
    const npm = Bun.which("npm")!;
    try {
      await updateCopyfileRuntime("0.10.8", { homeDir: reviewed.home, pathValue: `${reviewed.localBin}${delimiter}${reviewed.bunBin}`, registryOrigin: fixture.server.url.origin });
      const lockBytes = readFileSync(join(reviewed.runtime, "0.10.8-copyfile", "install-lock.json"));
      const lockPath = join(consumer.home, "reviewed-lock.json");
      writeFileSync(lockPath, lockBytes, { mode: 0o600 });
      const sha256 = createHash("sha256").update(lockBytes).digest("hex");
      const spyBin = join(consumer.home, "npm-spy"), calls = join(consumer.home, "npm-calls");
      mkdirSync(spyBin, { mode: 0o700 });
      writeFileSync(join(spyBin, "npm"), `#!/usr/bin/env bun
import { appendFileSync } from "node:fs";
appendFileSync(${JSON.stringify(calls)}, JSON.stringify(process.argv.slice(2)) + "\\n");
if (process.argv[2] === "install") process.exit(82);
const child = Bun.spawn([${JSON.stringify(npm)}, ...process.argv.slice(2)], { env: process.env, stdin: "ignore", stdout: "inherit", stderr: "inherit" });
process.exit(await child.exited);
`, { mode: 0o755 });
      process.env.PATH = `${spyBin}${delimiter}${originalPath}`;
      const result = await updateCopyfileRuntime("0.10.8", { homeDir: consumer.home, pathValue: `${consumer.localBin}${delimiter}${consumer.bunBin}`, registryOrigin: fixture.server.url.origin, minReleaseAge: 7, reviewedLock: lockPath, reviewedLockSha256: sha256 });
      const commands = readFileSync(calls, "utf8").trim().split("\n").map(line => JSON.parse(line)[0]);
      expect(commands.filter((command: string) => ["ci", "sbom", "install"].includes(command))).toEqual(["ci", "sbom"]);
      expect(readFileSync(join(consumer.runtime, "0.10.8-copyfile", "install-lock.json")).equals(lockBytes)).toBe(true);
      expect(result.reviewedLockSha256).toBe(sha256);
      for (const [path, content] of consumer.configs) expect(readFileSync(path, "utf8")).toBe(content);
      expect(rollbackCopyfileRuntime(String(result.receiptId), { homeDir: consumer.home })).toMatchObject({ rolledBack: true });
    } finally { process.env.PATH = originalPath; fixture.server.stop(true); }
  });

  test("reviewed lock drift caused during npm ci refuses before launcher switch", async () => {
    const reviewed = fixtureHome(), consumer = fixtureHome();
    const fixture = await serverWithArtifact();
    const originalPath = process.env.PATH, npm = Bun.which("npm")!;
    try {
      await updateCopyfileRuntime("0.10.8", { homeDir: reviewed.home, pathValue: `${reviewed.localBin}${delimiter}${reviewed.bunBin}`, registryOrigin: fixture.server.url.origin });
      const lockBytes = readFileSync(join(reviewed.runtime, "0.10.8-copyfile", "install-lock.json"));
      const lockPath = join(consumer.home, "reviewed-lock.json");
      writeFileSync(lockPath, lockBytes, { mode: 0o600 });
      const spyBin = join(consumer.home, "npm-spy"); mkdirSync(spyBin, { mode: 0o700 });
      writeFileSync(join(spyBin, "npm"), `#!/usr/bin/env bun
import { appendFileSync } from "node:fs";
const args = process.argv.slice(2);
const child = Bun.spawn([${JSON.stringify(npm)}, ...args], { env: process.env, stdin: "ignore", stdout: "inherit", stderr: "inherit" });
const code = await child.exited;
if (code === 0 && args[0] === "ci") appendFileSync(args[args.indexOf("--prefix") + 1] + "/package-lock.json", "\\n ");
process.exit(code);
`, { mode: 0o755 });
      process.env.PATH = `${spyBin}${delimiter}${originalPath}`;
      await expect(updateCopyfileRuntime("0.10.8", { homeDir: consumer.home, pathValue: `${consumer.localBin}${delimiter}${consumer.bunBin}`, registryOrigin: fixture.server.url.origin, minReleaseAge: 7, reviewedLock: lockPath, reviewedLockSha256: createHash("sha256").update(lockBytes).digest("hex") })).rejects.toThrow("REVIEWED_LOCK_DRIFT_DURING_INSTALL");
      expect(realpathSync(join(consumer.localBin, "skills"))).toBe(join(consumer.oldPackage, BIN.skills));
      expect(existsSync(join(consumer.runtime, "0.10.8-copyfile"))).toBe(false);
      for (const [path, content] of consumer.configs) expect(readFileSync(path, "utf8")).toBe(content);
    } finally { process.env.PATH = originalPath; fixture.server.stop(true); }
  });

  test("incomplete reviewed closure is refused by real npm before switching", async () => {
    const f = fixtureHome(), fixture = await serverWithArtifact({ "is-odd": "^3.0.1" });
    try {
      const lockBytes = Buffer.from(JSON.stringify({ lockfileVersion: 3, requires: true, packages: {
        "": { dependencies: { "@hasna/skills": "file:./verified.tgz" } },
        "node_modules/@hasna/skills": { version: "0.10.8", resolved: "file:verified.tgz", integrity: fixture.integrity, dependencies: { "is-odd": "^3.0.1" } },
      } }));
      const path = join(f.home, "incomplete-lock.json"); writeFileSync(path, lockBytes, { mode: 0o600 });
      await expect(updateCopyfileRuntime("0.10.8", { homeDir: f.home, pathValue: `${f.localBin}${delimiter}${f.bunBin}`, registryOrigin: fixture.server.url.origin, minReleaseAge: 7, reviewedLock: path, reviewedLockSha256: createHash("sha256").update(lockBytes).digest("hex") })).rejects.toThrow("DEPENDENCY_GRAPH_INSTALL_FAILED");
      expect(realpathSync(join(f.localBin, "skills"))).toBe(join(f.oldPackage, BIN.skills));
      expect(existsSync(join(f.runtime, "0.10.8-copyfile"))).toBe(false);
      for (const [path, content] of f.configs) expect(readFileSync(path, "utf8")).toBe(content);
    } finally { fixture.server.stop(true); }
  });

  test("hidden npm lock cannot conceal an omitted required transitive dependency", async () => {
    const f = fixtureHome(), fixture = await serverWithArtifact({ "is-odd": "3.0.1" });
    try {
      const metadata = await (await fetch("https://registry.npmjs.org/is-odd/3.0.1", { redirect: "error" })).json();
      expect(metadata.dependencies).toEqual({ "is-number": "^6.0.0" });
      const lockBytes = Buffer.from(JSON.stringify({ lockfileVersion: 3, requires: true, packages: {
        "": { dependencies: { "@hasna/skills": "file:./verified.tgz" } },
        "node_modules/@hasna/skills": { version: "0.10.8", resolved: "file:verified.tgz", integrity: fixture.integrity, dependencies: { "is-odd": "3.0.1" }, bin: BIN },
        "node_modules/is-odd": { version: "3.0.1", resolved: metadata.dist.tarball, integrity: metadata.dist.integrity },
      } }));
      const path = join(f.home, "missing-transitive-lock.json"); writeFileSync(path, lockBytes, { mode: 0o600 });
      await expect(updateCopyfileRuntime("0.10.8", { homeDir: f.home, pathValue: `${f.localBin}${delimiter}${f.bunBin}`, registryOrigin: fixture.server.url.origin, minReleaseAge: 7, reviewedLock: path, reviewedLockSha256: createHash("sha256").update(lockBytes).digest("hex") })).rejects.toThrow("DEPENDENCY_GRAPH_INSTALL_FAILED");
      const stage = join(f.runtime, readdirSync(f.runtime).find(name => name.startsWith(".stage-0.10.8-"))!);
      const installed = join(stage, "install", "node_modules");
      // Real ci succeeded and wrote the misleading hidden lock; the actual
      // manifest still requires the missing package. SBOM is the refusal gate.
      expect(existsSync(join(installed, ".package-lock.json"))).toBe(true);
      expect(JSON.parse(readFileSync(join(installed, "is-odd", "package.json"), "utf8")).dependencies["is-number"]).toBe("^6.0.0");
      expect(existsSync(join(installed, "is-number"))).toBe(false);
      expect(realpathSync(join(f.localBin, "skills"))).toBe(join(f.oldPackage, BIN.skills));
      expect(existsSync(join(f.runtime, "0.10.8-copyfile"))).toBe(false);
    } finally { fixture.server.stop(true); }
  });

  test.each([
    { dependencies: { "is-odd": "3.0.1" } },
    { dependencies: { "@hasna/contracts": "1.3.5", "@hasna/secrets": "0.4.2" } },
    { dependencies: {}, optionalDependencies: { "fsevents": "2.3.3" } },
  ] as { dependencies: Record<string, string>; optionalDependencies?: Record<string, string> }[])("reviewed full required closure succeeds under force-actual inspection: %j", async ({ dependencies, optionalDependencies }) => {
    const reviewed = fixtureHome(), consumer = fixtureHome();
    const fixture = await serverWithArtifact(dependencies, optionalDependencies);
    try {
      await updateCopyfileRuntime("0.10.8", { homeDir: reviewed.home, pathValue: `${reviewed.localBin}${delimiter}${reviewed.bunBin}`, registryOrigin: fixture.server.url.origin, minReleaseAge: 7, minReleaseAgeExclude: ["@hasna/*"] });
      const bytes = readFileSync(join(reviewed.runtime, "0.10.8-copyfile", "install-lock.json"));
      const path = join(consumer.home, "complete-lock.json"); writeFileSync(path, bytes, { mode: 0o600 });
      const result = await updateCopyfileRuntime("0.10.8", { homeDir: consumer.home, pathValue: `${consumer.localBin}${delimiter}${consumer.bunBin}`, registryOrigin: fixture.server.url.origin, minReleaseAge: 7, minReleaseAgeExclude: ["@hasna/*"], reviewedLock: path, reviewedLockSha256: createHash("sha256").update(bytes).digest("hex") });
      expect(result.updated).toBe(true);
      if (dependencies["is-odd"]) expect(existsSync(join(consumer.runtime, "0.10.8-copyfile", "node_modules", "is-number", "package.json"))).toBe(true);
      else if (dependencies["@hasna/secrets"]) expect(JSON.parse(readFileSync(join(consumer.runtime, "0.10.8-copyfile", "node_modules", "@hasna", "skills", "node_modules", "@hasna", "secrets", "package.json"), "utf8")).version).toBe("0.4.2");
      expect(rollbackCopyfileRuntime(String(result.receiptId), { homeDir: consumer.home })).toMatchObject({ rolledBack: true });
    } finally { fixture.server.stop(true); }
  }, 120_000);

  test("real npm conflicting Hasna dependency versions retain nested closure without changing archive payload", async () => {
    const f = fixtureHome();
    const fixture = await serverWithArtifact({ "@hasna/contracts": "1.3.5", "@hasna/secrets": "0.4.2" });
    try {
      const result = await updateCopyfileRuntime("0.10.8", {
        homeDir: f.home, pathValue: `${f.localBin}${delimiter}${f.bunBin}`,
        registryOrigin: fixture.server.url.origin, minReleaseAge: 7,
        minReleaseAgeExclude: ["@hasna/contracts", "@hasna/secrets"],
      });
      const target = join(f.runtime, "0.10.8-copyfile");
      const packageRoot = join(target, "node_modules", "@hasna", "skills");
      const nestedSecrets = join(packageRoot, "node_modules", "@hasna", "secrets");
      expect(JSON.parse(readFileSync(join(nestedSecrets, "package.json"), "utf8")).version).toBe("0.4.2");
      expect(lstatSync(join(packageRoot, "node_modules", ".bin", "secrets")).isSymbolicLink()).toBe(true);
      const lock = JSON.parse(readFileSync(join(target, "install-lock.json"), "utf8"));
      expect(lock.packages["node_modules/@hasna/skills/node_modules/@hasna/secrets"].version).toBe("0.4.2");
      const receipt = JSON.parse(readFileSync(join(target, "rollout-receipt.json"), "utf8"));
      expect(receipt.tarballIntegrity).toBe(fixture.integrity);
      expect(receipt.runtimeTreeSha256).toMatch(/^[a-f0-9]{64}$/);
      for (const [path, content] of f.configs) expect(readFileSync(path, "utf8")).toBe(content);
      expect(pinnedTarget(join(f.localBin, "skills"))).toBe(join(packageRoot, BIN.skills));
      const original = readFileSync(join(nestedSecrets, "package.json"));
      writeFileSync(join(nestedSecrets, "package.json"), Buffer.concat([original, Buffer.from("\n ")]));
      expect(() => rollbackCopyfileRuntime(String(result.receiptId), { homeDir: f.home })).toThrow("ACTIVE_RUNTIME_TREE_DRIFT");
      writeFileSync(join(nestedSecrets, "package.json"), original);
      expect(rollbackCopyfileRuntime(String(result.receiptId), { homeDir: f.home })).toMatchObject({ rolledBack: true });
    } finally { fixture.server.stop(true); }
  }, 120_000);

  test("archive-supplied dependency payload is refused before installation", async () => {
    const archive = await new Bun.Archive({ "package/package.json": "{}", "package/node_modules/foreign/index.js": "unreviewed" }, { compress: "gzip" }).bytes();
    await expect(preflightTarball(archive)).rejects.toThrow("TARBALL_BUNDLED_DEPENDENCIES_UNSUPPORTED");
  });

  test("npm-added dependency projection preserves payload tamper and unsafe dependency refusals", async () => {
    const npm = Bun.which("npm")!;
    for (const [attack, expected] of [
      ["extra", "INSTALLED_PACKAGE_BYTES_MISMATCH"], ["changed", "INSTALLED_PACKAGE_BYTES_MISMATCH"],
      ["missing", "INSTALLED_PACKAGE_BYTES_MISMATCH"], ["root-symlink", "INSTALLED_DEPENDENCY_DIRECTORY_UNSAFE"],
      ["nested-symlink", "TREE_SYMLINK_ESCAPES_ROOT"],
    ] as const) {
      const f = fixtureHome(); const fixture = await serverWithArtifact();
      const priorPath = process.env.PATH; const spyBin = join(f.home, "npm-spy");
      mkdirSync(spyBin, { mode: 0o700 });
      writeFileSync(join(spyBin, "npm"), `#!/usr/bin/env bun
import { mkdirSync, writeFileSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
const args = process.argv.slice(2);
const child = Bun.spawn([${JSON.stringify(npm)}, ...args], { env: process.env, stdin: "ignore", stdout: "inherit", stderr: "inherit" });
const status = await child.exited;
if (status === 0 && args[0] === "ci") {
 const root = join(process.cwd(), "node_modules", "@hasna", "skills");
 const attack = ${JSON.stringify(attack)};
 if (attack === "extra") writeFileSync(join(root, "unreviewed.js"), "payload");
 if (attack === "changed") writeFileSync(join(root, "README.md"), "changed");
 if (attack === "missing") rmSync(join(root, "README.md"));
 if (attack === "root-symlink") symlinkSync(${JSON.stringify(f.home)}, join(root, "node_modules"));
 if (attack === "nested-symlink") { mkdirSync(join(root, "node_modules")); symlinkSync(${JSON.stringify(f.home)}, join(root, "node_modules", "escape")); }
}
process.exit(status);
`, { mode: 0o755 });
      try {
        process.env.PATH = `${spyBin}${delimiter}${priorPath}`;
        await expect(updateCopyfileRuntime("0.10.8", { homeDir: f.home, pathValue: `${f.localBin}${delimiter}${f.bunBin}`, registryOrigin: fixture.server.url.origin })).rejects.toThrow(expected);
        expect(realpathSync(join(f.localBin, "skills"))).toBe(join(f.oldPackage, BIN.skills));
        expect(existsSync(join(f.runtime, "0.10.8-copyfile"))).toBe(false);
        for (const [path, content] of f.configs) expect(readFileSync(path, "utf8")).toBe(content);
      } finally {
        if (priorPath === undefined) delete process.env.PATH; else process.env.PATH = priorPath;
        fixture.server.stop(true);
      }
    }
  }, 120_000);

  test("switched launchers are pinned: a hostile cwd bunfig.toml, .env and BUN_OPTIONS reach nothing", async () => {
    const f = fixtureHome();
    const fixture = await serverWithArtifact({}, {}, name => `console.log(JSON.stringify({ name: ${JSON.stringify(name)}, dotenv: process.env.HOSTILE_DOTENV ?? null, bunOptions: process.env.BUN_OPTIONS ?? null, nodeOptions: process.env.NODE_OPTIONS ?? null, kept: [process.env.HASNA_SKILLS_PROBE, process.env.SKILLS_PROBE, process.env.LC_ALL], quoted: process.env.HASNA_QUOTED ?? null, cwd: process.cwd(), launchCwd: process.env.HASNA_SKILLS_LAUNCH_CWD ?? null, argv: process.argv.slice(2) }));`);
    const hostile = hostileDirectory();
    try {
      const pathValue = `${f.localBin}${delimiter}${f.bunBin}`;
      const result = await updateCopyfileRuntime("0.10.8", { homeDir: f.home, pathValue, registryOrigin: fixture.server.url.origin });
      expect(result).toMatchObject({ updated: true, launcherCount: 14 });
      const targetRoot = join(f.runtime, "0.10.8-copyfile");
      const receipt = JSON.parse(readFileSync(join(targetRoot, "rollout-receipt.json"), "utf8"));
      const launcher = receipt.launchers.find((item: { path: string }) => item.path === join(f.localBin, "skills"));
      // Positive control (fixture t11): the pre-switch launcher shape, preserved as the
      // backup, is a bare symlink to a `#!/usr/bin/env bun` entry governed by the cwd.
      const control = hostile.launch(launcher.backupPath);
      expect(control.code).toBe(0);
      expect(hostile.markers()).toBe(1);
      expect(control.stdout.trim()).toBe("0.10.6 skills");
      // Fixture t12: the switched launcher runs the exact entry under a pinned Bun from
      // the trusted runtime directory, with no cwd configuration and only allowlisted
      // environment names. Values pass through byte-exact, quotes and newlines included.
      const quoted = "it's \"quoted\"\nand multi-line $HOME `x` \\ trailing'";
      const bunOptions = `--preload=${join(hostile.dir, "preload.js")}`;
      for (const path of [join(f.localBin, "skills"), join(f.bunBin, "skills-mcp")]) {
        const pinned = hostile.launch(path, { BUN_OPTIONS: bunOptions, NODE_OPTIONS: `--require=${join(hostile.dir, "preload.js")}`, HASNA_SKILLS_PROBE: "kept", SKILLS_PROBE: "kept", LC_ALL: "en_US.UTF-8", HASNA_QUOTED: quoted, HASNA_SKILLS_LAUNCH_CWD: "/spoofed-by-caller" });
        expect(pinned.stderr).toBe("");
        expect(pinned.code).toBe(0);
        expect(JSON.parse(pinned.stdout)).toEqual({
          name: basename(path), dotenv: null, bunOptions: null, nodeOptions: null, kept: ["kept", "kept", "en_US.UTF-8"], quoted,
          cwd: targetRoot, launchCwd: realpathSync(hostile.dir), argv: ["probe-arg"],
        });
      }
      expect(hostile.markers()).toBe(1);
      expect(lstatSync(join(f.localBin, "skills")).isSymbolicLink()).toBe(false);
      expect(readFileSync(join(f.localBin, "skills"), "utf8")).toContain("--config=/dev/null --no-env-file --no-macros --no-install");
    } finally { fixture.server.stop(true); }
  });

  test("the launcher's own shell runs with -p: exported functions and shell options from the caller run nothing", async () => {
    const f = fixtureHome();
    const fixture = await serverWithArtifact({}, {}, name => `console.log(JSON.stringify({ name: ${JSON.stringify(name)}, launchCwd: process.env.HASNA_SKILLS_LAUNCH_CWD ?? null, lcAll: process.env.LC_ALL ?? null }));`);
    const hostile = hostileDirectory();
    try {
      await updateCopyfileRuntime("0.10.8", { homeDir: f.home, pathValue: `${f.localBin}${delimiter}${f.bunBin}`, registryOrigin: fixture.server.url.origin });
      const launcher = join(f.localBin, "skills");
      expect(readFileSync(launcher, "utf8").startsWith("#!/bin/sh -p\n")).toBe(true);
      const xtraceMarker = join(hostile.dir, "ps4-ran"), functionMarker = join(hostile.dir, "function-ran");
      // On macOS /bin/sh is bash 3.2. Without -p it enables SHELLOPTS from the
      // environment (xtrace then expands PS4 with command substitution) and
      // imports exported functions, so `pwd -P` could be replaced before env -i.
      const vectors: Record<string, string>[] = [
        { SHELLOPTS: "xtrace", PS4: `$(/usr/bin/touch ${xtraceMarker})` },
        { "BASH_FUNC_pwd%%": `() { /usr/bin/touch ${functionMarker}; echo /hijacked; }` },
        { SHELLOPTS: "xtrace", PS4: `$(/usr/bin/touch ${xtraceMarker})`, "BASH_FUNC_pwd%%": `() { /usr/bin/touch ${functionMarker}; echo /hijacked; }`, LC_ALL: "it's \"odd\"" },
      ];
      for (const vector of vectors) {
        const run = hostile.launch(launcher, vector);
        expect(run.code).toBe(0);
        expect(JSON.parse(run.stdout)).toEqual({ name: "skills", launchCwd: realpathSync(hostile.dir), lcAll: vector.LC_ALL ?? null });
        expect(existsSync(xtraceMarker)).toBe(false);
        expect(existsSync(functionMarker)).toBe(false);
      }
    } finally { fixture.server.stop(true); }
  });

  test("pinned package bin roles preserve server storage and documented client options", async () => {
    const f = fixtureHome();
    const fixture = await serverWithArtifact({}, {}, name => `console.log(JSON.stringify({ name: ${JSON.stringify(name)}, host: process.env.HOST ?? null, port: process.env.PORT ?? null, nodeEnv: process.env.NODE_ENV ?? null, agentId: process.env.AGENT_ID ?? null, proxy: process.env.HTTPS_PROXY ?? null, database: process.env.DATABASE_URL ?? null, canonical: process.env.HASNA_SKILLS_DATABASE_URL ?? null, fallback: process.env.SKILLS_DATABASE_URL ?? null, api: process.env.SKILLS_API_URL ?? null }));`);
    const hostile = hostileDirectory();
    try {
      await updateCopyfileRuntime("0.10.8", { homeDir: f.home, pathValue: `${f.localBin}${delimiter}${f.bunBin}`, registryOrigin: fixture.server.url.origin });
      for (const name of Object.keys(BIN) as Array<keyof typeof BIN>) {
        const run = hostile.launch(join(f.localBin, name), { HOST: "127.0.0.1", PORT: "47911", NODE_ENV: "production", AGENT_ID: "agent-fixture", HTTPS_PROXY: "http://127.0.0.1:9",
          DATABASE_URL: "bare.sqlite", HASNA_SKILLS_DATABASE_URL: "canonical.sqlite", SKILLS_DATABASE_URL: "fallback.sqlite", SKILLS_API_URL: "https://skills.example.test" });
        expect(run.code).toBe(0);
        // skills-serve and skills-server share bin/server.js, so only the settings are compared.
        expect(run.stderr).toBe("");
        const server = launcherModule.launcherProfileForBin(name, BIN[name]) === "server";
        expect(JSON.parse(run.stdout)).toMatchObject({ host: "127.0.0.1", port: "47911", nodeEnv: "production", agentId: "agent-fixture", proxy: null,
          database: server ? "bare.sqlite" : null, canonical: server ? "canonical.sqlite" : null, fallback: server ? "fallback.sqlite" : null, api: "https://skills.example.test" });
      }
    } finally { fixture.server.stop(true); }
  });

  test("a pinned-launcher refusal before the switch leaves no runtime lock: retry, rollback and alias adoption still work", async () => {
    const f = fixtureHome();
    const fixture = await serverWithArtifact();
    const pathValue = `${f.localBin}${delimiter}${f.bunBin}`;
    const options = { homeDir: f.home, pathValue, registryOrigin: fixture.server.url.origin };
    const lock = join(f.runtime, ".copyfile-update-lock");
    try {
      const runtimeSpy = spyOn(launcherModule, "pinnedLauncherRuntime").mockImplementationOnce(() => { throw new Error("LAUNCHER_RUNTIME_UNSAFE"); });
      try { await expect(updateCopyfileRuntime("0.10.8", options)).rejects.toThrow("LAUNCHER_RUNTIME_UNSAFE"); } finally { runtimeSpy.mockRestore(); }
      expect(existsSync(lock)).toBe(false);
      const stateSpy = spyOn(launcherModule, "pinnedLauncherState").mockImplementationOnce(() => { throw new Error("LAUNCHER_CWD_PATH_INVALID"); });
      try { await expect(updateCopyfileRuntime("0.10.8", options)).rejects.toThrow("LAUNCHER_CWD_PATH_INVALID"); } finally { stateSpy.mockRestore(); }
      expect(existsSync(lock)).toBe(false);
      for (const [path, content] of f.configs) expect(readFileSync(path, "utf8")).toBe(content);
      expect(realpathSync(join(f.localBin, "skills"))).toBe(join(f.oldPackage, BIN.skills));
      const result = await updateCopyfileRuntime("0.10.8", options);
      expect(result).toMatchObject({ updated: true, launcherCount: 14 });
      // Alias adoption: the same two refusals, then a successful adoption and its rollback.
      const legacy = join(f.home, ".bun", "install", "global", "node_modules", "@hasna", "skills");
      mkdirSync(join(legacy, "bin"), { recursive: true, mode: 0o700 });
      writeFileSync(join(legacy, "package.json"), JSON.stringify({ name: "@hasna/skills", version: "0.10.6", bin: BIN }), { mode: 0o600 });
      for (const target of new Set(Object.values(BIN))) writeFileSync(join(legacy, target), "legacy fixture\n", { mode: 0o755 });
      const oldMcp = join(f.bunBin, "skills-mcp");
      renameSync(oldMcp, `${oldMcp}.synthetic-prior`);
      symlinkSync(relative(f.bunBin, join(legacy, BIN["skills-mcp"])), oldMcp);
      const aliasRuntimeSpy = spyOn(launcherModule, "pinnedLauncherRuntime").mockImplementationOnce(() => { throw new Error("LAUNCHER_RUNTIME_UNSAFE"); });
      try { expect(() => adoptCopyfileAliases({ homeDir: f.home, pathValue })).toThrow("LAUNCHER_RUNTIME_UNSAFE"); } finally { aliasRuntimeSpy.mockRestore(); }
      expect(existsSync(lock)).toBe(false);
      const aliasStateSpy = spyOn(launcherModule, "pinnedLauncherState").mockImplementationOnce(() => { throw new Error("LAUNCHER_CWD_PATH_INVALID"); });
      try { expect(() => adoptCopyfileAliases({ homeDir: f.home, pathValue })).toThrow("LAUNCHER_CWD_PATH_INVALID"); } finally { aliasStateSpy.mockRestore(); }
      expect(existsSync(lock)).toBe(false);
      expect(realpathSync(oldMcp)).toBe(join(legacy, BIN["skills-mcp"]));
      const adopted = adoptCopyfileAliases({ homeDir: f.home, pathValue });
      expect(adopted).toMatchObject({ adopted: true, aliasCount: 1 });
      expect(rollbackCopyfileAliases(String(adopted.receiptId), { homeDir: f.home, pathValue })).toMatchObject({ rolledBack: true, restoredAliasCount: 1 });
      expect(realpathSync(oldMcp)).toBe(join(legacy, BIN["skills-mcp"]));
      renameSync(`${oldMcp}.synthetic-prior`, oldMcp);
      expect(rollbackCopyfileRuntime(String(result.receiptId), { homeDir: f.home })).toMatchObject({ rolledBack: true, restoredVersion: "0.10.6" });
      expect(existsSync(lock)).toBe(false);
    } finally { fixture.server.stop(true); }
  });

  test("a second update switches pinned launchers to pinned launchers and rolls back to the exact prior pinned text", async () => {
    const f = fixtureHome();
    const first = await serverWithArtifact();
    const second = await serverWithArtifact({}, {}, name => `console.log("0.10.9 ${name}");`, "0.10.9");
    try {
      const pathValue = `${f.localBin}${delimiter}${f.bunBin}`;
      await updateCopyfileRuntime("0.10.8", { homeDir: f.home, pathValue, registryOrigin: first.server.url.origin });
      const firstText = readFileSync(join(f.localBin, "skills"), "utf8");
      const firstTarget = pinnedTarget(join(f.localBin, "skills"));
      const result = await updateCopyfileRuntime("0.10.9", { homeDir: f.home, pathValue, registryOrigin: second.server.url.origin });
      expect(result).toMatchObject({ updated: true, version: "0.10.9", currentVersion: "0.10.8", launcherCount: 14 });
      const targetRoot = join(f.runtime, "0.10.9-copyfile");
      expect(pinnedTarget(join(f.localBin, "skills"))).toBe(join(targetRoot, "node_modules", "@hasna", "skills", BIN.skills));
      const receipt = JSON.parse(readFileSync(join(targetRoot, "rollout-receipt.json"), "utf8"));
      const item = receipt.launchers.find((entry: { path: string }) => entry.path === join(f.localBin, "skills"));
      expect(item).toMatchObject({ oldShape: "pinned", oldTarget: firstTarget, oldLinkTarget: firstTarget, oldCwd: join(f.runtime, "0.10.8-copyfile"), newShape: "pinned", newCwd: targetRoot });
      expect(item.oldSha256).toBe(createHash("sha256").update(firstText).digest("hex"));
      // The backup is the exact prior pinned launcher, byte for byte, and not a symlink.
      expect(lstatSync(item.backupPath).isSymbolicLink()).toBe(false);
      expect(readFileSync(item.backupPath, "utf8")).toBe(firstText);
      expect(readFileSync(join(f.localBin, "skills"), "utf8")).not.toBe(firstText);
      expect(rollbackCopyfileRuntime(String(result.receiptId), { homeDir: f.home })).toMatchObject({ rolledBack: true, restoredVersion: "0.10.8", launcherCount: 14 });
      expect(readFileSync(join(f.localBin, "skills"), "utf8")).toBe(firstText);
      expect(pinnedTarget(join(f.localBin, "skills"))).toBe(firstTarget);
      expect(launcherTarget(`${item.path}.skills-after-${result.receiptId}`)).toBe(item.newTarget);
      // A receipt whose pinned digest does not match its rendered text is refused before any launcher moves.
      const forged = JSON.parse(readFileSync(join(targetRoot, "rollout-receipt.json"), "utf8"));
      forged.state = "switched";
      forged.launchers[0].newSha256 = "0".repeat(64);
      writeFileSync(join(targetRoot, "rollout-receipt.json"), JSON.stringify(forged, null, 2) + "\n");
      expect(() => rollbackCopyfileRuntime(String(result.receiptId), { homeDir: f.home })).toThrow("PREIMAGE_RECEIPT_MISMATCH");
    } finally { first.server.stop(true); second.server.stop(true); }
  });

  test("explicit age policy reaches npm resolution and ci without inherited settings, including transitive dependencies", async () => {
    const f = fixtureHome();
    const fixture = await serverWithArtifact({ "is-odd": "3.0.1" });
    const originalPath = process.env.PATH;
    const originalAge = process.env.NPM_CONFIG_MIN_RELEASE_AGE;
    const originalExclude = process.env.NPM_CONFIG_MIN_RELEASE_AGE_EXCLUDE;
    const npm = Bun.which("npm")!;
    const spyBin = join(f.home, "npm-spy");
    mkdirSync(spyBin, { mode: 0o700 });
    const log = join(f.home, "npm-invocations.jsonl");
    writeFileSync(join(spyBin, "npm"), `#!/usr/bin/env bun
import { appendFileSync, lstatSync } from "node:fs";
const args = process.argv.slice(2);
if (args[0] === "install" || args[0] === "ci") {
  const probe = Bun.spawn([${JSON.stringify(npm)}, "config", "list", "--json"], { env: process.env, stdout: "pipe", stderr: "ignore" });
  const config = JSON.parse(await new Response(probe.stdout).text());
  if (await probe.exited !== 0) process.exit(81);
  appendFileSync(${JSON.stringify(log)}, JSON.stringify({ command: args[0], age: config["min-release-age"], exclusions: config["min-release-age-exclude"], inheritedAge: Object.hasOwn(process.env, "NPM_CONFIG_MIN_RELEASE_AGE"), inheritedExclusions: Object.hasOwn(process.env, "NPM_CONFIG_MIN_RELEASE_AGE_EXCLUDE"), userConfigMode: lstatSync(process.env.NPM_CONFIG_USERCONFIG).mode & 511 }) + "\\n");
}
const child = Bun.spawn([${JSON.stringify(npm)}, ...args], { env: process.env, stdin: "ignore", stdout: "inherit", stderr: "inherit" });
process.exit(await child.exited);
`, { mode: 0o755 });
    const exclusions = ["@hasna/*", "@hasna-internal/*", "@openai/*", "@anthropic-ai/*", "openai"];
    try {
      process.env.PATH = `${spyBin}${delimiter}${originalPath}`;
      process.env.NPM_CONFIG_MIN_RELEASE_AGE = "0";
      process.env.NPM_CONFIG_MIN_RELEASE_AGE_EXCLUDE = "*";
      const result = await updateCopyfileRuntime("0.10.8", { homeDir: f.home, pathValue: `${f.localBin}${delimiter}${f.bunBin}`, registryOrigin: fixture.server.url.origin, minReleaseAge: 7, minReleaseAgeExclude: exclusions });
      const calls = readFileSync(log, "utf8").trim().split("\n").map(line => JSON.parse(line));
      expect(calls.map(row => row.command)).toEqual(["install", "ci"]);
      expect(calls.every(row => row.age === 7 && JSON.stringify(row.exclusions) === JSON.stringify(exclusions) && !row.inheritedAge && !row.inheritedExclusions && row.userConfigMode === 0o600)).toBe(true);
      const targetRoot = join(f.runtime, "0.10.8-copyfile");
      const lock = JSON.parse(readFileSync(join(targetRoot, "install-lock.json"), "utf8"));
      expect(lock.packages["node_modules/is-odd"].version).toBe("3.0.1");
      expect(lock.packages["node_modules/is-number"].version).toBe("6.0.0");
      expect(result.dependencyPolicy).toMatchObject({ minReleaseAge: 7, minReleaseAgeExclude: exclusions, npmVersion: "11.19.0" });
      for (const [path, content] of f.configs) expect(readFileSync(path, "utf8")).toBe(content);
      expect(pinnedTarget(join(f.localBin, "skills"))).toBe(join(targetRoot, "node_modules", "@hasna", "skills", BIN.skills));
      expect(rollbackCopyfileRuntime(String(result.receiptId), { homeDir: f.home })).toMatchObject({ rolledBack: true, restoredVersion: "0.10.6" });
      expect(realpathSync(join(f.localBin, "skills"))).toBe(join(f.oldPackage, BIN.skills));
    } finally {
      if (originalPath === undefined) delete process.env.PATH; else process.env.PATH = originalPath;
      if (originalAge === undefined) delete process.env.NPM_CONFIG_MIN_RELEASE_AGE; else process.env.NPM_CONFIG_MIN_RELEASE_AGE = originalAge;
      if (originalExclude === undefined) delete process.env.NPM_CONFIG_MIN_RELEASE_AGE_EXCLUDE; else process.env.NPM_CONFIG_MIN_RELEASE_AGE_EXCLUDE = originalExclude;
      fixture.server.stop(true);
    }
  });

  test("unsupported npm and missing release-age capability refuse before dependency installation or launcher changes", async () => {
    const originalPath = process.env.PATH;
    for (const [version, config] of [["11.16.0", {}], ["11.19.0", { "min-release-age": null }]] as const) {
      const f = fixtureHome();
      const fixture = await serverWithArtifact();
      const bin = join(f.home, "npm-probe");
      mkdirSync(bin, { mode: 0o700 });
      const log = join(f.home, "unexpected-install");
      writeFileSync(join(bin, "npm"), `#!/usr/bin/env bun
import { writeFileSync } from "node:fs";
if (process.argv[2] === "--version") console.log(${JSON.stringify(version)});
else if (process.argv[2] === "config") console.log(${JSON.stringify(JSON.stringify(config))});
else { writeFileSync(${JSON.stringify(log)}, "unexpected"); process.exit(83); }
`, { mode: 0o755 });
      try {
        process.env.PATH = `${bin}${delimiter}${originalPath}`;
        await expect(updateCopyfileRuntime("0.10.8", { homeDir: f.home, pathValue: `${f.localBin}${delimiter}${f.bunBin}`, registryOrigin: fixture.server.url.origin, minReleaseAge: 7 })).rejects.toThrow("NPM_RELEASE_AGE_UNSUPPORTED");
        expect(existsSync(log)).toBe(false);
        expect(realpathSync(join(f.localBin, "skills"))).toBe(join(f.oldPackage, BIN.skills));
        expect(existsSync(join(f.runtime, "0.10.8-copyfile"))).toBe(false);
        for (const [path, content] of f.configs) expect(readFileSync(path, "utf8")).toBe(content);
      } finally { process.env.PATH = originalPath; fixture.server.stop(true); }
    }
  });

  test("CLI age options refuse the legacy updater and rollback or adoption operations before side effects", async () => {
    const priorExitCode = process.exitCode;
    const priorTestMode = process.env.SKILLS_TEST_MODE;
    const priorError = console.error, priorLog = console.log;
    const cases = [
      ["--min-release-age", "7"],
      ["--min-release-age-exclude", "@hasna/*"],
      ["--version", "0.10.8", "--min-release-age", "7", "--rollback", "synthetic-receipt"],
      ["--min-release-age", "7", "--adopt-aliases"],
      ["--min-release-age", "7", "--rollback-aliases", "synthetic-receipt"],
    ];
    try {
      process.env.SKILLS_TEST_MODE = "1";
      for (const args of cases) {
        const output: string[] = [];
        console.error = (...values) => output.push(values.join(" "));
        console.log = (...values) => output.push(values.join(" "));
        process.exitCode = 0;
        const program = new Command().enablePositionalOptions().exitOverride();
        registerRuntime(program);
        await program.parseAsync(["self-update", "--json", ...args], { from: "user" });
        expect(process.exitCode).toBe(1);
        expect(output.map(line => JSON.parse(line))).toEqual([{ error: "RELEASE_AGE_POLICY_REQUIRES_EXACT_VERSION" }]);
      }
      const program = new Command().enablePositionalOptions().exitOverride();
      registerRuntime(program);
      const command = program.commands.find(command => command.name() === "self-update")!;
      command.parseOptions(["--version", "0.10.8", "--min-release-age", "7", "--min-release-age-exclude", "@hasna/*", "--min-release-age-exclude", "openai"]);
      expect(command.opts()).toMatchObject({ version: "0.10.8", minReleaseAge: "7", minReleaseAgeExclude: ["@hasna/*", "openai"] });
      for (const age of ["0", "-1", "1.5", "Infinity", "9007199254740992"]) {
        const output: string[] = [];
        console.error = (...values) => output.push(values.join(" "));
        process.exitCode = 0;
        const invalid = new Command().enablePositionalOptions().exitOverride();
        registerRuntime(invalid);
        await invalid.parseAsync(["self-update", "--json", "--version", "0.10.8", "--min-release-age", age], { from: "user" });
        expect(process.exitCode).toBe(1);
        expect(output.map(line => JSON.parse(line))).toEqual([{ updated: false, error: "MIN_RELEASE_AGE_INVALID" }]);
      }
    } finally {
      console.error = priorError; console.log = priorLog; process.exitCode = priorExitCode ?? 0;
      if (priorTestMode === undefined) delete process.env.SKILLS_TEST_MODE; else process.env.SKILLS_TEST_MODE = priorTestMode;
    }
  });

  test("age and exclusion inputs reject unsafe values before reading a runtime or fetching an artifact", async () => {
    for (const minReleaseAge of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      await expect(updateCopyfileRuntime("0.10.8", { homeDir: "/missing-synthetic-home", minReleaseAge })).rejects.toThrow("MIN_RELEASE_AGE_INVALID");
    }
    await expect(updateCopyfileRuntime("0.10.8", { homeDir: "/missing-synthetic-home", minReleaseAgeExclude: ["@hasna/*"] })).rejects.toThrow("MIN_RELEASE_AGE_REQUIRED_FOR_EXCLUSIONS");
    for (const pattern of ["", "@hasna/*\nregistry=https://example.invalid", "--registry", "openai=0", "openai "]) {
      await expect(updateCopyfileRuntime("0.10.8", { homeDir: "/missing-synthetic-home", minReleaseAge: 7, minReleaseAgeExclude: [pattern] })).rejects.toThrow("MIN_RELEASE_AGE_EXCLUDE_INVALID");
    }
  });

  test("verifies the exact artifact, switches physical runtime launchers, preserves config and rolls back", async () => {
    const f = fixtureHome();
    const { server, integrity } = await serverWithArtifact();
    try {
      const pathValue = `${f.externalBin}${delimiter}${f.localBin}${delimiter}${f.bunBin}`;
      const priorUmask = process.umask(0o002);
      let result: Awaited<ReturnType<typeof updateCopyfileRuntime>>;
      try {
        result = await updateCopyfileRuntime("0.10.8", { homeDir: f.home, pathValue, registryOrigin: server.url.origin });
      } finally {
        process.umask(priorUmask);
      }
      expect(result).toMatchObject({ updated: true, version: "0.10.8", currentVersion: "0.10.6", launcherCount: 21, configCount: 4, tarballIntegrity: integrity, prerequisites: { status: "not-declared" } });
      const targetRoot = join(f.runtime, "0.10.8-copyfile");
      const targetPackage = join(targetRoot, "node_modules", "@hasna", "skills");
      const nodeModulesRoot = join(targetRoot, "node_modules");
      expect(pinnedTarget(join(f.localBin, "skills"))).toBe(join(targetPackage, BIN.skills));
      expect(pinnedTarget(join(f.bunBin, "skills"))).toBe(join(targetPackage, BIN.skills));
      // The switched launcher is the exact fleet pinned shape for this runtime, cwd and entry.
      const pinnedBinding = parsePinnedLauncher(readFileSync(join(f.localBin, "skills"), "utf8"));
      expect(pinnedBinding).toEqual({ runtime: realpathSync(process.execPath), cwd: targetRoot, entry: join(targetPackage, BIN.skills), format: "v2", profile: "client" });
      expect(readFileSync(join(f.localBin, "skills"), "utf8")).toBe(renderPinnedLauncher(pinnedBinding!));
      expect(readFileSync(join(f.localBin, "skills"), "utf8")).toContain(`'${realpathSync(process.execPath)}' --config=/dev/null --no-env-file --no-macros --no-install '--cwd=${targetRoot}' '${join(targetPackage, BIN.skills)}' "$@"`);
      expect(readFileSync(join(f.localBin, "skills"), "utf8")).toContain('exec /usr/bin/env -i "$@"');
      expect(JSON.parse(readFileSync(join(targetPackage, "package.json"), "utf8")).version).toBe("0.10.8");
      expect(lstatSync(targetRoot).mode & 0o077).toBe(0);
      expect(lstatSync(nodeModulesRoot).isDirectory()).toBe(true);
      expect(lstatSync(nodeModulesRoot).mode & 0o022).toBe(0);
      const receipt = JSON.parse(readFileSync(join(targetRoot, "rollout-receipt.json"), "utf8"));
      expect(receipt).toMatchObject({ state: "switched", targetVersion: "0.10.8", tarballIntegrity: integrity, tarballBytes: expect.any(Number) });
      expect(receipt.launchers).toHaveLength(21);
      expect(receipt.launchers.every((item: { backupPath: string }) => existsSync(item.backupPath))).toBe(true);
      expect(receipt.launchers.every((item: { path: string; backupPath: string; oldLinkTarget: string }) => readlinkSync(item.backupPath) === item.oldLinkTarget && item.oldLinkTarget === relative(join(item.path, ".."), f.oldPackage + "/" + BIN[basename(item.path) as keyof typeof BIN]))).toBe(true);
      const receiptHistory = join(targetRoot, "receipt-history");
      expect(readdirSync(receiptHistory).length).toBeGreaterThan(1);
      expect(readdirSync(receiptHistory).every(name => (lstatSync(join(receiptHistory, name)).mode & 0o222) === 0)).toBe(true);
      expect(readdirSync(f.runtime).filter(name => name.startsWith(".copyfile-update-lock-released-")).length).toBe(1);
      expect(readFileSync(join(targetRoot, "install-lock.json"), "utf8")).toContain('"lockfileVersion"');
      const walk = (dir: string) => {
        for (const name of readdirSync(dir)) {
          const path = join(dir, name), stat = lstatSync(path);
          if (stat.isSymbolicLink()) continue;
          if (stat.isDirectory()) { expect(stat.mode & 0o022).toBe(0); walk(path); }
          else if (stat.isFile()) expect(stat.mode & 0o022).toBe(0);
        }
      };
      walk(nodeModulesRoot);
      for (const [path, content] of f.configs) {
        expect(readFileSync(path, "utf8")).toBe(content);
        const relativePath = path.slice(f.home.length + 1);
        expect(readFileSync(join(targetRoot, "preimage", "configs", relativePath), "utf8")).toBe(content);
      }
      const partiallyRolled = receipt.launchers[0];
      const afterPath = `${partiallyRolled.path}.skills-after-${result.receiptId}`;
      // The interrupted rollback preserved the switched (pinned) launcher bytes at its after path.
      writeFileSync(afterPath, readFileSync(partiallyRolled.path), { mode: 0o755, flag: "wx" });
      const partialTemp = `${partiallyRolled.path}.partial-rollback`;
      symlinkSync(partiallyRolled.oldLinkTarget, partialTemp);
      renameSync(partialTemp, partiallyRolled.path);
      const priorReceiptBytes = readFileSync(join(targetRoot, "rollout-receipt.json"));
      const historySnapshot = join(receiptHistory, `synthetic-interruption-${crypto.randomUUID()}.json`);
      writeFileSync(historySnapshot, priorReceiptBytes, { mode: 0o400, flag: "wx" });
      expect(readFileSync(historySnapshot).equals(priorReceiptBytes)).toBe(true);
      receipt.state = "rollback-required";
      writeFileSync(join(targetRoot, "rollout-receipt.json"), JSON.stringify(receipt, null, 2) + "\n");
      const rolled = rollbackCopyfileRuntime(String(result.receiptId), { homeDir: f.home });
      expect(rolled).toMatchObject({ rolledBack: true, restoredVersion: "0.10.6", launcherCount: 21 });
      expect(realpathSync(join(f.localBin, "skills"))).toBe(join(f.oldPackage, BIN.skills));
      expect(realpathSync(join(f.bunBin, "skills"))).toBe(join(f.oldPackage, BIN.skills));
      expect(readlinkSync(join(f.localBin, "skills"))).toBe(receipt.launchers.find((item: { path: string }) => item.path === join(f.localBin, "skills")).oldLinkTarget);
      expect(realpathSync(join(f.externalBin, "skills"))).toBe(join(f.oldPackage, BIN.skills));
      expect(JSON.parse(readFileSync(join(targetRoot, "rollout-receipt.json"), "utf8")).state).toBe("rolled-back");
      const rollbackHistory = readdirSync(receiptHistory)
        .filter(name => name.endsWith(".json"))
        .map(name => ({ name, receipt: JSON.parse(readFileSync(join(receiptHistory, name), "utf8")) }))
        .filter(item => item.receipt.state === "rollback-required");
      // The fixture starts from an interrupted partial rollback; every subsequent
      // per-launcher completion must preserve the exact prior journal state.
      expect(new Set(rollbackHistory.map(item => item.receipt.rollbackCompletedLaunchers.length))).toEqual(
        new Set(Array.from({ length: 21 }, (_, index) => index)),
      );
      expect(rollbackHistory.every(item => (lstatSync(join(receiptHistory, item.name)).mode & 0o222) === 0)).toBe(true);
      expect(readdirSync(f.runtime).filter(name => name.startsWith(".copyfile-update-lock-released-")).length).toBe(2);
    } finally { server.stop(true); }
  });

  test("refuses non-exact versions and registry integrity mismatch before switching launchers", async () => {
    const f = fixtureHome();
    await expect(updateCopyfileRuntime("latest", { homeDir: f.home, pathValue: `${f.localBin}${delimiter}${f.bunBin}` })).rejects.toThrow("EXACT_VERSION_REQUIRED");
    await expect(updateCopyfileRuntime("0.10.9-beta.1", { homeDir: f.home, pathValue: `${f.localBin}${delimiter}${f.bunBin}` })).rejects.toThrow("EXACT_STABLE_VERSION_REQUIRED");
    await expect(updateCopyfileRuntime("0.10.9+build.1", { homeDir: f.home, pathValue: `${f.localBin}${delimiter}${f.bunBin}` })).rejects.toThrow("EXACT_STABLE_VERSION_REQUIRED");
    const fixture = await serverWithArtifact();
    const brokenFetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const response = await fetch(input, init);
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.pathname === "/skills-0.10.8.tgz") {
        const changed = new Uint8Array(await response.arrayBuffer());
        changed[changed.length - 1] ^= 0xff;
        return new Response(changed, { status: 200, headers: { "content-type": "application/octet-stream" } });
      }
      return response;
    }) as typeof fetch;
    try {
      await expect(updateCopyfileRuntime("0.10.8", { homeDir: f.home, pathValue: `${f.localBin}${delimiter}${f.bunBin}`, registryOrigin: fixture.server.url.origin, fetcher: brokenFetcher })).rejects.toThrow("TARBALL_INTEGRITY_MISMATCH");
      expect(realpathSync(join(f.localBin, "skills"))).toBe(join(f.oldPackage, BIN.skills));
      expect(realpathSync(join(f.bunBin, "skills"))).toBe(join(f.oldPackage, BIN.skills));
      const alias = join(f.home, "aliased-bin");
      symlinkSync(f.localBin, alias);
      await expect(updateCopyfileRuntime("0.10.8", { homeDir: f.home, pathValue: `${alias}${delimiter}${f.bunBin}` })).rejects.toThrow("PATH_ANCESTOR_SYMLINK_UNSUPPORTED");
      const skillLauncher = join(f.localBin, "skills");
      const originalText = readlinkSync(skillLauncher);
      renameSync(skillLauncher, `${skillLauncher}.direct`);
      symlinkSync(originalText, join(f.localBin, ".skills-target-chain"));
      symlinkSync(".skills-target-chain", skillLauncher);
      await expect(updateCopyfileRuntime("0.10.8", { homeDir: f.home, pathValue: `${f.localBin}${delimiter}${f.bunBin}` })).rejects.toThrow("LAUNCHER_SYMLINK_CHAIN_UNSUPPORTED");
      expect(existsSync(`${skillLauncher}.skills-prev-test`)).toBe(false);
    } finally { fixture.server.stop(true); }
  });

  test("a failure after the first launcher switch rolls back the resolved target binding", async () => {
    const f = fixtureHome();
    const fixture = await serverWithArtifact();
    try {
      await expect(updateCopyfileRuntime("0.10.8", {
        homeDir: f.home,
        pathValue: `${f.localBin}${delimiter}${f.bunBin}`,
        registryOrigin: fixture.server.url.origin,
        onLauncherSwitched: () => { throw new Error("SYNTHETIC_POST_SWITCH_FAILURE"); },
      })).rejects.toThrow("UPDATE_FAILED_ROLLED_BACK");
      for (const name of Object.keys(BIN)) {
        expect(realpathSync(join(f.localBin, name))).toBe(join(f.oldPackage, BIN[name as keyof typeof BIN]));
        expect(realpathSync(join(f.bunBin, name))).toBe(join(f.oldPackage, BIN[name as keyof typeof BIN]));
      }
      const receiptPath = join(f.runtime, "0.10.8-copyfile", "rollout-receipt.json");
      expect(JSON.parse(readFileSync(receiptPath, "utf8")).state).toBe("rolled-back");
    } finally { fixture.server.stop(true); }
  });

  test("repeated and lexically equivalent PATH directories produce one launcher entry each", async () => {
    const f = fixtureHome();
    const fixture = await serverWithArtifact();
    try {
      const pathValue = [
        ...Array.from({ length: 12 }, () => f.localBin),
        join(f.localBin, "."),
        f.bunBin,
        f.externalBin,
      ].join(delimiter);
      const result = await updateCopyfileRuntime("0.10.8", {
        homeDir: f.home,
        pathValue,
        registryOrigin: fixture.server.url.origin,
      });
      expect(result).toMatchObject({ updated: true, launcherCount: 21 });
      const receipt = JSON.parse(readFileSync(join(f.runtime, "0.10.8-copyfile", "rollout-receipt.json"), "utf8"));
      const paths = receipt.launchers.map((item: { path: string }) => item.path);
      expect(paths).toHaveLength(21);
      expect(new Set(paths).size).toBe(21);
      expect(paths.filter((path: string) => path.startsWith(f.localBin + "/"))).toHaveLength(Object.keys(BIN).length);
      expect(pinnedTarget(join(f.localBin, "skills"))).toBe(join(f.runtime, "0.10.8-copyfile", "node_modules", "@hasna", "skills", BIN.skills));
    } finally { fixture.server.stop(true); }
  });

  test("adopts verified legacy package aliases with exact backups and restores them from a receipt", async () => {
    const f = fixtureHome();
    const fixture = await serverWithArtifact();
    try {
      const pathValue = `${f.localBin}${delimiter}${f.bunBin}`;
      await updateCopyfileRuntime("0.10.8", { homeDir: f.home, pathValue, registryOrigin: fixture.server.url.origin });
      const legacy = join(f.home, ".bun", "install", "global", "node_modules", "@hasna", "skills");
      mkdirSync(join(legacy, "bin"), { recursive: true, mode: 0o700 });
      writeFileSync(join(legacy, "package.json"), JSON.stringify({ name: "@hasna/skills", version: "0.10.6", bin: BIN }), { mode: 0o600 });
      for (const target of new Set(Object.values(BIN))) writeFileSync(join(legacy, target), "legacy fixture\n", { mode: 0o755 });
      chmodSync(join(legacy, BIN["skills-mcp"]), 0o777);
      const oldMcp = join(f.bunBin, "skills-mcp"), oldServer = join(f.localBin, "skills-server");
      renameSync(oldMcp, `${oldMcp}.synthetic-prior`);
      renameSync(oldServer, `${oldServer}.synthetic-prior`);
      symlinkSync(relative(f.bunBin, join(legacy, BIN["skills-mcp"])), oldMcp);
      symlinkSync(relative(f.localBin, join(legacy, BIN["skills-server"])), oldServer);
      const priorMcpLink = readlinkSync(oldMcp), priorServerLink = readlinkSync(oldServer);
      const result = adoptCopyfileAliases({ homeDir: f.home, pathValue });
      expect(result).toMatchObject({ adopted: true, version: "0.10.8", aliasCount: 2 });
      const receiptPath = join(f.runtime, "0.10.8-copyfile", "alias-adoptions", `${result.receiptId}.json`);
      const receipt = JSON.parse(readFileSync(receiptPath, "utf8"));
      expect(receipt.state).toBe("switched");
      expect(receipt.aliases).toHaveLength(2);
      for (const item of receipt.aliases) {
        expect(pinnedTarget(item.path)).toBe(item.newTarget);
        expect(item).toMatchObject({ oldShape: "symlink", newShape: "pinned", newCwd: join(f.runtime, "0.10.8-copyfile") });
        expect(readlinkSync(item.backupPath)).toBe(item.oldLinkTarget);
        expect(realpathSync(item.backupPath)).toBe(item.oldTarget);
      }
      const rolled = rollbackCopyfileAliases(String(result.receiptId), { homeDir: f.home, pathValue });
      expect(rolled).toMatchObject({ rolledBack: true, restoredAliasCount: 2 });
      expect(readlinkSync(oldMcp)).toBe(priorMcpLink);
      expect(readlinkSync(oldServer)).toBe(priorServerLink);
      expect(realpathSync(oldMcp)).toBe(join(legacy, BIN["skills-mcp"]));
      expect(realpathSync(oldServer)).toBe(join(legacy, BIN["skills-server"]));
    } finally { fixture.server.stop(true); }
  });

  test("adopts the observed one-hop package-root alias and restores its exact public link", async () => {
    const f = fixtureHome();
    const fixture = await serverWithArtifact();
    try {
      const pathValue = `${f.localBin}${delimiter}${f.bunBin}`;
      await updateCopyfileRuntime("0.10.8", { homeDir: f.home, pathValue, registryOrigin: fixture.server.url.origin });
      const packageLink = join(f.home, ".local", "lib", "node_modules", "@hasna", "skills");
      mkdirSync(join(packageLink, ".."), { recursive: true, mode: 0o700 });
      symlinkSync(relative(join(packageLink, ".."), f.oldPackage), packageLink);
      const packageLinkText = readlinkSync(packageLink);
      const alias = join(f.localBin, "skills-server");
      renameSync(alias, `${alias}.synthetic-prior`);
      symlinkSync(relative(f.localBin, join(packageLink, BIN["skills-server"])), alias);
      const oldLinkText = readlinkSync(alias);
      const result = adoptCopyfileAliases({ homeDir: f.home, pathValue });
      expect(result).toMatchObject({ adopted: true, aliasCount: 1 });
      const receipt = JSON.parse(readFileSync(join(f.runtime, "0.10.8-copyfile", "alias-adoptions", `${result.receiptId}.json`), "utf8"));
      expect(receipt.aliases[0].chain).toEqual({ packageLinkPath: packageLink, packageLinkTarget: packageLinkText });
      expect(readlinkSync(packageLink)).toBe(packageLinkText);
      expect(readlinkSync(receipt.aliases[0].backupPath)).toBe(oldLinkText);
      expect(realpathSync(receipt.aliases[0].backupPath)).toBe(join(f.oldPackage, BIN["skills-server"]));
      expect(pinnedTarget(alias)).toBe(receipt.aliases[0].newTarget);
      expect(rollbackCopyfileAliases(String(result.receiptId), { homeDir: f.home, pathValue }))
        .toMatchObject({ rolledBack: true, restoredAliasCount: 1 });
      expect(readlinkSync(alias)).toBe(oldLinkText);
      expect(realpathSync(alias)).toBe(join(f.oldPackage, BIN["skills-server"]));
      expect(readlinkSync(packageLink)).toBe(packageLinkText);
    } finally { fixture.server.stop(true); }
  });

  test("refuses unsafe, wrong-root and cyclic package-link chains before making backups", async () => {
    for (const cause of ["writable-parent", "wrong-root", "cycle"]) {
      const f = fixtureHome();
      const fixture = await serverWithArtifact();
      try {
        const pathValue = `${f.localBin}${delimiter}${f.bunBin}`;
        await updateCopyfileRuntime("0.10.8", { homeDir: f.home, pathValue, registryOrigin: fixture.server.url.origin });
        const packageLink = join(f.home, ".local", "lib", "node_modules", "@hasna", "skills");
        const wrongPackage = join(f.home, ".bun", "install", "global", "node_modules", "@hasna", "skills");
        mkdirSync(join(packageLink, ".."), { recursive: true, mode: 0o700 });
        if (cause === "wrong-root") {
          mkdirSync(join(wrongPackage, "bin"), { recursive: true, mode: 0o700 });
          writeFileSync(join(wrongPackage, BIN["skills-server"]), "synthetic wrong-root binary\n", { mode: 0o755 });
        }
        symlinkSync(relative(join(packageLink, ".."), cause === "wrong-root" ? wrongPackage : cause === "cycle" ? packageLink : f.oldPackage), packageLink);
        if (cause === "writable-parent") chmodSync(join(packageLink, ".."), 0o775);
        const alias = join(f.localBin, "skills-server");
        renameSync(alias, `${alias}.synthetic-prior`);
        symlinkSync(relative(f.localBin, join(packageLink, BIN["skills-server"])), alias);
        const original = readlinkSync(alias);
        expect(() => adoptCopyfileAliases({ homeDir: f.home, pathValue })).toThrow(
          cause === "writable-parent" ? "ALIAS_PATH_UNSAFE" : "ALIAS_LINK_CHAIN_UNSUPPORTED",
        );
        expect(readlinkSync(alias)).toBe(original);
        expect(readdirSync(f.localBin).some(name => name.includes("skills-alias-prev-"))).toBe(false);
        expect(existsSync(join(f.runtime, "0.10.8-copyfile", "alias-adoptions"))).toBe(false);
      } finally { fixture.server.stop(true); }
    }
  });

  test("a changed package-root link leaves a partial adoption recoverable only after its preimage returns", async () => {
    const f = fixtureHome();
    const fixture = await serverWithArtifact();
    try {
      const pathValue = `${f.localBin}${delimiter}${f.bunBin}`;
      await updateCopyfileRuntime("0.10.8", { homeDir: f.home, pathValue, registryOrigin: fixture.server.url.origin });
      const packageLink = join(f.home, ".local", "lib", "node_modules", "@hasna", "skills");
      mkdirSync(join(packageLink, ".."), { recursive: true, mode: 0o700 });
      symlinkSync(relative(join(packageLink, ".."), f.oldPackage), packageLink);
      const originalPackageText = readlinkSync(packageLink);
      const aliases = [join(f.localBin, "skills-mcp"), join(f.localBin, "skills-server")];
      for (const alias of aliases) {
        renameSync(alias, `${alias}.synthetic-prior`);
        symlinkSync(relative(f.localBin, join(packageLink, BIN[basename(alias) as keyof typeof BIN])), alias);
      }
      const originals = aliases.map(alias => readlinkSync(alias));
      expect(() => adoptCopyfileAliases({ homeDir: f.home, pathValue, onAliasSwitched: () => {
        renameSync(packageLink, `${packageLink}.synthetic-held`);
        symlinkSync(relative(join(packageLink, ".."), join(f.runtime, "0.10.8-copyfile", "node_modules", "@hasna", "skills")), packageLink);
      } })).toThrow("ALIAS_ADOPTION_ROLLBACK_REQUIRED");
      const adoptionRoot = join(f.runtime, "0.10.8-copyfile", "alias-adoptions");
      const receiptName = readdirSync(adoptionRoot).find(name => name.endsWith(".json"))!;
      const receipt = JSON.parse(readFileSync(join(adoptionRoot, receiptName), "utf8"));
      expect(receipt.state).toBe("rollback-required");
      expect(receipt.aliases.every((item: { chain: { packageLinkTarget: string } }) => item.chain.packageLinkTarget === originalPackageText)).toBe(true);
      expect(() => rollbackCopyfileAliases(receipt.id, { homeDir: f.home, pathValue })).toThrow("LAUNCHER_SYMLINK_CHAIN_UNSUPPORTED");
      renameSync(packageLink, `${packageLink}.synthetic-failed-link`);
      renameSync(`${packageLink}.synthetic-held`, packageLink);
      expect(rollbackCopyfileAliases(receipt.id, { homeDir: f.home, pathValue }))
        .toMatchObject({ rolledBack: true, restoredAliasCount: 1 });
      for (let i = 0; i < aliases.length; i++) {
        expect(readlinkSync(aliases[i]!)).toBe(originals[i]);
        expect(realpathSync(aliases[i]!)).toBe(join(f.oldPackage, BIN[basename(aliases[i]!) as keyof typeof BIN]));
      }
      expect(readlinkSync(packageLink)).toBe(originalPackageText);
    } finally { fixture.server.stop(true); }
  });

  test("a last-switch package-link text change fails even when it still resolves to the same binary", async () => {
    const f = fixtureHome();
    const fixture = await serverWithArtifact();
    try {
      const pathValue = `${f.localBin}${delimiter}${f.bunBin}`;
      await updateCopyfileRuntime("0.10.8", { homeDir: f.home, pathValue, registryOrigin: fixture.server.url.origin });
      const packageLink = join(f.home, ".local", "lib", "node_modules", "@hasna", "skills");
      mkdirSync(join(packageLink, ".."), { recursive: true, mode: 0o700 });
      symlinkSync(relative(join(packageLink, ".."), f.oldPackage), packageLink);
      const originalPackageText = readlinkSync(packageLink);
      const alias = join(f.localBin, "skills-server");
      renameSync(alias, `${alias}.synthetic-prior`);
      symlinkSync(relative(f.localBin, join(packageLink, BIN["skills-server"])), alias);
      const oldAliasText = readlinkSync(alias);
      expect(() => adoptCopyfileAliases({ homeDir: f.home, pathValue, onAliasSwitched: () => {
        renameSync(packageLink, `${packageLink}.synthetic-held`);
        symlinkSync(f.oldPackage, packageLink);
      } })).toThrow("ALIAS_ADOPTION_ROLLBACK_REQUIRED");
      const adoptionRoot = join(f.runtime, "0.10.8-copyfile", "alias-adoptions");
      const receiptName = readdirSync(adoptionRoot).find(name => name.endsWith(".json"))!;
      const receipt = JSON.parse(readFileSync(join(adoptionRoot, receiptName), "utf8"));
      expect(receipt.state).toBe("rollback-required");
      expect(realpathSync(packageLink)).toBe(f.oldPackage);
      expect(readlinkSync(packageLink)).not.toBe(originalPackageText);
      expect(() => rollbackCopyfileAliases(receipt.id, { homeDir: f.home, pathValue })).toThrow("ALIAS_LINK_CHAIN_DRIFT");
      renameSync(packageLink, `${packageLink}.synthetic-failed-link`);
      renameSync(`${packageLink}.synthetic-held`, packageLink);
      expect(rollbackCopyfileAliases(receipt.id, { homeDir: f.home, pathValue }))
        .toMatchObject({ rolledBack: true, restoredAliasCount: 1 });
      expect(readlinkSync(alias)).toBe(oldAliasText);
      expect(realpathSync(alias)).toBe(join(f.oldPackage, BIN["skills-server"]));
      expect(readlinkSync(packageLink)).toBe(originalPackageText);
    } finally { fixture.server.stop(true); }
  });

  test("a failure during alias adoption restores prior bindings from verified backups", async () => {
    const f = fixtureHome();
    const fixture = await serverWithArtifact();
    try {
      const pathValue = `${f.localBin}${delimiter}${f.bunBin}`;
      await updateCopyfileRuntime("0.10.8", { homeDir: f.home, pathValue, registryOrigin: fixture.server.url.origin });
      const legacy = join(f.home, ".bun", "install", "global", "node_modules", "@hasna", "skills");
      mkdirSync(join(legacy, "bin"), { recursive: true, mode: 0o700 });
      writeFileSync(join(legacy, "package.json"), JSON.stringify({ name: "@hasna/skills", version: "0.10.6", bin: BIN }), { mode: 0o600 });
      for (const target of new Set(Object.values(BIN))) writeFileSync(join(legacy, target), "legacy fixture\n", { mode: 0o755 });
      const aliases = [join(f.bunBin, "skills-mcp"), join(f.bunBin, "skills-server")];
      for (const path of aliases) {
        renameSync(path, `${path}.synthetic-prior`);
        symlinkSync(relative(f.bunBin, join(legacy, BIN[basename(path) as keyof typeof BIN])), path);
      }
      const originals = aliases.map(path => readlinkSync(path));
      expect(() => adoptCopyfileAliases({ homeDir: f.home, pathValue, onAliasSwitched: () => { throw new Error("SYNTHETIC_FAILURE"); } }))
        .toThrow("ALIAS_ADOPTION_ROLLED_BACK");
      for (let i = 0; i < aliases.length; i++) {
        expect(readlinkSync(aliases[i]!)).toBe(originals[i]);
        expect(realpathSync(aliases[i]!)).toBe(join(legacy, BIN[basename(aliases[i]!) as keyof typeof BIN]));
      }
    } finally { fixture.server.stop(true); }
  });

  test("a partial switch with a failed automatic restore remains recoverable from its receipt", async () => {
    const f = fixtureHome();
    const fixture = await serverWithArtifact();
    try {
      const pathValue = `${f.localBin}${delimiter}${f.bunBin}`;
      await updateCopyfileRuntime("0.10.8", { homeDir: f.home, pathValue, registryOrigin: fixture.server.url.origin });
      const legacy = join(f.home, ".bun", "install", "global", "node_modules", "@hasna", "skills");
      mkdirSync(join(legacy, "bin"), { recursive: true, mode: 0o700 });
      writeFileSync(join(legacy, "package.json"), JSON.stringify({ name: "@hasna/skills", version: "0.10.6", bin: BIN }), { mode: 0o600 });
      for (const target of new Set(Object.values(BIN))) writeFileSync(join(legacy, target), "legacy fixture\n", { mode: 0o755 });
      const first = join(f.bunBin, "skills-mcp"), second = join(f.bunBin, "skills-server");
      for (const path of [first, second]) {
        renameSync(path, `${path}.synthetic-prior`);
        symlinkSync(relative(f.bunBin, join(legacy, BIN[basename(path) as keyof typeof BIN])), path);
      }
      const firstOriginal = readlinkSync(first), secondOriginal = readlinkSync(second);
      const adoptionRoot = join(f.runtime, "0.10.8-copyfile", "alias-adoptions");
      let backup = "";
      expect(() => adoptCopyfileAliases({ homeDir: f.home, pathValue, onAliasSwitched: path => {
        expect(path).toBe(first);
        const receiptName = readdirSync(adoptionRoot).find(name => name.endsWith(".json"));
        expect(receiptName).toBeDefined();
        backup = `${first}.skills-alias-prev-${receiptName!.slice(0, -5)}`;
        renameSync(backup, `${backup}.held`);
        renameSync(second, `${second}.held`);
        symlinkSync(relative(f.bunBin, join(legacy, BIN["skills-worker"])), second);
      } })).toThrow("ALIAS_ADOPTION_ROLLBACK_REQUIRED");
      const receiptName = readdirSync(adoptionRoot).find(name => name.endsWith(".json"))!;
      const receipt = JSON.parse(readFileSync(join(adoptionRoot, receiptName), "utf8"));
      expect(receipt.state).toBe("rollback-required");
      expect(receipt.aliases).toHaveLength(2);
      expect(pinnedTarget(first)).toBe(receipt.aliases[0].newTarget);
      expect(existsSync(backup)).toBe(false);
      expect(existsSync(receipt.aliases[1].backupPath)).toBe(false);
      renameSync(second, `${second}.synthetic-failed-link`);
      renameSync(`${second}.held`, second);
      renameSync(`${backup}.held`, backup);
      const rolled = rollbackCopyfileAliases(receipt.id, { homeDir: f.home, pathValue });
      expect(rolled).toMatchObject({ rolledBack: true, restoredAliasCount: 1 });
      expect(readlinkSync(first)).toBe(firstOriginal);
      expect(readlinkSync(second)).toBe(secondOriginal);
      expect(realpathSync(first)).toBe(join(legacy, BIN["skills-mcp"]));
      expect(realpathSync(second)).toBe(join(legacy, BIN["skills-server"]));
    } finally { fixture.server.stop(true); }
  });

  test("refuses group- or world-writable alias directories before creating a backup", async () => {
    for (const mode of [0o775, 0o777]) {
      const f = fixtureHome();
      const fixture = await serverWithArtifact();
      try {
        const pathValue = `${f.localBin}${delimiter}${f.bunBin}`;
        await updateCopyfileRuntime("0.10.8", { homeDir: f.home, pathValue, registryOrigin: fixture.server.url.origin });
        const legacy = join(f.home, ".bun", "install", "global", "node_modules", "@hasna", "skills");
        mkdirSync(join(legacy, "bin"), { recursive: true, mode: 0o700 });
        writeFileSync(join(legacy, "package.json"), JSON.stringify({ name: "@hasna/skills", version: "0.10.6", bin: BIN }), { mode: 0o600 });
        writeFileSync(join(legacy, BIN["skills-server"]), "legacy fixture\n", { mode: 0o755 });
        const alias = join(f.bunBin, "skills-server");
        renameSync(alias, `${alias}.synthetic-prior`);
        symlinkSync(relative(f.bunBin, join(legacy, BIN["skills-server"])), alias);
        const original = readlinkSync(alias);
        chmodSync(f.bunBin, mode);
        expect(() => adoptCopyfileAliases({ homeDir: f.home, pathValue })).toThrow("ALIAS_PATH_UNSAFE");
        expect(readlinkSync(alias)).toBe(original);
        expect(realpathSync(alias)).toBe(join(legacy, BIN["skills-server"]));
        expect(readdirSync(f.bunBin).some(name => name.includes("skills-alias-prev-"))).toBe(false);
        expect(existsSync(join(f.runtime, "0.10.8-copyfile", "alias-adoptions"))).toBe(false);
      } finally { fixture.server.stop(true); }
    }
  });

  test("refuses aliases with an unsupported physical root, package identity, or bin mapping", async () => {
    for (const cause of ["wrong-root", "wrong-package", "wrong-bin"]) {
      const f = fixtureHome();
      const fixture = await serverWithArtifact();
      try {
        const pathValue = `${f.localBin}${delimiter}${f.bunBin}`;
        await updateCopyfileRuntime("0.10.8", { homeDir: f.home, pathValue, registryOrigin: fixture.server.url.origin });
        const legacy = cause === "wrong-root"
          ? join(f.home, "other", "node_modules", "@hasna", "skills")
          : join(f.home, ".bun", "install", "global", "node_modules", "@hasna", "skills");
        mkdirSync(join(legacy, "bin"), { recursive: true, mode: 0o700 });
        writeFileSync(join(legacy, "package.json"), JSON.stringify({
          name: cause === "wrong-package" ? "@hasna/other" : "@hasna/skills", version: "0.10.6",
          bin: cause === "wrong-bin" ? { ...BIN, "skills-server": BIN["skills-worker"] } : BIN,
        }), { mode: 0o600 });
        writeFileSync(join(legacy, BIN["skills-server"]), "legacy fixture\n", { mode: 0o755 });
        const alias = join(f.bunBin, "skills-server");
        renameSync(alias, `${alias}.synthetic-prior`);
        symlinkSync(relative(f.bunBin, join(legacy, BIN["skills-server"])), alias);
        const original = readlinkSync(alias);
        expect(() => adoptCopyfileAliases({ homeDir: f.home, pathValue })).toThrow(
          cause === "wrong-root" ? "ALIAS_SOURCE_ROOT_UNSUPPORTED" : cause === "wrong-package" ? "PACKAGE_IDENTITY_INVALID" : "ALIAS_SOURCE_BIN_MISMATCH",
        );
        expect(readlinkSync(alias)).toBe(original);
        expect(realpathSync(alias)).toBe(join(legacy, BIN["skills-server"]));
        expect(readdirSync(f.bunBin).some(name => name.includes("skills-alias-prev-"))).toBe(false);
        expect(existsSync(join(f.runtime, "0.10.8-copyfile", "alias-adoptions"))).toBe(false);
      } finally { fixture.server.stop(true); }
    }
  });

  test("adopt-aliases pins pre-pinned bare symlinks to the current runtime: a hostile cwd bunfig.toml, .env and BUN_OPTIONS then reach nothing", async () => {
    const f = fixtureHome();
    const fixture = await serverWithArtifact({}, {}, name => `console.log(JSON.stringify({ name: ${JSON.stringify(name)}, dotenv: process.env.HOSTILE_DOTENV ?? null, bunOptions: process.env.BUN_OPTIONS ?? null, nodeOptions: process.env.NODE_OPTIONS ?? null, cwd: process.cwd(), launchCwd: process.env.HASNA_SKILLS_LAUNCH_CWD ?? null, argv: process.argv.slice(2) }));`);
    const hostile = hostileDirectory();
    try {
      const pathValue = `${f.localBin}${delimiter}${f.bunBin}`;
      await updateCopyfileRuntime("0.10.8", { homeDir: f.home, pathValue, registryOrigin: fixture.server.url.origin });
      const targetRoot = join(f.runtime, "0.10.8-copyfile");
      const links = asPrePinnedRollout(targetRoot);
      expect([...links.keys()].sort()).toEqual(binPaths(f).sort());
      const result = adoptCopyfileAliases({ homeDir: f.home, pathValue });
      expect(result).toMatchObject({ adopted: true, version: "0.10.8", aliasCount: 14 });
      const receipt = JSON.parse(readFileSync(join(targetRoot, "alias-adoptions", `${result.receiptId}.json`), "utf8"));
      expect(receipt).toMatchObject({ state: "switched", targetVersion: "0.10.8", targetPackageRoot: join(targetRoot, "node_modules", "@hasna", "skills") });
      expect(receipt.aliases.map((item: { path: string }) => item.path).sort()).toEqual([...links.keys()].sort());
      const runtime = realpathSync(process.execPath);
      for (const item of receipt.aliases) {
        // The same record as any adopted alias: the old symlink, its exact text and backup, and the new pinned shape.
        expect(item).toMatchObject({
          oldShape: "symlink", oldTarget: item.newTarget, oldLinkTarget: links.get(item.path), oldVersion: "0.10.8",
          newShape: "pinned", newRuntime: runtime, newCwd: targetRoot, backupPath: `${item.path}.skills-alias-prev-${result.receiptId}`,
        });
        expect([item.oldRuntime, item.oldCwd, item.oldSha256, item.chain]).toEqual([undefined, undefined, undefined, undefined]);
        expect(pinnedTarget(item.path)).toBe(item.newTarget);
        expect(readFileSync(item.path, "utf8")).toBe(renderPinnedLauncher({ runtime, cwd: targetRoot, entry: item.newTarget, format: item.newFormat, profile: item.newProfile }));
        expect(lstatSync(item.backupPath).isSymbolicLink()).toBe(true);
        expect(readlinkSync(item.backupPath)).toBe(links.get(item.path)!);
      }
      // Positive control: the preserved pre-pinned launcher, run from the hostile
      // directory, loads that directory's bunfig.toml preload and .env.
      const control = hostile.launch(`${join(f.localBin, "skills")}.skills-alias-prev-${result.receiptId}`);
      expect(control.code).toBe(0);
      expect(hostile.markers()).toBe(1);
      expect(JSON.parse(control.stdout)).toMatchObject({ name: "skills", dotenv: "leaked" });
      for (const path of [join(f.localBin, "skills"), join(f.bunBin, "skills-mcp")]) {
        const pinned = hostile.launch(path, { BUN_OPTIONS: `--preload=${join(hostile.dir, "preload.js")}`, NODE_OPTIONS: `--require=${join(hostile.dir, "preload.js")}` });
        expect(pinned.stderr).toBe("");
        expect(pinned.code).toBe(0);
        expect(JSON.parse(pinned.stdout)).toEqual({
          name: basename(path), dotenv: null, bunOptions: null, nodeOptions: null, cwd: targetRoot, launchCwd: realpathSync(hostile.dir), argv: ["probe-arg"],
        });
      }
      expect(hostile.markers()).toBe(1);
      expect(existsSync(join(f.runtime, ".copyfile-update-lock"))).toBe(false);
    } finally { fixture.server.stop(true); }
  });

  test("adopt-aliases leaves launchers already pinned to the current runtime untouched and pins only the bare symlinks beside them", async () => {
    const f = fixtureHome();
    const fixture = await serverWithArtifact();
    try {
      const pathValue = `${f.localBin}${delimiter}${f.bunBin}`;
      await updateCopyfileRuntime("0.10.8", { homeDir: f.home, pathValue, registryOrigin: fixture.server.url.origin });
      const paths = binPaths(f);
      const updated = launcherSnapshot(paths);
      expect([...updated.values()].every(item => !item.symlink)).toBe(true);
      // A mixed station: two launchers are back in the pre-pinned shape (a bare
      // absolute symlink to the current entry); twelve are pinned to the current runtime.
      const bare = [join(f.bunBin, "skills-mcp"), join(f.localBin, "skills-server")];
      for (const path of bare) {
        const temp = `${path}.synthetic-bare`;
        symlinkSync(pinnedTarget(path), temp);
        renameSync(temp, path);
      }
      const first = adoptCopyfileAliases({ homeDir: f.home, pathValue });
      expect(first).toMatchObject({ adopted: true, version: "0.10.8", aliasCount: 2 });
      const adoptions = join(f.runtime, "0.10.8-copyfile", "alias-adoptions");
      const receipt = JSON.parse(readFileSync(join(adoptions, `${first.receiptId}.json`), "utf8"));
      expect(receipt.aliases.map((item: { path: string }) => item.path).sort()).toEqual([...bare].sort());
      const adopted = launcherSnapshot(paths);
      for (const path of paths) {
        // Every launcher is now pinned with exactly the text the update wrote for it.
        expect(adopted.get(path)).toMatchObject({ symlink: false, text: updated.get(path)!.text });
        // The ones already pinned were never rewritten.
        if (!bare.includes(path)) expect(adopted.get(path)!.ino).toBe(updated.get(path)!.ino);
      }
      // Already pinned to the current runtime: a no-op, with no receipt and no backup.
      expect(adoptCopyfileAliases({ homeDir: f.home, pathValue })).toEqual({ adopted: true, version: "0.10.8", aliasCount: 0 });
      expect(launcherSnapshot(paths)).toEqual(adopted);
      expect(readdirSync(adoptions).filter(name => name.endsWith(".json"))).toEqual([`${first.receiptId}.json`]);
      expect([f.localBin, f.bunBin].flatMap(dir => readdirSync(dir).filter(name => name.includes(".skills-alias-prev-"))).sort())
        .toEqual(bare.map(path => `${basename(path)}.skills-alias-prev-${first.receiptId}`).sort());
      expect(existsSync(join(f.runtime, ".copyfile-update-lock"))).toBe(false);
    } finally { fixture.server.stop(true); }
  });

  test("alias rollback restores the exact pre-pinned symlinks, and refuses while a launcher pinned in place has lost its backup", async () => {
    const f = fixtureHome();
    const fixture = await serverWithArtifact();
    const lock = join(f.runtime, ".copyfile-update-lock");
    try {
      const pathValue = `${f.localBin}${delimiter}${f.bunBin}`;
      await updateCopyfileRuntime("0.10.8", { homeDir: f.home, pathValue, registryOrigin: fixture.server.url.origin });
      const targetRoot = join(f.runtime, "0.10.8-copyfile");
      const links = asPrePinnedRollout(targetRoot);
      const result = adoptCopyfileAliases({ homeDir: f.home, pathValue });
      expect(result).toMatchObject({ adopted: true, aliasCount: 14 });
      const receiptPath = join(targetRoot, "alias-adoptions", `${result.receiptId}.json`);
      const adopted = launcherSnapshot(links.keys());
      // The old and new entry are the same file here, so the target alone cannot
      // show the launcher is still in its old state: without its backup, refuse.
      const backup = `${join(f.bunBin, "skills-mcp")}.skills-alias-prev-${result.receiptId}`;
      renameSync(backup, `${backup}.held`);
      expect(() => rollbackCopyfileAliases(String(result.receiptId), { homeDir: f.home, pathValue })).toThrow("ALIAS_BACKUP_MISSING_FOR_SWITCH");
      expect(launcherSnapshot(links.keys())).toEqual(adopted);
      expect(JSON.parse(readFileSync(receiptPath, "utf8")).state).toBe("switched");
      expect(existsSync(lock)).toBe(false);
      renameSync(`${backup}.held`, backup);
      expect(rollbackCopyfileAliases(String(result.receiptId), { homeDir: f.home, pathValue })).toMatchObject({ rolledBack: true, restoredAliasCount: 14 });
      for (const [path, text] of links) {
        expect(lstatSync(path).isSymbolicLink()).toBe(true);
        expect(readlinkSync(path)).toBe(text);
        expect(realpathSync(path)).toBe(text);
        // The switched pinned launcher is preserved beside it.
        expect(pinnedTarget(`${path}.skills-alias-after-${result.receiptId}`)).toBe(text);
      }
      expect(JSON.parse(readFileSync(receiptPath, "utf8")).state).toBe("rolled-back");
      expect(existsSync(lock)).toBe(false);
      // The station is pre-pinned again, so a new adoption pins it again.
      expect(adoptCopyfileAliases({ homeDir: f.home, pathValue })).toMatchObject({ adopted: true, aliasCount: 14 });
    } finally { fixture.server.stop(true); }
  });

  test("runtime rollback after adopting pre-pinned symlinks: refused while they are pinned, exact through a newer update, complete after alias rollback", async () => {
    const f = fixtureHome();
    const first = await serverWithArtifact();
    const second = await serverWithArtifact({}, {}, name => `console.log("0.10.9 ${name}");`, "0.10.9");
    const lock = join(f.runtime, ".copyfile-update-lock");
    try {
      const pathValue = `${f.localBin}${delimiter}${f.bunBin}`;
      const original = launcherSnapshot(binPaths(f));
      const update = await updateCopyfileRuntime("0.10.8", { homeDir: f.home, pathValue, registryOrigin: first.server.url.origin });
      const targetRoot = join(f.runtime, "0.10.8-copyfile");
      const links = asPrePinnedRollout(targetRoot);
      const adopted = adoptCopyfileAliases({ homeDir: f.home, pathValue });
      expect(adopted).toMatchObject({ adopted: true, aliasCount: 14 });
      const pinned = launcherSnapshot(links.keys());
      // The 0.10.8 receipt records bare symlinks as its new state. While the adopted
      // pins replace them its rollback refuses, before any launcher moves.
      expect(() => rollbackCopyfileRuntime(String(update.receiptId), { homeDir: f.home })).toThrow("LAUNCHER_DRIFT_ROLLBACK_REFUSED");
      expect(launcherSnapshot(links.keys())).toEqual(pinned);
      expect(JSON.parse(readFileSync(join(targetRoot, "rollout-receipt.json"), "utf8")).state).toBe("switched");
      expect(existsSync(lock)).toBe(false);
      // A newer update records the adopted pins as its old state, and its rollback restores them byte for byte.
      const next = await updateCopyfileRuntime("0.10.9", { homeDir: f.home, pathValue, registryOrigin: second.server.url.origin });
      expect(next).toMatchObject({ updated: true, version: "0.10.9", currentVersion: "0.10.8", launcherCount: 14 });
      const nextReceipt = JSON.parse(readFileSync(join(f.runtime, "0.10.9-copyfile", "rollout-receipt.json"), "utf8"));
      for (const item of nextReceipt.launchers) {
        expect(item).toMatchObject({ oldShape: "pinned", oldTarget: links.get(item.path), oldCwd: targetRoot, oldSha256: createHash("sha256").update(pinned.get(item.path)!.text).digest("hex") });
      }
      expect(rollbackCopyfileRuntime(String(next.receiptId), { homeDir: f.home })).toMatchObject({ rolledBack: true, restoredVersion: "0.10.8", launcherCount: 14 });
      for (const [path, state] of pinned) expect(launcherSnapshot([path]).get(path)).toMatchObject({ symlink: false, text: state.text });
      // Undone in reverse order: the alias adoption, then the 0.10.8 rollout, back to the exact original links.
      expect(rollbackCopyfileAliases(String(adopted.receiptId), { homeDir: f.home, pathValue })).toMatchObject({ rolledBack: true, restoredAliasCount: 14 });
      for (const [path, text] of links) expect(readlinkSync(path)).toBe(text);
      expect(rollbackCopyfileRuntime(String(update.receiptId), { homeDir: f.home })).toMatchObject({ rolledBack: true, restoredVersion: "0.10.6", launcherCount: 14 });
      for (const [path, state] of original) {
        expect(state.symlink).toBe(true);
        expect(readlinkSync(path)).toBe(state.text);
        expect(realpathSync(path)).toBe(join(f.oldPackage, BIN[basename(path) as keyof typeof BIN]));
      }
      expect(existsSync(lock)).toBe(false);
    } finally { first.server.stop(true); second.server.stop(true); }
  });

  test("adopt-aliases still refuses chain-unsupported, foreign, unowned and unsafe launchers beside pre-pinned symlinks, and no refusal leaves a runtime lock", async () => {
    const f = fixtureHome();
    const fixture = await serverWithArtifact();
    const lock = join(f.runtime, ".copyfile-update-lock");
    try {
      await updateCopyfileRuntime("0.10.8", { homeDir: f.home, pathValue: `${f.localBin}${delimiter}${f.bunBin}`, registryOrigin: fixture.server.url.origin });
      const targetRoot = join(f.runtime, "0.10.8-copyfile");
      const links = asPrePinnedRollout(targetRoot);
      // ~/.bun/bin stays an alias directory but is left off PATH, so the runtime
      // layout check never sees the alias under test: adoption itself must refuse it.
      const pathValue = f.localBin;
      const alias = join(f.bunBin, "skills-mcp"), entry = links.get(alias)!;
      const replaceAlias = (make: (temp: string) => void) => {
        const temp = `${alias}.synthetic-${crypto.randomUUID()}`;
        make(temp);
        renameSync(temp, alias);
      };
      const restoreAlias = () => replaceAlias(temp => symlinkSync(entry, temp));
      const refuses = (error: string) => {
        expect(() => adoptCopyfileAliases({ homeDir: f.home, pathValue })).toThrow(error);
        for (const [path, text] of links) if (path !== alias) expect(readlinkSync(path)).toBe(text);
        expect([f.localBin, f.bunBin].flatMap(dir => readdirSync(dir).filter(name => name.includes(".skills-alias-")))).toEqual([]);
        expect(existsSync(join(targetRoot, "alias-adoptions"))).toBe(false);
        expect(existsSync(lock)).toBe(false);
      };
      // Chain-unsupported: the alias reaches the current entry through a second link.
      symlinkSync(entry, join(f.bunBin, ".synthetic-hop"));
      replaceAlias(temp => symlinkSync(".synthetic-hop", temp));
      expect(realpathSync(alias)).toBe(entry);
      refuses("ALIAS_LINK_CHAIN_UNSUPPORTED");
      expect(readlinkSync(alias)).toBe(".synthetic-hop");
      restoreAlias();
      // Foreign: a regular file that is not a managed pinned launcher.
      replaceAlias(temp => writeFileSync(temp, "#!/bin/sh\necho foreign\n", { mode: 0o755 }));
      refuses("ALIAS_LINK_NOT_OWNED");
      expect(readFileSync(alias, "utf8")).toBe("#!/bin/sh\necho foreign\n");
      restoreAlias();
      // Unowned: the alias itself belongs to another account (lstat reports another uid).
      const realLstat = nodeFs.lstatSync;
      const ownerSpy = spyOn(nodeFs, "lstatSync").mockImplementation(((path: nodeFs.PathLike, options?: nodeFs.StatSyncOptions) => {
        const stat = realLstat(path, options as undefined);
        if (String(path) !== alias || !stat) return stat;
        return new Proxy(stat, { get: (target, key) => {
          const value = Reflect.get(target, key, target);
          if (key === "uid") return (value as number) + 1;
          return typeof value === "function" ? value.bind(target) : value;
        } });
      }) as typeof nodeFs.lstatSync);
      try { refuses("ALIAS_LINK_NOT_OWNED"); } finally { ownerSpy.mockRestore(); }
      expect(readlinkSync(alias)).toBe(entry);
      // Unsafe or unwritable alias directory.
      for (const [mode, error] of [[0o775, "ALIAS_PATH_UNSAFE"], [0o777, "ALIAS_PATH_UNSAFE"], [0o500, "ALIAS_DIRECTORY_NOT_OWNED"]] as const) {
        chmodSync(f.bunBin, mode);
        try { refuses(error); } finally { chmodSync(f.bunBin, 0o700); }
      }
      // Pinned-shape refusals before the runtime lock is taken.
      const runtimeSpy = spyOn(launcherModule, "pinnedLauncherRuntime").mockImplementationOnce(() => { throw new Error("LAUNCHER_RUNTIME_UNSAFE"); });
      try { refuses("LAUNCHER_RUNTIME_UNSAFE"); } finally { runtimeSpy.mockRestore(); }
      const stateSpy = spyOn(launcherModule, "pinnedLauncherState").mockImplementationOnce(() => { throw new Error("LAUNCHER_CWD_PATH_INVALID"); });
      try { refuses("LAUNCHER_CWD_PATH_INVALID"); } finally { stateSpy.mockRestore(); }
      // A failure after the first switch restores every exact pre-pinned symlink.
      expect(() => adoptCopyfileAliases({ homeDir: f.home, pathValue, onAliasSwitched: () => { throw new Error("SYNTHETIC_POST_SWITCH_FAILURE"); } }))
        .toThrow("ALIAS_ADOPTION_ROLLED_BACK");
      for (const [path, text] of links) expect(readlinkSync(path)).toBe(text);
      const failed = readdirSync(join(targetRoot, "alias-adoptions")).filter(name => name.endsWith(".json"));
      expect(failed).toHaveLength(1);
      expect(JSON.parse(readFileSync(join(targetRoot, "alias-adoptions", failed[0]!), "utf8")).state).toBe("rolled-back");
      expect(existsSync(lock)).toBe(false);
      // With every cause removed, the same station is adopted.
      expect(adoptCopyfileAliases({ homeDir: f.home, pathValue })).toMatchObject({ adopted: true, aliasCount: 14 });
      for (const [path, text] of links) expect(pinnedTarget(path)).toBe(text);
      expect(existsSync(lock)).toBe(false);
    } finally { fixture.server.stop(true); }
  });

  test("streams registry responses under a hard byte cap", async () => {
    const response = new Response(new ReadableStream({
      start(controller) { controller.enqueue(new Uint8Array([1, 2, 3])); controller.enqueue(new Uint8Array([4, 5, 6])); controller.close(); },
    }));
    await expect(readBodyCapped(response, 4, "BODY_TOO_LARGE")).rejects.toThrow("BODY_TOO_LARGE");
  });

  test("bounds expanded tar bytes and refuses link or extended tar entry types before extraction", async () => {
    const archive = await new Bun.Archive({ "package/a": "small", "package/b": "small" }, { compress: "gzip" }).bytes();
    await expect(preflightTarball(archive, { maxEntries: 1 })).rejects.toThrow("TARBALL_ENTRY_COUNT_INVALID");
    await expect(preflightTarball(archive, { maxExpandedBytes: 512 })).rejects.toThrow("TARBALL_EXPANDED_SIZE_INVALID");

    const tar = new Uint8Array(1536);
    const header = tar.subarray(0, 512);
    header.set(new TextEncoder().encode("package/link"), 0);
    header.set(new TextEncoder().encode("0000644\0"), 100);
    header.set(new TextEncoder().encode("0000000\0"), 108);
    header.set(new TextEncoder().encode("0000000\0"), 116);
    header.set(new TextEncoder().encode("00000000000\0"), 124);
    header.set(new TextEncoder().encode("00000000000\0"), 136);
    header.fill(32, 148, 156);
    header[156] = "2".charCodeAt(0);
    header.set(new TextEncoder().encode("ustar\0"), 257);
    header.set(new TextEncoder().encode("00"), 263);
    const checksum = [...header].reduce((sum, byte) => sum + byte, 0).toString(8).padStart(6, "0");
    header.set(new TextEncoder().encode(`${checksum}\0 `), 148);
    await expect(preflightTarball(gzipSync(tar))).rejects.toThrow("TARBALL_ENTRY_TYPE_UNSUPPORTED");
  });
});

describe("target runtime activation prerequisites", () => {
  async function targetUpdate(version: string, options: Parameters<typeof updateCopyfileRuntime>[1]) {
    const prior = process.env.HASNA_SKILLS_DIR;
    process.env.HASNA_SKILLS_DIR = join(options!.homeDir!, ".hasna/skills");
    try { return await updateCopyfileRuntime(version, options); }
    finally { if (prior === undefined) delete process.env.HASNA_SKILLS_DIR; else process.env.HASNA_SKILLS_DIR = prior; }
  }

  const declaration = { version: 1, entry: "dist/runtime-prerequisites.js" };
  async function targetEntry() {
    const built = await Bun.build({ entrypoints: [join(import.meta.dir, "../../runtime-prerequisites.ts")], target: "bun" });
    if (!built.success) throw new Error("Synthetic target build failed");
    return built.outputs[0]!.text();
  }
  const sessionPreimages = new Map<string, { path: string; bytes: Buffer; inode: number }>();
  function assertSessionPreserved(f: ReturnType<typeof fixtureHome>) {
    const original = sessionPreimages.get(f.home)!;
    expect(readFileSync(original.path).equals(original.bytes)).toBe(true);
    expect(lstatSync(original.path).ino).toBe(original.inode);
  }
  function configure(f: ReturnType<typeof fixtureHome>, agents: string[]) {
    // An existing synthetic pin is outside runtime/config preimages. The
    // activation checker must leave it intact even when activation refuses.
    const sessionId = randomUUID();
    const path = join(f.home, ".hasna/skills/selection-cache/sessions", `${createHash("sha256").update(sessionId).digest("hex")}.json`);
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    writeFileSync(path, JSON.stringify({ sessionId, generation: 7, synthetic: true }), { mode: 0o600 });
    const original = { path, bytes: readFileSync(path), inode: lstatSync(path).ino };
    sessionPreimages.set(f.home, original);
    assertSessionPreserved(f);
    writeFileSync(join(f.home, ".hasna/skills/agent-policy.json"), JSON.stringify({ loading: "cli", bridge: { agents } }), { mode: 0o600 });
  }
  function preparedRefusal(f: ReturnType<typeof fixtureHome>, before: ReturnType<typeof launcherSnapshot>, code: string) {
    expect(launcherSnapshot(before.keys())).toEqual(before);
    assertSessionPreserved(f);
    expect(existsSync(join(f.runtime, `${prerequisiteTargetVersion}-copyfile`))).toBe(false);
    const stages = readdirSync(f.runtime).filter(name => name.startsWith(`.stage-${prerequisiteTargetVersion}-`));
    expect(stages).toHaveLength(1);
    const stage = join(f.runtime, stages[0]!);
    const receipt = JSON.parse(readFileSync(join(stage, "rollout-receipt.json"), "utf8"));
    expect(receipt).toMatchObject({ state: "prepared", targetVersion: prerequisiteTargetVersion, prerequisites: { status: "refused", code }, switchedLaunchers: [] });
    expect(receipt.tarballSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(receipt.packageTreeSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(createHash("sha256").update(readFileSync(join(stage, "preimage/manifest.json"))).digest("hex")).toBe(receipt.preimageSha256);
    for (const config of receipt.configs) if (config.present) {
      const original = readFileSync(join(stage, "preimage/configs", config.relativePath));
      expect(readFileSync(config.sourcePath)).toEqual(original);
      expect(createHash("sha256").update(original).digest("hex")).toBe(config.sha256);
    }
    expect(existsSync(join(f.runtime, ".copyfile-update-lock"))).toBe(false);
    expect(existsSync(f.oldPackage)).toBe(true);
    return receipt;
  }
  test.each(["missing", "invalid-schema", "stderr", "unsupported-config"])("prerequisite refusal preserves launchers, configuration and bound prepared receipt: %s", async mode => {
    const f = fixtureHome(); configure(f, ["sumi"]);
    const helperBin = installSumiPathsFixture(f.home);
    const helper = join(helperBin, "sumi-paths");
    if (mode === "missing") rmSync(helper);
    if (mode === "invalid-schema") writeFileSync(helper, `#!${process.execPath}\nconsole.log(JSON.stringify({schemaVersion:99}));\n`, { mode: 0o700 });
    if (mode === "stderr") writeFileSync(helper, `#!${process.execPath}\nconsole.error('synthetic diagnostic must not escape');\nprocess.exit(2);\n`, { mode: 0o700 });
    const fixture = await serverWithArtifact({}, {}, undefined, prerequisiteTargetVersion, { declaration, entry: await targetEntry() });
    const before = launcherSnapshot(binPaths(f));
    const previous = process.env.SUMI_CONFIG_CONTENT;
    try {
      if (mode === "unsupported-config") process.env.SUMI_CONFIG_CONTENT = "synthetic omitted content";
      const code = `RUNTIME_PREREQUISITE_REFUSED_${mode === "invalid-schema" ? "SUMI_PATH_RESOLVER_INVALID_RESPONSE" : mode === "unsupported-config" ? "SUMI_PATH_CONFIG_UNSUPPORTED" : "SUMI_PATH_RESOLVER_UNAVAILABLE"}`;
      await expect(targetUpdate(prerequisiteTargetVersion, { homeDir: f.home, cwd: f.home, pathValue: `${helperBin}${delimiter}${f.localBin}${delimiter}${f.bunBin}`, registryOrigin: fixture.server.url.origin })).rejects.toThrow(code);
      preparedRefusal(f, before, code);
    } finally {
      if (previous === undefined) delete process.env.SUMI_CONFIG_CONTENT; else process.env.SUMI_CONFIG_CONTENT = previous;
      fixture.server.stop(true);
    }
  });
  test.each(["missing-entry", "unknown-contract", "wrong-target", "invalid-response", "timeout"])("declared target prerequisite contract fails closed: %s", async mode => {
    const f = fixtureHome(); configure(f, ["claude"]);
    const fixture = await serverWithArtifact({}, {}, undefined, prerequisiteTargetVersion, {
      declaration: mode === "unknown-contract" ? { ...declaration, version: 2 } : declaration,
      entry: mode === "missing-entry" ? null : mode === "timeout" ? "await Bun.sleep(10000);" : mode === "wrong-target" ? 'console.log(JSON.stringify({schema:"skills.runtime-prerequisites.v1",targetVersion:"0.0.0",ok:true,checked:[],code:null}));'
        : mode === "invalid-response" ? 'console.log(JSON.stringify({synthetic:"unrecognized"}));' : await targetEntry(),
    });
    const before = launcherSnapshot(binPaths(f));
    const code = mode === "missing-entry" ? "RUNTIME_PREREQUISITE_ENTRY_MISSING" : mode === "unknown-contract" ? "RUNTIME_PREREQUISITE_CONTRACT_INVALID" : mode === "timeout" ? "RUNTIME_PREREQUISITE_CHECK_UNAVAILABLE" : "RUNTIME_PREREQUISITE_RESPONSE_INVALID";
    try {
      await expect(targetUpdate(prerequisiteTargetVersion, { homeDir: f.home, cwd: f.home, pathValue: `${f.localBin}${delimiter}${f.bunBin}`, registryOrigin: fixture.server.url.origin })).rejects.toThrow(code);
      preparedRefusal(f, before, code);
    } finally { fixture.server.stop(true); }
  });
  test("target reader preserves relative Sumi selectors instead of testing conflicting defaults", async () => {
    const f = fixtureHome(); configure(f, ["sumi"]);
    for (const path of [join(f.home, ".hasna-internal/sumi/config"), join(f.home, ".config/sumi"), join(f.home, "selected-config")]) mkdirSync(path, { recursive: true, mode: 0o700 });
    const helperBin = installSumiPathsFixture(f.home);
    const fixture = await serverWithArtifact({}, {}, undefined, prerequisiteTargetVersion, { declaration, entry: await targetEntry() });
    const prior = process.env.SUMI_CONFIG_DIR;
    try {
      process.env.SUMI_CONFIG_DIR = "selected-config";
      const result = await targetUpdate(prerequisiteTargetVersion, { homeDir: f.home, cwd: f.home, pathValue: `${helperBin}${delimiter}${f.localBin}${delimiter}${f.bunBin}`, registryOrigin: fixture.server.url.origin });
      expect(result.prerequisites).toMatchObject({ status: "verified", checked: ["sumi-paths"] });
      assertSessionPreserved(f);
      expect(rollbackCopyfileRuntime(String(result.receiptId), { homeDir: f.home })).toMatchObject({ rolledBack: true });
      assertSessionPreserved(f);
    } finally {
      if (prior === undefined) delete process.env.SUMI_CONFIG_DIR; else process.env.SUMI_CONFIG_DIR = prior;
      fixture.server.stop(true);
    }
  });
  test.each([true, false])("target entry verifies only applicable consumers (Sumi=%s), preserving rollback", async sumi => {
    const f = fixtureHome(); configure(f, sumi ? ["sumi"] : ["claude"]);
    const helperBin = sumi ? installSumiPathsFixture(f.home) : f.localBin;
    const fixture = await serverWithArtifact({}, {}, undefined, prerequisiteTargetVersion, { declaration, entry: await targetEntry() });
    const before = launcherSnapshot(binPaths(f));
    try {
      const result = await targetUpdate(prerequisiteTargetVersion, { homeDir: f.home, cwd: f.home, pathValue: `${helperBin}${delimiter}${f.localBin}${delimiter}${f.bunBin}`, registryOrigin: fixture.server.url.origin });
      const receipt = JSON.parse(readFileSync(join(f.runtime, `${prerequisiteTargetVersion}-copyfile/rollout-receipt.json`), "utf8"));
      expect(receipt.prerequisites).toMatchObject({ status: "verified", schema: "skills.runtime-prerequisites.v1", targetVersion: prerequisiteTargetVersion, entry: declaration.entry, checked: sumi ? ["sumi-paths"] : [] });
      expect(receipt.prerequisites.entrySha256).toBe(createHash("sha256").update(readFileSync(join(receipt.targetPackageRoot, declaration.entry))).digest("hex"));
      for (const config of receipt.configs) if (config.present) expect(readFileSync(config.sourcePath)).toEqual(readFileSync(join(f.runtime, `${prerequisiteTargetVersion}-copyfile/preimage/configs`, config.relativePath)));
      assertSessionPreserved(f);
      expect(rollbackCopyfileRuntime(String(result.receiptId), { homeDir: f.home })).toMatchObject({ rolledBack: true });
      assertSessionPreserved(f);
      for (const [path, old] of before) {
        expect(readlinkSync(path)).toBe(old.text);
        expect(launcherTarget(path)).toBe(join(f.oldPackage, BIN[basename(path) as keyof typeof BIN]));
      }
    } finally { fixture.server.stop(true); }
  });
});
