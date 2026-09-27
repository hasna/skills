#!/usr/bin/env bun
/** One task, one immutable bundle. The supervisor alone owns its short-lived
 * callback credential. The reviewed skill runs as an unprivileged child with an
 * explicit environment and preinstalled, image-pinned dependencies. */
import {
  chmodSync,
  chownSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { inspectSkillBundle } from "../lib/skill-bundle.js";
import { digestInput } from "../sdk/execution/admission.js";
import type { FrozenAdmission } from "../sdk/execution/types.js";
import { assertPureAdmission, inspectPureBundle, PURE_DESCRIPTOR, pureInput, validatePureOutput, type PureInput } from "./runtime-pure-contract.js";
import type { RuntimeResult } from "./runtime-store.js";
import {
  hashBytes,
  RUNTIME_MAX_ARTIFACT_BYTES,
  RUNTIME_MAX_BUNDLE_BYTES,
  RUNTIME_MAX_LOG_BYTES,
  RUNTIME_TIMEOUT_MS,
  runtimeInput,
} from "./runtime-policy.js";
export interface RuntimeWork {
  admission: FrozenAdmission;
  bundleBase64: string;
  input: { content: string; title?: string } | PureInput;
}
export interface SupervisorOptions {
  executable?: string;
  dependenciesPath: string;
  unprivileged?: boolean;
  guardPath?: string;
}

async function capped(
  stream: ReadableStream<Uint8Array>,
  cap: number,
  kill: () => void,
): Promise<string> {
  const reader = stream.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > cap) {
      kill();
      await reader.cancel();
      throw Error("Runtime log limit exceeded");
    }
    parts.push(value);
  }
  return Buffer.concat(parts).toString("utf8");
}
export async function executeRuntimeWork(
  work: RuntimeWork,
  options: SupervisorOptions,
): Promise<RuntimeResult> {
  const contract = work.admission.executionContract ? assertPureAdmission(work.admission) : undefined;
  if (contract && (options.unprivileged === false || process.platform !== "linux"))
    throw Error("Pure execution requires the Linux isolation guard");
  const input = contract ? pureInput(work.input) : runtimeInput(work.input);
  if (
    (!contract && work.admission.skillId !== "pdf-generate") ||
    work.admission.runtime !== "bun" ||
    digestInput(input) !== work.admission.inputDigest
  )
    throw Error("Runtime input contract does not match admission");
  const bytes = Buffer.from(work.bundleBase64, "base64");
  if (
    bytes.length > RUNTIME_MAX_BUNDLE_BYTES ||
    hashBytes(bytes) !== work.admission.bundleDigest.replace(/^sha256:/, "")
  )
    throw Error("Runtime bundle digest mismatch");
  const inspected = contract ? { entries: await inspectPureBundle(bytes, contract) } : await inspectSkillBundle(bytes, {
    limits: {
      compressedBytes: RUNTIME_MAX_BUNDLE_BYTES,
      decompressedBytes: 4_000_000,
      fileBytes: 1_000_000,
      entries: 100,
      timeoutMs: 5000,
    },
  });
  const entrypoint = contract?.entrypoint ?? "src/index.ts";
  if (!inspected.entries.some((e) => e.path === entrypoint))
    throw Error("Reviewed runtime entrypoint is missing");
  const base = mkdtempSync(join(tmpdir(), "skills-execution-"));
  chmodSync(base, 0o755);
  const skill = join(base, "skill"),
    out = join(base, "artifacts"),
    logs = join(base, "logs"),
    home = join(base, "home");
  for (const p of [skill, out, logs, home]) mkdirSync(p, { mode: 0o755 });
  try {
    for (const e of inspected.entries) {
      const p = join(skill, e.path);
      mkdirSync(dirname(p), { recursive: true, mode: 0o755 });
      writeFileSync(p, e.bytes, { mode: 0o444 });
    }
    if (existsSync(join(skill, "node_modules")))
      throw Error("Runtime bundle may not supply dependencies");
    if (!contract) symlinkSync(options.dependenciesPath, join(skill, "node_modules"), "dir");
    const unprivileged = options.unprivileged ?? true;
    if (unprivileged && process.getuid?.() !== 0)
      throw Error(
        "Cloud supervisor must start with privilege to separate the child identity",
      );
    if (unprivileged)
      for (const p of [out, logs, home]) {
        // Change mode while the supervisor owns the directory; after chown,
        // chmod would require an unnecessary FOWNER capability.
        chmodSync(p, 0o700);
        chownSync(p, 65534, 65534);
      }
    const pdf = contract ? undefined : runtimeInput(input);
    const args = contract ? ["--no-install", "--no-env-file", "run", join(skill, entrypoint)] : [
      "run", join(skill, entrypoint), "--content", pdf!.content, "--content-type", "text", "--filename", "document",
      ...(pdf!.title ? ["--title", pdf!.title] : []),
    ];
    const executable = options.executable ?? process.execPath;
    const command = unprivileged
      ? [options.guardPath ?? "/opt/skills-runtime/guard", ...(contract ? ["--pure"] : []), executable, ...args]
      : [executable, ...args];
    const proc = Bun.spawn(command, {
      cwd: skill,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      env: {
        PATH: "/usr/local/bin:/usr/bin:/bin",
        HOME: home,
        TMPDIR: home,
        LANG: "C.UTF-8",
        ...(contract ? { SKILLS_INPUT_JSON: JSON.stringify({ ...input, format: "json" }) } : {
          SKILLS_EXPORTS_DIR: out, SKILLS_LOGS_DIR: logs,
        }),
      },
    });
    // Pure guard owns and reaps its child group. Signal its monitor, never a
    // guessed process group or a station session; SIGKILL would bypass cleanup.
    const stop = () => proc.kill(contract ? "SIGTERM" : 9);
    let timedOut = false;
    const timeout = setTimeout(
      () => {
        timedOut = true;
        stop();
      },
      Math.min(work.admission.limits.maxDurationMs, contract ? PURE_DESCRIPTOR.maxDurationMs : RUNTIME_TIMEOUT_MS),
    );
    let stdout = "",
      stderr = "",
      exitCode: number;
    const reads = [
      capped(proc.stdout, contract ? PURE_DESCRIPTOR.stdoutBytes : RUNTIME_MAX_LOG_BYTES, stop),
      capped(proc.stderr, contract ? PURE_DESCRIPTOR.stderrBytes : RUNTIME_MAX_LOG_BYTES, stop),
      proc.exited,
    ] as const;
    try {
      [stdout, stderr, exitCode] = await Promise.all(reads);
    } finally {
      clearTimeout(timeout);
      stop();
      await Promise.allSettled(reads);
    }
    if (timedOut)
      return {
        exitCode: 124,
        stdout,
        stderr,
        artifacts: [],
        error: "Runtime timeout exceeded",
      };
    if (contract) {
      if (readdirSync(out).length || readdirSync(logs).length) throw Error("Pure execution cannot produce artifacts");
      if (exitCode === 0) validatePureOutput(stdout, pureInput(input));
      return { exitCode, stdout, stderr, artifacts: [] };
    }
    const artifacts: RuntimeResult["artifacts"] = [];
    let total = 0;
    if (exitCode === 0)
      for (const name of readdirSync(out)) {
        if (!["document.pdf", "document.html"].includes(name))
          throw Error("Unexpected runtime artifact");
        const path = join(out, name),
          stat = lstatSync(path);
        if (!stat.isFile() || stat.isSymbolicLink())
          throw Error("Runtime artifact must be a regular file");
        total += stat.size;
        if (total > RUNTIME_MAX_ARTIFACT_BYTES)
          throw Error("Runtime artifact limit exceeded");
        const data = readFileSync(path);
        if (
          name.endsWith(".pdf") &&
          !data.subarray(0, 5).equals(Buffer.from("%PDF-"))
        )
          throw Error("Runtime did not produce a PDF");
        artifacts.push({
          name,
          contentType: name.endsWith(".pdf")
            ? "application/pdf"
            : "text/html; charset=utf-8",
          base64: data.toString("base64"),
          sha256: hashBytes(data),
          byteSize: data.length,
        });
      }
    if (exitCode === 0 && !artifacts.some((a) => a.name === "document.pdf"))
      throw Error("Runtime PDF artifact missing");
    return { exitCode, stdout, stderr, artifacts };
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
}
async function readResponse(response: Response, max: number): Promise<unknown> {
  if (!response.ok) {
    void response.body?.cancel();
    throw Error(`Runtime transport HTTP${response.status}`);
  }
  if (!response.body) throw Error("Runtime response body missing");
  return JSON.parse(await capped(response.body, max, () => {}));
}
export async function runRuntimeWorker(
  env: Record<string, string | undefined> = process.env,
): Promise<void> {
  const origin = env.SKILLS_RUNTIME_API_ORIGIN,
    token = env.SKILLS_RUNTIME_TOKEN,
    run = env.SKILLS_RUN_ID;
  if (!origin || !token || !run || !/^run_[a-z0-9_]+$/.test(run))
    throw Error("Runtime supervisor transport is not configured");
  const metadata = env.ECS_CONTAINER_METADATA_URI_V4;
  if (!metadata) throw Error("Fargate task metadata is required");
  const metadataUrl = new URL(metadata);
  if (
    metadataUrl.protocol !== "http:" ||
    metadataUrl.hostname !== "169.254.170.2"
  )
    throw Error("Invalid task metadata endpoint");
  const identity = (await readResponse(
    await fetch(metadata, {
      signal: AbortSignal.timeout(5000),
      redirect: "error",
    }),
    65536,
  )) as { ImageID?: string };
  if (identity.ImageID !== env.SKILLS_RUNTIME_IMAGE_DIGEST)
    throw Error("Actual task image does not match the admitted image digest");
  const headers = { authorization: `Bearer ${token}` };
  const url = origin.replace(/\/+$/, "") + "/runtime/" + run;
  const work = (await readResponse(
    await fetch(url + "/work", {
      headers,
      signal: AbortSignal.timeout(15000),
      redirect: "error",
    }),
    2_000_000,
  )) as RuntimeWork;
  if (
    work.admission.runId !== run ||
    work.admission.runtimeImageDigest !== env.SKILLS_RUNTIME_IMAGE_DIGEST ||
    work.admission.bundleDigest !== env.SKILLS_BUNDLE_DIGEST
  )
    throw Error("Supervisor launch identity does not match admission");
  let result: RuntimeResult;
  try {
    result = await executeRuntimeWork(work, {
      dependenciesPath: "/opt/skills-runtime/node_modules",
    });
  } catch {
    result = {
      exitCode: 1,
      stdout: "",
      stderr: "",
      artifacts: [],
      error: "Isolated skill execution failed",
    };
  }
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await readResponse(
        await fetch(url + "/complete", {
          method: "POST",
          headers: { ...headers, "content-type": "application/json" },
          body: JSON.stringify(result),
          signal: AbortSignal.timeout(15000),
          redirect: "error",
        }),
        65536,
      );
      return;
    } catch {
      if (attempt === 4)
        throw Error("Runtime completion could not be recorded");
      await Bun.sleep(500 * 2 ** attempt);
    }
  }
}
if (import.meta.main)
  runRuntimeWorker().catch(() => {
    console.error("Runtime supervisor failed; inspect the execution receipt");
    process.exitCode = 1;
  });
