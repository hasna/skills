import { afterAll, afterEach, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { REDACTED_VAULT_REFERENCE, resolveSkillsConnection, SkillsFleetCredentialError, type SkillsFleetOptions } from "./fleet-credentials.js";
import { defaultSecretsClientDependencies, type DefaultSecretsClientDependencies } from "./secrets-cli.js";
import { useDefaultTestTimeout } from "../test-preload.js";
useDefaultTestTimeout();

// Synthetic values only. None of them is a credential.
const VAULT_KEY = "fixture/skills/live/api_key";
const VALUE = "synthetic-skills-key-5d1e9a";
const LITERAL = "synthetic-literal-key-0b44";
const DISK = "synthetic-disk-key-77c2";
const BOOTSTRAP = "synthetic-bootstrap-3f90";
const VAULT_VALUE = "synthetic-vault-value-a1c4";
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function directory() { const root = realpathSync(mkdtempSync(join(tmpdir(), "fleet-secrets-cli-"))); roots.push(root); return root; }

const skills = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: request =>
  new Response(null, { status: request.headers.get("authorization") === `Bearer ${VALUE}` ? 200 : 401 }) });
let vaultReads = 0;
const vault = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
  const url = new URL(request.url);
  const bootstrap = request.headers.get("x-api-key") ?? request.headers.get("authorization")?.replace(/^Bearer /, "");
  if (bootstrap !== BOOTSTRAP || url.pathname !== "/v1/secrets/get" || url.searchParams.get("key") !== VAULT_KEY) return new Response(null, { status: 403 });
  vaultReads++;
  return Response.json({ key: VAULT_KEY, value: VAULT_VALUE });
} });
afterAll(() => { skills.stop(true); vault.stop(true); });

const absent: DefaultSecretsClientDependencies["importSdk"] = () =>
  Promise.reject(Object.assign(new Error("Cannot find module '@hasna/secrets/sdk' from '/synthetic/bin/index.js'"), { code: "ERR_MODULE_NOT_FOUND" }));

/** A stand-in `secrets` CLI: records its argv and the NAMES of its environment, prints the value for the one key. */
function standInCli(exitStatus = 0) {
  const bin = directory(), log = directory();
  writeFileSync(join(bin, "secrets"), `#!/bin/sh
printf '%s\\n' "$@" > "${log}/argv"
/usr/bin/env | /usr/bin/cut -d= -f1 | /usr/bin/sort > "${log}/env-names"
[ "$1" = get ] && [ "$2" = "${VAULT_KEY}" ] && [ "$3" = --plaintext ] && [ ${exitStatus} = 0 ] && { printf '%s' "${VALUE}"; exit 0; }
exit 1
`, { mode: 0o700 });
  chmodSync(join(bin, "secrets"), 0o700);
  return { bin, log };
}
function pointerEnv(path: string, extra: Record<string, string> = {}) {
  const home = directory();
  return { HOME: home, HASNA_HOME: join(home, ".hasna"), PATH: path, HASNA_SKILLS_API_URL: skills.url.origin, HASNA_SKILLS_API_KEY_REF: VAULT_KEY, ...extra } as Record<string, string>;
}
function counting(access: Partial<DefaultSecretsClientDependencies> = {}) {
  const calls = { importSdk: 0, findCli: 0, runCli: 0 };
  const deps: NonNullable<SkillsFleetOptions["secretsAccess"]> = {
    importSdk: () => { calls.importSdk++; return (access.importSdk ?? defaultSecretsClientDependencies.importSdk)(); },
    findCli: env => { calls.findCli++; return (access.findCli ?? defaultSecretsClientDependencies.findCli)(env); },
    runCli: (executable, args, options) => { calls.runCli++; return (access.runCli ?? defaultSecretsClientDependencies.runCli)(executable, args, options); },
  };
  return { calls, deps };
}
async function refusal(promise: Promise<unknown>) { try { await promise; } catch (error) { return error as Error; } throw new Error("expected a refusal"); }

test("pointer, SDK absent, CLI present: the CLI completes the pointer and the key authenticates", async () => {
  const cli = standInCli();
  const env = pointerEnv(`${cli.bin}:/usr/bin:/bin`);
  const { calls, deps } = counting({ importSdk: absent });
  const connection = await resolveSkillsConnection(env, { secretsAccess: deps });
  expect(connection?.apiKey).toBe(VALUE);
  expect(connection?.apiKeyTier).toBe("pointer");
  expect(readFileSync(join(cli.log, "argv"), "utf8")).toBe(`get\n${VAULT_KEY}\n--plaintext\n`);
  // The CLI ran in the caller's environment unchanged: no added variable, no projected credential.
  const names = readFileSync(join(cli.log, "env-names"), "utf8").trim().split("\n");
  expect(names.filter(name => !(name in env) && !["PWD", "SHLVL", "_", "OLDPWD"].includes(name))).toEqual([]);
  expect(names.filter(name => /SECRETS|TOKEN|PASSWORD/.test(name))).toEqual([]);
  expect(calls.runCli).toBe(1);
  expect((await fetch(`${connection!.apiOrigin}/api/auth/whoami`, { headers: { authorization: `Bearer ${connection!.apiKey}` } })).status).toBe(200);
});

test("pointer, SDK and CLI both absent: terminal refusal naming the pointer, with no fallthrough to env or disk", async () => {
  const empty = directory();
  const env = pointerEnv(empty, { HASNA_SKILLS_API_KEY: LITERAL });
  mkdirSync(join(env.HOME!, ".hasna/skills/config"), { recursive: true, mode: 0o700 });
  writeFileSync(join(env.HOME!, ".hasna/skills/config/credentials"), `HASNA_SKILLS_API_KEY=${DISK}\nHASNA_SKILLS_API_URL=${skills.url.origin}\n`, { mode: 0o600 });
  const { calls, deps } = counting({ importSdk: absent });
  const error = await refusal(resolveSkillsConnection(env, { secretsAccess: deps }));
  expect(error).toBeInstanceOf(SkillsFleetCredentialError);
  expect(error.message).toContain("HASNA_SKILLS_API_KEY_REF");
  expect(error.message).toContain(REDACTED_VAULT_REFERENCE);
  expect(error.message).toContain("TERMINAL");
  for (const value of [LITERAL, DISK, VALUE, VAULT_KEY]) expect(JSON.stringify({ message: error.message, error })).not.toContain(value);
  expect(calls.runCli).toBe(0);
});

test("pointer, SDK absent, CLI present but failing: terminal refusal, no value and no fallthrough", async () => {
  const cli = standInCli(1);
  const env = pointerEnv(`${cli.bin}:/usr/bin:/bin`, { HASNA_SKILLS_API_KEY: LITERAL });
  const { calls, deps } = counting({ importSdk: absent });
  const error = await refusal(resolveSkillsConnection(env, { secretsAccess: deps }));
  expect(error).toBeInstanceOf(SkillsFleetCredentialError);
  expect(error.message).toContain(REDACTED_VAULT_REFERENCE);
  for (const value of [LITERAL, VALUE, VAULT_KEY]) expect(error.message).not.toContain(value);
  expect(calls.runCli).toBe(1);
});

test("pointer, SDK absent: a Secrets bootstrap that is itself a pointer is refused before the CLI runs", async () => {
  const cli = standInCli();
  const env = pointerEnv(`${cli.bin}:/usr/bin:/bin`, { HASNA_SECRETS_API_KEY_REF: "recursive/secrets/live/api_key" });
  const { calls, deps } = counting({ importSdk: absent });
  const error = await refusal(resolveSkillsConnection(env, { secretsAccess: deps }));
  expect(error).toBeInstanceOf(SkillsFleetCredentialError);
  expect(error.message).toContain("bootstrap");
  expect(calls.runCli).toBe(0);
});

test("pointer, SDK present: contracts' own completion is used and the CLI never runs", async () => {
  const cli = standInCli();
  const env = pointerEnv(`${cli.bin}:/usr/bin:/bin`, { HASNA_SECRETS_API_URL: vault.url.origin, HASNA_SECRETS_API_KEY_OVERRIDE: BOOTSTRAP });
  const { calls, deps } = counting();
  const before = vaultReads;
  const connection = await resolveSkillsConnection(env, { secretsAccess: deps });
  expect(connection?.apiKey).toBe(VAULT_VALUE);
  expect(vaultReads).toBe(before + 1);
  expect({ importSdk: calls.importSdk, findCli: calls.findCli, runCli: calls.runCli }).toEqual({ importSdk: 1, findCli: 0, runCli: 0 });
});

test("non-pointer tiers are unchanged and never consult the SDK or the CLI", async () => {
  const cli = standInCli();
  const home = directory();
  const env = { HOME: home, HASNA_HOME: join(home, ".hasna"), PATH: `${cli.bin}:/usr/bin:/bin`, HASNA_SKILLS_API_URL: skills.url.origin, HASNA_SKILLS_API_KEY: LITERAL };
  const { calls, deps } = counting({ importSdk: absent });
  const connection = await resolveSkillsConnection(env, { secretsAccess: deps });
  expect(connection?.apiKey).toBe(LITERAL);
  expect(connection?.apiKeyTier).toBe("env");
  expect(calls).toEqual({ importSdk: 0, findCli: 0, runCli: 0 });
});

/** A `secrets` planted in a checkout: it leaves a marker if it ever runs and prints a value that must never become a key. */
function plantedCli(folder: string, marker: string) {
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, "secrets"), `#!/bin/sh\n: > "${marker}"\nprintf '%s' "${LITERAL}"\n`, { mode: 0o700 });
  chmodSync(join(folder, "secrets"), 0o700);
}
async function inWorkingFolder<T>(cwd: string, run: () => Promise<T>): Promise<T> {
  const original = process.cwd();
  process.chdir(cwd);
  try { return await run(); } finally { process.chdir(original); }
}

for (const [label, pathFor] of [
  ["'.'", (_cwd: string) => ".:/usr/bin:/bin"],
  ["a relative 'node_modules/.bin'", (_cwd: string) => "node_modules/.bin:/usr/bin:/bin"],
  ["an absolute entry inside the working folder", (cwd: string) => `${cwd}/node_modules/.bin:/usr/bin:/bin`],
] as const) {
  test(`pointer, SDK absent: a secrets planted in the checkout and reached through ${label} is refused and never runs`, async () => {
    const cwd = directory(), markers = directory();
    const marker = join(markers, "ran");
    plantedCli(cwd, marker);
    plantedCli(join(cwd, "node_modules/.bin"), marker);
    const env = pointerEnv(pathFor(cwd));
    const { calls, deps } = counting({ importSdk: absent });
    const error = await inWorkingFolder(cwd, () => refusal(resolveSkillsConnection(env, { secretsAccess: deps })));
    expect(error).toBeInstanceOf(SkillsFleetCredentialError);
    expect(error.message).toContain("TERMINAL");
    expect(error.message).not.toContain(LITERAL);
    expect(error.message).not.toContain(cwd);
    expect(calls.runCli).toBe(0);
    expect(existsSync(marker)).toBe(false);
  });
}

test("pointer, SDK absent: from a checkout holding a planted secrets, a CLI on an absolute entry outside it completes the pointer", async () => {
  const cwd = directory(), markers = directory();
  const marker = join(markers, "ran");
  plantedCli(cwd, marker);
  plantedCli(join(cwd, "node_modules/.bin"), marker);
  const cli = standInCli();
  const env = pointerEnv(`.:node_modules/.bin::${cli.bin}:/usr/bin:/bin`);
  const { calls, deps } = counting({ importSdk: absent });
  const connection = await inWorkingFolder(cwd, () => resolveSkillsConnection(env, { secretsAccess: deps }));
  expect(connection?.apiKey).toBe(VALUE);
  expect(calls.runCli).toBe(1);
  expect(existsSync(marker)).toBe(false);
});
