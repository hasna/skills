/**
 * Bun HTTP server for the Skills Dashboard.
 * Serves the Vite-built React dashboard and provides API routes.
 */

import { existsSync } from "fs";
import { join, dirname, extname } from "path";
import { fileURLToPath } from "url";
import { SKILLS, CATEGORIES, getSkill, getSkillsByCategory, searchSkills } from "../lib/registry.js";
import { getInstalledSkills, installSkill, removeSkill } from "../lib/installer.js";
import { getSkillDocs, getSkillBestDoc, getSkillRequirements } from "../lib/skillinfo.js";

interface SkillWithStatus {
  name: string;
  displayName: string;
  description: string;
  category: string;
  tags: string[];
  installed: boolean;
  envVars: string[];
  systemDeps: string[];
  cliCommand: string | null;
}

// Resolve the dashboard dist directory
function resolveDashboardDir(): string {
  const candidates: string[] = [];

  try {
    const scriptDir = dirname(fileURLToPath(import.meta.url));
    candidates.push(join(scriptDir, "..", "dashboard", "dist"));
    candidates.push(join(scriptDir, "..", "..", "dashboard", "dist"));
  } catch {}

  if (process.argv[1]) {
    const mainDir = dirname(process.argv[1]);
    candidates.push(join(mainDir, "..", "dashboard", "dist"));
    candidates.push(join(mainDir, "..", "..", "dashboard", "dist"));
  }

  candidates.push(join(process.cwd(), "dashboard", "dist"));

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }

  return join(process.cwd(), "dashboard", "dist");
}

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...SECURITY_HEADERS,
    },
  });
}

/** Validate skill name to prevent path traversal */
function isValidSkillName(name: string): boolean {
  return /^[a-z0-9-]+$/.test(name);
}

function getAllSkillsWithStatus(): SkillWithStatus[] {
  const installed = new Set(getInstalledSkills());
  return SKILLS.map((meta) => {
    const reqs = getSkillRequirements(meta.name);
    return {
      name: meta.name,
      displayName: meta.displayName,
      description: meta.description,
      category: meta.category,
      tags: meta.tags,
      installed: installed.has(meta.name),
      envVars: reqs?.envVars || [],
      systemDeps: reqs?.systemDeps || [],
      cliCommand: reqs?.cliCommand || null,
    };
  });
}

function serveStaticFile(filePath: string): Response | null {
  if (!existsSync(filePath)) return null;

  const ext = extname(filePath);
  const contentType = MIME_TYPES[ext] || "application/octet-stream";

  return new Response(Bun.file(filePath), {
    headers: { "Content-Type": contentType },
  });
}

export async function startServer(port: number, options?: { open?: boolean }): Promise<void> {
  const shouldOpen = options?.open ?? true;
  const dashboardDir = resolveDashboardDir();
  const dashboardExists = existsSync(dashboardDir);

  if (!dashboardExists) {
    console.error(`\nDashboard not found at: ${dashboardDir}`);
    console.error(`Run this to build it:\n`);
    console.error(`  cd dashboard && bun install && bun run build\n`);
  }

  const server = Bun.serve({
    port,
    async fetch(req) {
      const url = new URL(req.url);
      const path = url.pathname;
      const method = req.method;

      // ── API Routes ──

      // GET /api/skills - All skills with status
      if (path === "/api/skills" && method === "GET") {
        return json(getAllSkillsWithStatus());
      }

      // GET /api/categories - List categories with counts
      if (path === "/api/categories" && method === "GET") {
        const counts = CATEGORIES.map((cat) => ({
          name: cat,
          count: getSkillsByCategory(cat).length,
        }));
        return json(counts);
      }

      // GET /api/skills/search?q= - Search skills
      if (path === "/api/skills/search" && method === "GET") {
        const query = url.searchParams.get("q") || "";
        if (!query.trim()) return json([]);
        const results = searchSkills(query);
        const installed = new Set(getInstalledSkills());
        return json(
          results.map((meta) => {
            const reqs = getSkillRequirements(meta.name);
            return {
              name: meta.name,
              displayName: meta.displayName,
              description: meta.description,
              category: meta.category,
              tags: meta.tags,
              installed: installed.has(meta.name),
              envVars: reqs?.envVars || [],
              systemDeps: reqs?.systemDeps || [],
              cliCommand: reqs?.cliCommand || null,
            };
          })
        );
      }

      // GET /api/skills/:name - Single skill detail
      const singleMatch = path.match(/^\/api\/skills\/([^/]+)$/);
      if (singleMatch && method === "GET") {
        const name = singleMatch[1];
        if (!isValidSkillName(name)) return json({ error: "Invalid skill name" }, 400);
        const meta = getSkill(name);
        if (!meta) return json({ error: `Skill '${name}' not found` }, 404);

        const reqs = getSkillRequirements(name);
        const docs = getSkillBestDoc(name);
        const installed = new Set(getInstalledSkills());
        return json({
          name: meta.name,
          displayName: meta.displayName,
          description: meta.description,
          category: meta.category,
          tags: meta.tags,
          installed: installed.has(meta.name),
          envVars: reqs?.envVars || [],
          systemDeps: reqs?.systemDeps || [],
          cliCommand: reqs?.cliCommand || null,
          docs: docs || null,
        });
      }

      // GET /api/skills/:name/docs - Raw documentation text
      const docsMatch = path.match(/^\/api\/skills\/([^/]+)\/docs$/);
      if (docsMatch && method === "GET") {
        const name = docsMatch[1];
        if (!isValidSkillName(name)) return json({ error: "Invalid skill name" }, 400);
        const content = getSkillBestDoc(name);
        return json({ content: content || null });
      }

      // POST /api/skills/:name/install - Install skill
      const installMatch = path.match(/^\/api\/skills\/([^/]+)\/install$/);
      if (installMatch && method === "POST") {
        const name = installMatch[1];
        if (!isValidSkillName(name)) return json({ error: "Invalid skill name" }, 400);
        const result = installSkill(name);
        return json(result, result.success ? 200 : 400);
      }

      // POST /api/skills/:name/remove - Remove skill
      const removeMatch = path.match(/^\/api\/skills\/([^/]+)\/remove$/);
      if (removeMatch && method === "POST") {
        const name = removeMatch[1];
        if (!isValidSkillName(name)) return json({ error: "Invalid skill name" }, 400);
        const success = removeSkill(name);
        return json({ success, skill: name }, success ? 200 : 404);
      }

      // ── CORS ──
      if (method === "OPTIONS") {
        return new Response(null, {
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
          },
        });
      }

      // ── Static Files (Vite dashboard) ──
      if (dashboardExists && (method === "GET" || method === "HEAD")) {
        if (path !== "/") {
          const filePath = join(dashboardDir, path);
          const res = serveStaticFile(filePath);
          if (res) return res;
        }

        // SPA fallback: serve index.html for all other GET routes
        const indexPath = join(dashboardDir, "index.html");
        const res = serveStaticFile(indexPath);
        if (res) return res;
      }

      return json({ error: "Not found" }, 404);
    },
  });

  // Graceful shutdown
  const shutdown = () => {
    server.stop();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  const serverUrl = `http://localhost:${port}`;
  console.log(`Skills Dashboard running at ${serverUrl}`);

  if (shouldOpen) {
    try {
      const { exec } = await import("child_process");
      const openCmd = process.platform === "darwin"
        ? "open"
        : process.platform === "win32"
          ? "start"
          : "xdg-open";
      exec(`${openCmd} ${serverUrl}`);
    } catch {}
  }
}

// Run directly when executed as main script
const isMain = import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("serve.ts") ||
  process.argv[1]?.endsWith("serve.js");

if (isMain) {
  const port = parseInt(process.env.PORT || "3579", 10);
  startServer(port, { open: !process.env.NO_OPEN });
}
