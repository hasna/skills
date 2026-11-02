import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, sep } from "node:path";
import { resolveAgentDiscoveryExclusionRoots } from "./agent-discovery.js";

// A Claude plugin is registered once per scope. The user scope is global and a
// project scope carries its own projectPath; the same plugin may be installed in
// both, and in several projects, with different versions and install paths
// (measured on station02). The exclusion reader must accept that native shape
// while keeping malformed or genuinely conflicting registrations refused.
const scratch: string[] = [];
afterEach(() => { for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function put(path: string, text: string): void { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text); }
function pluginRoot(home: string, name: string): string {
  const root = join(home, "plugins", name);
  put(join(root, ".claude-plugin/plugin.json"), "{}");
  mkdirSync(join(root, "skills"), { recursive: true });
  return root;
}
function setup(rowsFor: (home: string) => Record<string, Array<Record<string, unknown>>>) {
  const home = mkdtempSync(join(tmpdir(), "claude-plugin-scopes-"));
  scratch.push(home);
  const claude = join(home, ".claude");
  const rows = rowsFor(home);
  put(join(claude, "settings.json"), JSON.stringify({ enabledPlugins: Object.fromEntries(Object.keys(rows).map(id => [id, true])) }));
  put(join(claude, "plugins/installed_plugins.json"), JSON.stringify({ version: 2, plugins: rows }));
  return { home, claude };
}
const roots = (home: string) => resolveAgentDiscoveryExclusionRoots({ home, agent: "claude" });
const within = (parent: string, child: string) => child === parent || child.startsWith(parent + sep);

test("a single user registration resolves to its install root", () => {
  const { home } = setup(home => ({ "fixture@market": [{ scope: "user", installPath: pluginRoot(home, "user-one"), version: "1.0.0" }] }));
  const resolved = roots(home);
  expect(resolved).toContain(join(home, "plugins", "user-one"));
  expect(resolved).toContain(join(home, "plugins", "user-one", "skills"));
});

test("user and project registrations with different versions resolve to both roots", () => {
  const { home } = setup(home => ({
    "fixture@market": [
      { scope: "user", installPath: pluginRoot(home, "user-two"), version: "1.0.0" },
      { scope: "project", projectPath: join(home, "project"), installPath: pluginRoot(home, "project-two"), version: "2.0.0" },
    ],
  }));
  const resolved = roots(home);
  for (const name of ["user-two", "project-two"]) expect(resolved).toContain(join(home, "plugins", name));
});

test("two project registrations at distinct projectPaths resolve to both roots", () => {
  const { home } = setup(home => ({
    "fixture@market": [
      { scope: "project", projectPath: join(home, "project-a"), installPath: pluginRoot(home, "project-a-root"), version: "1.0.0" },
      { scope: "project", projectPath: join(home, "project-b"), installPath: pluginRoot(home, "project-b-root"), version: "1.0.0" },
    ],
  }));
  const resolved = roots(home);
  for (const name of ["project-a-root", "project-b-root"]) expect(resolved).toContain(join(home, "plugins", name));
});

test("a project-only registration resolves and leaves unrelated project paths authorable", () => {
  const { home } = setup(home => ({ "fixture@market": [{ scope: "project", projectPath: join(home, "project"), installPath: pluginRoot(home, "project-only"), version: "1.0.0" }] }));
  const resolved = roots(home);
  expect(resolved).toContain(join(home, "plugins", "project-only"));
  const destination = join(home, "project", "scratch", "skill");
  expect(resolved.some(root => within(root, destination))).toBe(false);
});

test("identical user and project registrations resolve without a duplicate root", () => {
  const { home } = setup(home => {
    const installPath = pluginRoot(home, "shared");
    return { "fixture@market": [
      { scope: "user", installPath, version: "1.0.0" },
      { scope: "project", projectPath: join(home, "project"), installPath, version: "1.0.0" },
    ] };
  });
  const resolved = roots(home);
  expect(resolved.filter(root => root === join(home, "plugins", "shared"))).toHaveLength(1);
});

test("a repeated effective scope is still refused", () => {
  const { home } = setup(home => {
    const installPath = pluginRoot(home, "repeated");
    return { "fixture@market": [
      { scope: "user", installPath, version: "1.0.0" },
      { scope: "user", installPath, version: "1.0.0" },
    ] };
  });
  expect(() => roots(home)).toThrow("enabled plugin registration is missing or ambiguous");
});

test("a repeated project scope with the same projectPath is refused", () => {
  const { home } = setup(home => ({
    "fixture@market": [
      { scope: "project", projectPath: join(home, "project"), installPath: pluginRoot(home, "project-dupe-a"), version: "1.0.0" },
      { scope: "project", projectPath: join(home, "project"), installPath: pluginRoot(home, "project-dupe-b"), version: "1.0.0" },
    ],
  }));
  expect(() => roots(home)).toThrow("enabled plugin registration is missing or ambiguous");
});

test("a project registration without its projectPath is refused", () => {
  const { home } = setup(home => ({ "fixture@market": [{ scope: "project", installPath: pluginRoot(home, "project-no-path"), version: "1.0.0" }] }));
  expect(() => roots(home)).toThrow("enabled plugin registration is missing or ambiguous");
});

test("a relative or non-normalized projectPath is refused", () => {
  for (const projectPath of ["project", `${join(tmpdir(), "project")}/`, `${join(tmpdir(), "project")}/sub/..`]) {
    const { home } = setup(home => ({ "fixture@market": [{ scope: "project", projectPath, installPath: pluginRoot(home, "project-bad-path"), version: "1.0.0" }] }));
    expect(() => roots(home)).toThrow("enabled plugin registration is missing or ambiguous");
  }
});

test("a projectPath carrying a control character is refused", () => {
  const { home } = setup(home => ({ "fixture@market": [{ scope: "project", projectPath: `${join(home, "project")}\u0000x`, installPath: pluginRoot(home, "project-control"), version: "1.0.0" }] }));
  expect(() => roots(home)).toThrow("enabled plugin registration is missing or ambiguous");
});

test("an unknown registration scope is refused, including beside a valid row", () => {
  for (const rows of [
    [{ scope: "local", installPath: "PLACEHOLDER", version: "1.0.0" }],
    [{ scope: "user", installPath: "PLACEHOLDER", version: "1.0.0" }, { scope: "local", installPath: "PLACEHOLDER", version: "1.0.0" }],
  ]) {
    const { home } = setup(home => {
      const installPath = pluginRoot(home, "unknown-scope");
      return { "fixture@market": rows.map(row => ({ ...row, installPath })) };
    });
    expect(() => roots(home)).toThrow("enabled plugin registration is missing or ambiguous");
  }
});

test("one install path claiming two string versions is refused", () => {
  const { home } = setup(home => {
    const installPath = pluginRoot(home, "conflict");
    return { "fixture@market": [
      { scope: "user", installPath, version: "1.0.0" },
      { scope: "project", projectPath: join(home, "project"), installPath, version: "2.0.0" },
    ] };
  });
  expect(() => roots(home)).toThrow("enabled plugin registration is missing or ambiguous");
});

test("one install path claiming two non-string versions is refused", () => {
  const { home } = setup(home => {
    const installPath = pluginRoot(home, "numeric-conflict");
    return { "fixture@market": [
      { scope: "user", installPath, version: 1 },
      { scope: "project", projectPath: join(home, "project"), installPath, version: 2 },
    ] };
  });
  expect(() => roots(home)).toThrow("enabled plugin registration is missing or ambiguous");
});

test("a user registration carrying a projectPath is refused", () => {
  const { home } = setup(home => ({ "fixture@market": [{ scope: "user", projectPath: join(home, "project"), installPath: pluginRoot(home, "user-project-path"), version: "1.0.0" }] }));
  expect(() => roots(home)).toThrow("enabled plugin registration is missing or ambiguous");
});

test("a relative install path is refused", () => {
  const { home } = setup(() => ({ "fixture@market": [{ scope: "user", installPath: "plugins/relative", version: "1.0.0" }] }));
  expect(() => roots(home)).toThrow("malformed plugin installation root");
});

test("an install path carrying a control character is refused", () => {
  const { home } = setup(home => ({ "fixture@market": [{ scope: "user", installPath: `${pluginRoot(home, "control")}\n`, version: "1.0.0" }] }));
  expect(() => roots(home)).toThrow("malformed plugin installation root");
});
