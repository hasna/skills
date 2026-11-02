import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, sep } from "node:path";
import { resolveAgentDiscoveryExclusionRoots } from "./agent-discovery.js";

// A Claude plugin is registered once per native scope. user and managed carry
// no project; project and local carry the project they belong to. The same
// plugin may be installed in several scopes, in several projects, with
// different versions and install paths (measured on station02, and with
// `claude plugin install --scope local` on 2.1.314). The exclusion reader must
// accept that native shape while keeping malformed or genuinely conflicting
// registrations refused.
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

test("an ancestor projectPath is accepted and excludes only the plugin root", () => {
  const { home } = setup(home => ({ "fixture@market": [{ scope: "project", projectPath: sep, installPath: pluginRoot(home, "ancestor"), version: "1.0.0" }] }));
  const resolved = roots(home);
  expect(resolved).toContain(join(home, "plugins", "ancestor"));
  // The projectPath only identifies the scope; it never becomes an exclusion
  // root, so an ancestor such as / cannot swallow unrelated destinations.
  // `within("/", x)` is false for every path that is not itself "/", so the
  // direct claim is that the ancestor is absent from the roots.
  for (const root of resolved) expect(within(home, root)).toBe(true);
  expect(resolved).not.toContain(sep);
});

test("a symlinked projectPath is accepted and stays inert", () => {
  const { home } = setup(home => {
    const target = join(home, "real-project");
    mkdirSync(target, { recursive: true });
    const link = join(home, "linked-project");
    symlinkSync(target, link);
    return { "fixture@market": [{ scope: "project", projectPath: link, installPath: pluginRoot(home, "symlinked-project"), version: "1.0.0" }] };
  });
  const resolved = roots(home);
  expect(resolved).toContain(join(home, "plugins", "symlinked-project"));
  // Neither the link nor its target becomes authorable or excluded.
  for (const destination of [join(home, "linked-project", "scratch", "skill"), join(home, "real-project", "scratch", "skill")]) {
    expect(resolved.some(root => within(root, destination))).toBe(false);
  }
});

test("a local registration with its projectPath resolves", () => {
  const { home } = setup(home => ({ "fixture@market": [{ scope: "local", projectPath: join(home, "project"), installPath: pluginRoot(home, "local-only"), version: "1.0.0" }] }));
  const resolved = roots(home);
  expect(resolved).toContain(join(home, "plugins", "local-only"));
  const destination = join(home, "project", "scratch", "skill");
  expect(resolved.some(root => within(root, destination))).toBe(false);
});

test("local and project registrations sharing one install root resolve to one root", () => {
  // Measured native shape: installing the same plugin with --scope local and
  // then --scope project writes the same cache installPath and version under
  // both scopes, each with its own projectPath.
  const { home } = setup(home => {
    const installPath = pluginRoot(home, "local-and-project");
    return { "fixture@market": [
      { scope: "local", projectPath: join(home, "project"), installPath, version: "1.0.0" },
      { scope: "project", projectPath: join(home, "project"), installPath, version: "1.0.0" },
    ] };
  });
  const resolved = roots(home);
  expect(resolved.filter(root => root === join(home, "plugins", "local-and-project"))).toHaveLength(1);
});

test("local and user registrations with distinct roots resolve to both", () => {
  const { home } = setup(home => ({
    "fixture@market": [
      { scope: "user", installPath: pluginRoot(home, "user-with-local"), version: "1.0.0" },
      { scope: "local", projectPath: join(home, "project"), installPath: pluginRoot(home, "local-beside-user"), version: "2.0.0" },
    ],
  }));
  const resolved = roots(home);
  for (const name of ["user-with-local", "local-beside-user"]) expect(resolved).toContain(join(home, "plugins", name));
});

test("a local registration without its projectPath is refused", () => {
  const { home } = setup(home => ({ "fixture@market": [{ scope: "local", installPath: pluginRoot(home, "local-no-path"), version: "1.0.0" }] }));
  expect(() => roots(home)).toThrow("enabled plugin registration is missing or ambiguous");
});

test("a repeated local registration for the same projectPath is refused", () => {
  const { home } = setup(home => ({
    "fixture@market": [
      { scope: "local", projectPath: join(home, "project"), installPath: pluginRoot(home, "local-dupe-a"), version: "1.0.0" },
      { scope: "local", projectPath: join(home, "project"), installPath: pluginRoot(home, "local-dupe-b"), version: "1.0.0" },
    ],
  }));
  expect(() => roots(home)).toThrow("enabled plugin registration is missing or ambiguous");
});

test("a local projectPath that is relative is refused", () => {
  const { home } = setup(home => ({ "fixture@market": [{ scope: "local", projectPath: "project", installPath: pluginRoot(home, "local-bad-path"), version: "1.0.0" }] }));
  expect(() => roots(home)).toThrow("enabled plugin registration is missing or ambiguous");
});

test("a managed registration without a project resolves", () => {
  const { home } = setup(home => ({ "fixture@market": [{ scope: "managed", installPath: pluginRoot(home, "managed"), version: "1.0.0" }] }));
  expect(roots(home)).toContain(join(home, "plugins", "managed"));
});

test("a managed registration carrying a projectPath is refused", () => {
  const { home } = setup(home => ({ "fixture@market": [{ scope: "managed", projectPath: join(home, "project"), installPath: pluginRoot(home, "managed-path"), version: "1.0.0" }] }));
  expect(() => roots(home)).toThrow("enabled plugin registration is missing or ambiguous");
});

test("a user or managed registration carrying a null projectPath is refused", () => {
  for (const scope of ["user", "managed"]) {
    const { home } = setup(home => ({ "fixture@market": [{ scope, projectPath: null, installPath: pluginRoot(home, `null-path-${scope}`), version: "1.0.0" }] }));
    expect(() => roots(home)).toThrow("enabled plugin registration is missing or ambiguous");
  }
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
    [{ scope: "global", installPath: "PLACEHOLDER", version: "1.0.0" }],
    [{ scope: "user", installPath: "PLACEHOLDER", version: "1.0.0" }, { scope: "global", installPath: "PLACEHOLDER", version: "1.0.0" }],
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

test("a version that is not a string is refused under the native schema", () => {
  for (const version of [1, [1], { v: 1 }, null, true]) {
    const { home } = setup(home => ({ "fixture@market": [{ scope: "user", installPath: pluginRoot(home, "bad-version"), version }] }));
    expect(() => roots(home)).toThrow("malformed plugin registration version");
  }
});

test("an absent version is legal and agrees with another absent version", () => {
  const { home } = setup(home => {
    const installPath = pluginRoot(home, "absent-version");
    return { "fixture@market": [
      { scope: "user", installPath },
      { scope: "project", projectPath: join(home, "project"), installPath },
    ] };
  });
  const resolved = roots(home);
  expect(resolved.filter(root => root === join(home, "plugins", "absent-version"))).toHaveLength(1);
});

test("an absent version and a string version on one install root are refused", () => {
  const { home } = setup(home => {
    const installPath = pluginRoot(home, "absent-versus-string");
    return { "fixture@market": [
      { scope: "user", installPath },
      { scope: "project", projectPath: join(home, "project"), installPath, version: "1.0.0" },
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
