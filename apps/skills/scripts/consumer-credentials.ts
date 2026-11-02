#!/usr/bin/env bun
import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

// Exercise the published credential provider from an ordinary production-only
// install. @hasna/secrets is restricted on npm and is not in the published
// install closure, so the consumer tree has no Secrets SDK: a vault pointer must
// complete through the installed `secrets` CLI, here a stand-in that checks its
// exact argv. Only registry installation uses the network; the child intercepts
// every application request and subprocess and uses synthetic credentials in a
// private test HOME.
const root = resolve(import.meta.dir, "..");
const workspace = await mkdtemp(join(tmpdir(), "skills-consumer-credentials-"));
await chmod(workspace, 0o700);
for (let parent = dirname(workspace); ; parent = dirname(parent)) {
  assert(!existsSync(join(parent, "node_modules/@hasna/secrets")), "Consumer fixture has an ambient Secrets package ancestor");
  if (dirname(parent) === parent) break;
}
const managerHome = join(workspace, "manager-home");
const home = join(workspace, "home");
await mkdir(managerHome, { mode: 0o700 });
await mkdir(home, { mode: 0o700 });
const npmExecutable = Bun.which("npm"), nodeExecutable = Bun.which("node");
assert(npmExecutable && nodeExecutable, "Consumer proof requires the selected npm and Node toolchain");
const toolDirectories = new Set([dirname(process.execPath), dirname(npmExecutable), dirname(nodeExecutable)]);
const toolPath = [...new Set([...(process.env.PATH ?? "").split(":").filter(path => toolDirectories.has(resolve(path))),
  ...toolDirectories, "/usr/bin", "/bin"])].join(":");
const env = { PATH: toolPath, HOME: managerHome,
  TMPDIR: workspace, NO_COLOR: "1", BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0",
  BUN_INSTALL_CACHE_DIR: join(workspace, "package-cache"),
  NPM_CONFIG_CACHE: join(workspace, "npm-cache"),
  NPM_CONFIG_USERCONFIG: join(workspace, "user.npmrc"),
  NPM_CONFIG_GLOBALCONFIG: join(workspace, "global.npmrc") };
await writeFile(env.NPM_CONFIG_USERCONFIG, "registry=https://registry.npmjs.org/\n", { mode: 0o600 });
await writeFile(env.NPM_CONFIG_GLOBALCONFIG, "", { mode: 0o600 });

async function run(command: string[], cwd: string, childEnv: Record<string, string>, limitMs = 120_000) {
  const child = Bun.spawn(command, { cwd, env: childEnv, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  let captured = 0, refused = false;
  const stop = () => { if (child.exitCode === null) child.kill("SIGKILL"); };
  const timer = setTimeout(() => { refused = true; stop(); }, limitMs);
  const read = async (stream: ReadableStream<Uint8Array>) => {
    const chunks: Uint8Array[] = [];
    for await (const chunk of stream) {
      captured += chunk.length;
      if (captured > 64 * 1024) { refused = true; stop(); break; }
      chunks.push(chunk);
    }
    return Buffer.concat(chunks).toString("utf8");
  };
  try {
    const [stdout, stderr, status] = await Promise.all([read(child.stdout), read(child.stderr), child.exited]);
    assert(!refused, "Consumer credential child exceeded its time or output budget");
    return { stdout, stderr, status };
  } finally { clearTimeout(timer); stop(); await child.exited; }
}

try {
  let archive = process.argv[2] ? resolve(process.argv[2]) : "";
  if (!archive) {
    const packed = await run([npmExecutable, "pack", "--ignore-scripts", "--json", "--pack-destination", workspace], root, env);
    assert.equal(packed.status, 0, "Consumer credential npm pack failed");
    const rows = JSON.parse(packed.stdout);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].filename, `hasna-skills-${rows[0].version}.tgz`);
    archive = join(workspace, rows[0].filename);
  }
  await writeFile(join(workspace, "package.json"), JSON.stringify({ private: true,
    dependencies: { "@hasna/skills": `file:${archive}` } }));
  const bunfig = join(workspace, "bunfig.toml");
  // Exact Hasna package names are publisher-exempt; unrelated packages retain the seven-day gate.
  await writeFile(bunfig, `[install]\nregistry = "https://registry.npmjs.org"\nminimumReleaseAge = 604800\nminimumReleaseAgeExcludes = ["@hasna/skills", "@hasna/contracts", "@hasna/events", "@hasna/secrets"]\n`);
  const installed = await run([process.execPath, "--no-env-file", "install", "--production", "--ignore-scripts",
    "--backend=copyfile", "--linker=hoisted", `--config=${bunfig}`], workspace, env);
  assert.equal(installed.status, 0, "Production-only consumer installation failed");
  const packageRoot = join(workspace, "node_modules/@hasna/skills");
  const installedMetadata = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
  const credentialDirectory = join(home, ".hasna/skills/config");
  await mkdir(credentialDirectory, { recursive: true, mode: 0o700 });
  const credentialFile = join(credentialDirectory, "credentials-consumer-proof");
  const credentialBytes = "HASNA_SKILLS_API_URL=https://skills.example.test\nHASNA_SKILLS_API_KEY_REF=fixture/skills/api-key\n";
  await writeFile(credentialFile, credentialBytes, { mode: 0o600 });
  const preload = join(workspace, "provider-fixture.js");
  await writeFile(preload, `import { appendFileSync } from "node:fs";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
const record = (operation) => appendFileSync(process.env.CREDENTIAL_PROOF_JOURNAL, JSON.stringify({ operation }) + "\\n");
const refuse = (reason) => { record("unexpected:" + reason); throw new Error("Consumer fixture refused " + reason); };
const refuseProcess = () => refuse("subprocess, including Keychain access");
// The one subprocess allowed: the stand-in Secrets CLI, with exactly the documented read.
const spawn = Bun.spawn;
Bun.spawn = (command, options) => {
  const argv = Array.isArray(command) ? command : command?.cmd;
  if (!Array.isArray(argv) || argv[0] !== process.env.CREDENTIAL_PROOF_CLI
      || JSON.stringify(argv.slice(1)) !== JSON.stringify(["get", "fixture/skills/api-key", "--plaintext"])) return refuseProcess();
  return spawn(command, options);
};
Bun.spawnSync = refuseProcess;
for (const method of ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"]) childProcess[method] = refuseProcess;
syncBuiltinESMExports();
const fetchEmbedded = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const request = new Request(input, init);
  const url = new URL(request.url);
  if (request.method !== "GET") return refuse("application mutation");
  // Ink's bundled Yoga module loads its embedded WASM through fetch(data:).
  // This is a bounded in-memory resource, never an application/network call.
  if (url.protocol === "data:") {
    if (!url.href.startsWith("data:application/octet-stream;base64,") || url.href.length > 1024 * 1024
        || request.headers.has("authorization") || request.headers.has("x-api-key")) return refuse("embedded resource");
    record("embedded-resource");
    return fetchEmbedded(request);
  }
  if (url.origin !== "https://skills.example.test" || url.search) return refuse("application authority");
  if (request.headers.get("authorization") !== "Bearer " + process.env.CREDENTIAL_PROOF_VALUE) return refuse("Skills credential or fallback");
  if (url.pathname === "/api/auth/whoami") {
    record("identity");
    return Response.json({ user: { id: "fixture-user", email: "owner@example.test", role: "owner" },
      organization: { id: "fixture-workspace", slug: "fixture", name: "Fixture" } });
  }
  if (url.pathname === "/api/v1/capabilities") {
    record("capabilities");
    return Response.json({ contractVersion: 1, apiVersion: 1, capabilities: ["skills.registry"],
      scopes: ["skills:read"], permissions: { publish: false, profilesWrite: false } });
  }
  return refuse("application route");
};\n`, { mode: 0o600 });
  // The stand-in `secrets` CLI. It records the read and the NAMES of its environment, and prints the value.
  const cliDirectory = join(workspace, "secrets-cli");
  await mkdir(cliDirectory, { mode: 0o700 });
  const cliPath = join(cliDirectory, "secrets"), cliEnvNames = join(workspace, "secrets-cli-env-names");
  await writeFile(cliPath, `#!/bin/sh
[ "$#" = 3 ] && [ "$1" = get ] && [ "$2" = fixture/skills/api-key ] && [ "$3" = --plaintext ] || exit 64
printf '{"operation":"vault-cli-get"}\\n' >> "$CREDENTIAL_PROOF_JOURNAL"
/usr/bin/env | /usr/bin/cut -d= -f1 | /usr/bin/sort > "${cliEnvNames}"
[ "$CREDENTIAL_PROOF_DENY" = 1 ] && exit 1
printf '%s' "$CREDENTIAL_PROOF_VALUE"
`, { mode: 0o700 });
  await chmod(cliPath, 0o700);
  const bootstrap = randomUUID(), secret = randomUUID(), staleLiteral = randomUUID();
  const childEnv = { ...env, PATH: `${cliDirectory}:${env.PATH}`, CREDENTIAL_PROOF_CLI: cliPath, HOME: home, HASNA_HOME: join(home, ".hasna"), HASNA_PROFILE: "consumer-proof",
    HASNA_SKILLS_API_URL: "https://skills.example.test", HASNA_SECRETS_API_URL: "https://vault.example.test",
    HASNA_SECRETS_API_KEY_OVERRIDE: bootstrap, HASNA_SKILLS_API_KEY: staleLiteral,
    CREDENTIAL_PROOF_BOOTSTRAP: bootstrap, CREDENTIAL_PROOF_VALUE: secret,
    CREDENTIAL_PROOF_JOURNAL: join(workspace, "requests.jsonl") };
  const runCase = async (name: string, success: boolean, expectedRequests: string[], overrides: Record<string, string> = {}) => {
    await writeFile(childEnv.CREDENTIAL_PROOF_JOURNAL, "", { mode: 0o600 });
    const result = await run([process.execPath, "--no-env-file", "--no-install", "--preload", preload,
      join(packageRoot, "bin/index.js"), "auth", "whoami", "--json"], workspace, { ...childEnv, ...overrides }, 20_000);
    for (const value of [bootstrap, secret, staleLiteral, "fixture/skills/api-key", overrides.CREDENTIAL_PROOF_VALUE].filter(Boolean))
      assert(!(result.stdout + result.stderr).includes(value!), "Consumer exposed a synthetic credential");
    assert.equal(result.stderr, "", `${name}: unexpected stderr`);
    const payload = JSON.parse(result.stdout);
    assert.equal(result.status, success ? 0 : 1, `${name}: incorrect exit status (${payload.code ?? "no code"})`);
    if (success) {
      assert.equal(payload.status, "authenticated", `${name}: provider did not authenticate`);
      assert.equal(payload.userId, "fixture-user");
      assert.equal(payload.orgId, "fixture-workspace");
      assert.equal(payload.authSource, credentialFile);
    } else assert.equal(payload.code, "MISSING_API_CREDENTIAL", `${name}: incorrect terminal refusal`);
    const journal = (await readFile(childEnv.CREDENTIAL_PROOF_JOURNAL, "utf8")).trim();
    const operations: string[] = journal ? journal.split("\n").map(line => JSON.parse(line).operation) : [];
    assert(operations.filter(operation => operation === "embedded-resource").length <= 1, "Unexpected embedded resource count");
    assert.deepEqual(operations.filter(operation => operation !== "embedded-resource"), expectedRequests,
      `${name}: incorrect provider request sequence`);
    assert.equal(await readFile(credentialFile, "utf8"), credentialBytes, `${name}: credential file changed`);
    if (operations.includes("vault-cli-get")) {
      const caseEnv: Record<string, string> = { ...childEnv, ...overrides };
      const names = (await readFile(cliEnvNames, "utf8")).trim().split("\n");
      assert.deepEqual(names.filter(entry => !(entry in caseEnv) && !["PWD", "SHLVL", "_", "OLDPWD"].includes(entry)), [],
        `${name}: the Secrets CLI received an environment variable the caller did not set`);
      await rm(cliEnvNames);
    }
    console.log(`PASS ${name}`);
  };
  await runCase("an unconfigured named profile refuses without native credentials or network", false, [],
    { HASNA_PROFILE: "unconfigured-proof", HASNA_SKILLS_API_KEY: "" });
  // The published install closure carries no Secrets SDK, anywhere in the consumer tree.
  assert(!Object.hasOwn(installedMetadata.dependencies ?? {}, "@hasna/secrets") && !Object.hasOwn(installedMetadata.optionalDependencies ?? {}, "@hasna/secrets")
    && !Object.hasOwn(installedMetadata.peerDependencies ?? {}, "@hasna/secrets"), "The published manifest must not install @hasna/secrets");
  for (const location of [join(workspace, "node_modules/@hasna/secrets"), join(packageRoot, "node_modules/@hasna/secrets")])
    assert(!existsSync(location), "The production consumer tree must not contain @hasna/secrets");
  await runCase("production install resolves the credential-file vault pointer through the secrets CLI", true, ["vault-cli-get", "identity", "capabilities"]);
  await runCase("a rotated vault value is resolved on the next invocation", true, ["vault-cli-get", "identity", "capabilities"],
    { CREDENTIAL_PROOF_VALUE: randomUUID() });
  await runCase("vault denial never uses a competing literal credential", false, ["vault-cli-get"], { CREDENTIAL_PROOF_DENY: "1" });
  await rename(cliDirectory, join(workspace, "held-secrets-cli"));
  // The toolchain directory can hold the station's real `secrets`; the terminal case needs a PATH with none.
  const noCliPath = "/usr/bin:/bin";
  assert.equal(Bun.which("secrets", { PATH: noCliPath }), null, "The terminal case needs a PATH without a secrets CLI");
  await runCase("an unavailable secrets CLI remains terminal", false, [], { PATH: noCliPath });
  console.log("Verified packed production-only Skills credential provider: no Secrets SDK installed, pointer completed through the secrets CLI; no live credentials or application requests used.");
} finally { await rm(workspace, { recursive: true, force: true }); }
