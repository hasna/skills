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

test("bun run from a workspace subfolder: a bin in a parent's node_modules/.bin is refused (N1)", () => {
  const repo = directory(), home = directory(), outside = directory();
  const cwd = join(repo, "apps/x");
  mkdirSync(cwd, { recursive: true });
  // A hoisted dependency bin: repo/node_modules/.bin/secrets is a symlink into repo/node_modules/<pkg>, outside cwd.
  const hoisted = plant(join(repo, "node_modules/evil-pkg/bin"));
  mkdirSync(join(repo, "node_modules/.bin"), { recursive: true });
  symlinkSync(hoisted, join(repo, "node_modules/.bin/secrets"));
  plant(join(outside, "bin"));
  const error = locationRefusal(() => locateSecretsCli({ PATH: `${cwd}/node_modules/.bin:${repo}/node_modules/.bin:${outside}/bin` }, { cwd, home }));
  expect(error.reason).toContain("node_modules of the working folder or a parent");
  expect(error.message).not.toContain(repo);
  // A plain file planted in the parent's node_modules/.bin is refused the same way.
  const repo2 = directory();
  const cwd2 = join(repo2, "packages/y");
  mkdirSync(cwd2, { recursive: true });
  plant(join(repo2, "node_modules/.bin"));
  locationRefusal(() => locateSecretsCli({ PATH: `${repo2}/node_modules/.bin` }, { cwd: cwd2, home }));
  // Control: from the same subfolder, a CLI outside the project is used.
  const legit = join(outside, "bin/secrets");
  expect(locateSecretsCli({ PATH: `${outside}/bin` }, { cwd, home })).toBe(legit);
});

test("a PATH entry elsewhere that resolves into a parent's node_modules is refused (N1)", () => {
  const repo = directory(), home = directory(), outside = directory();
  const cwd = join(repo, "apps/x");
  mkdirSync(cwd, { recursive: true });
  const planted = plant(join(repo, "node_modules/some-pkg/bin"));
  mkdirSync(join(outside, "bin"));
  symlinkSync(planted, join(outside, "bin/secrets"));
  locationRefusal(() => locateSecretsCli({ PATH: `${outside}/bin` }, { cwd, home }));
});

test("a retained runtime under the user's home stays usable from a checkout below home (N1 control)", () => {
  const home = directory();
  // The retained runtime layout: ~/.local/bin/secrets -> ~/.hasna/secrets/runtime/<v>/node_modules/@hasna/secrets/bin/secrets.
  const runtime = plant(join(home, ".hasna/secrets/runtime/0.6.5-copyfile/node_modules/@hasna/secrets/bin"));
  mkdirSync(join(home, ".local/bin"), { recursive: true });
  symlinkSync(runtime, join(home, ".local/bin/secrets"));
  // The checkout sits below ~/.hasna too, so ~/.hasna is one of the working folder's parents.
  const cwd = join(home, ".hasna/repos/worktrees/org/repo/apps/x");
  mkdirSync(cwd, { recursive: true });
  expect(locateSecretsCli({ PATH: `${home}/.local/bin` }, { cwd, home })).toBe(join(home, ".local/bin/secrets"));
  // Its runtime is also accepted when reached directly through its own bin folder.
  expect(locateSecretsCli({ PATH: dirnameOf(runtime) }, { cwd, home })).toBe(runtime);
  // But a node_modules directly under one of those parents is project-injected and refused.
  plant(join(home, ".hasna/repos/worktrees/org/repo/node_modules/.bin"));
  locationRefusal(() => locateSecretsCli({ PATH: `${home}/.hasna/repos/worktrees/org/repo/node_modules/.bin` }, { cwd, home }));
});

function dirnameOf(file: string) { return file.slice(0, file.lastIndexOf("/")); }

test("a committed symlink node_modules -> elsewhere in a parent folder is refused (N1 review B1)", () => {
  const repo = directory(), home = directory(), outside = directory();
  const cwd = join(repo, "apps/x");
  mkdirSync(cwd, { recursive: true });
  plant(join(repo, "nm_real/.bin"));
  symlinkSync(join(repo, "nm_real"), join(repo, "node_modules"));
  locationRefusal(() => locateSecretsCli({ PATH: `${repo}/node_modules/.bin` }, { cwd, home }));
  // node_modules pointing outside the repository entirely.
  const repo2 = directory();
  const cwd2 = join(repo2, "apps/x");
  mkdirSync(cwd2, { recursive: true });
  plant(join(outside, "elsewhere/.bin"));
  symlinkSync(join(outside, "elsewhere"), join(repo2, "node_modules"));
  locationRefusal(() => locateSecretsCli({ PATH: `${repo2}/node_modules/.bin` }, { cwd: cwd2, home }));
});

test("a node_modules/.bin that is itself a symlink out of node_modules is refused (N1 review B1)", () => {
  const repo = directory(), home = directory();
  const cwd = join(repo, "apps/x");
  mkdirSync(cwd, { recursive: true });
  plant(join(repo, "tools"));
  mkdirSync(join(repo, "node_modules"), { recursive: true });
  symlinkSync("../tools", join(repo, "node_modules/.bin"));
  locationRefusal(() => locateSecretsCli({ PATH: `${repo}/node_modules/.bin` }, { cwd, home }));
  // A .bin file linking to a file outside the project is refused too.
  const repo2 = directory(), outside = directory();
  const cwd2 = join(repo2, "apps/x");
  mkdirSync(cwd2, { recursive: true });
  const target = plant(join(outside, "bin"));
  mkdirSync(join(repo2, "node_modules/.bin"), { recursive: true });
  symlinkSync(target, join(repo2, "node_modules/.bin/secrets"));
  locationRefusal(() => locateSecretsCli({ PATH: `${repo2}/node_modules/.bin` }, { cwd: cwd2, home }));
});

test("a case-only spelling NODE_MODULES is refused on a case-insensitive volume (N1 review B1)", () => {
  const repo = directory(), home = directory();
  const cwd = join(repo, "apps/x");
  mkdirSync(cwd, { recursive: true });
  plant(join(repo, "NODE_MODULES/.bin"));
  if (!existsSync(join(repo, "node_modules/.bin/secrets"))) return; // case-sensitive volume: the lowercase entry doesn't exist
  locationRefusal(() => locateSecretsCli({ PATH: `${repo}/node_modules/.bin` }, { cwd, home }));
  locationRefusal(() => locateSecretsCli({ PATH: `${repo}/NODE_MODULES/.bin` }, { cwd, home }));
});

test("the user's own ~/node_modules/.bin stays usable from a checkout below home (home is not a project folder)", () => {
  const home = directory();
  const installed = plant(join(home, "node_modules/.bin"));
  const cwd = join(home, "code/repo/apps/x");
  mkdirSync(cwd, { recursive: true });
  expect(locateSecretsCli({ PATH: `${home}/node_modules/.bin` }, { cwd, home })).toBe(installed);
});
