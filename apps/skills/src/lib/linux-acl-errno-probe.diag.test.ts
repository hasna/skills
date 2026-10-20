// DIAG PLA8-00581 (not for merge). On Linux, measure whether this Bun build keeps
// errno intact between an FFI call and the separate FFI read of errno, which the
// guarded config writer's ACL admission (hasNoLinuxAccessAcl) depends on. A fresh
// private directory has no ACL, so every read should be ENODATA (61). Prints one
// masked line; the measurement itself never fails the run.
import { expect, test } from "bun:test";
import { lstatSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { useDefaultTestTimeout } from "../test-preload.js";
import { assertNativePathAcl } from "./agent-integration.js";
import { diagLinuxErrnoProbe, diagMask } from "../cli/commands/runtime-mcp-registration-diag.fixture.js";

useDefaultTestTimeout();

test.skipIf(process.platform !== "linux")("diag PLA8-00581 (not for merge): Linux FFI errno stability under GC", () => {
  const root = mkdtempSync(join(tmpdir(), "skills-errno-probe-"));
  try {
    const replica = diagLinuxErrnoProbe(root, 2_000_000);
    const calls = 5_000; let refusals = 0;
    for (let index = 0; index < calls; index++) {
      if (index % 250 === 0) Bun.gc(false);
      try { assertNativePathAcl(root, lstatSync(root, { bigint: true }), { allowDenyOnly: true, creationParent: true }); }
      catch { refusals++; }
    }
    console.log(`[pla8-00581-errno] ${diagMask(JSON.stringify({ bun: Bun.version, revision: Bun.revision.slice(0, 12), replica, product: { calls, refusals } }))}`);
    expect(typeof replica).toBe("object");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
