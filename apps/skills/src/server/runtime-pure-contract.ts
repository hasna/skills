/** Trusted pure interface; publishing a skill never grants admission to it. */
import { inspectSkillBundle, type SkillBundleEntry } from "../lib/skill-bundle.js";
import { digestInput } from "../sdk/execution/admission.js";
import type { FrozenAdmission, PureExecutionContract } from "../sdk/execution/types.js";
import { createHash } from "node:crypto";

export const PURE_DESCRIPTOR = Object.freeze({
  id: "regex-test.v1" as const,
  runtime: "bun",
  adapter: "skills-input-json.v1",
  input: Object.freeze({ patternBytes: 512, textBytes: 4096, totalBytes: 8192, flags: "dgimsuvy" }),
  output: "regex-matches.v1",
  secrets: "none",
  egress: "deny",
  maxDurationMs: 5000,
  maxMemoryMb: 512,
  maxCpuUnits: 256,
  stdoutBytes: 16384,
  stderrBytes: 8192,
  artifactsBytes: 0,
});
export const PURE_DESCRIPTOR_DIGEST = digestInput(PURE_DESCRIPTOR);
export const PURE_LIMITS = Object.freeze({ maxDurationMs: 5000, maxMemoryMb: 512,
  maxCpuUnits: 256, maxArtifactsBytes: 0, maxConcurrency: 1 });
export interface PureInput { pattern: string; text: string; flags: string }
export interface PureReviewedBundle {
  slug: string;
  version: string;
  sha256: string;
  tenantId: string;
  imageDigest: string;
  executionContract: PureExecutionContract;
}
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const object = (v: unknown): Record<string, unknown> => {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw Error("Pure contract requires an object");
  return v as Record<string, unknown>;
};
function keys(v: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(v).some(k => !allowed.includes(k))) throw Error("Unsupported pure contract field");
}

/** JSON.parse alone silently discards duplicate keys, including escaped spellings. */
export function uniqueJson(text: string): unknown {
  const result: unknown = JSON.parse(text);
  let i = 0;
  const ws = () => { while (/\s/.test(text[i] ?? "") && i < text.length) i++; };
  const string = () => {
    const start = i++;
    while (i < text.length) { const c = text[i++]; if (c === "\\") i++; else if (c === '"') break; }
    return JSON.parse(text.slice(start, i)) as string;
  };
  const value = (depth: number): void => {
    if (depth > 32) throw Error("JSON nesting limit exceeded");
    ws();
    if (text[i] === '"') { string(); return; }
    if (text[i] === "{") {
      i++; ws(); const seen = new Set<string>();
      if (text[i] === "}") { i++; return; }
      for (;;) {
        ws(); const key = string();
        if (seen.has(key)) throw Error("Duplicate JSON key");
        seen.add(key); ws(); i++; value(depth + 1); ws();
        if (text[i++] === "}") return;
      }
    }
    if (text[i] === "[") {
      i++; ws(); if (text[i] === "]") { i++; return; }
      for (;;) { value(depth + 1); ws(); if (text[i++] === "]") return; }
    }
    while (i < text.length && !/[\s,\]}]/.test(text[i]!)) i++;
  };
  value(0);
  return result;
}
export function pureInput(value: unknown): PureInput {
  const v = object(value); keys(v, ["pattern", "text", "flags"]);
  if (typeof v.pattern !== "string" || Buffer.byteLength(v.pattern) > 512 ||
      typeof v.text !== "string" || Buffer.byteLength(v.text) > 4096 ||
      typeof v.flags !== "string" || !/^[dgimsuvy]*$/.test(v.flags) ||
      new Set(v.flags).size !== v.flags.length || (v.flags.includes("u") && v.flags.includes("v")) ||
      Buffer.byteLength(JSON.stringify(v)) > 8192) throw Error("Invalid pure regex input");
  // Do not compile or execute user patterns in the API process.
  return { pattern: v.pattern, text: v.text, flags: v.flags };
}
export function assertPureContract(value: unknown): asserts value is PureExecutionContract {
  const v = object(value); keys(v, ["id", "descriptorDigest", "entrypoint", "entrypointDigest"]);
  if (v.id !== PURE_DESCRIPTOR.id || v.descriptorDigest !== PURE_DESCRIPTOR_DIGEST ||
      typeof v.entrypoint !== "string" || !/^src\/[a-zA-Z0-9_/-]+\.[cm]?[jt]s$/.test(v.entrypoint) ||
      v.entrypoint.includes("//") || typeof v.entrypointDigest !== "string" ||
      !/^[a-f0-9]{64}$/.test(v.entrypointDigest)) throw Error("Unsupported pure execution contract");
}
export function assertPureAdmission(a: FrozenAdmission): PureExecutionContract {
  assertPureContract(a.executionContract);
  if (a.runtime !== "bun" || a.dependencyLayerTag !== null || a.policy.egress !== "deny" ||
      a.policy.egressAllowlist.length !== 0 || a.policy.networkByteCap !== 0 ||
      Object.entries(PURE_LIMITS).some(([k,v]) => a.limits[k as keyof typeof PURE_LIMITS] !== v))
    throw Error("Pure admission isolation policy mismatch");
  return a.executionContract;
}
export async function inspectPureBundle(bytes: Uint8Array, contract: PureExecutionContract): Promise<SkillBundleEntry[]> {
  assertPureContract(contract);
  const { entries } = await inspectSkillBundle(bytes, { limits: {
    compressedBytes: 1_000_000, decompressedBytes: 4_000_000, fileBytes: 1_000_000, entries: 100, timeoutMs: 5000,
  } });
  const entry = entries.find(e => e.path === contract.entrypoint);
  if (!entry || hash(entry.bytes) !== contract.entrypointDigest) throw Error("Pure entrypoint integrity failed");
  if (entries.some(e => e.path.split("/").includes("node_modules"))) throw Error("Pure bundle cannot supply dependencies");
  const read = (name: string) => {
    const entry = entries.find(e => e.path === name);
    if (!entry) throw Error("Pure bundle manifest missing");
    return object(uniqueJson(Buffer.from(entry.bytes).toString("utf8")));
  };
  const manifest = read("skill.json"), runtime = object(manifest.runtime), pkg = read("package.json");
  if (manifest.kind !== "executable" || runtime.runtime !== "bun" || runtime.entrypoint !== contract.entrypoint ||
      !Array.isArray(runtime.env) || runtime.env.length !== 0 ||
      (runtime.system_deps !== undefined && (!Array.isArray(runtime.system_deps) || runtime.system_deps.length !== 0)) ||
      runtime.needs_network === true || manifest.needs_network === true)
    throw Error("Pure bundle requires a credential-free self-contained Bun entrypoint");
  for (const key of ["dependencies", "optionalDependencies", "peerDependencies", "devDependencies", "scripts"])
    if (pkg[key] !== undefined && Object.keys(object(pkg[key])).length) throw Error("Pure bundle cannot install dependencies or lifecycle scripts");
  return entries;
}
export function validatePureOutput(stdout: string, input: PureInput): void {
  if (Buffer.byteLength(stdout) > PURE_DESCRIPTOR.stdoutBytes) throw Error("Pure output limit exceeded");
  const v = object(uniqueJson(stdout)); keys(v, ["pattern", "flags", "matches"]);
  if (v.pattern !== input.pattern || v.flags !== input.flags || !Array.isArray(v.matches)) throw Error("Pure output does not match admitted input");
  for (const value of v.matches) {
    const m = object(value); keys(m, ["match", "groups", "namedGroups", "index"]);
    if (typeof m.match !== "string" || !Number.isInteger(m.index) || (m.index as number) < 0 ||
        (m.index as number) > input.text.length || input.text.slice(m.index as number, (m.index as number) + m.match.length) !== m.match ||
        !Array.isArray(m.groups) || m.groups.some(x => x !== null && typeof x !== "string") ||
        (m.namedGroups !== null && Object.values(object(m.namedGroups)).some(x => typeof x !== "string")))
      throw Error("Invalid pure match output");
  }
}
