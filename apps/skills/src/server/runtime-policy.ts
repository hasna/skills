import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { EcsDispatcherConfig } from "../sdk/execution/dispatchers/ecs.js";
import type { FrozenAdmission, AttemptRecord } from "../sdk/execution/types.js";
import { assertPureContract, type PureReviewedBundle } from "./runtime-pure-contract.js";
export const RUNTIME_MAX_INPUT_BYTES = 100_000;
export const RUNTIME_MAX_BUNDLE_BYTES = 1_000_000;
export const RUNTIME_MAX_ARTIFACT_BYTES = 2_000_000;
export const RUNTIME_MAX_LOG_BYTES = 32_768;
export const RUNTIME_TIMEOUT_MS = 60_000;
export interface RuntimeConfig extends EcsDispatcherConfig {
  imageDigest: string;
  apiOrigin: string;
  /** Only independently reviewed exact bundles enter this first credential-free lane. */
  reviewedBundles: ({ slug: "pdf-generate"; version: string; sha256: string; executionContract?: never } | PureReviewedBundle)[];
}
export function readRuntimeConfig(
  env: Record<string, string | undefined> = process.env,
): RuntimeConfig | null {
  const raw = env.HASNA_SKILLS_RUNTIME_CONFIG;
  if (!raw) return null;
  let c: RuntimeConfig;
  try {
    c = JSON.parse(raw);
  } catch {
    throw Error("HASNA_SKILLS_RUNTIME_CONFIG must contain valid JSON");
  }
  for (const key of [
    "cluster",
    "taskDefinition",
    "containerName",
    "region",
    "apiOrigin",
  ] as const)
    if (typeof c[key] !== "string" || !c[key].trim())
      throw Error(`Runtime configuration missing ${key}`);
  const origin = new URL(c.apiOrigin);
  if (
    origin.protocol !== "https:" &&
    !(
      origin.protocol === "http:" &&
      ["127.0.0.1", "localhost"].includes(origin.hostname)
    )
  )
    throw Error("Runtime API requires HTTPS");
  if (origin.username || origin.password || origin.search || origin.hash)
    throw Error("Runtime API URL must not carry credentials or query");
  if (!/^sha256:[a-f0-9]{64}$/.test(c.imageDigest))
    throw Error("Runtime image requires a pinned SHA256 digest");
  for (const key of ["subnets", "securityGroups"] as const)
    if (
      !Array.isArray(c[key]) ||
      !c[key].length ||
      c[key].some((v) => typeof v !== "string" || !v)
    )
      throw Error(`Runtime configuration missing ${key}`);
  if (!Array.isArray(c.reviewedBundles) || !c.reviewedBundles.length)
    throw Error("Runtime requires exact reviewed versions and bundle digests");
  const seen = new Set<string>();
  for (const b of c.reviewedBundles) {
    if (!b || typeof b.slug !== "string" || !/^[a-z0-9-]+$/.test(b.slug) ||
        typeof b.version !== "string" || !/^\d+\.\d+\.\d+$/.test(b.version) || !/^[a-f0-9]{64}$/.test(b.sha256))
      throw Error("Runtime requires exact reviewed versions and bundle digests");
    if (b.executionContract) {
      if (b.slug === "pdf-generate") throw Error("pdf-generate is reserved for the legacy PDF contract");
      assertPureContract(b.executionContract);
      if (typeof b.tenantId !== "string" || !b.tenantId.trim() || b.imageDigest !== c.imageDigest)
        throw Error("Pure runtime review must bind tenant and configured image");
    } else if (b.slug !== "pdf-generate") throw Error("Missing reviewed execution contract");
    const key = JSON.stringify([b.executionContract ? b.tenantId : null, b.slug, b.version, b.sha256]);
    if (seen.has(key)) throw Error("Ambiguous runtime review");
    seen.add(key);
  }
  return c;
}
export function runtimeInput(value: unknown): {
  content: string;
  title?: string;
} {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error("PDF input must be an object");
  const v = value as Record<string, unknown>;
  if (Object.keys(v).some((k) => !["content", "title"].includes(k)))
    throw Error("PDF cloud input supports content and title only");
  if (
    typeof v.content !== "string" ||
    !v.content.trim() ||
    Buffer.byteLength(v.content) > RUNTIME_MAX_INPUT_BYTES
  )
    throw Error("PDF content must contain 1-100000 UTF-8 bytes");
  if (
    v.title !== undefined &&
    (typeof v.title !== "string" || Buffer.byteLength(v.title) > 500)
  )
    throw Error("PDF title must be at most 500 UTF-8 bytes");
  return {
    content: v.content,
    ...(v.title === undefined ? {} : { title: v.title as string }),
  };
}
export function runtimeToken(
  key: string,
  admission: FrozenAdmission,
  attempt: AttemptRecord,
): string {
  if (Buffer.byteLength(key) < 32)
    throw Error("Runtime signing key must contain at least 32 bytes");
  const payload = Buffer.from(
    JSON.stringify({
      run: admission.runId,
      attempt: attempt.attemptId,
      generation: attempt.leaseGeneration,
      expires: Date.parse(admission.createdAt) + 20 * 60 * 1000,
    }),
  ).toString("base64url");
  return (
    payload +
    "." +
    createHmac("sha256", key)
      .update("skills-runtime-v1." + payload)
      .digest("base64url")
  );
}
export function verifyRuntimeToken(
  token: string,
  key: string,
  admission: FrozenAdmission,
  attempt: AttemptRecord,
  now = Date.now(),
): boolean {
  if (
    now > Date.parse(admission.createdAt) + 20 * 60 * 1000 ||
    token.length > 1024
  )
    return false;
  const expected = Buffer.from(runtimeToken(key, admission, attempt));
  const actual = Buffer.from(token);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
export const hashBytes = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
