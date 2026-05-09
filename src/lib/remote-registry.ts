/**
 * Remote registry client.
 *
 * Local registry behavior remains the default. These helpers are opt-in and
 * read from SKILLS_API_URL or config.apiUrl so private SaaS products can expose
 * a compatible registry API without hard-coding any SaaS details upstream.
 */

import { z } from "zod";
import { loadConfig, type SkillsConfig } from "./config.js";
import type { SkillMeta } from "./registry.js";

const remoteSkillSchema = z.object({
  name: z.string().min(1),
  displayName: z.string().optional(),
  description: z.string().optional(),
  category: z.string().optional(),
  tags: z.array(z.string()).optional(),
  dependencies: z.array(z.string()).optional(),
});

const remoteRegistrySchema = z.union([
  z.array(remoteSkillSchema),
  z.object({ skills: z.array(remoteSkillSchema) }),
  z.object({ data: z.array(remoteSkillSchema) }),
]);

export interface RemoteRegistryOptions {
  apiUrl?: string;
  endpoint?: string;
  timeoutMs?: number;
  fetchImpl?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
}

export function getConfiguredApiUrl(
  config: SkillsConfig = loadConfig(),
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  const raw = env["SKILLS_API_URL"] || config.apiUrl;
  const trimmed = raw?.trim().replace(/\/+$/, "");
  return trimmed || undefined;
}

export function buildSkillsApiUrl(apiUrl: string, endpoint = "/skills"): string {
  const url = new URL(apiUrl);
  const cleanEndpoint = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
  const pathname = url.pathname.replace(/\/+$/, "");

  if (pathname.endsWith("/skills")) {
    url.pathname = pathname;
    return url.toString();
  }

  if (pathname.endsWith("/api") || pathname.endsWith("/api/v1")) {
    url.pathname = `${pathname}${cleanEndpoint}`;
    return url.toString();
  }

  url.pathname = `${pathname}/api/v1${cleanEndpoint}`.replace(/\/{2,}/g, "/");
  return url.toString();
}

function titleize(name: string): string {
  return name.replace(/-/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

export function parseRemoteRegistryPayload(payload: unknown): SkillMeta[] {
  const parsed = remoteRegistrySchema.parse(payload);
  const rawSkills = Array.isArray(parsed) ? parsed : "skills" in parsed ? parsed.skills : parsed.data;

  return rawSkills.map((skill) => {
    const name = skill.name.replace(/^skill-/, "");
    return {
      name,
      displayName: skill.displayName || titleize(name),
      description: skill.description || "",
      category: skill.category || "Remote",
      tags: skill.tags || ["remote"],
      dependencies: skill.dependencies,
      source: "remote",
    };
  });
}

export async function loadRemoteRegistry(options: RemoteRegistryOptions = {}): Promise<SkillMeta[]> {
  const apiUrl = options.apiUrl || getConfiguredApiUrl();
  if (!apiUrl) {
    throw new Error("Remote registry requires SKILLS_API_URL or config apiUrl");
  }

  const url = buildSkillsApiUrl(apiUrl, options.endpoint);
  const fetchImpl = options.fetchImpl || fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 10_000);

  try {
    const response = await fetchImpl(url, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Remote registry request failed: ${response.status} ${response.statusText}`);
    }

    return parseRemoteRegistryPayload(await response.json());
  } finally {
    clearTimeout(timeout);
  }
}
