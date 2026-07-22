/**
 * Remote registry client.
 *
 * Local registry behavior remains the default. These helpers are opt-in and
 * read from SKILLS_API_URL or config.apiUrl so selfhost or cloud services can
 * expose a compatible registry API without hard-coding deployment details
 * upstream.
 */

import { z } from "zod";
import { getApiKey } from "./auth-store.js";
import { loadConfig, type SkillsConfig } from "./config.js";
import { resolveDeploymentTarget } from "./deployment-mode.js";
import { normalizeSkillsApiOrigin } from "./service-origin.js";
import { containsProhibitedPublicIdentity, containsProhibitedPublicMetadata } from "./public-metadata.js";
import { isPremiumSkill } from "./credit-catalog.js";
import { addSkillsProtocolHeaders } from "./remote-protocol.js";
import { type SkillMeta } from "./registry.js";
import {
  parsePublicAvailability,
  parsePublicSkillEndpoint,
} from "./public-endpoint-contract.js";

const remoteSlugSchema = z.string().min(1).max(128).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const remoteTextSchema = z.string().max(2_000);

const remoteAvailabilitySchema = z.object({
  status: z.enum(["available", "unavailable"]),
  code: z.string().max(128).regex(/^[A-Z0-9_]+$/).optional(),
  message: remoteTextSchema.optional(),
  details: z.array(remoteTextSchema).max(20).optional(),
});

const remoteCanonicalCreditQuoteSchema = z.object({
  formattedCredits: z.string().min(1),
  tier: z.enum(["free", "premium"]),
  creditUnit: z.enum(["run", "image", "second", "character", "song", "thousand_tokens", "article"]),
  credits: z.number().finite().nonnegative(),
  formattedUnitCredits: z.string().optional(),
  unitCount: z.number().optional(),
  estimated: z.boolean(),
  quoteDependsOnInput: z.boolean(),
  quoteRequired: z.boolean(),
  description: z.string().min(1),
});

const remoteSkillSchema = z.object({
  name: remoteSlugSchema.optional(),
  slug: remoteSlugSchema.optional(),
  displayName: remoteTextSchema.optional(),
  description: remoteTextSchema.optional(),
  category: z.string().max(128).optional(),
  tags: z.array(z.string().max(128)).max(100).optional(),
  dependencies: z.array(z.string().max(214)).max(100).optional(),
  version: z.string().max(128).regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/).optional(),
  creditQuote: remoteCanonicalCreditQuoteSchema.optional(),
  availability: remoteAvailabilitySchema.optional(),
  toolDependencies: z.unknown().optional(),
  connectorRequirements: z.unknown().optional(),
  connectorPreflight: z.unknown().optional(),
}).refine((skill) => skill.name || skill.slug, {
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
  const target = resolveDeploymentTarget(config, env);
  return target.mode === "local" ? undefined : target.apiUrl;
}

export function buildSkillsApiUrl(apiUrl: string, endpoint = "/skills"): string {
  const url = new URL(normalizeSkillsApiOrigin(apiUrl, process.env));
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

function normalizeRemoteSkill(skill: z.infer<typeof remoteSkillSchema>): SkillMeta {
  const requestedName = skill.slug || skill.name;
  if (!requestedName) throw new Error("Remote skill requires name or slug");
  if (containsProhibitedPublicIdentity(requestedName)) {
    throw new Error("Remote skill slug contains prohibited execution metadata");
  }
  const parsed = parsePublicSkillEndpoint({
    ...skill,
    currentVersion: skill.version,
  });
  if (!parsed?.name || !parsed.displayName || !parsed.description || !parsed.category || !parsed.tags) {
    throw new Error("Remote skill payload did not produce a public catalog entry");
  }
  const availability = parsed.availability ?? (isPremiumSkill(parsed.name)
    ? parsePublicAvailability({ status: "unavailable", code: "REMOTE_AVAILABILITY_MISSING" })
    : { status: "available" as const });
  const finalAvailability = !parsed.creditQuote && availability.status === "available"
    ? parsePublicAvailability({ status: "unavailable", code: "REMOTE_CREDIT_QUOTE_MISSING" })
    : availability;
  return {
    name: parsed.name,
    displayName: parsed.displayName,
    description: parsed.description,
    category: parsed.category,
    tags: parsed.tags,
    ...(skill.dependencies ? { dependencies: safeRemoteDependencies(skill.dependencies) } : {}),
    ...(skill.version ? { version: skill.version } : {}),
    ...(parsed.creditQuote ? { creditQuote: parsed.creditQuote } : {}),
    availability: finalAvailability,
    ...(parsed.toolDependencies ? { toolDependencies: parsed.toolDependencies } : {}),
    ...(parsed.connectorRequirements ? { connectorRequirements: parsed.connectorRequirements } : {}),
    ...(parsed.connectorPreflight ? { connectorPreflight: parsed.connectorPreflight } : {}),
    source: "remote",
  };
}

function safeRemoteDependencies(dependencies: string[]): string[] {
  return dependencies.filter((dependency) =>
    /^@?[a-z0-9][a-z0-9._/-]*$/i.test(dependency)
    && !containsProhibitedPublicIdentity(dependency)
    && !containsProhibitedCatalogText(dependency)
  );
}

function containsProhibitedCatalogText(value: string): boolean {
  return containsProhibitedPublicMetadata(value);
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
  const headers = addSkillsProtocolHeaders(new Headers({ Accept: "application/json" }));
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
  const apiUrl = options.apiUrl ? normalizeSkillsApiOrigin(options.apiUrl, process.env) : getConfiguredApiUrl();
  if (!apiUrl) {
    throw new Error("Remote registry requires SKILLS_API_URL or config apiUrl");
  }

  const url = buildSkillsApiUrl(apiUrl, options.endpoint);
  return parseRemoteRegistryPayload(await fetchRemoteJson(url, options));
}

export async function loadRemoteSkill(name: string, options: RemoteRegistryOptions = {}): Promise<SkillMeta> {
  const apiUrl = options.apiUrl ? normalizeSkillsApiOrigin(options.apiUrl, process.env) : getConfiguredApiUrl();
  if (!apiUrl) {
    throw new Error("Remote registry requires SKILLS_API_URL or config apiUrl");
  }

  const slug = encodeURIComponent(name);
  const url = buildSkillsApiUrl(apiUrl, options.endpoint ?? `/skills/${slug}`);
  return parseRemoteSkillPayload(await fetchRemoteJson(url, options));
}
