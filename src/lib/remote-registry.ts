/**
 * Remote registry client.
 *
 * Local registry behavior remains the default. These helpers are opt-in and
 * read from SKILLS_API_URL or config.apiUrl so private SaaS products can expose
 * a compatible registry API without hard-coding any SaaS details upstream.
 */

import { z } from "zod";
import { getApiKey } from "./auth-store.js";
import { loadConfig, type SkillsConfig } from "./config.js";
import type { SkillMeta } from "./registry.js";

const remotePricingSchema = z.object({
  formattedCost: z.string(),
  tier: z.string().optional(),
  billingUnit: z.string().optional(),
  costCents: z.number().optional(),
  formattedUnitCost: z.string().optional(),
  unitCount: z.number().optional(),
  estimated: z.boolean().optional(),
  quoteDependsOnInput: z.boolean().optional(),
  quoteRequired: z.boolean().optional(),
  description: z.string().optional(),
}).passthrough();

const remoteSkillSchema = z.object({
  name: z.string().min(1).optional(),
  slug: z.string().min(1).optional(),
  displayName: z.string().optional(),
  description: z.string().optional(),
  category: z.string().optional(),
  tags: z.array(z.string()).optional(),
  dependencies: z.array(z.string()).optional(),
  version: z.string().optional(),
  pricing: remotePricingSchema.optional(),
}).passthrough().refine((skill) => skill.name || skill.slug, {
  message: "Remote skill requires name or slug",
});

const remoteSkillDetailSchema = z.union([
  remoteSkillSchema,
  z.object({ skill: remoteSkillSchema }),
  z.object({ data: remoteSkillSchema }),
]);

const remoteRegistrySchema = z.union([
  z.array(remoteSkillSchema),
  z.object({ skills: z.array(remoteSkillSchema) }),
  z.object({ data: z.array(remoteSkillSchema) }),
]);

export interface RemoteRegistryOptions {
  apiUrl?: string;
  endpoint?: string;
  timeoutMs?: number;
  authToken?: string | null;
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
    if (cleanEndpoint === "/skills") {
      url.pathname = pathname;
    } else {
      url.pathname = `${pathname.slice(0, -"/skills".length)}${cleanEndpoint}` || cleanEndpoint;
    }
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

function normalizeRemoteSkill(skill: z.infer<typeof remoteSkillSchema>): SkillMeta {
  const name = skill.name || skill.slug;
  if (!name) throw new Error("Remote skill requires name or slug");
  return {
    name,
    displayName: skill.displayName || titleize(name),
    description: skill.description || "",
    category: skill.category || "Remote",
    tags: skill.tags || ["remote"],
    dependencies: skill.dependencies,
    ...(skill.version ? { version: skill.version } : {}),
    ...(skill.pricing ? { pricing: skill.pricing } : {}),
    source: "remote",
  };
}

export function parseRemoteRegistryPayload(payload: unknown): SkillMeta[] {
  const parsed = parseRemoteContract(
    remoteRegistrySchema,
    payload,
    "Remote registry payload did not match the expected skills contract",
  );
  const rawSkills = Array.isArray(parsed) ? parsed : "skills" in parsed ? parsed.skills : parsed.data;

  return rawSkills.map(normalizeRemoteSkill);
}

export function parseRemoteSkillPayload(payload: unknown): SkillMeta {
  const parsed = parseRemoteContract(
    remoteSkillDetailSchema,
    payload,
    "Remote skill payload did not match the expected skills contract",
  );
  const skill = ("skill" in parsed ? parsed.skill : "data" in parsed ? parsed.data : parsed) as z.infer<typeof remoteSkillSchema>;
  return normalizeRemoteSkill(skill);
}

function parseRemoteContract<T>(schema: z.ZodType<T>, payload: unknown, message: string): T {
  try {
    return schema.parse(payload);
  } catch (error) {
    if (error instanceof z.ZodError) throw new Error(message, { cause: error });
    throw error;
  }
}

function remoteRequestHeaders(options: RemoteRegistryOptions): Headers {
  const headers = new Headers({ Accept: "application/json" });
  const token = options.authToken !== undefined ? options.authToken : getApiKey();
  const trimmed = token?.trim();
  if (trimmed) headers.set("Authorization", `Bearer ${trimmed}`);
  return headers;
}

async function fetchRemoteJson(url: string, options: RemoteRegistryOptions): Promise<unknown> {
  const fetchImpl = options.fetchImpl || fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 10_000);

  try {
    const response = await fetchImpl(url, {
      headers: remoteRequestHeaders(options),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Remote registry request failed: ${response.status} ${response.statusText}`);
    }

    return response.json();
  } finally {
    clearTimeout(timeout);
  }
}

export async function loadRemoteRegistry(options: RemoteRegistryOptions = {}): Promise<SkillMeta[]> {
  const apiUrl = options.apiUrl || getConfiguredApiUrl();
  if (!apiUrl) {
    throw new Error("Remote registry requires SKILLS_API_URL or config apiUrl");
  }

  const url = buildSkillsApiUrl(apiUrl, options.endpoint);
  return parseRemoteRegistryPayload(await fetchRemoteJson(url, options));
}

export async function loadRemoteSkill(name: string, options: RemoteRegistryOptions = {}): Promise<SkillMeta> {
  const apiUrl = options.apiUrl || getConfiguredApiUrl();
  if (!apiUrl) {
    throw new Error("Remote registry requires SKILLS_API_URL or config apiUrl");
  }

  const slug = encodeURIComponent(name);
  const url = buildSkillsApiUrl(apiUrl, options.endpoint ?? `/skills/${slug}`);
  return parseRemoteSkillPayload(await fetchRemoteJson(url, options));
}
