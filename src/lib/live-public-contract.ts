import { sanitizeCustomerArtifactList } from "./customer-artifacts.js";
import {
  PUBLIC_CREDIT_QUOTE_KEYS,
  PUBLIC_CREDIT_USAGE_KEYS,
  assertOnlyKeys,
  parsePublicCreditUsageEndpoint,
  parsePublicQuoteEndpoint,
  parsePublicSkillEndpoint,
} from "./public-endpoint-contract.js";
import { normalizeRemoteSkillRunContract } from "./remote-run-contract.js";

export interface LivePublicContractProof {
  version: unknown;
  health: unknown;
  catalog: unknown;
  skill: unknown;
  quote: unknown;
  runs: unknown;
  usage: unknown;
}

export interface LivePublicContractExpectation {
  platformSha: string;
  platformVersion: string;
  clientPin: string;
  probeSkill?: string;
}

const VERSION_KEYS = new Set(["name", "version", "commitSha"]);
const HEALTH_KEYS = new Set(["status", "version", "commitSha", "uptime", "skillCount"]);
const RUN_KEYS = new Set([
  "contractVersion", "id", "skill", "requestedSlug", "status", "exitCode", "correlationId", "credits",
  "formattedCredits", "creditQuote", "createdAt", "startedAt", "completedAt", "durationMs", "outputType",
  "errorCode", "errorMessage", "creditsReserved", "creditsUsed", "creditBalance", "formattedCreditBalance",
  "amountCredits", "recentNetAmountCredits", "error", "code", "details", "artifacts",
]);
const ARTIFACT_KEYS = new Set([
  "id", "type", "runId", "byteSize", "sha256", "createdAt", "fileName", "relativePath", "name", "contentType",
]);
const PROMOTION_PROOF_SKILL = "logo-design";

export function validateLivePublicContract(
  proof: LivePublicContractProof,
  expectation: LivePublicContractExpectation,
): void {
  const probeSkill = expectation.probeSkill ?? "image";
  assertFullSha(expectation.platformSha);
  assertSemver(expectation.platformVersion, "expected platform version");
  assertSemver(expectation.clientPin, "expected client pin");

  const version = strictRecord(proof.version, VERSION_KEYS, "version");
  assert(version.name === "@hasnatools/platform-skills", "live package identity mismatch");
  assert(version.version === expectation.platformVersion, "live platform version mismatch");
  assert(version.commitSha === expectation.platformSha, "live version commit SHA mismatch");

  const health = strictRecord(proof.health, HEALTH_KEYS, "health");
  assert(health.status === "ok", "live health is not ok");
  assert(health.version === expectation.platformVersion, "live health version mismatch");
  assert(health.commitSha === expectation.platformSha, "live health commit SHA mismatch");
  assertSafeInteger(health.uptime, "health.uptime");
  assertSafeInteger(health.skillCount, "health.skillCount");

  const catalog = unwrapArray(proof.catalog, ["skills", "data"], "catalog");
  assert(catalog.length > 0, "live catalog is empty");
  const parsedCatalog = catalog.map((record, index) => parsePublicSkillEndpoint(
    strictRecord(record, undefined, `catalog[${index}]`),
    { strict: true, label: `catalog[${index}]` },
  ));
  const catalogProbe = parsedCatalog.find((entry) => entry?.slug === probeSkill);
  assert(catalogProbe?.currentVersion === expectation.clientPin, "live catalog client pin mismatch");

  const detailRaw = unwrapRecord(proof.skill, ["skill", "data"], "detail");
  const detail = parsePublicSkillEndpoint(detailRaw, { strict: true, label: "detail" });
  assert(detail?.slug === probeSkill, "live detail skill mismatch");
  assert(detail.currentVersion === expectation.clientPin, "live detail client pin mismatch");
  assert(detail.creditQuote && Number.isSafeInteger(detail.creditQuote.credits), "live detail lacks authoritative credits");

  const quoteRaw = unwrapRecord(proof.quote, ["quote", "data"], "quote");
  const quote = parsePublicQuoteEndpoint(quoteRaw, { strict: true, label: "quote" });
  assert(quote.skill === probeSkill, "live quote skill mismatch");
  assert(typeof quote.quoteToken === "string" && quote.quoteToken.length > 0, "live quote lacks a signed token");
  assert(quote.creditQuote && Number.isSafeInteger(quote.creditQuote.credits), "live quote lacks authoritative credits");

  const rawRuns = unwrapArray(proof.runs, ["runs", "data", "items"], "runs");
  assert(rawRuns.length > 0, "live promotion run proof is missing");
  const runs = rawRuns.map((raw, index) => {
    const record = strictRecord(raw, RUN_KEYS, `runs[${index}]`);
    const normalized = normalizeRemoteSkillRunContract(record);
    const canonicalRecord = record.contractVersion === undefined
      ? { ...record, contractVersion: 1 }
      : record;
    assert(
      canonicalJson(normalized) === canonicalJson(canonicalRecord),
      `runs[${index}] must use the canonical public run contract`,
    );
    if (record.creditQuote !== undefined) strictRecord(record.creditQuote, PUBLIC_CREDIT_QUOTE_KEYS, `runs[${index}].creditQuote`);
    if (record.artifacts !== undefined) {
      assert(Array.isArray(record.artifacts), `runs[${index}].artifacts must be an array`);
      for (const [artifactIndex, artifact] of record.artifacts.entries()) {
        strictRecord(artifact, ARTIFACT_KEYS, `runs[${index}].artifacts[${artifactIndex}]`);
      }
      const sanitized = sanitizeCustomerArtifactList(record.artifacts);
      assert(JSON.stringify(sanitized) === JSON.stringify(record.artifacts), `runs[${index}].artifacts are not canonical`);
    }
    assert(normalized.contractVersion === 1, `runs[${index}] contract version is invalid`);
    return normalized;
  });
  const promotionRun = runs.find((run) => run.skill === PROMOTION_PROOF_SKILL
    && run.status === "completed"
    && run.creditsUsed === 1
    && typeof run.id === "string");
  assert(promotionRun, "live provider-free promotion run proof is missing");

  const rawUsage = unwrapArray(proof.usage, ["transactions", "usage", "data", "items"], "usage");
  assert(rawUsage.length > 0, "live promotion usage proof is missing");
  const usage = rawUsage.map((raw, index) => {
    const record = strictRecord(raw, PUBLIC_CREDIT_USAGE_KEYS, `usage[${index}]`);
    const parsed = parsePublicCreditUsageEndpoint(record, { strict: true, label: `usage[${index}]` });
    assert(canonicalJson(parsed) === canonicalJson(record), `usage[${index}] must use the canonical public usage contract`);
    return parsed;
  });
  assert(
    usage.some((entry) => entry.runId === promotionRun.id
      && entry.transactionType === "debit"
      && entry.amountCredits === -promotionRun.creditsUsed!
      && entry.description === "Skill run credits"),
    "live provider-free promotion usage proof is missing",
  );
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function strictRecord(
  value: unknown,
  allowed: ReadonlySet<string> | undefined,
  label: string,
): Record<string, unknown> {
  assert(isRecord(value), `${label} must be an object`);
  if (allowed) assertOnlyKeys(value, allowed, label);
  return value;
}

function unwrapArray(value: unknown, wrappers: string[], label: string): unknown[] {
  if (Array.isArray(value)) return value;
  const record = strictRecord(value, new Set(wrappers), `${label} wrapper`);
  for (const key of wrappers) if (Array.isArray(record[key])) return record[key];
  throw new Error(`${label} does not contain an array`);
}

function unwrapRecord(value: unknown, wrappers: string[], label: string): Record<string, unknown> {
  if (isRecord(value) && wrappers.every((key) => !(key in value))) return value;
  const record = strictRecord(value, new Set(wrappers), `${label} wrapper`);
  for (const key of wrappers) if (isRecord(record[key])) return record[key];
  throw new Error(`${label} does not contain an object`);
}

function assertFullSha(value: string): void {
  assert(/^[a-f0-9]{40}$/.test(value), "expected platform SHA must be a full lowercase commit SHA");
}

function assertSemver(value: string, label: string): void {
  assert(/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(value), `${label} is invalid`);
}

function assertSafeInteger(value: unknown, label: string): void {
  assert(typeof value === "number" && Number.isSafeInteger(value) && value >= 0, `${label} must be a non-negative integer`);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
