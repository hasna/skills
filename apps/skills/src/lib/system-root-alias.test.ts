/** The macOS /tmp root alias stays trusted while other processes add and remove entries in the sticky /private/tmp. */
import { afterEach, expect, test } from "bun:test";
import { existsSync, lstatSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as integration from "./agent-integration.js";
import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

// Creates and removes its own empty files directly in /private/tmp until the
// stop file exists, then exits between iterations so no entry is left behind.
const CHURN = `const fs = require("node:fs"), path = require("node:path"); let n = 0; fs.writeSync(1, "ready\\n");
while (!fs.existsSync(process.env.CHURN_STOP)) { const file = path.join("/private/tmp", process.env.CHURN_PREFIX + (n++ % 16)); fs.closeSync(fs.openSync(file, "wx", 0o600)); fs.unlinkSync(file); if (n % 8 === 0) Bun.sleepSync(1); }`;

test.skipIf(process.platform !== "darwin")("entry churn in /private/tmp never makes the /tmp root alias untrusted", async () => {
  const home = mkdtempSync("/private/tmp/skills-alias-churn-"); roots.push(home);
  const spelled = home.replace(/^\/private\/tmp\//, "/tmp/"), stop = join(home, "stop"), prefix = `.skills-alias-churn-${process.pid}-`;
  // Control: the alias is trusted and the home resolves without churn.
  expect(integration.inventoryNativeSkills(spelled, { projectDirs: [], agents: ["claude"] })).toEqual([]);
  const churn = Bun.spawn([process.execPath, "--no-env-file", "-e", CHURN], { env: { PATH: "/usr/bin:/bin", CHURN_STOP: stop, CHURN_PREFIX: prefix }, stdout: "pipe", stderr: "pipe" });
  const failures: string[] = [];
  let before: bigint, after: bigint;
  try {
    const ready = churn.stdout.getReader(); await ready.read(); ready.releaseLock();
    before = lstatSync("/private/tmp", { bigint: true }).ctimeNs;
    for (let round = 0; round < 20; round++) {
      try { integration.inventoryNativeSkills(spelled, { projectDirs: [], agents: ["claude"] }); }
      catch (error) { failures.push(String(error)); }
    }
    after = lstatSync("/private/tmp", { bigint: true }).ctimeNs;
    await Bun.sleep(10); expect(churn.exitCode).toBeNull();
  } finally {
    writeFileSync(stop, "");
    await churn.exited;
  }
  expect(churn.exitCode).toBe(0);
  // The churn really overlapped the alias checks, so the result is not vacuous.
  expect(after!).not.toBe(before!);
  expect(failures).toEqual([]);
  expect(readdirSync("/private/tmp").some(name => name.startsWith(prefix))).toBe(false);
  expect(existsSync(stop)).toBe(true);
});
