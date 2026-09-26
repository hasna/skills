type OwnedChild = {
  readonly pid: number;
  readonly exitCode: number | null;
  readonly signalCode: string | number | null;
  kill(signal: "SIGKILL"): unknown;
};

type GroupSignal = (pid: number, signal: "SIGKILL" | 0) => unknown;

/** Capture identity immediately after spawn; Bun may change pid after reaping. */
export function capturePreparationProcess(
  child: OwnedChild,
  platform: NodeJS.Platform = process.platform,
  signalGroup: GroupSignal = (pid, signal) => process.kill(pid, signal),
): { kill(): void; groupExited(): boolean | undefined } {
  let spawnedPid: number | undefined;
  try { spawnedPid = child.pid; } catch { /* unknown identity fails closed */ }
  const groupId = typeof spawnedPid === "number" && Number.isSafeInteger(spawnedPid) && spawnedPid > 1
    ? spawnedPid : undefined;
  const canSignalGroup = platform !== "win32" && groupId !== undefined;
  const killLiveChild = () => {
    if (child.exitCode === null && child.signalCode === null) {
      try { child.kill("SIGKILL"); } catch { /* owned child already exited */ }
    }
  };
  return {
    kill() {
      if (!canSignalGroup) { killLiveChild(); return; }
      try { signalGroup(-groupId, "SIGKILL"); }
      catch { killLiveChild(); }
    },
    groupExited() {
      if (!canSignalGroup) return undefined;
      try { signalGroup(-groupId, 0); return false; }
      catch (error) { return (error as NodeJS.ErrnoException).code === "ESRCH" ? true : undefined; }
    },
  };
}
