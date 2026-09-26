import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { verifyContentHash } from "./skill-hash.js";
import {
  PORTABLE_SKILL_STANDARD,
  SKILL_RUNTIMES,
  SKILL_SANDBOX_MODES,
  SKILL_SYSTEM_DEPS_ALLOWLIST,
  type PortableSkillManifest,
  type SkillRuntimeName,
  type SkillSandboxMode,
} from "./portable-skills-types.js";
import type { SkillValidationMessage } from "./skill-validation.js";

/**
 * Field-level validator implementing the hasna.skill.v1 JSON Schema
 * (schemas/skill.schema.json). Checks the portable manifest against the
 * contract and verifies the self-referencing content_hash when a skill
 * folder is available. Returns exact field errors with `contract.*` codes.
 *
 * The parity test (skill-contract.test.ts) asserts this validator and the
 * schema file agree on required fields, runtime/sandbox enums, and the
 * system-deps allowlist, so the two cannot drift apart silently.
 */

export const SEMVER_PATTERN =
  "^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)(?:-((?:0|[1-9]\\d*|\\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\\.(?:0|[1-9]\\d*|\\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\\+([0-9a-zA-Z-]+(?:\\.[0-9a-zA-Z-]+)*))?$";
export const CONTENT_HASH_PATTERN = "^[a-f0-9]{64}$";
export const ENV_REFERENCE_PATTERN = "^[A-Z0-9_]+$";
export const MAX_RUNTIME_TIMEOUT_SECONDS = 900;
export const DEFAULT_RUNTIME_TIMEOUT_SECONDS = 900;

export interface PortableContractOptions {
  /**
   * Whether the manifest is the full portable contract (a skill.json exists).
   * When true, the runtime contract and content_hash are required; a manifest
   * present without its integrity field is not portable. SKILL.md-only legacy
   * skills stay under the relaxed rule.
   */
  strict?: boolean;
  /** Skill folder for content_hash verification. */
  skillPath?: string;
}

function add(target: SkillValidationMessage[], code: string, message: string): void {
  target.push({ code, message });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Validate the portable manifest against the hasna.skill.v1 contract.
 * Returns issues only; callers combine with existing directory validation.
 */
export function validatePortableManifestContract(
  manifest: PortableSkillManifest | undefined,
  options: PortableContractOptions = {},
): SkillValidationMessage[] {
  const issues: SkillValidationMessage[] = [];
  if (!manifest) {
    add(issues, "contract.manifest_missing", "No portable manifest to validate");
    return issues;
  }

  if (manifest.standard !== PORTABLE_SKILL_STANDARD) {
    add(issues, "contract.standard_invalid", `standard must be '${PORTABLE_SKILL_STANDARD}'`);
  }
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(manifest.name)) {
    add(issues, "contract.name_invalid", `name '${manifest.name}' must be a lowercase slug (letters, numbers, dots, underscores, hyphens)`);
  }
  if (!isNonEmptyString(manifest.description)) {
    add(issues, "contract.description_missing", "description is required");
  }
  if (!isNonEmptyString(manifest.version)) {
    add(issues, "contract.version_missing", "version is required");
  } else if (!new RegExp(SEMVER_PATTERN).test(manifest.version)) {
    add(issues, "contract.version_invalid", `version '${manifest.version}' is not valid semver`);
  }

  validateRuntimeContract(manifest, issues, options.strict === true);

  const provenance = manifest.provenance;
  if (provenance && !isRecord(provenance)) {
    add(issues, "contract.provenance_invalid", "provenance must be an object");
  } else {
    const sourceCommit = provenance?.source_commit;
    if (sourceCommit !== undefined && sourceCommit !== null && !isNonEmptyString(sourceCommit)) {
      add(issues, "contract.source_commit_invalid", "provenance.source_commit must be a string");
    }
    const changelog = provenance?.changelog;
    if (changelog !== undefined && changelog !== null && !isNonEmptyString(changelog)) {
      add(issues, "contract.changelog_invalid", "provenance.changelog must be a string");
    }
    const declaredHash = provenance?.content_hash;
    if (options.strict && !isNonEmptyString(declaredHash)) {
      add(issues, "contract.content_hash_missing", "provenance.content_hash is required: a portable manifest must carry its canonical content hash");
    } else if (isNonEmptyString(declaredHash) && !new RegExp(CONTENT_HASH_PATTERN).test(declaredHash)) {
      add(issues, "contract.content_hash_invalid", "provenance.content_hash must be a 64-character lowercase hex SHA-256");
    } else if (options.skillPath && isNonEmptyString(declaredHash)) {
      const verification = verifyContentHash(options.skillPath, manifest);
      if (!verification.valid) {
        add(
          issues,
          "contract.content_hash_mismatch",
          `provenance.content_hash does not match the bundle: declared ${verification.declaredHash}, computed ${verification.computedHash}. Content changed without re-hashing (a content change requires a version bump too).`,
        );
      }
    }
  }

  return issues;
}

function validateRuntimeContract(manifest: PortableSkillManifest, issues: SkillValidationMessage[], strict: boolean): void {
  const runtime = manifest.runtime;
  if (runtime === undefined) {
    // Explicit prose instructions have no execution contract. Keep strict
    // runtime requirements for executable and legacy kind-less manifests.
    if (strict && manifest.kind !== "instruction") {
      add(issues, "contract.runtime_missing", "runtime contract is required: { runtime, entrypoint?, timeout?, needs_network?, env?, sandbox?, system_deps?, artifacts? }");
    }
    return;
  }
  if (!isRecord(runtime)) {
    add(issues, "contract.runtime_invalid", "runtime must be an object");
    return;
  }

  const runtimeName = runtime.runtime;
  if (!SKILL_RUNTIMES.includes(runtimeName as SkillRuntimeName)) {
    add(issues, "contract.runtime_invalid", `runtime.runtime must be one of: ${SKILL_RUNTIMES.join(", ")}`);
  }
  if (runtime.version !== undefined && runtime.version !== null && !isNonEmptyString(runtime.version)) {
    add(issues, "contract.runtime_version_invalid", "runtime.version must be a string");
  }
  if (runtime.entrypoint !== undefined && runtime.entrypoint !== null && !isNonEmptyString(runtime.entrypoint)) {
    add(issues, "contract.entrypoint_invalid", "runtime.entrypoint must be a relative path string");
  }
  if (runtime.timeout !== undefined && runtime.timeout !== null) {
    if (typeof runtime.timeout !== "number" || !Number.isInteger(runtime.timeout) || runtime.timeout < 1 || runtime.timeout > MAX_RUNTIME_TIMEOUT_SECONDS) {
      add(issues, "contract.timeout_invalid", `runtime.timeout must be an integer between 1 and ${MAX_RUNTIME_TIMEOUT_SECONDS} seconds`);
    }
  }
  if (runtime.needs_network !== undefined && runtime.needs_network !== null && typeof runtime.needs_network !== "boolean") {
    add(issues, "contract.needs_network_invalid", "runtime.needs_network must be a boolean");
  }
  if (runtime.env !== undefined && runtime.env !== null) {
    if (!Array.isArray(runtime.env)) {
      add(issues, "contract.env_invalid", "runtime.env must be an array of secret REFERENCE names");
    } else {
      for (const reference of runtime.env) {
        if (typeof reference !== "string" || !new RegExp(ENV_REFERENCE_PATTERN).test(reference)) {
          add(issues, "contract.env_invalid", `runtime.env entry '${String(reference)}' must be an uppercase identifier (e.g. OPENAI_API_KEY) — names only, never values`);
        }
      }
    }
  }
  if (runtime.sandbox !== undefined && runtime.sandbox !== null && !SKILL_SANDBOX_MODES.includes(runtime.sandbox as SkillSandboxMode)) {
    add(issues, "contract.sandbox_invalid", `runtime.sandbox must be one of: ${SKILL_SANDBOX_MODES.join(", ")}`);
  }
  if (runtime.system_deps !== undefined && runtime.system_deps !== null) {
    if (!Array.isArray(runtime.system_deps)) {
      add(issues, "contract.system_deps_invalid", "runtime.system_deps must be an array");
    } else {
      for (const dep of runtime.system_deps) {
        if (!SKILL_SYSTEM_DEPS_ALLOWLIST.includes(dep)) {
          add(issues, "contract.system_dep_not_allowed", `runtime.system_deps entry '${dep}' is not on the allowlist: ${SKILL_SYSTEM_DEPS_ALLOWLIST.join(", ")}`);
        }
      }
    }
  }
  if (runtime.artifacts !== undefined && runtime.artifacts !== null) {
    if (!Array.isArray(runtime.artifacts)) {
      add(issues, "contract.artifacts_invalid", "runtime.artifacts must be an array of glob patterns");
    } else {
      for (const glob of runtime.artifacts) {
        if (!isNonEmptyString(glob)) {
          add(issues, "contract.artifacts_invalid", "runtime.artifacts entries must be non-empty glob strings");
        }
      }
    }
  }
}

/** Read a skill.json from disk and parse it, tolerating absence. */
export function readRawSkillJson(skillPath: string): Record<string, unknown> | undefined {
  const path = join(skillPath, "skill.json");
  if (!existsSync(path)) return undefined;
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf-8"));
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}
