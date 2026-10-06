import { expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();

// Exercise the real Commander registration, stdin reader, request path and
// profile writer in a fresh process. Only transport is synthetic; no SDK login
// shortcut or ambient credential can make this path pass.
async function login(args: string[], input = "123456\n", mode = "returning") {
  const root = await mkdtemp(join(tmpdir(), "skills-login-stdin-"));
  const home = join(root, "home"), journal = join(root, "receipt.json");
  await mkdir(home);
  const fixture = join(root, "fixture.ts");
  await writeFile(fixture, `
import { Command } from ${JSON.stringify(import.meta.resolve("commander"))};
import { existsSync, statSync, writeFileSync } from "node:fs";
import { getAuthFilePath } from ${JSON.stringify(resolve(import.meta.dir, "../lib/auth-store.ts"))};
import { resolveSkillsConnection } from ${JSON.stringify(resolve(import.meta.dir, "../lib/fleet-credentials.ts"))};
const mode = process.env.TEST_LOGIN_MODE;
const interactive = mode === "interactive" || mode === "cancel";
if (interactive) {
  // A virtual terminal supplies key events to the real masked reader; no
  // terminal state or keyboard input on the test host is used.
  for (const stream of [process.stdin, process.stdout, process.stderr]) Object.defineProperty(stream, "isTTY", { value: true });
  process.stdin.isRaw = false;
  process.stdin.setRawMode = value => { process.stdin.isRaw = value; return process.stdin; };
  const stderrWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = (text, ...rest) => {
    if (String(text).includes("Enter the six-digit code")) queueMicrotask(() => {
      if (mode === "cancel") process.stdin.emit("keypress", "", { ctrl: true, name: "c" });
      else {
        for (const digit of "123456") process.stdin.emit("keypress", digit, { name: digit });
        process.stdin.emit("keypress", "", { name: "return" });
      }
    });
    return stderrWrite(text, ...rest);
  };
  const stdoutWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = (text, ...rest) => {
    if (String(text).includes("Register Skills with your coding agents now")) queueMicrotask(() => process.stdin.emit("data", "n\\n"));
    return stdoutWrite(text, ...rest);
  };
}
const { registerAuth } = await import(${JSON.stringify(resolve(import.meta.dir, "commands/auth.ts"))});
const paths = [], grants = [], key = "inert-issued-key";
let verifiedCode = false, redirectsRefused = true;
globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  if (url.origin !== "https://example.invalid") throw Error("Unexpected fixture authority");
  redirectsRefused &&= init?.redirect === "error";
  paths.push(url.pathname);
  if (url.pathname === "/api/auth/login") return Response.json({ success: true });
  if (url.pathname === "/api/auth/verify") {
    const body = JSON.parse(init.body);
    verifiedCode = body.code === "123456" && body.email === "fixture@example.invalid";
    if (mode === "refused") return Response.json({ error: "Verification refused" }, { status: 403 });
    if (mode === "redirect") return new Response(null, { status: 302, headers: { Location: "https://other.invalid" } });
    return Response.json({ token: "inert-session", ...(mode === "preissued" ? { apiKey: key } : {}),
      firstLogin: false, user: { id: "fixture-user", email: "fixture@example.invalid", role: "member" },
      organization: { id: "fixture-org", slug: "fixture" } });
  }
  if (url.pathname === "/api/auth/keys") {
    const body = JSON.parse(init.body); grants.push(body.scopes);
    return Response.json({ key });
  }
  throw Error("Unexpected fixture route");
};
const program = new Command(); program.exitOverride();
registerAuth(program);
try { await program.parseAsync(["bun", "skills", ...process.argv.slice(2)]); }
catch { process.exitCode = 1; }
const path = getAuthFilePath(), stored = existsSync(path);
const connection = stored ? await resolveSkillsConnection() : null;
writeFileSync(${JSON.stringify(journal)}, JSON.stringify({ paths, grants, verifiedCode, redirectsRefused, stored,
  ...(interactive ? { rawRestored: process.stdin.isRaw === false } : {}),
  mode: stored ? statSync(path).mode & 0o777 : null,
  keyMatches: Boolean(connection && connection.apiKey === key), origin: connection?.apiOrigin }), { mode: 0o600 });
if (interactive) process.stdin.destroy();
`);
  const child = Bun.spawn([process.execPath, "--no-env-file", fixture, ...args], {
    cwd: root, stdin: "pipe", stdout: "pipe", stderr: "pipe",
    env: { HOME: home, HASNA_HOME: join(home, ".hasna"), HASNA_CONFIG_HOME: join(home, "config"),
      HASNA_SKILLS_DIR: join(home, "data"), HASNA_SKILLS_API_URL: "https://example.invalid",
      HASNA_PROFILE: "stdin-fixture", HASNA_STATION: "stdin-fixture-no-keychain",
      TMPDIR: root, PATH: "/usr/bin:/bin", NO_COLOR: "1", BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0", TEST_LOGIN_MODE: mode },
  });
  const timer = setTimeout(() => child.kill("SIGKILL"), 10_000);
  try {
    if (mode !== "interactive" && mode !== "cancel") { child.stdin.write(input); child.stdin.end(); }
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
    ]);
    expect(stdout + stderr).not.toContain("123456");
    expect(stdout + stderr).not.toContain("inert-issued-key");
    expect(stdout + stderr).not.toContain("inert-session");
    if (!await Bun.file(journal).exists()) throw new Error(`Synthetic login failed before its receipt (${exitCode}): ${stderr}`);
    return { stdout, stderr, exitCode, receipt: JSON.parse(await readFile(journal, "utf8")) };
  } finally { clearTimeout(timer); await rm(root, { recursive: true, force: true }); }
}

for (const prefix of [["login"], ["auth", "login"]]) {
  test(`${prefix.join(" ")} consumes stdin once, preserves the origin and grants normal billing access`, async () => {
    const value = await login([...prefix, "--email", "fixture@example.invalid", "--code-stdin", "--json"]);
    expect(value.exitCode).toBe(0); expect(value.stderr).toBe("");
    expect(JSON.parse(value.stdout).status).toBe("authenticated");
    expect(value.receipt).toMatchObject({ paths: ["/api/auth/verify", "/api/auth/keys"], verifiedCode: true,
      redirectsRefused: true, stored: true, mode: 0o600, keyMatches: true, origin: "https://example.invalid" });
    expect(value.receipt.grants).toEqual([["skills:read", "skills:run", "runs:read", "connectors:read",
      "connectors:write", "billing:read", "billing:write"]]);
  });
}

test("request-only login recommends stdin and does not verify or store a profile", async () => {
  const value = await login(["login", "--email", "fixture@example.invalid", "--json"], "");
  expect(value.exitCode).toBe(0);
  expect(JSON.parse(value.stdout)).toMatchObject({ status: "code_sent" });
  expect(JSON.parse(value.stdout).message).toContain("--code-stdin");
  expect(value.receipt).toMatchObject({ paths: ["/api/auth/login"], stored: false });
});

test("interactive login masks the code and restores terminal state", async () => {
  const value = await login(["login", "--email", "fixture@example.invalid"], "", "interactive");
  expect(value.exitCode).toBe(0);
  expect(value.stderr).toContain("******");
  expect(value.receipt).toMatchObject({ paths: ["/api/auth/login", "/api/auth/verify", "/api/auth/keys"],
    verifiedCode: true, stored: true, rawRestored: true });
});

test("cancelling masked login restores terminal state without verification", async () => {
  const value = await login(["login", "--email", "fixture@example.invalid"], "", "cancel");
  expect(value.exitCode).toBe(130);
  expect(value.receipt).toMatchObject({ paths: ["/api/auth/login"], stored: false, rawRestored: true });
});

for (const input of ["", "12345", "123456\n654321", "1234567", "x".repeat(33)]) {
  test(`invalid stdin is refused before requests (${input.length} bytes)`, async () => {
    const value = await login(["login", "--email", "fixture@example.invalid", "--code-stdin", "--json"], input);
    expect(value.exitCode).toBe(1);
    expect(value.receipt).toMatchObject({ paths: [], stored: false });
    expect(JSON.parse(value.stdout).error).toContain("six-digit");
  });
}

for (const extra of [["--code", "inert"], ["--api-key"], ["--device"], ["--poll"]]) {
  test(`stdin rejects conflicting ${extra[0]} before requests`, async () => {
    const value = await login(["login", "--email", "fixture@example.invalid", "--code-stdin", ...extra, "--json"]);
    expect(value.exitCode).toBe(1);
    expect(value.receipt).toMatchObject({ paths: [], stored: false });
    expect(JSON.parse(value.stdout).error).toContain("cannot be combined");
  });
}

test("stdin requires email without falling into device authorization", async () => {
  const value = await login(["login", "--code-stdin", "--json"]);
  expect(value.exitCode).toBe(1); expect(value.receipt.paths).toEqual([]);
});

test("workspace enrollment retains its separate option guard", async () => {
  const value = await login(["auth", "login", "--membership-id", "fixture-member", "--email", "fixture@example.invalid",
    "--code-stdin", "--url", "https://example.invalid", "--json"]);
  expect(value.exitCode).toBe(1); expect(value.receipt.paths).toEqual([]);
  expect(JSON.parse(value.stdout).error).toContain("Workspace login");
});

test("a preissued sign-in key is persisted without another issuance", async () => {
  const value = await login(["login", "--email", "fixture@example.invalid", "--code-stdin", "--json"], "123456\n", "preissued");
  expect(value.exitCode).toBe(0);
  expect(value.receipt).toMatchObject({ paths: ["/api/auth/verify"], grants: [], stored: true, keyMatches: true });
});

for (const mode of ["refused", "redirect"]) test(`${mode} verification cannot issue or persist a key`, async () => {
  const value = await login(["login", "--email", "fixture@example.invalid", "--code-stdin", "--json"], "123456\n", mode);
  expect(value.exitCode).toBe(1);
  expect(value.receipt).toMatchObject({ paths: ["/api/auth/verify"], grants: [], stored: false, redirectsRefused: true });
});
