import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { gatewaySignInRefusal, resolveSkillsSignInOrigin } from "../lib/fleet-credentials.js";
import { getAuthFilePath } from "../lib/auth-store.js";
import { defaultFleetGatewayBaseUrl } from "@hasna/contracts/client";
import { SKILLS_PRODUCT_DEFAULT_ORIGIN } from "../lib/product-default.js";
import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();

test("a gateway target recommends a separate profile without removing configuration", () => {
  const refusal = gatewaySignInRefusal({ origin: defaultFleetGatewayBaseUrl("skills"), source: "HASNA_SKILLS_API_URL" });
  expect(refusal?.code).toBe("GATEWAY_AUTH_UNAVAILABLE");
  expect(refusal?.message).toContain("--profile <new-profile> login");
  expect(refusal?.message).not.toMatch(/unset|remove/i);
  expect(refusal?.next).toEqual(["skills --profile <new-profile> login"]);
});

async function signIn(seed: "gateway" | "vault" | "legacy", args: string[], seedProfile?: string) {
  const root = await mkdtemp(join(tmpdir(), "skills-fleet-login-")), home = join(root, "home");
  await mkdir(home);
  const receipt = join(root, "receipt.json"), preload = join(root, "preload.ts");
  await writeFile(preload, `
import { mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { dirname, basename } from "node:path";
import { defaultFleetGatewayBaseUrl } from ${JSON.stringify(import.meta.resolve("@hasna/contracts/client"))};
import { getAuthFilePath } from ${JSON.stringify(resolve(import.meta.dir, "../lib/auth-store.ts"))};
import { SKILLS_PRODUCT_DEFAULT_ORIGIN } from ${JSON.stringify(resolve(import.meta.dir, "../lib/product-default.ts"))};
const originalPath = getAuthFilePath({ ...process.env, HASNA_PROFILE: process.env.FLEET_LOGIN_PROFILE });
const seed = process.env.FLEET_LOGIN_SEED;
const key = "inert-fleet-key";
const original = seed === "vault"
  ? "HASNA_SKILLS_API_KEY_REF=fixture-reference\\nHASNA_SKILLS_API_URL=" + SKILLS_PRODUCT_DEFAULT_ORIGIN + "\\n"
  : "HASNA_SKILLS_API_KEY=" + key + "\\n" + (seed === "gateway"
    ? "HASNA_SKILLS_BOUND_API_URL=" + defaultFleetGatewayBaseUrl("skills") + "\\n" : "");
mkdirSync(dirname(originalPath), { recursive: true, mode: 0o700 });
writeFileSync(originalPath, original, { mode: 0o600 });
const requests = [];
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  if (url.protocol === "data:") return originalFetch(input, init);
  requests.push({ origin: url.origin, path: url.pathname });
  if (url.origin !== SKILLS_PRODUCT_DEFAULT_ORIGIN || url.pathname !== "/api/auth/verify") throw Error("Unexpected fixture request");
  return Response.json({ apiKey: "inert-profile-key", firstLogin: false });
};
process.on("exit", () => {
  const selectedPath = getAuthFilePath();
  writeFileSync(${JSON.stringify(receipt)}, JSON.stringify({ requests,
    originalUnchanged: readFileSync(originalPath, "utf8") === original,
    selectedFile: basename(selectedPath), selectedExists: existsSync(selectedPath),
    files: readdirSync(dirname(originalPath)).sort() }), { mode: 0o600 });
});
`);
  try {
    const child = Bun.spawn([process.execPath, "--no-env-file", "--preload", preload,
      resolve(import.meta.dir, "index.tsx"), ...args], {
      cwd: root, stdin: "pipe", stdout: "pipe", stderr: "pipe",
      env: { HOME: home, HASNA_HOME: join(home, ".hasna"), HASNA_CONFIG_HOME: join(home, "config"),
        HASNA_SKILLS_DIR: join(home, "data"), HASNA_STATION: "fleet-login-fixture",
        PATH: "/usr/bin:/bin", TMPDIR: root, NO_COLOR: "1", BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0", FLEET_LOGIN_SEED: seed,
        ...(seedProfile ? { FLEET_LOGIN_PROFILE: seedProfile } : {}) },
    });
    child.stdin.write("123456\n"); child.stdin.end();
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
    ]);
    for (const inert of ["inert-fleet-key", "inert-profile-key", "fixture-reference"]) expect(stdout + stderr).not.toContain(inert);
    return { stdout, stderr, exitCode, receipt: JSON.parse(await readFile(receipt, "utf8")) };
  } finally { await rm(root, { recursive: true, force: true }); }
}

test("gateway refusal points to a separate profile and preserves the fleet credential", async () => {
  const value = await signIn("gateway", ["--profile", "fleet-fixture", "login", "--email", "fixture@example.invalid", "--json"], "fleet-fixture");
  expect(value.exitCode).toBe(1);
  expect(value.stdout).toContain("--profile");
  expect(value.stdout).not.toMatch(/unset|remove/i);
  expect(value.receipt).toMatchObject({ requests: [], originalUnchanged: true, files: ["credentials-fleet-fixture"] });
});

for (const seed of ["gateway", "vault", "legacy"] as const) {
  test(`explicit product login preserves a stored ${seed} credential before sending`, async () => {
    const value = await signIn(seed, ["--profile", "fleet-fixture", "login", "--url", SKILLS_PRODUCT_DEFAULT_ORIGIN,
      "--email", "fixture@example.invalid", "--code-stdin", "--json"], "fleet-fixture");
    expect(value.exitCode).toBe(1);
    expect(JSON.parse(value.stdout).code).toBe("STORED_CREDENTIAL_PROTECTED");
    expect(value.stdout).toContain("--profile");
    expect(value.receipt).toMatchObject({ requests: [], originalUnchanged: true, files: ["credentials-fleet-fixture"] });
  });
}

test("a new --profile login defaults to the product and writes only its own credential", async () => {
  const value = await signIn("gateway", ["--profile", "skillsmd", "login", "--email", "fixture@example.invalid", "--code-stdin", "--json"]);
  expect(value.exitCode).toBe(0);
  expect(value.receipt).toMatchObject({ originalUnchanged: true, selectedFile: "credentials-skillsmd", selectedExists: true,
    requests: [{ origin: SKILLS_PRODUCT_DEFAULT_ORIGIN, path: "/api/auth/verify" }],
    files: ["credentials", "credentials-skillsmd", "identity-skillsmd.json"] });
});

test("an explicit product URL preserves the default profile's gateway credential", async () => {
  const home = await mkdtemp(join(tmpdir(), "skills-default-login-"));
  const env = { HOME: home, HASNA_HOME: join(home, ".hasna"), HASNA_CONFIG_HOME: join(home, "config") };
  const file = getAuthFilePath(env);
  const original = `HASNA_SKILLS_API_KEY=inert-fleet-key\nHASNA_SKILLS_BOUND_API_URL=${defaultFleetGatewayBaseUrl("skills")}\n`;
  try {
    await mkdir(resolve(file, ".."), { recursive: true });
    await writeFile(file, original, { mode: 0o600 });
    expect(() => resolveSkillsSignInOrigin(env, { credentials: { keychain: { enabled: false } } }, SKILLS_PRODUCT_DEFAULT_ORIGIN))
      .toThrow(/--profile/);
    expect(await readFile(file, "utf8")).toBe(original);
  } finally { await rm(home, { recursive: true, force: true }); }
});

test("a fresh installation keeps the hosted product sign-in default", async () => {
  const home = await mkdtemp(join(tmpdir(), "skills-fresh-login-"));
  try {
    expect(resolveSkillsSignInOrigin({ HOME: home, HASNA_HOME: join(home, ".hasna"), HASNA_CONFIG_HOME: join(home, "config") },
      { credentials: { keychain: { enabled: false } } })).toEqual({ origin: SKILLS_PRODUCT_DEFAULT_ORIGIN, source: "default" });
  } finally { await rm(home, { recursive: true, force: true }); }
});
