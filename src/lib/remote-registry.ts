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
import { sanitizePublicDiscoveryText } from "./discovery.js";
import { isPremiumSkill } from "./pricing.js";
import { toPublicCreditQuote } from "./public-credits.js";
import { addSkillsProtocolHeaders } from "./remote-protocol.js";
import type { SkillMeta } from "./registry.js";

const remoteAvailabilitySchema = z.object({
  status: z.enum(["available", "unavailable"]),
  code: z.string().optional(),
  message: z.string().optional(),
  details: z.array(z.string()).optional(),
}).passthrough();

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
}).passthrough();

const remoteLegacyCreditQuoteSchema = z.object({
  contractVersion: z.literal(1),
  tier: z.enum(["free", "premium"]),
  billingUnit: z.string(),
  costCents: z.number(),
  formattedCost: z.string().optional(),
  formattedUnitCost: z.string().optional(),
  unitCount: z.number().optional(),
  estimated: z.boolean(),
  quoteDependsOnInput: z.boolean(),
  quoteRequired: z.boolean(),
  description: z.string().min(1),
}).passthrough();

const remoteCreditQuoteInputSchema = z.union([
  remoteCanonicalCreditQuoteSchema,
  remoteLegacyCreditQuoteSchema,
]);

const remoteSkillSchema = z.object({
  name: z.string().min(1).optional(),
  slug: z.string().min(1).optional(),
  displayName: z.string().optional(),
  description: z.string().optional(),
  category: z.string().optional(),
  tags: z.array(z.string()).optional(),
  dependencies: z.array(z.string()).optional(),
  version: z.string().optional(),
  pricing: remoteCreditQuoteInputSchema.optional(),
  creditQuote: remoteCreditQuoteInputSchema.optional(),
  availability: remoteAvailabilitySchema.optional(),
}).passthrough().refine((skill) => skill.name || skill.slug, {
  message: "Remote skill requires name or slug",
});

const secretValuePatterns: RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{8,}\b/g,
  /\bgh[opsur]_[A-Za-z0-9_]{8,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{8,}\b/g,
  /\bnpm_[A-Za-z0-9_]{8,}\b/g,
  /\bAKIA[A-Z0-9]{12,}\b/g,
  /\bAIza[A-Za-z0-9_-]{10,}\b/g,
  new RegExp("\\bsecret" + "-token:\\s*[A-Za-z0-9._-]+", "gi"),
  /\bctx7sk\-[A-Za-z0-9_-]{8,}\b/g,
  /\bxai\-[A-Za-z0-9_-]{8,}\b/g,
];

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

function titleize(name: string): string {
  return name.replace(/-/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function normalizeRemoteSkill(skill: z.infer<typeof remoteSkillSchema>): SkillMeta {
  const name = skill.name || skill.slug;
  if (!name) throw new Error("Remote skill requires name or slug");
  const creditQuote = skill.creditQuote || skill.pricing
    ? normalizeRemoteCreditQuote((skill.creditQuote ?? skill.pricing)!)
    : undefined;
  const availability = normalizeRemoteAvailability(name, skill.availability);
  return {
    name,
    displayName: skill.displayName || titleize(name),
    description: skill.description || "",
    category: skill.category || "Remote",
    tags: skill.tags || ["remote"],
    dependencies: skill.dependencies,
    ...(skill.version ? { version: skill.version } : {}),
    ...(creditQuote ? { creditQuote } : {}),
    availability: !creditQuote && availability.status === "available"
      ? {
          status: "unavailable",
          code: "REMOTE_CREDIT_QUOTE_MISSING",
          message: "The remote service did not publish an authoritative credit quote for this skill.",
          details: ["The run is blocked until a credit quote is available. No credits were charged."],
        }
      : availability,
    source: "remote",
  };
}

function normalizeRemoteCreditQuote(value: z.infer<typeof remoteCreditQuoteInputSchema>) {
  return "contractVersion" in value
    ? undefined
    : toPublicCreditQuote(value);
}

function normalizeRemoteAvailability(
  name: string,
  availability?: z.infer<typeof remoteAvailabilitySchema>,
): NonNullable<SkillMeta["availability"]> {
  if (!availability) {
    return isPremiumSkill(name)
      ? {
          status: "unavailable",
          code: "REMOTE_AVAILABILITY_MISSING",
          message: "The remote service did not publish run availability for this skill.",
          details: ["No credits were charged."],
        }
      : { status: "available" };
  }
  if (availability.status === "available") return { status: "available" };
  return {
    status: availability.status,
    ...(safeAvailabilityCode(availability.code) ? { code: safeAvailabilityCode(availability.code) } : {}),
    ...(availability.message ? { message: sanitizeAvailabilityText(availability.message) } : {}),
    ...(availability.details ? { details: availability.details.map(sanitizeAvailabilityText).filter(Boolean) } : {}),
  };
}

function safeAvailabilityCode(code: string | undefined): string | undefined {
  if (!code) return undefined;
  return /^[A-Z0-9_]+$/.test(code) ? code : undefined;
}

function sanitizeAvailabilityText(text: string): string {
  return secretValuePatterns.reduce(
    (value, pattern) => value.replace(pattern, "credential"),
    sanitizePublicDiscoveryText(text)
      .replace(/\b[A-Z0-9_]*(?:API_KEY|SECRET|TOKEN|CREDENTIAL)[A-Z0-9_]*\b/g, "credential"),
  )
    .replace(/\s{2,}/g, " ")
    .trim();
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
