import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { runCliInCwd } from "./cli.test-utils";

describe("CLI hosted auth and billing", () => {
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
});
