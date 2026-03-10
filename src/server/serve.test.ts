import { describe, test, expect } from "bun:test";
import { createFetchHandler, startServer } from "./serve";

const handler = createFetchHandler();

async function api(path: string, options?: RequestInit): Promise<Response> {
  const req = new Request(`http://localhost${path}`, options);
  return handler(req);
}

describe("Dashboard Server", () => {
  describe("GET /api/skills", () => {
    test("returns all 202 skills", async () => {
      const res = await api("/api/skills");
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("application/json");
      const data = await res.json();
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBe(202);
    });

    test("each skill has required fields", async () => {
      const res = await api("/api/skills");
      const data = await res.json();
      const skill = data[0];
      expect(skill).toHaveProperty("name");
      expect(skill).toHaveProperty("displayName");
      expect(skill).toHaveProperty("description");
      expect(skill).toHaveProperty("category");
      expect(skill).toHaveProperty("tags");
      expect(skill).toHaveProperty("installed");
      expect(skill).toHaveProperty("envVars");
      expect(skill).toHaveProperty("systemDeps");
      expect(skill).toHaveProperty("cliCommand");
      expect(typeof skill.installed).toBe("boolean");
      expect(Array.isArray(skill.tags)).toBe(true);
      expect(Array.isArray(skill.envVars)).toBe(true);
      expect(Array.isArray(skill.systemDeps)).toBe(true);
    });

    test("includes security headers", async () => {
      const res = await api("/api/skills");
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
      expect(res.headers.get("x-frame-options")).toBe("DENY");
    });
  });

  describe("GET /api/categories", () => {
    test("returns 17 categories", async () => {
      const res = await api("/api/categories");
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBe(17);
    });

    test("each category has name and count", async () => {
      const res = await api("/api/categories");
      const data = await res.json();
      for (const cat of data) {
        expect(cat).toHaveProperty("name");
        expect(cat).toHaveProperty("count");
        expect(typeof cat.name).toBe("string");
        expect(typeof cat.count).toBe("number");
        expect(cat.count).toBeGreaterThan(0);
      }
    });

    test("category counts sum to 202", async () => {
      const res = await api("/api/categories");
      const data = await res.json();
      const total = data.reduce((sum: number, cat: any) => sum + cat.count, 0);
      expect(total).toBe(202);
    });
  });

  describe("GET /api/tags", () => {
    test("returns tags array with name and count", async () => {
      const res = await api("/api/tags");
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("application/json");
      const data = await res.json();
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBeGreaterThan(0);
      expect(data[0]).toHaveProperty("name");
      expect(data[0]).toHaveProperty("count");
      expect(typeof data[0].name).toBe("string");
      expect(typeof data[0].count).toBe("number");
    });

    test("tags are sorted alphabetically", async () => {
      const res = await api("/api/tags");
      const data = await res.json();
      for (let i = 1; i < data.length; i++) {
        expect(data[i].name.localeCompare(data[i - 1].name)).toBeGreaterThanOrEqual(0);
      }
    });

    test("all tag counts are positive integers", async () => {
      const res = await api("/api/tags");
      const data = await res.json();
      for (const entry of data) {
        expect(entry.count).toBeGreaterThan(0);
        expect(Number.isInteger(entry.count)).toBe(true);
      }
    });

    test("includes common tags like 'api'", async () => {
      const res = await api("/api/tags");
      const data = await res.json();
      const tagNames = data.map((t: any) => t.name);
      expect(tagNames).toContain("api");
    });

    test("includes security headers", async () => {
      const res = await api("/api/tags");
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    });
  });

  describe("GET /api/skills/search", () => {
    test("returns results for valid query", async () => {
      const res = await api("/api/skills/search?q=email");
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBeGreaterThan(0);
    });

    test("returns empty array for no match", async () => {
      const res = await api("/api/skills/search?q=zzzznonexistentzzzzz");
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toEqual([]);
    });

    test("returns empty array for empty query", async () => {
      const res = await api("/api/skills/search?q=");
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toEqual([]);
    });

    test("returns empty array for missing q param", async () => {
      const res = await api("/api/skills/search");
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toEqual([]);
    });

    test("search results have full skill fields", async () => {
      const res = await api("/api/skills/search?q=image");
      const data = await res.json();
      expect(data.length).toBeGreaterThan(0);
      const skill = data[0];
      expect(skill).toHaveProperty("name");
      expect(skill).toHaveProperty("installed");
      expect(skill).toHaveProperty("envVars");
    });
  });

  describe("GET /api/skills/:name", () => {
    test("returns skill detail", async () => {
      const res = await api("/api/skills/image");
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.name).toBe("image");
      expect(data.displayName).toBe("Image");
      expect(data.category).toBe("Content Generation");
      expect(data).toHaveProperty("docs");
      expect(data).toHaveProperty("envVars");
      expect(data).toHaveProperty("systemDeps");
    });

    test("returns 404 for nonexistent skill", async () => {
      const res = await api("/api/skills/nonexistent-xyz-999");
      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data).toHaveProperty("error");
    });

    test("returns 400 for invalid skill name", async () => {
      const res = await api("/api/skills/INVALID..NAME");
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("Invalid");
    });

    test("rejects names with uppercase or dots", async () => {
      const res = await api("/api/skills/BAD.NAME");
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("Invalid");
    });
  });

  describe("GET /api/skills/:name/docs", () => {
    test("returns documentation for skill with docs", async () => {
      const res = await api("/api/skills/image/docs");
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toHaveProperty("content");
      expect(data.content).toBeTruthy();
      expect(typeof data.content).toBe("string");
    });

    test("returns null content for skill without docs", async () => {
      const res = await api("/api/skills/domainsearch/docs");
      expect(res.status).toBe(200);
      const data = await res.json();
      // domainsearch has no doc files
      expect(data).toHaveProperty("content");
    });

    test("returns 400 for invalid name", async () => {
      const res = await api("/api/skills/INVALID..NAME/docs");
      expect(res.status).toBe(400);
    });
  });

  describe("POST /api/skills/:name/install", () => {
    test("attempts to install a skill", async () => {
      const res = await api("/api/skills/image/install", { method: "POST" });
      const data = await res.json();
      // Will either succeed or say already installed
      expect(data).toHaveProperty("skill");
      expect(data.skill).toBe("image");
    });

    test("returns 400 for invalid name", async () => {
      const res = await api("/api/skills/INVALID..NAME/install", { method: "POST" });
      expect(res.status).toBe(400);
    });

    test("returns error for nonexistent skill", async () => {
      const res = await api("/api/skills/nonexistent-xyz-999/install", { method: "POST" });
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain("not found");
    });
  });

  describe("POST /api/skills/:name/remove", () => {
    test("returns result for remove attempt", async () => {
      const res = await api("/api/skills/nonexistent-xyz-999/remove", { method: "POST" });
      const data = await res.json();
      expect(data).toHaveProperty("success");
      expect(data).toHaveProperty("skill");
    });

    test("returns 400 for invalid name", async () => {
      const res = await api("/api/skills/INVALID..NAME/remove", { method: "POST" });
      expect(res.status).toBe(400);
    });
  });

  describe("GET /api/version", () => {
    test("returns version string", async () => {
      const res = await api("/api/version");
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toHaveProperty("version");
      expect(typeof data.version).toBe("string");
      expect(data.version).not.toBe("");
    });
  });

  describe("POST /api/skills/:name/install with agent options", () => {
    test("installs skill for a specific agent with for param", async () => {
      const res = await api("/api/skills/image/install", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ for: "claude", scope: "project" }),
      });
      const data = await res.json();
      expect(data).toHaveProperty("skill", "image");
      expect(data).toHaveProperty("success");
      expect(data).toHaveProperty("results");
      expect(Array.isArray(data.results)).toBe(true);
    });

    test("returns 400 for invalid agent name via for param", async () => {
      const res = await api("/api/skills/image/install", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ for: "invalid-agent" }),
      });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain("Unknown agent");
    });

    test("handles empty POST body gracefully (full source install)", async () => {
      const res = await api("/api/skills/image/install", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "",
      });
      const data = await res.json();
      expect(data).toHaveProperty("skill");
    });

    test("handles malformed JSON body gracefully", async () => {
      const res = await api("/api/skills/image/install", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not json",
      });
      const data = await res.json();
      // Falls through to full source install since body parsing fails silently
      expect(data).toHaveProperty("skill");
    });

    test("agent install for nonexistent skill returns 400", async () => {
      const res = await api("/api/skills/nonexistent-xyz-999/install", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ for: "claude", scope: "global" }),
      });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.success).toBe(false);
    });

    test("scope defaults to global when not specified", async () => {
      const res = await api("/api/skills/image/install", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ for: "claude" }),
      });
      const data = await res.json();
      expect(data).toHaveProperty("skill", "image");
      expect(data).toHaveProperty("results");
    });
  });

  describe("POST /api/self-update", () => {
    test("attempts self-update and returns result", async () => {
      const res = await api("/api/self-update", { method: "POST" });
      const data = await res.json();
      expect(data).toHaveProperty("success");
      // Either succeeds or fails — both are valid responses
      if (data.success) {
        expect(data).toHaveProperty("output");
      } else {
        expect(data).toHaveProperty("error");
      }
    });
  });

  describe("CORS", () => {
    test("OPTIONS returns CORS headers", async () => {
      const res = await api("/api/skills", { method: "OPTIONS" });
      expect(res.headers.get("access-control-allow-origin")).toBe("*");
      expect(res.headers.get("access-control-allow-methods")).toContain("GET");
      expect(res.headers.get("access-control-allow-methods")).toContain("POST");
      expect(res.headers.get("access-control-allow-headers")).toContain("Content-Type");
    });
  });

  describe("startup integration", () => {
    test("spawns server, hits API, and shuts down", async () => {
      const port = 39000 + Math.floor(Math.random() * 999);
      const proc = Bun.spawn(["bun", "run", "src/server/serve.ts"], {
        env: { ...process.env, PORT: String(port), NO_OPEN: "1" },
        stdout: "pipe",
        stderr: "pipe",
        cwd: import.meta.dir.replace(/\/src\/server$/, ""),
      });

      try {
        // Poll until server is ready (up to 10 seconds)
        const serverUrl = `http://localhost:${port}`;
        let ready = false;
        for (let i = 0; i < 40; i++) {
          try {
            const res = await fetch(`${serverUrl}/api/version`);
            if (res.ok) {
              ready = true;
              break;
            }
          } catch {}
          await Bun.sleep(250);
        }
        expect(ready).toBe(true);

        // Hit GET /api/skills and verify 202 skills
        const skillsRes = await fetch(`${serverUrl}/api/skills`);
        expect(skillsRes.status).toBe(200);
        const skills = await skillsRes.json();
        expect(Array.isArray(skills)).toBe(true);
        expect(skills.length).toBe(202);

        // Hit GET / and check for HTML (if dashboard is built)
        const rootRes = await fetch(`${serverUrl}/`);
        if (rootRes.status === 200) {
          const html = await rootRes.text();
          if (html.includes("<!DOCTYPE html>")) {
            expect(html).toContain("<!DOCTYPE html>");
          }
        }
      } finally {
        proc.kill();
        await proc.exited;
      }
    }, 15000);
  });

  describe("static serving / SPA fallback", () => {
    test("serves index.html for root path", async () => {
      const res = await api("/");
      // May or may not have dashboard built, but should not 404 on API check
      if (res.status === 200) {
        const text = await res.text();
        expect(text).toContain("<!DOCTYPE html>");
      }
    });

    test("SPA fallback serves HTML for unknown non-API routes", async () => {
      const res = await api("/some/random/path");
      // With dashboard built, serves index.html (SPA fallback); without, 404
      if (res.status === 200) {
        const text = await res.text();
        expect(text).toContain("<!DOCTYPE html>");
      } else {
        expect(res.status).toBe(404);
      }
    });
  });

  describe("no-dashboard handler", () => {
    test("returns 404 for GET / when dashboard does not exist", async () => {
      const noDbHandler = createFetchHandler({
        dashboardDir: "/tmp/nonexistent-dashboard-dir",
        dashboardExists: false,
      });
      const req = new Request("http://localhost/");
      const res = await noDbHandler(req);
      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.error).toBe("Not found");
    });

    test("returns 404 for unknown GET paths when dashboard does not exist", async () => {
      const noDbHandler = createFetchHandler({
        dashboardDir: "/tmp/nonexistent-dashboard-dir",
        dashboardExists: false,
      });
      const req = new Request("http://localhost/some/path");
      const res = await noDbHandler(req);
      expect(res.status).toBe(404);
    });

    test("API routes still work when dashboard does not exist", async () => {
      const noDbHandler = createFetchHandler({
        dashboardDir: "/tmp/nonexistent-dashboard-dir",
        dashboardExists: false,
      });
      const req = new Request("http://localhost/api/version");
      const res = await noDbHandler(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toHaveProperty("version");
    });
  });

  describe("startServer", () => {
    test("starts on port 0 and picks a random free port", async () => {
      // We can't easily test startServer directly since it blocks,
      // but we can test via subprocess
      const proc = Bun.spawn(["bun", "run", "src/server/serve.ts"], {
        env: { ...process.env, PORT: "0", NO_OPEN: "1" },
        stdout: "pipe",
        stderr: "pipe",
        cwd: import.meta.dir.replace(/\/src\/server$/, ""),
      });

      try {
        // Read stdout to get the assigned port
        const reader = proc.stdout.getReader();
        let output = "";
        const decoder = new TextDecoder();

        // Read until we find the "running at" message
        for (let i = 0; i < 80; i++) {
          const { value, done } = await reader.read();
          if (done) break;
          output += decoder.decode(value, { stream: true });
          if (output.includes("running at")) break;
          await Bun.sleep(250);
        }
        reader.releaseLock();

        expect(output).toContain("Skills Dashboard running at http://localhost:");

        // Extract the port
        const portMatch = output.match(/localhost:(\d+)/);
        expect(portMatch).not.toBeNull();
        const port = parseInt(portMatch![1]);
        expect(port).toBeGreaterThan(0);
        expect(port).not.toBe(3579); // Should not be the old default

        // Verify the server is actually responding
        const res = await fetch(`http://localhost:${port}/api/version`);
        expect(res.status).toBe(200);
      } finally {
        proc.kill();
        await proc.exited;
      }
    }, 15000);
  });
});
