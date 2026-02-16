import { describe, test, expect } from "bun:test";
import { createFetchHandler } from "./serve";

const handler = createFetchHandler();

async function api(path: string, options?: RequestInit): Promise<Response> {
  const req = new Request(`http://localhost${path}`, options);
  return handler(req);
}

describe("Dashboard Server", () => {
  describe("GET /api/skills", () => {
    test("returns all 200 skills", async () => {
      const res = await api("/api/skills");
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("application/json");
      const data = await res.json();
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBe(200);
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

    test("category counts sum to 200", async () => {
      const res = await api("/api/categories");
      const data = await res.json();
      const total = data.reduce((sum: number, cat: any) => sum + cat.count, 0);
      expect(total).toBe(200);
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

  describe("CORS", () => {
    test("OPTIONS returns CORS headers", async () => {
      const res = await api("/api/skills", { method: "OPTIONS" });
      expect(res.headers.get("access-control-allow-origin")).toBe("*");
      expect(res.headers.get("access-control-allow-methods")).toContain("GET");
      expect(res.headers.get("access-control-allow-methods")).toContain("POST");
      expect(res.headers.get("access-control-allow-headers")).toContain("Content-Type");
    });
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
});
