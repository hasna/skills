import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, realpathSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { LAUNCH_CWD_VARIABLE, restoreLaunchCwd } from "./launch-cwd.js";
import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();

const roots: string[] = [];
const originalCwd = process.cwd();
afterEach(() => {
  process.chdir(originalCwd);
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("pinned launcher working directory", () => {
  test("returns to the caller's directory and consumes the variable", () => {
    const dir = join(tmpdir(), `skills-launch-cwd-${crypto.randomUUID()}`);
    roots.push(dir);
    mkdirSync(dir, { mode: 0o700 });
    const env: Record<string, string | undefined> = { [LAUNCH_CWD_VARIABLE]: dir };
    expect(restoreLaunchCwd(env)).toEqual({ restored: true, cwd: realpathSync(dir) });
    expect(process.cwd()).toBe(realpathSync(dir));
    expect(LAUNCH_CWD_VARIABLE in env).toBe(false);
  });

  test("stays in the trusted directory when the variable is absent, relative or unreadable", () => {
    for (const value of [undefined, "", "relative/path", join(tmpdir(), `skills-launch-cwd-missing-${crypto.randomUUID()}`)]) {
      const env: Record<string, string | undefined> = value === undefined ? {} : { [LAUNCH_CWD_VARIABLE]: value };
      expect(restoreLaunchCwd(env)).toEqual({ restored: false, cwd: process.cwd() });
      expect(process.cwd()).toBe(originalCwd);
      expect(LAUNCH_CWD_VARIABLE in env).toBe(false);
    }
  });
});
