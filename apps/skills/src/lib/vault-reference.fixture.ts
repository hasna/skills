import { mock } from "bun:test";
import * as childProcess from "node:child_process";
import { chmodSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const scratch = mkdtempSync(join(tmpdir(), "vault-ref-"));
const skillsFile = join(scratch, ".hasna/skills/config/credentials");
const secretsFile = join(scratch, ".hasna/secrets/config/credentials");
for (const app of ["skills", "secrets"]) mkdirSync(join(scratch, `.hasna/${app}/config`), { recursive: true, mode: 0o700 });
let locked = false, response = "ok", requests = 0, keychainReads = 0, rotate = false, factories = 0;
const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(req) {
  requests++;
  if (req.headers.get("x-api-key") !== "dummy-bootstrap-key") return new Response(null, { status: 401 });
  if (new URL(req.url).pathname !== "/v1/secrets/get") return new Response(null, { status: 404 });
  if (rotate) writeFileSync(skillsFile, `HASNA_SKILLS_API_KEY_REF=changed/skills/live/api_key\nHASNA_SKILLS_API_URL=${server.url.origin}\n`, { mode: 0o600 });
  if (response === "missing") return new Response(null, { status: 404 });
  if (response === "unauthorized") return new Response(null, { status: 403 });
  return Response.json({ key: "fixture/skills/live/api_key", value: response === "empty" ? "" : "dummy-vault-key" });
} });
Object.defineProperty(process, "platform", { value: "darwin" });
mock.module("node:child_process", () => ({ ...childProcess, spawnSync: (...args: any[]) => {
  if (args[0] !== "/usr/bin/security") throw Error("Unexpected subprocess in isolated fixture");
  keychainReads++;
  return { status: locked ? 36 : 44, stdout: "", stderr: locked ? "Keychain locked" : "The specified item could not be found." };
} }));
const { createSecretsClientFromEnv } = await import("@hasna/secrets/sdk");
// The fixture observes the loader boundary separately from the unmocked CLI
// test. The SDK provider, transport and HTTP implementation remain real.
mock.module("@hasna/secrets", () => ({ createSecretsClientFromEnv: (...args: Parameters<typeof createSecretsClientFromEnv>) => {
  factories++;
  return createSecretsClientFromEnv(...args);
} }));
type BuiltFleetExports = Pick<typeof import("./fleet-credentials.js"), "resolveSkillsApiKey" | "resolveSkillsFleet">;
// Exercise the newly built JS artifact before the clean build emits declarations.
// Preserve the source export signatures; the prior computed import was untyped.
// @ts-ignore -- this runtime artifact's declarations are emitted after this fixture is checked.
const { resolveSkillsApiKey, resolveSkillsFleet }: BuiltFleetExports = await import("../../dist/index.js");
async function resolveSkillsConnection(env: Record<string, string | undefined>) {
  const metadata = resolveSkillsFleet(env);
  return { ...metadata, apiKey: await resolveSkillsApiKey(env) };
}
const result: Record<string, boolean | number> = {};
function reset() {
  for (const key of Object.keys(process.env)) if (/^(HASNA_|SKILLS_|SECRETS_)/.test(key)) delete process.env[key];
  process.env.HOME = scratch;
  process.env.HASNA_SKILLS_API_URL = server.url.origin;
  process.env.HASNA_SECRETS_API_URL = server.url.origin;
  writeFileSync(skillsFile, `HASNA_SKILLS_API_KEY_REF=fixture/skills/live/api_key\nHASNA_SKILLS_API_URL=${server.url.origin}\nHASNA_SKILLS_BOUND_API_URL=${server.url.origin}\n`, { mode: 0o600 });
  writeFileSync(secretsFile, `HASNA_SECRETS_API_KEY=dummy-bootstrap-key\nHASNA_SECRETS_API_URL=${server.url.origin}\n`, { mode: 0o600 });
  chmodSync(secretsFile, 0o600);
  locked = false; response = "ok"; requests = 0; keychainReads = 0; rotate = false; factories = 0;
}
async function refused() { try { await resolveSkillsConnection(process.env); return false; } catch { return true; } }
try {
  reset();
  const healthy = await resolveSkillsConnection(process.env);
  result.normalFileReferenceWorks = healthy?.apiKey === "dummy-vault-key" && "apiKeyTier" in healthy && healthy.apiKeyTier === "pointer" && requests === 1;
  for (const failure of ["missing", "unauthorized", "empty"]) {
    reset(); response = failure; process.env.HASNA_SKILLS_API_KEY = "dummy-stale-key";
    result[failure + "RefusesWithoutLiteralFallback"] = await refused();
  }
  reset(); process.env.HASNA_SKILLS_API_KEY_REF = "fixture/skills/live/api_key"; locked = true;
  try { createSecretsClientFromEnv(process.env); result.directBootstrapRefusesLockedKeychain = false; }
  catch { result.directBootstrapRefusesLockedKeychain = true; }
  const before = requests;
  result.pointerPreservesAmbientKeychainRefusal = await refused() && requests === before;
  reset(); process.env.HASNA_SKILLS_API_URL = "https://different.example.com";
  result.fileReferenceRetainsInstanceBinding = await refused() && requests === 0;
  reset(); rotate = true;
  result.fileChangeDuringVaultReadRefuses = await refused();
  reset(); rmSync(secretsFile);
  result.missingBootstrapRefuses = await refused() && requests === 0;
  reset(); writeFileSync(secretsFile, "HASNA_SECRETS_API_KEY=''\n", { mode: 0o600 });
  result.malformedBootstrapRefuses = await refused() && requests === 0;
  reset(); chmodSync(secretsFile, 0o644);
  result.unreadableBootstrapRefuses = await refused() && requests === 0;
  reset();
  const closed = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response(null) });
  const closedOrigin = closed.url.origin;
  closed.stop(true);
  process.env.HASNA_SECRETS_API_URL = closedOrigin;
  writeFileSync(secretsFile, `HASNA_SECRETS_API_KEY=dummy-bootstrap-key\nHASNA_SECRETS_API_URL=${closedOrigin}\n`, { mode: 0o600 });
  result.unreachableVaultRefuses = await refused() && requests === 0;
  reset(); writeFileSync(secretsFile, "HASNA_SECRETS_API_KEY_REF=recursive/secrets/live/api_key\n", { mode: 0o600 });
  process.env.HASNA_SECRETS_API_KEY = "dummy-bootstrap-key";
  // A Secrets credential cannot recursively depend on the same hosted vault.
  result.recursiveBootstrapRefuses = await refused() && factories === 0 && requests === 0;
  reset();
  const inaccessibleHome = join(scratch, "inaccessible-home");
  mkdirSync(inaccessibleHome, { mode: 0o700 });
  chmodSync(inaccessibleHome, 0);
  try {
    result.explicitLocalModeDoesNotInspectFiles = await resolveSkillsApiKey({ HOME: inaccessibleHome, HASNA_SKILLS_LOCAL: "1" }) === null;
  } catch { result.explicitLocalModeDoesNotInspectFiles = false; }
  finally { chmodSync(inaccessibleHome, 0o700); }
  console.log(JSON.stringify(result));
} finally { server.stop(true); rmSync(scratch, { recursive: true, force: true }); }
