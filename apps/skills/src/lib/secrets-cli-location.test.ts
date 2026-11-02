import { afterEach, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { locateSecretsCli, SecretsCliLocationError } from "./secrets-cli.js";
import { useDefaultTestTimeout } from "../test-preload.js";
useDefaultTestTimeout();

// Synthetic fixtures only. No credential is involved: the stand-ins are never run by these lookups.
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function directory() { const root = realpathSync(mkdtempSync(join(tmpdir(), "secrets-cli-location-"))); roots.push(root); return root; }
function plant(folder: string) {
  mkdirSync(folder, { recursive: true });
  const file = join(folder, "secrets");
  writeFileSync(file, "#!/bin/sh\nexit 0\n", { mode: 0o700 });
  chmodSync(file, 0o700);
  return file;
}
function locationRefusal(run: () => unknown): SecretsCliLocationError {
  try { run(); } catch (error) { expect(error).toBeInstanceOf(SecretsCliLocationError); return error as SecretsCliLocationError; }
  throw new Error("expected a SecretsCliLocationError");
}

test("relative PATH entries are never searched: '.' and 'node_modules/.bin' under the working folder", () => {
  const cwd = directory(), home = directory();
  plant(cwd); plant(join(cwd, "node_modules/.bin"));
  expect(locateSecretsCli({ PATH: ".:/usr/bin:/bin" }, { cwd, home })).toBeNull();
  expect(locateSecretsCli({ PATH: "node_modules/.bin:/usr/bin:/bin" }, { cwd, home })).toBeNull();
  // Control: the same folder as an absolute entry is reached, then refused for lying inside the working folder.
  expect(locationRefusal(() => locateSecretsCli({ PATH: `${cwd}/node_modules/.bin` }, { cwd, home })).reason).toContain("inside the working folder");
});

test("an empty PATH entry (the working folder in POSIX) is skipped, and a later absolute entry is used", () => {
  const cwd = directory(), home = directory(), outside = directory();
  plant(cwd);
  expect(locateSecretsCli({ PATH: "::" }, { cwd, home })).toBeNull();
  expect(locateSecretsCli({ PATH: "" }, { cwd, home })).toBeNull();
  const legit = plant(join(outside, "bin"));
  expect(locateSecretsCli({ PATH: `:${outside}/bin` }, { cwd, home })).toBe(legit);
});

test("an absolute entry inside the working folder is refused, with no fall-through to a later entry", () => {
  const cwd = directory(), home = directory(), outside = directory();
  plant(join(cwd, "node_modules/.bin"));
  plant(join(outside, "bin"));
  const error = locationRefusal(() => locateSecretsCli({ PATH: `${cwd}/node_modules/.bin:${outside}/bin` }, { cwd, home }));
  // The reason names no path.
  expect(error.message).not.toContain(cwd);
  expect(error.message).not.toContain(outside);
});

test("a symlink outside the working folder that resolves into it is refused", () => {
  const cwd = directory(), home = directory(), outside = directory();
  const planted = plant(join(cwd, "tools"));
  mkdirSync(join(outside, "bin"));
  symlinkSync(planted, join(outside, "bin/secrets"));
  locationRefusal(() => locateSecretsCli({ PATH: `${outside}/bin` }, { cwd, home }));
  // Control: a symlink that resolves outside the working folder is accepted.
  const other = directory();
  const real = plant(join(other, "real"));
  mkdirSync(join(other, "bin"));
  symlinkSync(real, join(other, "bin/secrets"));
  expect(locateSecretsCli({ PATH: `${other}/bin` }, { cwd, home })).toBe(join(other, "bin/secrets"));
});

test("a sibling whose name only starts with the working folder's name is not inside it", () => {
  const parent = directory(), home = directory();
  const cwd = join(parent, "repo");
  mkdirSync(cwd);
  const sibling = plant(join(parent, "repo-tools"));
  expect(locateSecretsCli({ PATH: join(parent, "repo-tools") }, { cwd, home })).toBe(sibling);
});

test("a PATH entry that is not in resolved form is refused", () => {
  const cwd = directory(), home = directory(), outside = directory();
  plant(join(outside, "bin"));
  mkdirSync(join(outside, "x"));
  locationRefusal(() => locateSecretsCli({ PATH: `${outside}/x/../bin` }, { cwd, home }));
  // Control: a trailing slash is not a different form.
  expect(locateSecretsCli({ PATH: `${outside}/bin/` }, { cwd, home })).toBe(join(outside, "bin/secrets"));
});

test("a working folder that is the home folder or one of its ancestors keeps the user's own installs usable", () => {
  const root = directory();
  const home = join(root, "home");
  const installed = plant(join(home, ".local/bin"));
  expect(locateSecretsCli({ PATH: join(home, ".local/bin") }, { cwd: home, home })).toBe(installed);
  expect(locateSecretsCli({ PATH: join(home, ".local/bin") }, { cwd: root, home })).toBe(installed);
  expect(locateSecretsCli({ PATH: join(home, ".local/bin") }, { cwd: "/", home })).toBe(installed);
  // A checkout below home is still a working folder: its own node_modules/.bin is refused.
  const clone = join(home, "clones/repo");
  plant(join(clone, "node_modules/.bin"));
  locationRefusal(() => locateSecretsCli({ PATH: join(clone, "node_modules/.bin") }, { cwd: clone, home }));
  // Relative entries stay skipped even from home.
  plant(join(home, "rel"));
  expect(locateSecretsCli({ PATH: "rel" }, { cwd: home, home })).toBeNull();
});

test("a directory or a non-executable file named secrets is not a candidate", () => {
  const cwd = directory(), home = directory(), outside = directory();
  mkdirSync(join(outside, "a/secrets"), { recursive: true });
  mkdirSync(join(outside, "b"));
  writeFileSync(join(outside, "b/secrets"), "#!/bin/sh\n", { mode: 0o600 });
  const legit = plant(join(outside, "c"));
  expect(locateSecretsCli({ PATH: `${outside}/a:${outside}/b:${outside}/c` }, { cwd, home })).toBe(legit);
  expect(existsSync(legit)).toBe(true);
});
