/**
 * Every test runs with native provider selectors inside its own temporary root
 * (PLA8-00588). Without the preload's isolation, a test that installed the
 * Skills bridge for Sumi wrote into the account's real ~/.config/sumi whenever
 * XDG_CONFIG_HOME was exported, and a later inventory test failed or passed by
 * file order. These assertions fail on any machine if the isolation is removed,
 * whether or not the machine exports XDG_CONFIG_HOME.
 */
import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";
import { tmpdir } from "node:os";
import { operatingSystemAccountHome } from "./test-isolation.fixture.js";
import { useDefaultTestTimeout } from "./test-preload.js";

useDefaultTestTimeout();

const XDG_SELECTORS = ["XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_CACHE_HOME", "XDG_STATE_HOME"] as const;
const SUMI_SELECTORS = ["SUMI_HOME", "SUMI_CONFIG_DIR", "SUMI_CONFIG", "SUMI_CONFIG_CONTENT"] as const;
const inside = (parent: string, child: string) => {
  const rel = relative(parent, child);
  return rel !== "" && !isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`);
};

test("every XDG selector points below the temporary root and never into the account home", () => {
  const accountHome = operatingSystemAccountHome();
  for (const key of XDG_SELECTORS) {
    const value = process.env[key];
    expect(value, key).toBeDefined();
    expect(inside(tmpdir(), value!), `${key}=${value}`).toBe(true);
    expect(inside(accountHome, value!), `${key}=${value}`).toBe(false);
  }
});

test("Sumi's own selectors are cleared, so Sumi resolves through the synthetic XDG roots", () => {
  for (const key of SUMI_SELECTORS) expect(process.env[key], key).toBeUndefined();
});

let previousConfigRoot: string | undefined;
const SUMI_SENTINEL = "/nonexistent/skills-test-sumi-home-must-be-cleared";

test("a selector root written by one test is gone before the next test", () => {
  previousConfigRoot = process.env.XDG_CONFIG_HOME;
  // Never write unless the root is a temporary one: if the isolation is ever broken, this test must fail here
  // rather than write a bridge into the account's real Sumi configuration.
  if (!previousConfigRoot || !inside(tmpdir(), previousConfigRoot) || inside(operatingSystemAccountHome(), previousConfigRoot)) {
    throw new Error(`refusing to write: XDG_CONFIG_HOME is not a temporary root (${previousConfigRoot ?? "unset"})`);
  }
  // A selector set inside one test must not reach the next one either.
  process.env.SUMI_HOME = SUMI_SENTINEL;
  const bridge = join(previousConfigRoot, "sumi", "skills", "skills-cli");
  mkdirSync(bridge, { recursive: true });
  writeFileSync(join(bridge, "SKILL.md"), "# synthetic bridge left by a test\n");
  expect(existsSync(bridge)).toBe(true);
});

test("the next test sees a fresh selector root and none of the previous test's files", () => {
  expect(previousConfigRoot).toBeDefined();
  expect(process.env.XDG_CONFIG_HOME).not.toBe(previousConfigRoot);
  expect(process.env.SUMI_HOME).toBeUndefined();
  // SKILLS_KEEP_TEST_FIXTURES=1 retains roots for inspection; the fresh root still holds.
  if (process.env.SKILLS_KEEP_TEST_FIXTURES !== "1") expect(existsSync(join(previousConfigRoot!, "sumi"))).toBe(false);
  expect(existsSync(join(process.env.XDG_CONFIG_HOME!, "sumi"))).toBe(false);
});
