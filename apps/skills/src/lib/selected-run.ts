/** Local execution reads a verified immutable object; it never resolves the mutable authoring corpus. */
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir, hostname as stationHostname } from "node:os";
import { resolveExecutionGrant } from "./execution-grant-client.js";
import { grantIdentifier, type ExecutionGrantRequest, type ResolvedExecutionGrant } from "./execution-grants.js";
import type { ResolvedSkillSelection } from "../types/skill-selection.js";
import type { SkillBundleEntry } from "./skill-bundle.js";
import { exactProfileSelection, readSelectedEntries, resolveSelectionContext, type SelectionResolverOptions } from "./selection-resolver.js";
import { readCachedSelection, selectionCacheRoot, SkillSelectionError } from "./selection-cache.js";
import { describeEntries } from "./selected-manifest.js";
import { SkillEntryPaths } from "./skill-entry-path.js";
import { declaredSecretNames, validateSelectedSecretBindings, resolveSelectedSecrets, redactExecutionSecrets, selectedSecretBindingsTemplate, type SelectedSecretBindings, type SelectedSecretsClient } from "./execution-secrets.js";

export interface ResolvedSelectedRun {
  selection: ResolvedSkillSelection;
  profileId: string;
  kind: "instruction" | "executable";
  entries: SkillBundleEntry[];
  manifest: Record<string, any>;
  packageJson: Record<string, any>;
  cacheDir: string;
}
export async function resolveSelectedRun(spec: string, profileId: string, options: SelectionResolverOptions = {}): Promise<ResolvedSelectedRun> {
  const context = await resolveSelectionContext(profileId, options);
  const selection = exactProfileSelection(spec, context.receipt.profile);
  const entries = await readSelectedEntries(selection, context, options);
  return { selection, profileId: context.receipt.profile.profileId, entries, ...describeEntries(entries), cacheDir: selectionCacheRoot(options) };
}
export interface SelectedLocalRunOptions {
  args?: string[];
  input?: unknown;
  cwd?: string;
  timeoutMs?: number;
  /** Only explicitly supplied environment values are available to declared secret references. */
  env?: Record<string, string>;
  /** Explicit value-free vault grants; mutually exclusive with env. */
  secretBindings?: SelectedSecretBindings;
  /** SDK injection seam. The default uses the independently configured Secrets SDK. */
  createSecretsClient?: () => SelectedSecretsClient;
  /** Disable network authorization for explicit cached execution; declared secrets then need caller bindings. */
  sharedExecutionGrants?: boolean;
  /** SDK seam for current shared authorization; responses still undergo exact binding validation. */
  resolveExecutionGrant?: (request: ExecutionGrantRequest) => Promise<ResolvedExecutionGrant>;
}
export async function prepareSelectedSecretBindings(selected: ResolvedSelectedRun, cwd = process.cwd()): Promise<SelectedSecretBindings> {
  const entries = await readCachedSelection(selected.selection, { cacheDir: selected.cacheDir });
  if (!entries) throw new SkillSelectionError("CACHED_BUNDLE_MISSING", "The selected execution bundle is not cached.");
  const { kind, manifest } = describeEntries(entries);
  if (kind !== "executable") throw new SkillSelectionError("INSTRUCTION_SKILL", "Instruction skills do not accept execution secret bindings.");
  const names = declaredSecretNames(manifest.runtime?.env);
  if (!names.length) throw new SkillSelectionError("NO_DECLARED_SECRETS", "This selected executable does not declare any environment references.");
  return selectedSecretBindingsTemplate({ selection: selected.selection, profileId: selected.profileId, cwd }, names);
}
export async function executeSelectedLocal(selected: ResolvedSelectedRun, options: SelectedLocalRunOptions = {}) {
  const selection = structuredClone(selected.selection), profileId = selected.profileId;
  // Re-read and verify so a caller cannot mutate returned entries between resolution and execution.
  const entries = await readCachedSelection(selection, { cacheDir: selected.cacheDir });
  if (!entries) throw new SkillSelectionError("CACHED_BUNDLE_MISSING", "The selected local execution bundle is not cached.");
  const { kind, manifest, packageJson } = describeEntries(entries);
  if (kind === "instruction") throw new SkillSelectionError("INSTRUCTION_SKILL", "This selected skill contains instructions. Use skills load instead of skills run.");
  const runtime = manifest.runtime ?? {};
  if (!runtime || typeof runtime !== "object" || Array.isArray(runtime)) throw new SkillSelectionError("INVALID_SKILL_MANIFEST", "The selected runtime declaration is invalid.");
  if ((runtime.sandbox !== undefined && runtime.sandbox !== "full") || runtime.needs_network === false) {
    throw new SkillSelectionError("LOCAL_SANDBOX_REQUIRED", "This selected version requires filesystem or network isolation. Use a cloud execution target that enforces its runtime policy.");
  }
  if (["hosted", "remote"].includes(packageJson.skills?.runtime) || ["private-hosted", "remote"].includes(packageJson.skills?.source)) {
    throw new SkillSelectionError("CLOUD_TARGET_REQUIRED", "This selected skill is server-owned and requires the cloud target.");
  }
  if ([packageJson.dependencies, packageJson.optionalDependencies, packageJson.peerDependencies].some((deps) => deps && Object.keys(deps).length)) {
    throw new SkillSelectionError("LOCAL_DEPENDENCY_BUILD_REQUIRED", "This selected version needs dependency preparation. Publish a self-contained executable bundle or use the cloud target; local runs do not install packages or run lifecycle scripts.");
  }
  const runtimeName = runtime.runtime ?? "bun";
  if (!["bun", "node", "python3"].includes(runtimeName)) throw new SkillSelectionError("LOCAL_RUNTIME_UNAVAILABLE", "The selected local runtime is unsupported.");
  const executable = runtimeName === "bun" ? process.execPath : Bun.which(runtimeName);
  if (!executable) throw new SkillSelectionError("LOCAL_RUNTIME_UNAVAILABLE", "The selected runtime is not installed on this station.");
  const declaredEntry = runtime.entrypoint ?? (typeof packageJson.bin === "string" ? packageJson.bin : packageJson.bin && typeof packageJson.bin === "object" ? Object.values(packageJson.bin)[0] : undefined);
  if (typeof declaredEntry !== "string" || !entries.some((entry) => entry.path === declaredEntry)) throw new SkillSelectionError("LOCAL_ENTRYPOINT_MISSING", "The selected bundle must declare a regular-file entrypoint in its runtime manifest or package bin.");
  const args = options.args ?? [];
  if (args.length > 128 || args.some((arg) => typeof arg !== "string" || arg.length > 16_384 || arg.includes("\0"))) throw new SkillSelectionError("INVALID_RUN_INPUT", "Local skill arguments exceed their limits.");
  const input = JSON.stringify(options.input ?? {});
  if (Buffer.byteLength(input) > 1024 * 1024) throw new SkillSelectionError("INVALID_RUN_INPUT", "Local skill JSON input exceeds one MiB.");
  const declaredTimeout = runtime.timeout === undefined ? 60_000 : runtime.timeout * 1000;
  const timeoutMs = options.timeoutMs ?? declaredTimeout;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300_000 || !Number.isFinite(declaredTimeout) || declaredTimeout <= 0 || timeoutMs > declaredTimeout) throw new SkillSelectionError("INVALID_RUN_TIMEOUT", "Local skill timeout must be positive, at most five minutes and no longer than the selected runtime allows.");
  const env: Record<string, string> = {};
  for (const key of ["PATH", "HOME", "TMPDIR", "LANG", "LC_ALL", "TERM"]) if (process.env[key]) env[key] = process.env[key]!;
  const names = declaredSecretNames(runtime.env);
  if (options.secretBindings !== undefined && options.env !== undefined) throw new SkillSelectionError("INVALID_SECRET_BINDINGS", "Choose explicit vault bindings or SDK environment values, never both.");
  let bindings = options.secretBindings === undefined ? undefined : validateSelectedSecretBindings(options.secretBindings, { selection, profileId, cwd: options.cwd ?? process.cwd() }, names);
  let secretEnv: Record<string, string> = {};
  const shared = names.length > 0 && options.secretBindings === undefined && options.env === undefined;
  if (shared && options.sharedExecutionGrants === false) throw new SkillSelectionError("EXECUTION_GRANT_FRESH_SELECTION_REQUIRED", "Shared secret grants require a fresh API selection; cached execution is refused.");
  if (!bindings && !shared) for (const name of names) {
    const value = options.env && Object.hasOwn(options.env, name) ? options.env[name] : undefined;
    if (value === undefined) throw new SkillSelectionError("LOCAL_ENV_REQUIRED", `The selected runtime requires an explicit binding for ${name}; use --secret-bindings. Ambient credentials are not inherited.`);
    if (typeof value !== "string" || value.includes("\0") || Buffer.byteLength(value) > 16_384) throw new SkillSelectionError("INVALID_SECRET_BINDINGS", "Explicit environment values must be bounded strings without NUL bytes.");
    secretEnv[name] = value;
  }
  // Explicit caller environment is not a way to override runtime internals or inject undeclared credentials.
  const runDirectory = mkdtempSync(join(tmpdir(), "skills-execution-"));
  const paths = new SkillEntryPaths();
  for (const entry of entries) {
    paths.add(entry.path, 100, () => { throw new SkillSelectionError("INVALID_BUNDLE_PATH", "The execution bundle contains an unsafe path."); }, () => { throw new SkillSelectionError("INVALID_BUNDLE_PATH", "The execution bundle path exceeds its limit."); });
    const destination = join(runDirectory, entry.path);
    mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
    writeFileSync(destination, entry.bytes, { flag: "wx", mode: entry.mode & 0o777 });
  }
  env.SKILLS_INPUT_JSON = input;
  env.SKILLS_WORKSPACE_DIR = resolve(options.cwd ?? process.cwd());
  env.SKILLS_RUN_DIR = runDirectory;
  if (runtime.version) {
    const version = await subprocess([executable, ...(runtimeName === "bun" ? ["--no-env-file"] : []), "--version"], runDirectory, env, "", Math.min(timeoutMs, 5000));
    const actual = version.stdout.trim().replace(/^v/, "").replace(/^Python /, "");
    if (version.exitCode !== 0 || actual !== runtime.version) throw new SkillSelectionError("LOCAL_RUNTIME_VERSION_MISMATCH", "The installed runtime version differs from the version selected by the skill.");
  }
  // Resolve only after source, input, runtime and grant validation. Version probes never receive secrets.
  let executionGrant: {policyRevision: string; grantId: string} | undefined;
  if (shared) {
    const {authority, workspaceId, profileRevision, slug, version, bundleDigest} = selection;
    const request: ExecutionGrantRequest = {
      selection: {authority, workspaceId, profileId, profileRevision, slug, version, bundleDigest},
      consumer: {stationId: process.env.HASNA_STATION || stationHostname(), workspaceDirectory: realpathSync(options.cwd ?? process.cwd())},
    };
    const grant = await (options.resolveExecutionGrant ?? resolveExecutionGrant)(request);
    if (!grant || !grantIdentifier(grant.policyRevision) || !grantIdentifier(grant.grantId)) throw new SkillSelectionError("INVALID_EXECUTION_GRANT", "The Skills API returned an invalid execution grant.");
    bindings = validateSelectedSecretBindings(grant.bindings, {selection, profileId, cwd:options.cwd ?? process.cwd()}, names);
    executionGrant = {policyRevision:grant.policyRevision, grantId:grant.grantId};
  }
  if (bindings) secretEnv = await resolveSelectedSecrets(bindings, options.createSecretsClient);
  const result = await subprocess([executable, ...(runtimeName === "bun" ? ["--no-env-file"] : []), join(runDirectory, declaredEntry), ...args], runDirectory, { ...env, ...secretEnv }, input, timeoutMs);
  result.stdout = redactExecutionSecrets(result.stdout, secretEnv);
  result.stderr = redactExecutionSecrets(result.stderr, secretEnv);
  const receipt = { selection, target: "local" as const, runtime: runtimeName, inputDigest: `sha256:${createHash("sha256").update(input).digest("hex")}`, runDirectory,
    ...(executionGrant ? {executionGrant} : {}),
    ...(bindings ? { secretBinding: { schema: bindings.schema, selection: bindings.selection, consumer: bindings.consumer, secretsAuthority: bindings.secretsAuthority, bindings: bindings.bindings } } : {}), ...result };
  writeFileSync(join(runDirectory, ".execution-receipt.json"), JSON.stringify({ ...receipt, stdout: undefined, stderr: undefined }), { mode: 0o600 });
  return receipt;
}
async function subprocess(command: string[], cwd: string, env: Record<string, string>, input: string, timeoutMs: number): Promise<{ exitCode: number; stdout: string; stderr: string; error?: string }> {
  return new Promise((resolveResult) => {
    const child = spawn(command[0]!, command.slice(1), { cwd, env, shell: false, detached: process.platform !== "win32", stdio: ["pipe", "pipe", "pipe"] });
    let outputBytes = 0, error: string | undefined, ended = false;
    const stdout: Buffer[] = [], stderr: Buffer[] = [];
    const kill = () => { try { if (process.platform !== "win32" && child.pid) process.kill(-child.pid, "SIGKILL"); else child.kill("SIGKILL"); } catch { child.kill("SIGKILL"); } };
    const timer = setTimeout(() => { error = "LOCAL_RUN_TIMEOUT"; kill(); }, timeoutMs);
    const capture = (target: Buffer[]) => (chunk: Buffer) => {
      outputBytes += chunk.length;
      if (outputBytes > 1024 * 1024) { error = "LOCAL_RUN_OUTPUT_LIMIT"; kill(); return; }
      target.push(chunk);
    };
    child.stdout.on("data", capture(stdout)); child.stderr.on("data", capture(stderr));
    const finish = (code: number) => {
      if (ended) return; ended = true; clearTimeout(timer);
      resolveResult({ exitCode: error === "LOCAL_RUN_TIMEOUT" ? 124 : error ? 1 : code, stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8"), ...(error ? { error } : {}) });
    };
    child.on("error", () => { error = "LOCAL_RUNTIME_START_FAILED"; finish(127); });
    child.on("close", (code) => finish(code ?? 1));
    child.stdin.on("error", () => {}); child.stdin.end(input);
  });
}
