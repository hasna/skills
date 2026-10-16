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
  expect(refusal?.next).toEqual([`HASNA_SKILLS_API_URL=${SKILLS_PRODUCT_DEFAULT_ORIGIN} SKILLS_API_URL=${SKILLS_PRODUCT_DEFAULT_ORIGIN} skills --profile <new-profile> login`]);
});

test("an explicit URL conflict preserves gateway configuration and offers a process-scoped profile command", () => {
  try {
    resolveSkillsSignInOrigin({ HASNA_SKILLS_API_URL: defaultFleetGatewayBaseUrl("skills") },
      { credentials: { keychain: { enabled: false } } }, SKILLS_PRODUCT_DEFAULT_ORIGIN);
    throw Error("Expected an explicit URL conflict");
  } catch (error) {
    expect(error).toMatchObject({ code: "INVALID_API_URL", next: [`HASNA_SKILLS_API_URL=${SKILLS_PRODUCT_DEFAULT_ORIGIN} SKILLS_API_URL=${SKILLS_PRODUCT_DEFAULT_ORIGIN} skills --profile <new-profile> login`] });
    expect((error as Error).message).not.toMatch(/unset|remove/i);
  }
});

async function signIn(seed: "gateway" | "vault" | "legacy", args: string[], seedProfile?: string, continuation?: "email" | "device",
  late?: { credential: "gateway" | "vault"; stage: "stdin" | "verify" | "issue" | "device" | "device-pending" | "api-key" },
  gatewayShell?: "HASNA_SKILLS_API_URL" | "SKILLS_API_URL") {
  const root = await mkdtemp(join(tmpdir(), "skills-fleet-login-")), home = join(root, "home");
  await mkdir(home);
  const receipt = join(root, "receipt.json"), preload = join(root, "preload.ts");
  await writeFile(preload, `
import { mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { dirname, basename } from "node:path";
import { mock } from "bun:test";
import * as sharedClient from ${JSON.stringify(import.meta.resolve("@hasna/contracts/client"))};
const contracts = { ...sharedClient };
const { defaultFleetGatewayBaseUrl } = contracts;
let vaultCalls = 0;
mock.module(${JSON.stringify(import.meta.resolve("@hasna/contracts/client"))}, () => ({ ...contracts,
  completePointerCredential: async () => { vaultCalls++; throw Error("Fixture vault consumption refused"); } }));
const projected = await import(${JSON.stringify(import.meta.resolve("@hasna/contracts/client"))});
try { await projected.completePointerCredential(); } catch {}
const vaultProbeMeasured = vaultCalls === 1;
vaultCalls = 0;
import { getAuthFilePath } from ${JSON.stringify(resolve(import.meta.dir, "../lib/auth-store.ts"))};
import { SKILLS_PRODUCT_DEFAULT_ORIGIN } from ${JSON.stringify(resolve(import.meta.dir, "../lib/product-default.ts"))};
const originalPath = getAuthFilePath({ ...process.env, HASNA_PROFILE: process.env.FLEET_LOGIN_PROFILE });
const seed = process.env.FLEET_LOGIN_SEED;
const key = "inert-fleet-key";
const original = seed === "vault"
  ? "HASNA_SKILLS_API_KEY_REF=fixture/skills/api-key\\nHASNA_SKILLS_API_URL=" + SKILLS_PRODUCT_DEFAULT_ORIGIN + "\\n"
  : "HASNA_SKILLS_API_KEY=" + key + "\\n" + (seed === "gateway"
    ? "HASNA_SKILLS_BOUND_API_URL=" + defaultFleetGatewayBaseUrl("skills") + "\\n" : "");
mkdirSync(dirname(originalPath), { recursive: true, mode: 0o700 });
if (!existsSync(originalPath)) writeFileSync(originalPath, original, { mode: 0o600 });
const requests = [];
let lateOriginal;
function provisionLateCredential() {
  lateOriginal = process.env.FLEET_LATE_CREDENTIAL === "vault"
    ? "HASNA_SKILLS_API_KEY_REF=fixture/skills/late-key\\n"
    : "HASNA_SKILLS_API_KEY=" + key + "\\nHASNA_SKILLS_BOUND_API_URL=" + defaultFleetGatewayBaseUrl("skills") + "\\n";
  writeFileSync(getAuthFilePath(), lateOriginal, { mode: 0o600 });
}
if (process.env.FLEET_LATE_STAGE === "stdin") {
  const input = process.stdin[Symbol.asyncIterator].bind(process.stdin);
  process.stdin[Symbol.asyncIterator] = async function* () {
    for await (const chunk of { [Symbol.asyncIterator]: input }) { provisionLateCredential(); yield chunk; }
  };
}
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  if (url.protocol === "data:") return originalFetch(input, init);
  requests.push({ origin: url.origin, path: url.pathname });
  if (url.origin !== (process.env.FLEET_TUI_ORIGIN || SKILLS_PRODUCT_DEFAULT_ORIGIN)) throw Error("Unexpected fixture authority");
  if (process.env.FLEET_TUI_END === "expired" && url.pathname === "/api/auth/device/token") return Response.json({ error: "expired_token" });
  const lateStage = process.env.FLEET_LATE_STAGE;
  const latePath = { verify: "/api/auth/verify", issue: "/api/auth/keys", device: "/api/auth/device/token", "device-pending": "/api/auth/device/token", "api-key": "/api/auth/whoami" }[lateStage];
  if (latePath === url.pathname) provisionLateCredential();
  if (lateStage === "device-pending" && url.pathname === "/api/auth/device/token") return Response.json({ status: "pending" });
  if (url.pathname === "/api/auth/login") return Response.json({ success: true });
  if (url.pathname === "/api/auth/device/start") return Response.json({ deviceCode: "inert-device-capability", userCode: "FIXTURE-CODE",
    verificationUri: SKILLS_PRODUCT_DEFAULT_ORIGIN + "/login", expiresIn: 600, interval: 1 });
  if (url.pathname === "/api/auth/verify" && ["verify", "issue"].includes(lateStage)) return Response.json({ token: "inert-session-capability", firstLogin: false });
  if (url.pathname === "/api/auth/keys") return Response.json({ key: "inert-profile-key" });
  if (url.pathname === "/api/auth/whoami") return Response.json({ user: { id: "fixture-user" } });
  if (["/api/auth/verify", "/api/auth/device/token"].includes(url.pathname)) return Response.json({ apiKey: "inert-profile-key", firstLogin: false });
  throw Error("Unexpected fixture route");
};
process.on("exit", () => {
  const selectedPath = getAuthFilePath();
  writeFileSync(${JSON.stringify(receipt)}, JSON.stringify({ requests, vaultCalls, vaultProbeMeasured,
    lateCredentialPreserved: lateOriginal ? readFileSync(selectedPath, "utf8") === lateOriginal : null,
    originalUnchanged: readFileSync(originalPath, "utf8") === original,
    selectedFile: basename(selectedPath), selectedExists: existsSync(selectedPath),
    files: readdirSync(dirname(originalPath)).sort() }), { mode: 0o600 });
});
`);
  const tui = join(root, "tui.tsx");
  if (args[0]?.startsWith("tui")) await writeFile(tui, `
import React from ${JSON.stringify(import.meta.resolve("react"))};
import { render } from ${JSON.stringify(import.meta.resolve("ink"))};
import { PassThrough } from "node:stream";
import { mock } from "bun:test";
import * as signIn from ${JSON.stringify(resolve(import.meta.dir, "../lib/sign-in.ts"))};
import { selectCliSkillsCredentialProfile } from ${JSON.stringify(resolve(import.meta.dir, "../lib/cli-credential-profile.ts"))};
const methods = { ...signIn };
mock.module(${JSON.stringify(resolve(import.meta.dir, "../lib/sign-in.ts"))}, () => ({ ...methods, openVerificationPage: () => false }));
selectCliSkillsCredentialProfile("skillsmd");
const { AccountView } = await import(${JSON.stringify(resolve(import.meta.dir, "components/AccountView.tsx"))});
const input = new PassThrough(), output = new PassThrough(), errors = new PassThrough();
input.isTTY = true; input.setRawMode = () => input; input.ref = () => input; input.unref = () => input;
output.isTTY = true; output.columns = 200; output.rows = 40;
let rendered = "";
output.on("data", chunk => { rendered += chunk.toString(); });
const app = render(React.createElement(AccountView, { action: "login", argument: process.env.FLEET_TUI_ORIGIN, onDone: () => {} }),
  { stdin: input, stdout: output, stderr: errors, exitOnCtrlC: false, patchConsole: false, debug: true });
try {
  const deadline = Date.now() + 5000;
  const expired = process.env.FLEET_TUI_END === "expired";
  while (!rendered.includes(expired ? "expired before it was approved" : "Register Skills with your agents from a shell:") && Date.now() < deadline) await Bun.sleep(20);
  console.log(JSON.stringify(expired ? { renderedRetry: rendered.includes("/login " + process.env.FLEET_TUI_ORIGIN) }
    : { renderedProfileSetup: rendered.includes("skills --profile skillsmd setup agents") }));
} finally { app.unmount(); input.destroy(); output.destroy(); errors.destroy(); }
`);
  try {
    const invoke = async (command: string[], overrides: Record<string, string> = {}) => {
    const child = Bun.spawn([process.execPath, "--no-env-file", "--preload", preload,
      ...(command[0]?.startsWith("tui") ? [tui] : [resolve(import.meta.dir, "index.tsx"), ...command])], {
      cwd: root, stdin: "pipe", stdout: "pipe", stderr: "pipe",
      env: { HOME: home, HASNA_HOME: join(home, ".hasna"), HASNA_CONFIG_HOME: join(home, "config"),
        HASNA_SKILLS_DIR: join(home, "data"), HASNA_STATION: "fleet-login-fixture",
        PATH: "/usr/bin:/bin", TMPDIR: root, NO_COLOR: "1", BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0", FLEET_LOGIN_SEED: seed,
        ...(seedProfile ? { FLEET_LOGIN_PROFILE: seedProfile } : {}),
        ...(late ? { FLEET_LATE_CREDENTIAL: late.credential, FLEET_LATE_STAGE: late.stage } : {}),
        ...(command[0] === "tui-expired" ? { FLEET_TUI_END: "expired", FLEET_TUI_ORIGIN: "http://127.0.0.1:9" } : {}),
        ...(gatewayShell ? { [gatewayShell]: defaultFleetGatewayBaseUrl("skills") } : {}), ...overrides },
    });
    child.stdin.write("123456\n"); child.stdin.end();
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
    ]);
    for (const inert of ["inert-fleet-key", "inert-profile-key", "fixture/skills/api-key", "inert-device-capability", "inert-session-capability"]) expect(stdout + stderr).not.toContain(inert);
    const recorded = JSON.parse(await readFile(receipt, "utf8"));
    expect(recorded.vaultProbeMeasured).toBe(true);
    return { stdout, stderr, exitCode, receipt: recorded };
    };
    const first = await invoke(args, gatewayShell ? { HASNA_SKILLS_API_URL: SKILLS_PRODUCT_DEFAULT_ORIGIN, SKILLS_API_URL: SKILLS_PRODUCT_DEFAULT_ORIGIN } : {});
    if (!continuation) return { ...first, first: null };
    const output = JSON.parse(first.stdout);
    expect(first.exitCode).toBe(0);
    expect(output.status).toBe(continuation === "email" ? "code_sent" : "pending");
    const command = continuation === "email" ? output.message.split("stdin to: ")[1] : output.next;
    const words: string[] = command.split(" "), overrides: Record<string, string> = {};
    while (words[0]?.includes("=")) {
      const [name, value] = words.shift()!.split("=");
      expect(["HASNA_SKILLS_API_URL", "SKILLS_API_URL"]).toContain(name);
      expect(value).toBe(SKILLS_PRODUCT_DEFAULT_ORIGIN);
      overrides[name!] = value!;
    }
    expect(words.slice(0, 4)).toEqual(["skills", "--profile", "skillsmd", "login"]);
    if (gatewayShell) expect(Object.keys(overrides).sort()).toEqual(["HASNA_SKILLS_API_URL", "SKILLS_API_URL"]);
    const second = await invoke([...words.slice(1), "--json"], overrides);
    return { ...second, first };
  } finally { await rm(root, { recursive: true, force: true }); }
}

for (const credential of ["gateway", "vault"] as const) {
  for (const stage of ["stdin", "verify", "issue", "device", "device-pending", "api-key"] as const) {
    test(`a ${credential} credential provisioned during ${stage} is preserved at completion`, async () => {
      const device = stage === "device" || stage === "device-pending";
      const flags = device ? ["--device"] : stage === "api-key" ? ["--api-key"] : ["--email", "fixture@example.invalid", "--code-stdin"];
      const value = await signIn("gateway", ["--profile", "skillsmd", "login", ...flags, "--json"], undefined,
        device ? "device" : undefined, { credential, stage });
      expect(value.exitCode).toBe(1);
      expect(value.stdout + value.stderr).toContain("configuration changed");
      expect(JSON.parse(value.stdout).error).toContain("configuration changed");
      expect(value.stderr).toBe("");
      expect(value.receipt).toMatchObject({ originalUnchanged: true, lateCredentialPreserved: true, vaultCalls: 0 });
      expect(value.receipt.files).not.toContain("identity-skillsmd.json");
      expect(value.receipt.requests.map((request: { path: string }) => request.path)).toEqual(stage === "issue"
        ? ["/api/auth/verify", "/api/auth/keys"] : stage === "stdin" ? []
        : [stage === "verify" ? "/api/auth/verify" : device ? "/api/auth/device/token" : "/api/auth/whoami"]);
    });
  }
}

test("gateway refusal points to a separate profile and preserves the fleet credential", async () => {
  const value = await signIn("gateway", ["--profile", "fleet-fixture", "login", "--email", "fixture@example.invalid", "--json"], "fleet-fixture");
  expect(value.exitCode).toBe(1);
  expect(value.stdout).toContain("--profile");
  expect(value.stdout).not.toMatch(/unset|remove/i);
  expect(value.receipt).toMatchObject({ requests: [], vaultCalls: 0, originalUnchanged: true, files: ["credentials-fleet-fixture"] });
});

for (const seed of ["gateway", "vault", "legacy"] as const) {
  test(`explicit product login preserves a stored ${seed} credential before sending`, async () => {
    const value = await signIn(seed, ["--profile", "fleet-fixture", "login", "--url", SKILLS_PRODUCT_DEFAULT_ORIGIN,
      "--email", "fixture@example.invalid", "--code-stdin", "--json"], "fleet-fixture");
    expect(value.exitCode).toBe(1);
    expect(JSON.parse(value.stdout).code).toBe("STORED_CREDENTIAL_PROTECTED");
    expect(value.stdout).toContain("--profile");
    expect(value.receipt).toMatchObject({ requests: [], vaultCalls: 0, originalUnchanged: true, files: ["credentials-fleet-fixture"] });
  });

  test(`workspace enrollment preserves a stored ${seed} credential before HTTP or vault consumption`, async () => {
    const value = await signIn(seed, ["--profile", "fleet-fixture", "auth", "login", "--membership-id", "11111111-1111-4111-8111-111111111111",
      "--email", "fixture@example.invalid", "--code-stdin", "--json"], "fleet-fixture");
    expect(value.exitCode).toBe(1);
    expect(JSON.parse(value.stdout)).toMatchObject({ code: "STORED_CREDENTIAL_PROTECTED", next: ["skills --profile <new-profile> login"] });
    expect(value.receipt).toMatchObject({ requests: [], vaultCalls: 0, originalUnchanged: true, files: ["credentials-fleet-fixture"] });
  });
}

for (const mode of ["email", "device"] as const) {
  test(`the printed ${mode} continuation finishes only the selected product profile`, async () => {
    const flags = mode === "email" ? ["--email", "fixture@example.invalid"] : ["--device"];
    const value = await signIn("gateway", ["--profile", "skillsmd", "login", ...flags, "--json"], undefined, mode);
    expect(value.exitCode).toBe(0);
    expect(JSON.parse(value.stdout)).toMatchObject({ status: "authenticated", next: ["skills --profile skillsmd setup agents"] });
    expect(value.first?.receipt).toMatchObject({ originalUnchanged: true, selectedExists: false, vaultCalls: 0,
      requests: [{ origin: SKILLS_PRODUCT_DEFAULT_ORIGIN, path: mode === "email" ? "/api/auth/login" : "/api/auth/device/start" }] });
    expect(value.receipt).toMatchObject({ originalUnchanged: true, selectedFile: "credentials-skillsmd", selectedExists: true, vaultCalls: 0,
      requests: [{ origin: SKILLS_PRODUCT_DEFAULT_ORIGIN, path: mode === "email" ? "/api/auth/verify" : "/api/auth/device/token" }],
      files: ["credentials", "credentials-skillsmd", "identity-skillsmd.json"] });
  });
}

for (const gatewayShell of ["HASNA_SKILLS_API_URL", "SKILLS_API_URL"] as const) {
  for (const mode of ["email", "device"] as const) {
    test(`${mode} continuation keeps product authority over an exported ${gatewayShell} gateway`, async () => {
      const flags = mode === "email" ? ["--email", "fixture@example.invalid"] : ["--device"];
      const value = await signIn("gateway", ["--profile", "skillsmd", "login", ...flags, "--json"], undefined, mode, undefined, gatewayShell);
      expect(value.exitCode).toBe(0);
      expect(JSON.parse(value.stdout)).toMatchObject({ status: "authenticated", next: [
        `HASNA_SKILLS_API_URL=${SKILLS_PRODUCT_DEFAULT_ORIGIN} SKILLS_API_URL=${SKILLS_PRODUCT_DEFAULT_ORIGIN} skills --profile skillsmd setup agents`] });
      expect(value.receipt).toMatchObject({ originalUnchanged: true, selectedFile: "credentials-skillsmd", selectedExists: true,
        requests: [{ origin: SKILLS_PRODUCT_DEFAULT_ORIGIN, path: mode === "email" ? "/api/auth/verify" : "/api/auth/device/token" }],
        files: ["credentials", "credentials-skillsmd", "identity-skillsmd.json"] });
    });
  }
}

test("a new --profile login defaults to the product and writes only its own credential", async () => {
  const value = await signIn("gateway", ["--profile", "skillsmd", "login", "--email", "fixture@example.invalid", "--code-stdin", "--json"]);
  expect(value.exitCode).toBe(0);
  expect(value.receipt).toMatchObject({ originalUnchanged: true, selectedFile: "credentials-skillsmd", selectedExists: true,
    requests: [{ origin: SKILLS_PRODUCT_DEFAULT_ORIGIN, path: "/api/auth/verify" }],
    files: ["credentials", "credentials-skillsmd", "identity-skillsmd.json"] });
});

test("TUI login renders setup instructions for the same named profile", async () => {
  const value = await signIn("gateway", ["tui"]);
  expect(value.exitCode).toBe(0);
  expect(JSON.parse(value.stdout)).toEqual({ renderedProfileSetup: true });
  expect(value.receipt).toMatchObject({ originalUnchanged: true, selectedFile: "credentials-skillsmd", selectedExists: true,
    requests: [{ origin: SKILLS_PRODUCT_DEFAULT_ORIGIN, path: "/api/auth/device/start" },
      { origin: SKILLS_PRODUCT_DEFAULT_ORIGIN, path: "/api/auth/device/token" }],
    files: ["credentials", "credentials-skillsmd", "identity-skillsmd.json"] });
});

test("TUI retry retains the explicit self-hosted authority without persisting a credential", async () => {
  const value = await signIn("gateway", ["tui-expired"]);
  expect(value.exitCode).toBe(0);
  expect(JSON.parse(value.stdout)).toEqual({ renderedRetry: true });
  expect(value.receipt).toMatchObject({ originalUnchanged: true, selectedExists: false,
    requests: [{ origin: "http://127.0.0.1:9", path: "/api/auth/device/start" },
      { origin: "http://127.0.0.1:9", path: "/api/auth/device/token" }], files: ["credentials"] });
});

test("email continuation quotes an apostrophe without changing the account address", async () => {
  const value = await signIn("gateway", ["--profile", "skillsmd", "login", "--email", "o'connor@example.invalid", "--json"]);
  expect(value.exitCode).toBe(0);
  const output = JSON.parse(value.stdout);
  expect(output.email).toBe("o'connor@example.invalid");
  expect(output.message).toContain("--email 'o'\\''connor@example.invalid' --code-stdin");
  expect(value.receipt).toMatchObject({ originalUnchanged: true, selectedExists: false,
    requests: [{ origin: SKILLS_PRODUCT_DEFAULT_ORIGIN, path: "/api/auth/login" }], files: ["credentials"] });
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
    for (const name of ["HASNA_SKILLS_API_URL", "SKILLS_API_URL"]) {
      try {
        resolveSkillsSignInOrigin({ ...env, [name]: defaultFleetGatewayBaseUrl("skills") },
          { credentials: { keychain: { enabled: false } } }, SKILLS_PRODUCT_DEFAULT_ORIGIN);
        throw Error("Expected stored-credential protection");
      } catch (error) {
        expect(error).toMatchObject({ code: "STORED_CREDENTIAL_PROTECTED", next: [
          `HASNA_SKILLS_API_URL=${SKILLS_PRODUCT_DEFAULT_ORIGIN} SKILLS_API_URL=${SKILLS_PRODUCT_DEFAULT_ORIGIN} skills --profile <new-profile> login`] });
      }
    }
  } finally { await rm(home, { recursive: true, force: true }); }
});

test("a fresh installation keeps the hosted product sign-in default", async () => {
  const home = await mkdtemp(join(tmpdir(), "skills-fresh-login-"));
  try {
    expect(resolveSkillsSignInOrigin({ HOME: home, HASNA_HOME: join(home, ".hasna"), HASNA_CONFIG_HOME: join(home, "config") },
      { credentials: { keychain: { enabled: false } } })).toEqual({ origin: SKILLS_PRODUCT_DEFAULT_ORIGIN, source: "default" });
  } finally { await rm(home, { recursive: true, force: true }); }
});
