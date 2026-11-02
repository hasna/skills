import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { resolveAgentDiscoveryExclusionRoots } from "./agent-discovery.js";

// A Claude plugin is registered once per scope. The user scope is global and a
// project scope carries its own projectPath; the same plugin may be installed in
// both with different versions and install paths (measured on station02). The
// exclusion reader must accept that native shape while keeping malformed or
// genuinely conflicting registrations refused.
function put(path: string, text: string): void { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text); }
function pluginRoot(home: string, name: string): string {
  const root = join(home, "plugins", name);
  put(join(root, ".claude-plugin/plugin.json"), "{}");
  mkdirSync(join(root, "skills"), { recursive: true });
  return root;
}
function setup(rowsFor: (home: string) => Record<string, Array<Record<string, unknown>>>) {
  const home = mkdtempSync(join(tmpdir(), "claude-plugin-scopes-"));
  const claude = join(home, ".claude");
  const rows = rowsFor(home);
  put(join(claude, "settings.json"), JSON.stringify({ enabledPlugins: Object.fromEntries(Object.keys(rows).map(id => [id, true])) }));
  put(join(claude, "plugins/installed_plugins.json"), JSON.stringify({ version: 2, plugins: rows }));
  return { home, claude };
}
const roots = (home: string) => resolveAgentDiscoveryExclusionRoots({ home, agent: "claude" });

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

test("a repeated scope is still refused", () => {
  const { home } = setup(home => {
    const installPath = pluginRoot(home, "repeated");
    return { "fixture@market": [
      { scope: "user", installPath, version: "1.0.0" },
      { scope: "user", installPath, version: "1.0.0" },
    ] };
  });
  expect(() => roots(home)).toThrow("enabled plugin registration is missing or ambiguous");
});

test("a project registration without its projectPath is refused", () => {
  const { home } = setup(home => ({ "fixture@market": [{ scope: "project", installPath: pluginRoot(home, "project-no-path"), version: "1.0.0" }] }));
  expect(() => roots(home)).toThrow("enabled plugin registration is missing or ambiguous");
});

test("an unknown registration scope is refused", () => {
  const { home } = setup(home => ({ "fixture@market": [{ scope: "local", installPath: pluginRoot(home, "local-scope"), version: "1.0.0" }] }));
  expect(() => roots(home)).toThrow("enabled plugin registration is missing or ambiguous");
});

test("one install path claiming two versions is refused", () => {
  const { home } = setup(home => {
    const installPath = pluginRoot(home, "conflict");
    return { "fixture@market": [
      { scope: "user", installPath, version: "1.0.0" },
      { scope: "project", projectPath: join(home, "project"), installPath, version: "2.0.0" },
    ] };
  });
  expect(() => roots(home)).toThrow("enabled plugin registration is missing or ambiguous");
});

test("a relative install path is refused", () => {
  const { home } = setup(() => ({ "fixture@market": [{ scope: "user", installPath: "plugins/relative", version: "1.0.0" }] }));
  expect(() => roots(home)).toThrow("malformed plugin installation root");
});
