#!/usr/bin/env bun
import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

// Exercise the published credential provider from an ordinary production-only
// install. A successful CLI/SDK import cannot prove lazy vault-pointer loading.
// Only registry installation uses the network; the child intercepts every
// application request and uses synthetic credentials in a private test HOME.
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
  await writeFile(bunfig, `[install]\nregistry = "https://registry.npmjs.org"\nminimumReleaseAge = 604800\nminimumReleaseAgeExcludes = ["@hasna/skills", "@hasna/secrets"]\n`);
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
Bun.spawn = refuseProcess; Bun.spawnSync = refuseProcess;
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
  if (url.origin === "https://vault.example.test" && url.pathname === "/v1/secrets/get"
      && url.searchParams.get("key") === "fixture/skills/api-key") {
    if (request.headers.get("authorization") !== "Bearer " + process.env.CREDENTIAL_PROOF_BOOTSTRAP) return refuse("vault bootstrap");
    record("vault-get");
    return Response.json(process.env.CREDENTIAL_PROOF_DENY === "1" ? { error: "fixture denied" }
      : { value: process.env.CREDENTIAL_PROOF_VALUE }, { status: process.env.CREDENTIAL_PROOF_DENY === "1" ? 403 : 200 });
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
  const bootstrap = randomUUID(), secret = randomUUID(), staleLiteral = randomUUID();
  const childEnv = { ...env, HOME: home, HASNA_HOME: join(home, ".hasna"), HASNA_PROFILE: "consumer-proof",
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
    console.log(`PASS ${name}`);
  };
  await runCase("an unconfigured named profile refuses without native credentials or network", false, [],
    { HASNA_PROFILE: "unconfigured-proof", HASNA_SKILLS_API_KEY: "" });
  await runCase("production install resolves the credential-file vault pointer", true, ["vault-get", "identity", "capabilities"]);
  await runCase("a rotated vault value is resolved on the next invocation", true, ["vault-get", "identity", "capabilities"],
    { CREDENTIAL_PROOF_VALUE: randomUUID() });
  await runCase("vault denial never uses a competing literal credential", false, ["vault-get"], { CREDENTIAL_PROOF_DENY: "1" });
  const secretsDirectory = join(workspace, "node_modules/@hasna/secrets");
  const providerPath = relative(await realpath(workspace), await realpath(secretsDirectory));
  assert(providerPath && providerPath !== ".." && !providerPath.startsWith("../") && !isAbsolute(providerPath),
    "The credential provider must belong to the production consumer tree");
  const secretsMetadata = JSON.parse(await readFile(join(secretsDirectory, "package.json"), "utf8"));
  assert.equal(secretsMetadata.name, "@hasna/secrets");
  assert.equal(secretsMetadata.version, installedMetadata.dependencies["@hasna/secrets"]);
  await rename(secretsDirectory, join(workspace, "held-secrets-package"));
  await runCase("an unavailable installed provider remains terminal", false, []);
  console.log("Verified packed production-only Skills credential provider; no live credentials or application requests used.");
} finally { await rm(workspace, { recursive: true, force: true }); }
