/**
 * Bun HTTP server for the Skills Dashboard.
 * Serves the Vite-built React dashboard and provides API routes.
 */

import { existsSync, readFileSync } from "fs";
import { join, dirname, extname } from "path";
import { fileURLToPath } from "url";
import { SKILLS, CATEGORIES, getSkill, getSkillsByCategory, searchSkills } from "../lib/registry.js";
import { getInstalledSkills, getInstallMeta, installSkill, removeSkill, installSkillForAgent, resolveAgents } from "../lib/installer.js";
import type { AgentScope } from "../lib/installer.js";
import { getSkillDocs, getSkillBestDoc, getSkillRequirements, generateSkillMd } from "../lib/skillinfo.js";

function getPackageJson(): { version: string; name: string } {
  try {
    const scriptDir = dirname(fileURLToPath(import.meta.url));
    for (const rel of ["../..", ".."]) {
      const pkgPath = join(scriptDir, rel, "package.json");
      if (existsSync(pkgPath)) {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
        return { version: pkg.version || "unknown", name: pkg.name || "skills" };
      }
    }
  } catch {}
  return { version: "unknown", name: "skills" };
}

interface SkillWithStatus {
  name: string;
  displayName: string;
  description: string;
  category: string;
  tags: string[];
  installed: boolean;
  envVars: string[];
  envVarsSet: string[];
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
      "X-API-Version": "1",
      ...SECURITY_HEADERS,
    },
  });
}

/** Validate skill name to prevent path traversal */
function isValidSkillName(name: string): boolean {
  return /^[a-z0-9-]+$/.test(name);
}

/** Filter object keys to only requested fields (for ?fields= param) */
function pickFields(obj: object, fields: string[]): Record<string, unknown> {
  if (fields.length === 0) return obj as Record<string, unknown>;
  const rec = obj as Record<string, unknown>;
  return Object.fromEntries(
    fields.filter(f => f in rec).map(f => [f, rec[f]])
  );
}

function parseFields(searchParams: URLSearchParams): string[] {
  const raw = searchParams.get("fields");
  if (!raw) return [];
  return raw.split(",").map(f => f.trim()).filter(Boolean);
}

function getAllSkillsWithStatus(): SkillWithStatus[] {
  const installed = new Set(getInstalledSkills());
  return SKILLS.map((meta) => {
    const reqs = getSkillRequirements(meta.name);
    const envVars = reqs?.envVars || [];
    return {
      name: meta.name,
      displayName: meta.displayName,
      description: meta.description,
      category: meta.category,
      tags: meta.tags,
      installed: installed.has(meta.name),
      envVars,
      envVarsSet: envVars.filter((v) => !!process.env[v]),
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

export function createFetchHandler(options?: {
  dashboardDir?: string;
  dashboardExists?: boolean;
}): (req: Request) => Promise<Response> {
  const dashboardDir = options?.dashboardDir ?? resolveDashboardDir();
  const dashboardExists = options?.dashboardExists ?? existsSync(dashboardDir);

  return async function fetchHandler(req: Request): Promise<Response> {
    const url = new URL(req.url);
    // Support both /api/v1/... and /api/... (v1 is the default)
    const path = url.pathname.replace(/^\/api\/v1\//, "/api/");
    const method = req.method;

    // ── API Routes ──

    // GET /health - Health check for monitoring
    if (path === "/api/health" && method === "GET") {
      const pkg = getPackageJson();
      return json({
        status: "ok",
        version: pkg.version,
        uptime: Math.floor(process.uptime()),
        skillCount: SKILLS.length,
      });
    }

    // GET /api/skills - All skills with status
    // Supports ?fields=name,category,installed to reduce payload
    // Supports ?stream=true for chunked JSON array streaming
    if (path === "/api/skills" && method === "GET") {
      const fields = parseFields(url.searchParams);
      const skills = getAllSkillsWithStatus();
      const data = fields.length ? skills.map(s => pickFields(s, fields)) : skills;

      if (url.searchParams.get("stream") === "true") {
        const CHUNK_SIZE = 20;
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue("[");
            for (let i = 0; i < data.length; i += CHUNK_SIZE) {
              const chunk = data.slice(i, i + CHUNK_SIZE);
              const prefix = i === 0 ? "" : ",";
              controller.enqueue(prefix + chunk.map(s => JSON.stringify(s)).join(","));
            }
            controller.enqueue("]");
            controller.close();
          },
        });
        return new Response(stream, {
          headers: {
            "Content-Type": "application/json",
            "Transfer-Encoding": "chunked",
            "X-API-Version": "1",
            ...SECURITY_HEADERS,
          },
        });
      }

      return json(data);
    }

    // GET /api/categories - List categories with counts
    if (path === "/api/categories" && method === "GET") {
      const counts = CATEGORIES.map((cat) => ({
        name: cat,
        count: getSkillsByCategory(cat).length,
      }));
      return json(counts);
    }

    // GET /api/tags - List all unique tags with counts
    if (path === "/api/tags" && method === "GET") {
      const tagCounts = new Map<string, number>();
      for (const skill of SKILLS) {
        for (const tag of skill.tags) {
          tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
        }
      }
      const sorted = Array.from(tagCounts.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, count]) => ({ name, count }));
      return json(sorted);
    }

    // GET /api/skills/search?q= - Search skills
    // Supports ?fields=name,category to reduce payload
    if (path === "/api/skills/search" && method === "GET") {
      const query = url.searchParams.get("q") || "";
      if (!query.trim()) return json([]);
      const fields = parseFields(url.searchParams);
      const results = searchSkills(query);
      const installed = new Set(getInstalledSkills());
      const mapped = results.map((meta) => {
        const reqs = getSkillRequirements(meta.name);
        const envVars = reqs?.envVars || [];
        const obj = {
          name: meta.name,
          displayName: meta.displayName,
          description: meta.description,
          category: meta.category,
          tags: meta.tags,
          installed: installed.has(meta.name),
          envVars,
          envVarsSet: envVars.filter((v) => !!process.env[v]),
          systemDeps: reqs?.systemDeps || [],
          cliCommand: reqs?.cliCommand || null,
        };
        return fields.length ? pickFields(obj, fields) : obj;
      });
      return json(mapped);
    }

    // GET /api/skills/:name - Single skill detail
    // Supports ?fields=name,description,envVars to reduce payload
    const singleMatch = path.match(/^\/api\/skills\/([^/]+)$/);
    if (singleMatch && method === "GET") {
      const name = singleMatch[1];
      if (!isValidSkillName(name)) return json({ error: "Invalid skill name" }, 400);
      const meta = getSkill(name);
      if (!meta) return json({ error: `Skill '${name}' not found` }, 404);

      const fields = parseFields(url.searchParams);
      const reqs = getSkillRequirements(name);
      const docs = getSkillBestDoc(name);
      const installed = new Set(getInstalledSkills());
      const isInstalled = installed.has(meta.name);
      const envVars = reqs?.envVars || [];

      // Include install metadata (timestamp + version) when installed
      let installedAt: string | null = null;
      let installedVersion: string | null = null;
      if (isInstalled) {
        const installMeta = getInstallMeta();
        const skillMeta = installMeta.skills?.[meta.name];
        if (skillMeta) {
          installedAt = skillMeta.installedAt || null;
          installedVersion = skillMeta.version || null;
        }
      }

      const obj = {
        name: meta.name,
        displayName: meta.displayName,
        description: meta.description,
        category: meta.category,
        tags: meta.tags,
        installed: isInstalled,
        installedAt,
        installedVersion,
        envVars,
        envVarsSet: envVars.filter((v) => !!process.env[v]),
        systemDeps: reqs?.systemDeps || [],
        cliCommand: reqs?.cliCommand || null,
        docs: docs || null,
      };
      return json(fields.length ? pickFields(obj, fields) : obj);
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
    // Accepts optional JSON body: { for?: "claude"|"codex"|"gemini"|"all", scope?: "global"|"project" }
    const installMatch = path.match(/^\/api\/skills\/([^/]+)\/install$/);
    if (installMatch && method === "POST") {
      const name = installMatch[1];
      if (!isValidSkillName(name)) return json({ error: "Invalid skill name" }, 400);

      // Parse optional JSON body for install options
      let body: { for?: string; scope?: string } = {};
      try {
        const text = await req.text();
        if (text) body = JSON.parse(text);
      } catch {}

      if (body.for) {
        // Agent install mode
        try {
          const agents = resolveAgents(body.for);
          const scope = (body.scope === "project" ? "project" : "global") as AgentScope;
          const results = agents.map((agent) =>
            installSkillForAgent(name, { agent, scope }, generateSkillMd)
          );
          const allSuccess = results.every((r) => r.success);
          const errors = results.filter((r) => !r.success).map((r) => r.error);
          // Compact success response — full results only on failure
          return json(
            allSuccess
              ? { skill: name, success: true }
              : { skill: name, success: false, results, error: errors.join("; ") },
            allSuccess ? 200 : 400
          );
        } catch (e) {
          return json(
            { skill: name, success: false, error: e instanceof Error ? e.message : "Unknown error" },
            400
          );
        }
      } else {
        // Full source install (default) — compact success response
        const result = installSkill(name);
        return json(
          result.success
            ? { skill: name, success: true }
            : { skill: name, success: false, error: result.error },
          result.success ? 200 : 400
        );
      }
    }

    // POST /api/skills/install-category - Install all skills in a category
    // Body: { category: string, for?: string, scope?: string }
    if (path === "/api/skills/install-category" && method === "POST") {
      let body: { category?: string; for?: string; scope?: string } = {};
      try {
        const text = await req.text();
        if (text) body = JSON.parse(text);
      } catch {}

      if (!body.category) {
        return json({ error: "Missing required field: category" }, 400);
      }

      const matchedCategory = CATEGORIES.find(
        (c) => c.toLowerCase() === body.category!.toLowerCase()
      );
      if (!matchedCategory) {
        return json({ error: `Unknown category: ${body.category}. Available: ${CATEGORIES.join(", ")}` }, 400);
      }

      const categorySkills = getSkillsByCategory(matchedCategory);
      const names = categorySkills.map((s) => s.name);

      if (body.for) {
        try {
          const agents = resolveAgents(body.for);
          const scope = (body.scope === "project" ? "project" : "global") as AgentScope;
          const results = [];
          for (const name of names) {
            for (const agent of agents) {
              results.push(installSkillForAgent(name, { agent, scope }, generateSkillMd));
            }
          }
          const allSuccess = results.every((r) => r.success);
          return json({ category: matchedCategory, count: names.length, success: allSuccess, results }, allSuccess ? 200 : 207);
        } catch (e) {
          return json({ success: false, error: e instanceof Error ? e.message : "Unknown error" }, 400);
        }
      } else {
        const results = names.map((name) => installSkill(name));
        const allSuccess = results.every((r) => r.success);
        return json({ category: matchedCategory, count: names.length, success: allSuccess, results }, allSuccess ? 200 : 207);
      }
    }

    // POST /api/skills/:name/remove - Remove skill
    const removeMatch = path.match(/^\/api\/skills\/([^/]+)\/remove$/);
    if (removeMatch && method === "POST") {
      const name = removeMatch[1];
      if (!isValidSkillName(name)) return json({ error: "Invalid skill name" }, 400);
      const success = removeSkill(name);
      return json({ success, skill: name }, success ? 200 : 404);
    }

    // GET /api/version - Current package version
    if (path === "/api/version" && method === "GET") {
      const pkg = getPackageJson();
      return json({ version: pkg.version, name: pkg.name });
    }

    // GET /api/export - Export installed skills as JSON
    if (path === "/api/export" && method === "GET") {
      const skills = getInstalledSkills();
      return json({
        version: 1,
        skills,
        timestamp: new Date().toISOString(),
      });
    }

    // POST /api/import - Import and install a list of skills
    // Body: { skills: string[], for?: string, scope?: string }
    if (path === "/api/import" && method === "POST") {
      let body: { skills?: string[]; for?: string; scope?: string } = {};
      try {
        const text = await req.text();
        if (text) body = JSON.parse(text);
      } catch {
        return json({ error: "Invalid JSON body" }, 400);
      }

      if (!Array.isArray(body.skills)) {
        return json({ error: 'Body must include "skills" array' }, 400);
      }

      const skillList: string[] = body.skills;
      const results: Array<{ skill: string; success: boolean; error?: string }> = [];

      if (body.for) {
        try {
          const agents = resolveAgents(body.for);
          const scope = (body.scope === "project" ? "project" : "global") as AgentScope;
          for (const name of skillList) {
            const agentResults = agents.map((agent) =>
              installSkillForAgent(name, { agent, scope }, generateSkillMd)
            );
            const success = agentResults.every((r) => r.success);
            const errors = agentResults.filter((r) => !r.success).map((r) => r.error).filter(Boolean);
            results.push({ skill: name, success, ...(errors.length > 0 ? { error: errors.join("; ") } : {}) });
          }
        } catch (e) {
          return json({ error: e instanceof Error ? e.message : "Unknown error" }, 400);
        }
      } else {
        for (const name of skillList) {
          const result = installSkill(name);
          results.push({ skill: result.skill, success: result.success, ...(result.error ? { error: result.error } : {}) });
        }
      }

      const imported = results.filter((r) => r.success).length;
      return json(
        { imported, total: skillList.length, results },
        imported === skillList.length ? 200 : 207
      );
    }

    // POST /api/self-update - Update package to latest
    if (path === "/api/self-update" && method === "POST") {
      try {
        const pkg = getPackageJson();
        const proc = Bun.spawn(["bun", "add", "-g", `${pkg.name}@latest`], {
          stdout: "pipe",
          stderr: "pipe",
        });
        const stdout = await new Response(proc.stdout).text();
        const stderr = await new Response(proc.stderr).text();
        const exitCode = await proc.exited;
        if (exitCode === 0) {
          return json({ success: true, output: stdout.trim() || stderr.trim() });
        }
        return json({ success: false, error: stderr.trim() || stdout.trim() }, 500);
      } catch (e) {
        return json({ success: false, error: e instanceof Error ? e.message : "Update failed" }, 500);
      }
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
  };
}

export async function startServer(port: number = 0, options?: { open?: boolean }): Promise<void> {
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
    fetch: createFetchHandler({ dashboardDir, dashboardExists }),
  });

  // Graceful shutdown
  const shutdown = () => {
    server.stop();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  const actualPort = server.port;
  const serverUrl = `http://localhost:${actualPort}`;
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
  const port = parseInt(process.env.PORT || "0", 10);
  startServer(port, { open: !process.env.NO_OPEN });
}
