import { constants, closeSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, rmdirSync, unlinkSync, ftruncateSync, writeSync } from "node:fs";
import { join } from "node:path";
import { capturePreparationProcess } from "./preparation-process";

export const DEPENDENCY_PREPARATION_MARKER = ".skills-dependency-preparation";
const RECOVERY = "Skill dependency preparation is incomplete. Confirm no installer is running, successfully run bun install --no-save in the skill directory, then remove only .skills-dependency-preparation. See docs/skill-standard.md#recovering-interrupted-dependency-preparation.";

export function hasDependencyPreparationMarker(skillPath: string): boolean {
  try { lstatSync(join(skillPath, DEPENDENCY_PREPARATION_MARKER)); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code !== "ENOENT"; }
}

function claimPreparation(skillPath: string): { finish(success: boolean): boolean; abandon(): void } | undefined {
  const marker = join(skillPath, DEPENDENCY_PREPARATION_MARKER);
  const state = join(marker, "state.json"), active = join(marker, "active");
  let created = false;
  try { mkdirSync(marker, { mode: 0o700 }); created = true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") return; }
  let fd: number | undefined;
  try {
    if (!lstatSync(marker).isDirectory() || lstatSync(marker).isSymbolicLink()) return;
    if (!created) {
      if (readdirSync(marker).some((name) => name !== "state.json")) return;
      if (!lstatSync(state).isFile() || lstatSync(state).isSymbolicLink() || lstatSync(state).size > 1024) return;
      const previous = JSON.parse(readFileSync(state, "utf8"));
      if (previous.version !== 1 || previous.status !== "failed" || Object.keys(previous).length !== 2) return;
    }
    // Exclusive directory creation serializes retries without trusting or
    // signaling a PID persisted by another process. Crash leftovers refuse.
    mkdirSync(active, { mode: 0o700 });
    fd = openSync(state, constants.O_RDWR | constants.O_NOFOLLOW | (created ? constants.O_CREAT | constants.O_EXCL : 0), 0o600);
    if (!fstatSync(fd).isFile()) { closeSync(fd); return; }
    const descriptor = fd;
    const record = (status: "pending" | "failed") => {
      const value = JSON.stringify({ version: 1, status });
      ftruncateSync(descriptor, 0); writeSync(descriptor, value, 0, "utf8");
    };
    record("pending");
    return { abandon() { try { closeSync(descriptor); } catch {} }, finish(success) {
      try {
        if (success) unlinkSync(state);
        else record("failed");
        closeSync(descriptor); fd = undefined;
        rmdirSync(active);
        if (success) rmdirSync(marker);
        return true;
      } catch { try { closeSync(descriptor); } catch {} return false; }
    } };
  } catch { if (fd !== undefined) try { closeSync(fd); } catch {} return; }
}

const DEFAULT_PREPARATION_TIMEOUT_MS = 60_000;

type PreparationFailure = { exitCode: number; error: string };

/** Prepare in the selected corpus without exposing installer diagnostics. */
export async function prepareSkillDependencies(
  skillPath: string,
  env: Record<string, string | undefined>,
  timeoutMs = DEFAULT_PREPARATION_TIMEOUT_MS,
): Promise<PreparationFailure | undefined> {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2_147_483_647) {
    return { exitCode: 1, error: "Invalid dependency preparation timeout" };
  }

  const preparation = claimPreparation(skillPath);
  if (!preparation) return { exitCode: 1, error: RECOVERY };
  const fail = (error: string, exitCode = 1): PreparationFailure => {
    if (!preparation.finish(false)) return { exitCode: 1, error: RECOVERY };
    return { exitCode, error };
  };
  let proc;
  let ownedProcess;
  try {
    proc = Bun.spawn(["bun", "install", "--no-save"], {
      cwd: skillPath,
      env,
      detached: process.platform !== "win32",
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    ownedProcess = capturePreparationProcess(proc);
  } catch {
    return fail("Could not start skill dependency preparation");
  }

  // Drain concurrently without retaining output: registry URLs and lifecycle
  // diagnostics can contain credentials, and full pipes can stall the installer.
  const readers = [proc.stdout.getReader(), proc.stderr.getReader()];
  const drains = readers.map(async (reader) => {
    while (!(await reader.read()).done) { /* discard each bounded chunk */ }
  });
  const kill = () => ownedProcess.kill();
  const failAfterCleanup = async (errorMessage: string, exitCode = 1): Promise<PreparationFailure> => {
    kill();
    try { await proc.exited; }
    catch { preparation.abandon(); return { exitCode, error: RECOVERY }; }
    for (let attempt = 0; attempt < 20; attempt++) {
      const stopped = ownedProcess.groupExited();
      if (stopped === true) return fail(errorMessage, exitCode);
      if (stopped === undefined) break;
      await Bun.sleep(25);
    }
    // Unknown group cleanup remains pending, never accepted as retryable.
    preparation.abandon();
    return { exitCode, error: RECOVERY };
  };
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    kill();
    // A lifecycle descendant may hold a pipe open after its parent exits.
    for (const reader of readers) void reader.cancel().catch(() => {});
  }, timeoutMs);
  try {
    const [exitCode, output] = await Promise.all([proc.exited, Promise.allSettled(drains)]);
    if (timedOut) return await failAfterCleanup("Skill dependency preparation timed out", 124);
    if (exitCode !== 0) {
      kill();
      return await failAfterCleanup(`Skill dependency preparation failed (exit ${exitCode})`);
    }
    if (output.some((result) => result.status === "rejected")) {
      kill();
      return await failAfterCleanup("Could not read skill dependency preparation output");
    }
    if (!preparation.finish(true)) return { exitCode: 1, error: RECOVERY };
  } catch {
    kill();
    return await failAfterCleanup("Skill dependency preparation failed");
  } finally {
    clearTimeout(timer);
    await Promise.allSettled(readers.map((reader) => reader.cancel()));
    for (const reader of readers) reader.releaseLock();
  }
}
