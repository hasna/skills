import { afterEach, expect, spyOn, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createDefaultSecretsClient, defaultSecretsClientDependencies, resolveSelectedSecrets, selectedSecretBindingsTemplate,
  type DefaultSecretsClientDependencies, type SecretsCliResult, type SelectedSecretBindings, type SelectedSecretsClient,
} from "./execution-secrets.js";
import type { ResolvedSkillSelection } from "../types/skill-selection.js";
import { useDefaultTestTimeout } from "../test-preload.js";
useDefaultTestTimeout();

// Synthetic values only. None of them is a credential.
const AUTHORITY = "https://vault.example.com/v1";
const VALUE = "synthetic-execution-value-7f3c";
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function directory() { const root = realpathSync(mkdtempSync(join(tmpdir(), "execution-secrets-client-"))); roots.push(root); return root; }

function notInstalled(): Promise<unknown> {
  return Promise.reject(Object.assign(new Error("Cannot find module '@hasna/secrets/sdk' from '/synthetic/bin/index.js'"), { code: "ERR_MODULE_NOT_FOUND" }));
}
function cliCalls() {
  const calls: { executable: string; args: string[] }[] = [];
  const runCli: DefaultSecretsClientDependencies["runCli"] = async (executable, args) => {
    calls.push({ executable, args: [...args] });
    return { status: 0, stdout: new TextEncoder().encode(VALUE) } satisfies SecretsCliResult;
  };
  return { calls, runCli };
}
function selection(cwd: string): { scope: Parameters<typeof selectedSecretBindingsTemplate>[0]; bindings: SelectedSecretBindings } {
  const resolved = { authority: "https://skills.example.com", workspaceId: "w", profileRevision: 1, slug: "s", version: "1.0.0", bundleDigest: "a".repeat(64) } as unknown as ResolvedSkillSelection;
  return {
    scope: { selection: resolved, profileId: "p", cwd },
    bindings: {
      schema: "hasna.skills-secret-bindings.v1",
      selection: { authority: resolved.authority, workspaceId: resolved.workspaceId, profileId: "p", profileRevision: resolved.profileRevision, slug: resolved.slug, version: resolved.version, bundleDigest: resolved.bundleDigest },
      consumer: { stationId: "station", workspaceDirectory: cwd },
      secretsAuthority: AUTHORITY,
      bindings: { SYNTHETIC_TOKEN: "fixture/app/live/token" },
    },
  };
}

test("SDK installed: the SDK's own client is used and the CLI is never consulted", async () => {
  const { calls, runCli } = cliCalls();
  let sdkFactories = 0, lookups = 0, authorityReads = 0;
  const sdkClient: SelectedSecretsClient = { baseUrl: AUTHORITY, async getSecret({ key }) { return { key, value: VALUE, expires_at: null }; } };
  const deps: DefaultSecretsClientDependencies = {
    importSdk: async () => ({ createSecretsClientFromEnv: (...args: unknown[]) => { sdkFactories++; expect(args).toEqual([]); return sdkClient; } }),
    findCli: () => { lookups++; return "/synthetic/secrets"; },
    resolveAuthority: () => { authorityReads++; return AUTHORITY; },
    runCli,
  };
  expect(await createDefaultSecretsClient(deps)).toBe(sdkClient);
  const { bindings } = selection(directory());
  expect(await resolveSelectedSecrets(bindings, () => createDefaultSecretsClient(deps))).toEqual({ SYNTHETIC_TOKEN: VALUE });
  // Credential origin: the SDK path neither runs the CLI nor reads the CLI-path authority configuration.
  expect({ sdkFactories, lookups, authorityReads, calls: calls.length }).toEqual({ sdkFactories: 2, lookups: 0, authorityReads: 0, calls: 0 });
});

test("SDK installed but unable to authenticate refuses without falling back to the CLI", async () => {
  const { calls, runCli } = cliCalls();
  const deps: DefaultSecretsClientDependencies = {
    importSdk: async () => ({ createSecretsClientFromEnv: () => { throw new Error("no credential resolved"); } }),
    findCli: () => "/synthetic/secrets", resolveAuthority: () => AUTHORITY, runCli,
  };
  const { bindings } = selection(directory());
  await expect(resolveSelectedSecrets(bindings, () => createDefaultSecretsClient(deps))).rejects.toMatchObject({ code: "LOCAL_SECRET_UNAVAILABLE" });
  expect(calls).toEqual([]);
});

test("a broken SDK install is not mistaken for an absent one", async () => {
  const { calls, runCli } = cliCalls();
  for (const importSdk of [
    () => Promise.reject(Object.assign(new Error("Cannot find module 'pg' from '/x/node_modules/@hasna/secrets/dist/sdk.js'"), { code: "ERR_MODULE_NOT_FOUND" })),
    () => Promise.reject(new SyntaxError("Unexpected token")),
    async () => ({}),
  ]) {
    await expect(createDefaultSecretsClient({ importSdk, findCli: () => "/synthetic/secrets", resolveAuthority: () => AUTHORITY, runCli })).rejects.toThrow("SECRETS_SDK_UNAVAILABLE");
  }
  expect(calls).toEqual([]);
});

test("SDK absent and CLI present: the same results through the CLI, with no value in argv, logs or errors", async () => {
  const { calls, runCli } = cliCalls();
  const deps: DefaultSecretsClientDependencies = { importSdk: notInstalled, findCli: () => "/synthetic/bin/secrets", resolveAuthority: () => AUTHORITY, runCli };
  const logs = [spyOn(console, "log"), spyOn(console, "error"), spyOn(console, "warn"), spyOn(console, "info"), spyOn(console, "debug")];
  try {
    const cwd = directory();
    const { scope, bindings } = selection(cwd);
    const template = await selectedSecretBindingsTemplate(scope, ["SYNTHETIC_TOKEN"], () => createDefaultSecretsClient(deps));
    expect(template.secretsAuthority).toBe(AUTHORITY);
    expect(await resolveSelectedSecrets(bindings, () => createDefaultSecretsClient(deps))).toEqual({ SYNTHETIC_TOKEN: VALUE });
    expect(calls).toEqual([{ executable: "/synthetic/bin/secrets", args: ["get", "fixture/app/live/token", "--plaintext"] }]);
    // A failed read whose stdout carried a value must not echo it.
    const leaky: DefaultSecretsClientDependencies = { ...deps, runCli: async () => ({ status: 1, stdout: new TextEncoder().encode(VALUE) }) };
    let caught: unknown;
    try { await resolveSelectedSecrets(bindings, () => createDefaultSecretsClient(leaky)); } catch (error) { caught = error; }
    expect(caught).toMatchObject({ code: "LOCAL_SECRET_UNAVAILABLE" });
    expect(String((caught as Error).message)).not.toContain(VALUE);
    expect(JSON.stringify(caught)).not.toContain(VALUE);
    for (const spy of logs) expect(JSON.stringify(spy.mock.calls)).not.toContain(VALUE);
    for (const call of calls) expect(call.args.join("\n")).not.toContain(VALUE);
  } finally { for (const spy of logs) spy.mockRestore(); }
});

test("the CLI path refuses a non-canonical authority and an unsafe key before running anything", async () => {
  const { calls, runCli } = cliCalls();
  for (const authority of ["https://vault.example.com", "https://user:pw@vault.example.com/v1", "http://vault.example.com/v1", "https://vault.example.com/v1?x=1"]) {
    await expect(createDefaultSecretsClient({ importSdk: notInstalled, findCli: () => "/synthetic/secrets", resolveAuthority: () => authority, runCli })).rejects.toThrow("SECRETS_CLI_AUTHORITY_INVALID");
  }
  const client = await createDefaultSecretsClient({ importSdk: notInstalled, findCli: () => "/synthetic/secrets", resolveAuthority: () => AUTHORITY, runCli });
  for (const key of ["--show", "-x", "a b", "", "a\nb"]) await expect(client.getSecret({ key })).rejects.toThrow("SECRETS_CLI_KEY_INVALID");
  expect(calls).toEqual([]);
});

test("neither SDK nor CLI: LOCAL_SECRET_UNAVAILABLE", async () => {
  const emptyPath = directory();
  const original = process.env.PATH;
  process.env.PATH = emptyPath;
  try {
    const deps: DefaultSecretsClientDependencies = { ...defaultSecretsClientDependencies, importSdk: notInstalled };
    expect(deps.findCli()).toBeNull();
    const cwd = directory();
    const { scope, bindings } = selection(cwd);
    await expect(selectedSecretBindingsTemplate(scope, ["SYNTHETIC_TOKEN"], () => createDefaultSecretsClient(deps))).rejects.toMatchObject({ code: "LOCAL_SECRET_UNAVAILABLE" });
    await expect(resolveSelectedSecrets(bindings, () => createDefaultSecretsClient(deps))).rejects.toMatchObject({ code: "LOCAL_SECRET_UNAVAILABLE" });
  } finally { process.env.PATH = original; }
});

test("the installed CLI is run with the caller's environment unchanged and no credential, and its value stays in memory", async () => {
  const bin = directory(), log = directory();
  const valueFile = join(log, "value");
  writeFileSync(valueFile, VALUE, { mode: 0o600 });
  // A stand-in `secrets` CLI: records its argv and the NAMES of its environment, prints the value for `get`.
  writeFileSync(join(bin, "secrets"), `#!/bin/sh
printf '%s\\n' "$@" > "$SH48_FIXTURE_LOG/argv"
/usr/bin/env | /usr/bin/cut -d= -f1 | /usr/bin/sort > "$SH48_FIXTURE_LOG/env-names"
[ "$1" = get ] && [ "$2" = fixture/app/live/token ] && [ "$3" = --plaintext ] && exec /bin/cat "$SH48_FIXTURE_VALUE"
exit 2
`, { mode: 0o700 });
  chmodSync(join(bin, "secrets"), 0o700);
  const saved = { ...process.env };
  try {
    for (const name of Object.keys(process.env)) if (/^HASNA_|SECRETS_/.test(name)) delete process.env[name];
    process.env.PATH = `${bin}:/usr/bin:/bin`;
    process.env.SH48_FIXTURE_LOG = log;
    process.env.SH48_FIXTURE_VALUE = valueFile;
    process.env.HASNA_SECRETS_API_URL = "https://vault.example.com/";
    const deps: DefaultSecretsClientDependencies = { ...defaultSecretsClientDependencies, importSdk: notInstalled };
    expect(deps.findCli()).toBe(join(bin, "secrets"));
    const client = await createDefaultSecretsClient(deps);
    // The authority comes from the URL-only resolver the CLI documents, not from a credential.
    expect(client.baseUrl).toBe(AUTHORITY);
    expect(await client.getSecret({ key: "fixture/app/live/token" })).toEqual({ key: "fixture/app/live/token", value: VALUE, expires_at: null });
    expect(readFileSync(join(log, "argv"), "utf8")).toBe("get\nfixture/app/live/token\n--plaintext\n");
    const names = readFileSync(join(log, "env-names"), "utf8").trim().split("\n");
    const allowedShellAdditions = new Set(["PWD", "SHLVL", "_", "OLDPWD"]);
    expect(names.filter(name => !(name in process.env) && !allowedShellAdditions.has(name))).toEqual([]);
    // No credential is projected: only the authority variable the caller itself set is present.
    expect(names.filter(name => /KEY|TOKEN|PASSWORD|CREDENTIAL/i.test(name))).toEqual([]);
    expect(names.filter(name => name.startsWith("HASNA_"))).toEqual(["HASNA_SECRETS_API_URL"]);
    // A non-zero exit is a refusal, never a value.
    await expect(client.getSecret({ key: "fixture/app/live/other" }).then(() => "resolved", () => "refused")).resolves.toBe("refused");
  } finally {
    for (const name of Object.keys(process.env)) if (!(name in saved)) delete process.env[name];
    Object.assign(process.env, saved);
  }
});

test("the default SDK loader resolves the separately installed SDK at call time", async () => {
  const sdk = await defaultSecretsClientDependencies.importSdk() as { createSecretsClientFromEnv?: unknown };
  expect(typeof sdk.createSecretsClientFromEnv).toBe("function");
});

test("execution: a secrets planted in the working folder is refused through relative or inside-the-folder PATH entries, and never runs", async () => {
  const cwd = directory(), markers = directory(), outside = directory();
  const marker = join(markers, "ran");
  for (const folder of [cwd, join(cwd, "node_modules/.bin")]) {
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, "secrets"), `#!/bin/sh\n: > "${marker}"\nprintf '%s' planted\n`, { mode: 0o700 });
    chmodSync(join(folder, "secrets"), 0o700);
  }
  const original = { path: process.env.PATH, cwd: process.cwd() };
  process.chdir(cwd);
  try {
    const deps: DefaultSecretsClientDependencies = { ...defaultSecretsClientDependencies, importSdk: notInstalled, resolveAuthority: () => AUTHORITY };
    for (const path of [".:/usr/bin:/bin", "node_modules/.bin:/usr/bin:/bin"]) {
      process.env.PATH = path;
      await expect(createDefaultSecretsClient(deps)).rejects.toThrow("SECRETS_CLI_UNAVAILABLE");
    }
    process.env.PATH = `${cwd}/node_modules/.bin:${outside}:/usr/bin:/bin`;
    await expect(createDefaultSecretsClient(deps)).rejects.toThrow("SECRETS_CLI_UNTRUSTED_LOCATION");
    // The caller turns either refusal into LOCAL_SECRET_UNAVAILABLE.
    const { scope } = selection(cwd);
    await expect(selectedSecretBindingsTemplate(scope, ["SYNTHETIC_TOKEN"], () => createDefaultSecretsClient(deps))).rejects.toMatchObject({ code: "LOCAL_SECRET_UNAVAILABLE" });
    expect(existsSync(marker)).toBe(false);
  } finally { process.chdir(original.cwd); process.env.PATH = original.path; }
});
