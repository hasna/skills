/**
 * Remote registry client.
 *
 * Local registry behavior remains the default. These helpers are opt-in: the
 * authority and the credential both come from the shared fleet ladder
 * (lib/fleet-credentials.ts), so a service can expose a compatible registry API
 * without this package hard-coding anything about where it is deployed.
 */

import { z } from "zod";
import { resolveApiUrl } from "./api-url.js";
import {
  normalizeSkillsApiOrigin,
  skillsApiRequestUrl,
  resolveSkillsConnection,
  SkillsFleetCredentialError,
  SKILLS_API_KEY_ENV,
  SKILLS_API_URL_ENV,
} from "./fleet-credentials.js";
import { sanitizePublicDiscoveryText } from "./discovery.js";
import { mergeSkillRegistryLists } from "./registry-merge.js";
import type { SkillMeta } from "./registry.js";

const remoteAvailabilitySchema = z.object({
  status: z.enum(["available", "unavailable"]),
  code: z.string().optional(),
  message: z.string().optional(),
  details: z.array(z.string()).optional(),
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
  revisionId: z.union([z.string().regex(/^[\x21-\x7e]+$/), z.null()]).optional(),
  lifecycle: z.enum(["active", "archived"]).optional(),
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
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  // Read paths fail closed: no credential means no remote registry, never a
  // fallback host. Resolution lives in one place so auth/write paths and read
  // paths cannot drift apart again.
  return resolveApiUrl(env);
}

/**
 * Compose one Skills API request URL from an authority and an endpoint.
 *
 * The Skills server serves its API under `/api/v1`, so a bare authority gets
 * `/api/v1` appended — the SAME composition `RemoteSkillsClient` performs
 * (`${origin}/api/v1/...`). The two sites must agree: they are handed the same
 * origin by the same resolver.
 *
 * A trailing `/skills` is only stripped when the API prefix precedes it
 * (`.../api/skills`, `.../api/v1/skills`), i.e. when an operator pasted the
 * full collection base that this package's own error messages print. A BARE
 * trailing `/skills` is NOT a collection: the default fleet authority is
 * `https://api.hasna.com/skills`, where `/skills` is the gateway's per-app PATH
 * PREFIX. Treating that as "the base already names the collection" collapsed
 * every remote read onto the gateway app root — which answers 404 — so a
 * correctly credentialled install on the default authority could not run
 * `skills list` at all, on the plain merge path as well as `--remote`.
 */
export function buildSkillsApiUrl(apiUrl: string, endpoint = "/skills"): string {
  const url = new URL(apiUrl);
  if (url.origin === "https://api.hasna.com" && /^\/skills\/(?:api\/)?v1\/skills\/?$/.test(url.pathname)) {
    url.pathname = "/skills";
    apiUrl = url.toString();
  }
  const cleanEndpoint = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
  if (normalizeSkillsApiOrigin(apiUrl) === "https://api.hasna.com/skills") {
    return skillsApiRequestUrl(apiUrl, `/api/v1${cleanEndpoint}`);
  }
  const pathname = url.pathname.replace(/\/+$/, "");

  const apiBase = /\/api(?:\/v1)?\/skills$/.test(pathname)
    ? pathname.slice(0, -"/skills".length)
    : pathname;

  if (/\/api(?:\/v1)?$/.test(apiBase)) {
    url.pathname = `${apiBase}${cleanEndpoint}`;
    return url.toString();
  }

  url.pathname = `${apiBase}/api/v1${cleanEndpoint}`.replace(/\/{2,}/g, "/");
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
    ...(skill.revisionId !== undefined ? { revisionId: skill.revisionId } : {}),
    ...(skill.lifecycle ? { lifecycle: skill.lifecycle } : {}),
    availability: normalizeRemoteAvailability(skill.availability),
    source: "remote",
  };
}

function normalizeRemoteAvailability(
  availability?: z.infer<typeof remoteAvailabilitySchema>,
): NonNullable<SkillMeta["availability"]> {
  if (!availability) return { status: "available" };
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

/**
 * Headers for one remote read: the caller's token, else the fleet ladder's.
 *
 * ASYNC because the ladder is: the pointer tier (`HASNA_SKILLS_API_KEY_REF`)
 * names a VAULT ITEM, and fetching its value is an await. Reading the
 * credential synchronously — the old `getApiKey()` here — saw the pointer's own
 * empty `apiKey` and sent no Authorization header at all, and callers reading
 * the same empty value as "no credential" silently served local data instead.
 * `resolveSkillsApiKey()` completes the pointer, and refuses (loudly) rather
 * than ever returning a blank key, so a hosted install always sends a real one.
 *
 * The header is omitted when the caller passed `authToken: null` on purpose —
 * a library consumer reading an unauthenticated instance of its own. That null
 * is now the ONLY unauthenticated route: with nothing configured, the ladder
 * itself refuses (fail-closed ruling, hasna/apps#1720), so an implicit
 * credentialless read cannot silently pass as one the operator meant.
 *
 * The AMBIENT credential is bound to the origin the ladder resolved it for
 * (`assertCredentialInstance` in fleet-credentials.ts) and is never attached
 * to any other host. `loadRemoteRegistry({ apiUrl })` / `loadRemoteSkill()`
 * are exported from the package entry, and a caller-supplied `apiUrl` with no
 * `authToken` used to be sent the operator's fleet key — the hasna/apps#1794
 * class (#1720 validation). A caller URL that is not the resolved origin now
 * needs an explicit `authToken` (or `authToken: null`); otherwise this refuses
 * with INSTANCE_CREDENTIAL_MISMATCH before any request is made.
 */
async function remoteRequestHeaders(options: RemoteRegistryOptions): Promise<Headers> {
  const headers = new Headers({ Accept: "application/json" });
  const token = options.authToken !== undefined ? options.authToken : await ambientTokenFor(options.apiUrl);
  const trimmed = token?.trim();
  if (trimmed) headers.set("Authorization", `Bearer ${trimmed}`);
  return headers;
}

/**
 * The ambient key, only for the origin it is bound to.
 *
 * Null under the explicit local opt-in (nothing to attach); the ladder's own
 * refusal when nothing is configured; INSTANCE_CREDENTIAL_MISMATCH when the
 * caller named a different host — the same refusal `assertCredentialInstance`
 * raises for a credential whose instance disagrees with the selected API.
 */
async function ambientTokenFor(callerApiUrl: string | undefined): Promise<string | null> {
  const connection = await resolveSkillsConnection();
  if (!connection) return null;
  if (callerApiUrl !== undefined && normalizeSkillsApiOrigin(callerApiUrl) !== connection.apiOrigin) {
    throw new SkillsFleetCredentialError(
      `The Skills credential resolved for ${connection.apiOrigin} is never sent to a caller-supplied apiUrl ` +
        `(${normalizeSkillsApiOrigin(callerApiUrl)}). Pass an explicit authToken for that instance, or authToken: null ` +
        `for an unauthenticated read; no credential was sent.`,
      "INSTANCE_CREDENTIAL_MISMATCH",
    );
  }
  return connection.apiKey;
}

async function fetchRemoteJson(url: string, options: RemoteRegistryOptions): Promise<unknown> {
  const fetchImpl = options.fetchImpl || fetch;
  const headers = await remoteRequestHeaders(options);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 10_000);

  try {
    const response = await fetchImpl(url, {
      headers,
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
    throw new Error(`Remote registry requires a Skills credential (${SKILLS_API_KEY_ENV}, the Keychain item, or ~/.hasna/skills/config/credentials) and, for your own instance, ${SKILLS_API_URL_ENV}`);
  }

  const url = buildSkillsApiUrl(apiUrl, options.endpoint);
  return parseRemoteRegistryPayload(await fetchRemoteJson(url, options));
}

/**
 * Merge the authenticated remote registry into a local listing, whenever the
 * install is pointed at a hosted instance.
 *
 * This is the fail-closed (R1) default-read merge: a client configured with an
 * origin sees the folder UNION cloud in the plain `list`/`search` path, while
 * every other install keeps today's exact local behavior.
 *
 *   - Nothing configured, local opted in -> the local list is returned
 *     unchanged and no request is attempted. An install running on this
 *     machine must stay byte-identical to the pre-merge output.
 *   - Nothing configured and NO local opt-in -> this throws, from the shared
 *     ladder (MISSING_API_CREDENTIAL, naming `HASNA_SKILLS_LOCAL` as the
 *     deliberate way out): local mode is opt-in only, and an unconfigured
 *     install is a refusal rather than a silent local listing.
 *   - An authority configured with NO credential -> this throws, from the
 *     shared ladder. It used to return the local half silently, which is the
 *     false green the 2026-09-04 ruling removes: an operator who pointed this
 *     CLI at an instance and lost the key was shown a healthy local listing.
 *   - Credential (+ authority, else the fleet gateway) -> the remote registry is fetched and merged under
 *     the precedence in registry-merge.ts (custom > extension > private >
 *     private-hosted > remote > upstream > official), remote rows tagged
 *     `source: "remote"`.
 *   - A configured, authenticated read that FAILS (auth rejection, HTTP
 *     error, network failure) throws a clear error rather than silently
 *     returning the local half — a silent partial listing would report
 *     success for a union the caller asked to include.
 *
 * The explicit `--remote` path stays on loadRemoteRegistry(): an explicit
 * request has always been fatal on failure, and that contract is unchanged.
 */
export async function mergeRemoteRegistry(
  local: SkillMeta[],
  options: RemoteRegistryOptions = {},
): Promise<SkillMeta[]> {
  const apiUrl = options.apiUrl || getConfiguredApiUrl();
  if (!apiUrl) return local;
  // A caller that passed `authToken: null` ITSELF asked for an unauthenticated
  // read; that is a library consumer's decision, taken in its own code, and it
  // keeps the local list.
  //
  // The AMBIENT ladder is deliberately NOT consulted here any more. Reading the
  // credential at this line and returning `local` when it looked empty is the
  // silent fallback this function's own doc comment says it removed: a vault
  // pointer (`HASNA_SKILLS_API_KEY_REF`) resolves synchronously to an EMPTY
  // string, so a correctly configured install was read as "no credential" and
  // served the bundled corpus with a zero exit — a configured CLI behaving
  // less safely than an unconfigured one. Resolving the key is now the request
  // path's job (remoteRequestHeaders), which completes a pointer and refuses
  // loudly when a configured credential cannot be produced.
  if (options.authToken !== undefined && !options.authToken?.trim()) return local;
  const remote = await loadRemoteRegistry({ ...options, apiUrl });
  return mergeSkillRegistryLists(local, remote);
}

export async function loadRemoteSkill(name: string, options: RemoteRegistryOptions = {}): Promise<SkillMeta> {
  const apiUrl = options.apiUrl || getConfiguredApiUrl();
  if (!apiUrl) {
    throw new Error(`Remote registry requires a Skills credential (${SKILLS_API_KEY_ENV}, the Keychain item, or ~/.hasna/skills/config/credentials) and, for your own instance, ${SKILLS_API_URL_ENV}`);
  }

  const slug = encodeURIComponent(name);
  const url = buildSkillsApiUrl(apiUrl, options.endpoint ?? `/skills/${slug}`);
  return parseRemoteSkillPayload(await fetchRemoteJson(url, options));
}
