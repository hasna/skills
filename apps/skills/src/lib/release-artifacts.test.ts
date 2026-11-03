import { expect, test } from "bun:test";
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { builtinModules } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";

import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();

const releaseArtifactTest = process.env.HASNA_SKILLS_RELEASE_ARTIFACT_TEST === "1" ? test : test.skip;
const packageRoot = resolve(import.meta.dir, "../..");
// Keep the exact CI-selected npm/Node toolchain while excluding ambient app configuration.
const npmExecutable = Bun.which("npm"), nodeExecutable = Bun.which("node");

function run(command: string[], cwd: string, env: Record<string, string>): string {
  const result = Bun.spawnSync(command, {
    cwd, env, stdin: "ignore", stdout: "pipe", stderr: "pipe", timeout: 120_000,
  });
  if (result.exitCode !== 0) {
    throw new Error(`${command.join(" ")} failed (${result.exitCode})\n${result.stdout.toString()}\n${result.stderr.toString()}`);
  }
  return result.stdout.toString();
}

function packInto(directory: string, producerRoot: string, env: Record<string, string>): string {
  const raw = run(
    [npmExecutable!, "pack", "--ignore-scripts", "--json", "--pack-destination", directory],
    producerRoot,
    { ...env, npm_config_ignore_scripts: "true", npm_config_dry_run: "false" },
  );
  const manifest = JSON.parse(raw) as Array<{ filename: string; version: string }>;
  expect(manifest).toHaveLength(1);
  expect(manifest[0]!.filename).toBe(`hasna-skills-${manifest[0]!.version}.tgz`);
  return join(directory, manifest[0]!.filename);
}

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function assertBundledSurfaces(producerRoot: string): void {
  const builtins = new Set([...builtinModules, ...builtinModules.map(name => `node:${name}`), "bun", "bun:sqlite"]);
  const scanner = new Bun.Transpiler({ loader: "js" });
  // bin/mcp.js bundles everything except the MCP SDK, zod included; its
  // tools/list converts schemas with that bundled zod (mcp/package-tool-list.ts).
  // The optional, private @hasna/secrets stays external (SH-00058) and is only
  // ever loaded lazily, by a dynamic import of its SDK entry.
  const lazySecrets = (entry: { path: string; kind: string }) => entry.kind === "dynamic-import" && entry.path === "@hasna/secrets/sdk";
  for (const file of ["dist/index.js", "dist/storage.js", "dist/sdk/index.js", "dist/admin-contract.js", "dist/runtime-prerequisites.js", "bin/mcp.js"]) {
    const imports = scanner.scanImports(readFileSync(join(producerRoot, file), "utf8").replace(/^#!.*\n/, ""));
    expect(imports.filter(entry => !builtins.has(entry.path) && !lazySecrets(entry) && !(file === "bin/mcp.js" &&
      (entry.path === "@modelcontextprotocol/sdk" || entry.path.startsWith("@modelcontextprotocol/sdk/"))))).toEqual([]);
  }
  expect(scanner.scanImports('import { KernelLock } from "@hasna/contracts/kernel-lock";')
    .filter(entry => !builtins.has(entry.path))).toHaveLength(1);
  expect(scanner.scanImports('import "@hasna/secrets"; await import("@hasna/secrets/sdk");').map(lazySecrets)).toEqual([false, true]);
  for (const directory of ["bin", "dist"]) {
    for (const entry of readdirSync(join(producerRoot, directory), { recursive: true }) as string[]) {
      if (!entry.endsWith(".js")) continue;
      const imports = scanner.scanImports(readFileSync(join(producerRoot, directory, entry), "utf8").replace(/^#!.*\n/, ""));
      expect(imports.filter(item => (item.path === "@hasna/secrets" || item.path.startsWith("@hasna/secrets/")) && !lazySecrets(item))
        .map(item => `${directory}/${entry} ${item.kind} ${item.path}`)).toEqual([]);
    }
  }
  const scratch = mkdtempSync(join(tmpdir(), "skills-bundled-sdk-consumer-"));
  chmodSync(scratch, 0o700);
  try {
    cpSync(join(producerRoot, "dist"), join(scratch, "dist"), { recursive: true });
    cpSync(join(producerRoot, "native"), join(scratch, "native"), { recursive: true });
    const home = join(scratch, "home"); mkdirSync(home, { mode: 0o700 });
    writeFileSync(join(scratch, "package.json"), '{"private":true,"type":"module"}');
    const program = 'import assert from "node:assert/strict"; const sdk = await import("./dist/sdk/index.js"); const api = await import("./dist/index.js"); assert.equal(typeof sdk.HttpProfileClient, "function"); assert.equal(typeof api.inspectSkillSession, "function"); console.log("Dependency-free SDK consumer passed.");';
    expect(run([process.execPath, "--no-env-file", "--no-install", "--eval", program], scratch,
      { HOME: home, TMPDIR: scratch, PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0" }))
      .toContain("Dependency-free SDK consumer passed.");
  } finally { rmSync(scratch, { recursive: true, force: true }); }
}

releaseArtifactTest("two clean builds produce byte-identical npm packs and an isolated production install resolves vault credentials", async () => {
  expect(npmExecutable).not.toBeNull();
  expect(nodeExecutable).not.toBeNull();
  const scratch = mkdtempSync(join(tmpdir(), "skills-release-artifact-"));
  chmodSync(scratch, 0o700);
  try {
    const producer = join(scratch, "producer");
    const excludedRoots = new Set(["bin", "dist", "native", "node_modules", ".turbo", "THIRD_PARTY_NOTICES"]);
    cpSync(packageRoot, producer, {
      recursive: true,
      filter(source) {
        const rel = relative(packageRoot, source);
        if (!rel) return true;
        return !excludedRoots.has(rel.split(sep)[0]!) && !rel.endsWith(".tgz");
      },
    });
    const producerHome = join(scratch, "producer-home");
    mkdirSync(producerHome, { mode: 0o700 });
    // No ambient profile, credentials, registry configuration or application
    // endpoint reaches install/build/pack. The nested consumer fixture likewise
    // isolates its HOME, refuses all subprocesses (including macOS Keychain),
    // and journals intercepted application requests with synthetic credentials.
    const toolDirectories = new Set([dirname(process.execPath), dirname(npmExecutable!), dirname(nodeExecutable!)]);
    const env = {
      PATH: [...new Set([...(process.env.PATH ?? "").split(":").filter(path => toolDirectories.has(resolve(path))),
        ...toolDirectories, "/usr/bin", "/bin"])].join(":"), HOME: producerHome,
      TMPDIR: scratch, NO_COLOR: "1", BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0",
      BUN_INSTALL_CACHE_DIR: join(scratch, "producer-cache"),
      NPM_CONFIG_CACHE: join(scratch, "npm-cache"),
      NPM_CONFIG_USERCONFIG: join(scratch, "user.npmrc"),
      NPM_CONFIG_GLOBALCONFIG: join(scratch, "global.npmrc"),
    };
    writeFileSync(env.NPM_CONFIG_USERCONFIG, "registry=https://registry.npmjs.org/\n", { mode: 0o600 });
    writeFileSync(env.NPM_CONFIG_GLOBALCONFIG, "", { mode: 0o600 });
    const bunfig = join(scratch, "install.bunfig.toml");
    writeFileSync(bunfig, '[install]\nregistry = "https://registry.npmjs.org"\n', { mode: 0o600 });
    const lockHash = sha256(join(producer, "bun.lock"));
    run([process.execPath, "--no-env-file", "install", "--frozen-lockfile", "--ignore-scripts", `--config=${bunfig}`], producer, env);
    expect(sha256(join(producer, "bun.lock"))).toBe(lockHash);
    // The registry refuses the optional, private @hasna/secrets anonymously
    // (SH-00058), and the build inlines its client. Place the exact locked
    // tarball the CI install step fetched, checked against bun.lock.
    const { privatePackageOverrides } = await import(join(packageRoot, "scripts/private-package-overrides.ts"));
    const { integrityOf, lockedTarball, PRIVATE_PACKAGES } = await import(join(packageRoot, "scripts/fetch-locked-private.mjs"));
    const privateTarballs = privatePackageOverrides() as Record<string, string>;
    expect(Object.keys(privateTarballs)).toEqual(PRIVATE_PACKAGES);
    for (const [name, specifier] of Object.entries(privateTarballs)) {
      const tarball = specifier.slice("file:".length);
      expect(integrityOf(readFileSync(tarball))).toBe(lockedTarball(readFileSync(join(producer, "bun.lock"), "utf8"), name).integrity);
      mkdirSync(join(producer, "node_modules", name), { recursive: true });
      run(["tar", "-xzf", tarball, "-C", join(producer, "node_modules", name), "--strip-components=1"], producer, env);
    }
    run([process.execPath, "--no-env-file", "run", "verify:producer"], producer, env);

    const firstPackDir = join(scratch, "pack-one");
    const secondPackDir = join(scratch, "pack-two");
    mkdirSync(firstPackDir, { mode: 0o700 });
    mkdirSync(secondPackDir, { mode: 0o700 });
    run([process.execPath, "--no-env-file", "run", "build"], producer, env);
    assertBundledSurfaces(producer);
    const firstArchive = packInto(firstPackDir, producer, env);
    run([process.execPath, "--no-env-file", "run", "build"], producer, env);
    const secondArchive = packInto(secondPackDir, producer, env);
    expect(sha256(secondArchive)).toBe(sha256(firstArchive));

    const consumerProof = run([process.execPath, "--no-env-file", join(producer, "scripts/consumer-credentials.ts"), secondArchive], producer,
      { ...env, SKILLS_PRIVATE_TARBALLS: process.env.SKILLS_PRIVATE_TARBALLS ?? "" });
    expect(consumerProof.split("\n").filter(line => line.startsWith("PASS "))).toHaveLength(6);
    const anonymousProof = run([process.execPath, "--no-env-file", join(producer, "scripts/consumer-anonymous.ts"), secondArchive], producer, env);
    expect(anonymousProof.split("\n").filter(line => line.startsWith("PASS "))).toHaveLength(5);

    // The outer npm pack ships these exact standalone-lock artifacts. Promote
    // only after reproducibility AND every installed-consumer check succeeds;
    // a failing credential or isolation proof leaves existing outputs intact.
    for (const directory of ["bin", "dist", "native", "THIRD_PARTY_NOTICES"]) {
      rmSync(join(packageRoot, directory), { recursive: true, force: true });
      cpSync(join(producer, directory), join(packageRoot, directory), { recursive: true });
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}, 300_000);
