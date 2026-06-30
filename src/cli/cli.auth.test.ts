import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { runCliInCwd } from "./cli.test-utils";

describe("CLI hosted auth and billing", () => {
  test("billing commands accept SKILLS_API_KEY without a stored login", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "cli-billing-api-key-"));
    const seenAuthHeaders: Array<string | null> = [];
    const server = Bun.serve({
      port: 0,
      fetch: async (req) => {
        const url = new URL(req.url);
        if (url.pathname === "/api/v1/billing/status" && req.method === "GET") {
          seenAuthHeaders.push(req.headers.get("authorization"));
          return Response.json({
            plan: "pro",
            balanceCents: 0,
            balance: "$0.00",
            subscription: null,
            hasPaymentMethod: true,
          });
        }

        if (url.pathname === "/api/v1/billing/portal" && req.method === "POST") {
          seenAuthHeaders.push(req.headers.get("authorization"));
          return Response.json({ url: "https://billing.example/portal" });
        }

        return Response.json({ error: `missing route ${req.method} ${url.pathname}` }, { status: 404 });
      },
    });

    try {
      const env = {
        HOME: tmpDir,
        SKILLS_API_URL: `http://127.0.0.1:${server.port}`,
        SKILLS_API_KEY: "sk_env_billing",
      };

      const status = await runCliInCwd(["billing", "status", "--json"], tmpDir, env);
      expect(status.exitCode).toBe(0);
      expect(JSON.parse(status.stdout)).toMatchObject({ plan: "pro", balance: "$0.00" });

      const portal = await runCliInCwd(["billing", "portal", "--json"], tmpDir, env);
      expect(portal.exitCode).toBe(0);
      expect(JSON.parse(portal.stdout)).toMatchObject({ url: "https://billing.example/portal" });
      expect(seenAuthHeaders).toEqual(["Bearer sk_env_billing", "Bearer sk_env_billing"]);
      expect(existsSync(join(tmpDir, ".hasna", "skills", "auth.json"))).toBe(false);
    } finally {
      server.stop(true);
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("auth whoami accepts SKILLS_API_KEY without storing or exposing the key", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "cli-whoami-api-key-"));
    const seenAuthHeaders: Array<string | null> = [];
    const server = Bun.serve({
      port: 0,
      fetch: async (req) => {
        const url = new URL(req.url);
        if (url.pathname === "/api/auth/whoami" && req.method === "GET") {
          seenAuthHeaders.push(req.headers.get("authorization"));
          return Response.json({
            user: { id: "user_env", email: "env@example.com", role: "owner" },
            organization: { id: "org_env", slug: "env-org", name: "Env Org" },
          });
        }

        return Response.json({ error: `missing route ${req.method} ${url.pathname}` }, { status: 404 });
      },
    });

    try {
      const env = {
        HOME: tmpDir,
        SKILLS_API_URL: `http://127.0.0.1:${server.port}`,
        SKILLS_API_KEY: "sk_env_whoami",
      };

      const result = await runCliInCwd(["auth", "whoami", "--json"], tmpDir, env);
      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe("");
      const data = JSON.parse(result.stdout);
      expect(data).toMatchObject({
        status: "authenticated",
        authSource: "env",
        email: "env@example.com",
        organization: "env-org",
        organizationName: "Env Org",
        role: "owner",
      });
      expect(result.stdout).not.toContain("sk_env_whoami");
      expect(seenAuthHeaders).toEqual(["Bearer sk_env_whoami"]);
      expect(existsSync(join(tmpDir, ".hasna", "skills", "auth.json"))).toBe(false);
    } finally {
      server.stop(true);
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("auth whoami env auth does not fall back to stale stored identity", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "cli-whoami-env-overrides-store-"));
    const authDir = join(tmpDir, ".hasna", "skills");
    mkdirSync(authDir, { recursive: true, mode: 0o700 });
    writeFileSync(join(authDir, "auth.json"), JSON.stringify({
      apiKey: "stored_fixture_key",
      email: "stored@example.com",
      orgId: "org_stored",
      orgSlug: "stored-org",
      userId: "user_stored",
    }));

    const server = Bun.serve({
      port: 0,
      fetch: async (req) => {
        const url = new URL(req.url);
        if (url.pathname === "/api/auth/whoami" && req.method === "GET") {
          expect(req.headers.get("authorization")).toBe("Bearer env_fixture_key");
          return Response.json({
            user: { role: "member" },
            organization: { name: "Env Org" },
          });
        }

        return Response.json({ error: `missing route ${req.method} ${url.pathname}` }, { status: 404 });
      },
    });

    try {
      const result = await runCliInCwd(["auth", "whoami", "--json"], tmpDir, {
        HOME: tmpDir,
        SKILLS_API_URL: `http://127.0.0.1:${server.port}`,
        SKILLS_API_KEY: "env_fixture_key",
      });
      expect(result.exitCode).toBe(0);
      const data = JSON.parse(result.stdout);
      expect(data).toMatchObject({
        status: "authenticated",
        authSource: "env",
        role: "member",
        organizationName: "Env Org",
      });
      expect(result.stdout).not.toContain("stored@example.com");
      expect(result.stdout).not.toContain("stored-org");
      expect(result.stdout).not.toContain("stored_fixture_key");
      expect(result.stdout).not.toContain("env_fixture_key");
    } finally {
      server.stop(true);
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("device login stores credentials and billing commands call the hosted API", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "cli-device-auth-"));
    const seenAuthHeaders: Array<string | null> = [];
    const server = Bun.serve({
      port: 0,
      fetch: async (req) => {
        const url = new URL(req.url);
        if (url.pathname === "/api/auth/device/start" && req.method === "POST") {
          return Response.json({
            deviceCode: "device_secret",
            userCode: "ABCD-EFGH",
            verificationUri: `${url.origin}/auth/device`,
            verificationUriComplete: `${url.origin}/auth/device?code=ABCD-EFGH`,
            expiresIn: 900,
            interval: 1,
          }, { status: 201 });
        }

        if (url.pathname === "/api/auth/device/token" && req.method === "POST") {
          return Response.json({
            token: "jwt_device",
            apiKey: "sk_device_login",
            user: { id: "user_1", email: "user@example.com", displayName: null, role: "owner" },
            organization: { id: "org_1", slug: "user", name: "User" },
            firstLogin: false,
          });
        }

        if (url.pathname === "/api/v1/billing/status" && req.method === "GET") {
          seenAuthHeaders.push(req.headers.get("authorization"));
          return Response.json({
            plan: "free",
            balanceCents: 500,
            balance: "$5.00",
            subscription: null,
            hasPaymentMethod: false,
          });
        }

        if (url.pathname === "/api/v1/billing/credits" && req.method === "POST") {
          seenAuthHeaders.push(req.headers.get("authorization"));
          return Response.json({ url: "https://billing.example/credits", pack: "$5" });
        }

        return Response.json({ error: `missing route ${req.method} ${url.pathname}` }, { status: 404 });
      },
    });

    try {
      const env = {
        HOME: tmpDir,
        SKILLS_API_URL: `http://127.0.0.1:${server.port}`,
      };
      const login = await runCliInCwd([
        "auth",
        "login",
        "--device",
        "--poll",
        "--poll-timeout-ms",
        "1000",
        "--no-open",
        "--json",
      ], tmpDir, env);
      expect(login.exitCode).toBe(0);
      expect(JSON.parse(login.stdout)).toMatchObject({
        status: "authenticated",
        email: "user@example.com",
        organization: "user",
      });

      const authPath = join(tmpDir, ".hasna", "skills", "auth.json");
      expect(existsSync(authPath)).toBe(true);
      expect(statSync(authPath).mode & 0o077).toBe(0);
      expect(JSON.parse(readFileSync(authPath, "utf8"))).toMatchObject({
        apiKey: "sk_device_login",
        email: "user@example.com",
        orgSlug: "user",
      });

      const status = await runCliInCwd(["billing", "status", "--json"], tmpDir, env);
      expect(status.exitCode).toBe(0);
      expect(JSON.parse(status.stdout)).toMatchObject({ plan: "free", balance: "$5.00" });

      const credits = await runCliInCwd(["credits", "buy", "5", "--json"], tmpDir, env);
      expect(credits.exitCode).toBe(0);
      expect(JSON.parse(credits.stdout)).toMatchObject({ url: "https://billing.example/credits", pack: "$5" });
      expect(seenAuthHeaders).toEqual(["Bearer sk_device_login", "Bearer sk_device_login"]);
    } finally {
      server.stop(true);
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("hosted auth and billing failures stay structured with --json", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "cli-hosted-json-errors-"));
    const server = Bun.serve({
      port: 0,
      fetch: () => new Response("temporary outage", { status: 503, statusText: "Unavailable" }),
    });

    try {
      const env = {
        HOME: tmpDir,
        SKILLS_API_URL: `http://127.0.0.1:${server.port}`,
        SKILLS_API_KEY: "sk_json_errors",
      };
      for (const args of [
        ["billing", "status", "--json"],
        ["billing", "checkout", "--json"],
        ["billing", "portal", "--json"],
        ["credits", "buy", "5", "--json"],
        ["credits", "packs", "--json"],
        ["auth", "whoami", "--json"],
        ["auth", "login", "--device", "--json"],
      ]) {
        const result = await runCliInCwd(args, tmpDir, env);
        expect(result.exitCode, args.join(" ")).not.toBe(0);
        expect(result.stderr, args.join(" ")).toBe("");
        const payload = JSON.parse(result.stdout);
        expect(payload).toMatchObject({ error: "temporary outage", status: 503 });
        expect(result.stdout, args.join(" ")).not.toContain("Stack trace");
        expect(result.stdout, args.join(" ")).not.toContain("bin/index.js");
      }
    } finally {
      server.stop(true);
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
