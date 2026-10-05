import { afterEach, describe, expect, test } from "bun:test";
import { Command } from "commander";
import { registerRuntime } from "./runtime.js";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, readdirSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { basename, delimiter, join, relative } from "node:path";
import { tmpdir } from "node:os";
import { adoptCopyfileAliases, preflightTarball, readBodyCapped, rollbackCopyfileAliases, rollbackCopyfileRuntime, updateCopyfileRuntime } from "./runtime-copyfile.js";
import { useDefaultTestTimeout } from "../../test-preload.js";

useDefaultTestTimeout();

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

async function serverWithArtifact(dependencies: Record<string, string> = {}) {
  const artifact = await new Bun.Archive({
    "package/package.json": JSON.stringify({ name: "@hasna/skills", version: "0.10.8", bin: BIN, dependencies }),
    "package/README.md": "Synthetic package fixture.\n",
    ...Object.fromEntries(Object.entries(BIN).map(([name, file]) => [`package/${file}`, `#!/usr/bin/env bun\nconsole.log("0.10.8 ${name}");\n`])),
  }, { compress: "gzip" }).bytes();
  const integrity = `sha512-${createHash("sha512").update(artifact).digest("base64")}`;
  let server: ReturnType<typeof Bun.serve>;
  server = Bun.serve({
    port: 0,
    fetch(request) {
      const url = new URL(request.url);
      if (url.pathname.endsWith("/0.10.8")) return Response.json({
        _id: "@hasna/skills@0.10.8", name: "@hasna/skills", version: "0.10.8",
        dist: { integrity, tarball: `${server.url.origin}/skills-0.10.8.tgz` },
      });
      if (url.pathname === "/skills-0.10.8.tgz") return new Response(artifact);
      return new Response("not found", { status: 404 });
    },
  });
  return { server, artifact, integrity };
}

describe("exact-version copyfile runtime update", () => {
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
      expect(commands.filter((command: string) => ["ci", "ls", "install"].includes(command))).toEqual(["ci", "ls"]);
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
      expect(realpathSync(join(f.localBin, "skills"))).toBe(join(packageRoot, BIN.skills));
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
      expect(realpathSync(join(f.localBin, "skills"))).toBe(join(targetRoot, "node_modules", "@hasna", "skills", BIN.skills));
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
      expect(result).toMatchObject({ updated: true, version: "0.10.8", currentVersion: "0.10.6", launcherCount: 21, configCount: 4, tarballIntegrity: integrity });
      const targetRoot = join(f.runtime, "0.10.8-copyfile");
      const targetPackage = join(targetRoot, "node_modules", "@hasna", "skills");
      const nodeModulesRoot = join(targetRoot, "node_modules");
      expect(realpathSync(join(f.localBin, "skills"))).toBe(join(targetPackage, BIN.skills));
      expect(realpathSync(join(f.bunBin, "skills"))).toBe(join(targetPackage, BIN.skills));
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
      symlinkSync(partiallyRolled.newTarget, afterPath);
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
      expect(realpathSync(join(f.localBin, "skills"))).toBe(join(f.runtime, "0.10.8-copyfile", "node_modules", "@hasna", "skills", BIN.skills));
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
        expect(realpathSync(item.path)).toBe(item.newTarget);
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
      expect(realpathSync(alias)).toBe(receipt.aliases[0].newTarget);
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
      expect(realpathSync(first)).toBe(receipt.aliases[0].newTarget);
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
