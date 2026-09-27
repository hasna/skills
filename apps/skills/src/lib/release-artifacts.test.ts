import { expect, test } from "bun:test";
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
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

releaseArtifactTest("two clean builds produce byte-identical npm packs and an isolated production install resolves vault credentials", () => {
  expect(npmExecutable).not.toBeNull();
  expect(nodeExecutable).not.toBeNull();
  const scratch = mkdtempSync(join(tmpdir(), "skills-release-artifact-"));
  chmodSync(scratch, 0o700);
  try {
    const producer = join(scratch, "producer");
    const excludedRoots = new Set(["bin", "dist", "node_modules", ".turbo"]);
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
    run([process.execPath, "--no-env-file", "run", "verify:producer"], producer, env);

    const firstPackDir = join(scratch, "pack-one");
    const secondPackDir = join(scratch, "pack-two");
    mkdirSync(firstPackDir, { mode: 0o700 });
    mkdirSync(secondPackDir, { mode: 0o700 });
    run([process.execPath, "--no-env-file", "run", "build"], producer, env);
    const firstArchive = packInto(firstPackDir, producer, env);
    run([process.execPath, "--no-env-file", "run", "build"], producer, env);
    const secondArchive = packInto(secondPackDir, producer, env);
    expect(sha256(secondArchive)).toBe(sha256(firstArchive));

    const consumerProof = run([process.execPath, "--no-env-file", join(producer, "scripts/consumer-credentials.ts"), secondArchive], producer, env);
    expect(consumerProof.split("\n").filter(line => line.startsWith("PASS "))).toHaveLength(5);

    // The outer npm pack ships these exact standalone-lock artifacts. Promote
    // only after reproducibility AND every installed-consumer check succeeds;
    // a failing credential or isolation proof leaves existing outputs intact.
    for (const directory of ["bin", "dist"]) {
      rmSync(join(packageRoot, directory), { recursive: true, force: true });
      cpSync(join(producer, directory), join(packageRoot, directory), { recursive: true });
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}, 300_000);
