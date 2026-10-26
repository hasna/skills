import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { useDefaultTestTimeout } from "../test-preload.js";
import { assertPortableAuthoringPath } from "./authoring-path.js";
import { scaffoldPortableSkill } from "./portable-skills.js";

useDefaultTestTimeout();

function fixture() {
  const home = mkdtempSync(join(tmpdir(), "authoring-native-home-"));
  return { home, native: join(home, "native-user"), corpus: join(home, "private-corpus") };
}
function withOverride(key: string, value: string, run: () => void) {
  const previous = process.env[key];
  process.env[key] = value;
  try { run(); } finally {
    if (previous === undefined) delete process.env[key]; else process.env[key] = previous;
  }
}
function put(path: string, text: string) {
  mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text);
}

for (const variable of ["CODEX_HOME", "CLAUDE_CONFIG_DIR"]) {
  test(`${variable} refuses native authoring before any payload or corpus creation`, () => {
    const f = fixture(), rootDir = join(f.native, "skills");
    withOverride(variable, f.native, () => {
      expect(() => scaffoldPortableSkill("synthetic-probe", { homeDir: f.home, rootDir, kind: "instruction" })).toThrow("native discovery root");
      expect(existsSync(rootDir)).toBe(false);
      const result = scaffoldPortableSkill("synthetic-private", { homeDir: f.home, rootDir: f.corpus, kind: "instruction" });
      expect(existsSync(join(result.path, "SKILL.md"))).toBe(true);
    });
  });
  test(`${variable} excludes canonical aliases and ancestors`, () => {
    const f = fixture(), alias = join(f.home, "alias");
    mkdirSync(f.native); symlinkSync(f.native, alias);
    withOverride(variable, alias, () => {
      for (const path of [join(f.native, "skills/probe"), join(alias, "plugins/cache/probe"), f.home]) {
        expect(() => assertPortableAuthoringPath(path, { homeDir: f.home })).toThrow("native discovery root");
      }
      expect(() => assertPortableAuthoringPath(f.native + "-sibling/probe", { homeDir: f.home })).not.toThrow();
    });
  });
  test(`${variable} reads current custom-home configured roots`, () => {
    const f = fixture(), declared = join(f.home, "declared-skills");
    put(join(f.native, variable === "CODEX_HOME" ? "config.toml" : "settings.json"), variable === "CODEX_HOME"
      ? `[[skills.config]]\npath = ${JSON.stringify(join(declared, "SKILL.md"))}\nenabled = false\n`
      : JSON.stringify({ permissions: { additionalDirectories: [declared] } }));
    withOverride(variable, f.native, () => {
      expect(() => assertPortableAuthoringPath(join(declared, "probe"), { homeDir: f.home })).toThrow("configured native discovery root");
      expect(() => assertPortableAuthoringPath(join(f.corpus, "probe"), { homeDir: f.home })).not.toThrow();
    });
  });
  test(`${variable} retains default exclusions and fails closed on opaque custom hooks`, () => {
    const f = fixture(), agent = variable === "CODEX_HOME" ? "codex" : "claude";
    withOverride(variable, f.native, () => {
      expect(() => assertPortableAuthoringPath(join(f.home, `.${agent}/skills/probe`), { homeDir: f.home })).toThrow("native discovery root");
      put(join(f.native, agent === "codex" ? "config.toml" : "settings.json"), agent === "codex"
        ? '[hooks]\ncommand = "unreviewed"\n' : JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: "command", command: "unreviewed" }] }] } }));
      expect(() => scaffoldPortableSkill("synthetic-probe", { homeDir: f.home, rootDir: f.corpus, kind: "instruction" })).toThrow();
      expect(existsSync(f.corpus)).toBe(false);
    });
  });
  test(`${variable} rejects ambiguous empty or whitespace overrides before writing`, () => {
    const f = fixture();
    for (const value of ["", " ", f.native + " "]) withOverride(variable, value, () => {
      expect(() => scaffoldPortableSkill("synthetic-probe", { homeDir: f.home, rootDir: f.corpus, kind: "instruction" })).toThrow(`Unsupported ${variable}`);
      expect(existsSync(f.corpus)).toBe(false);
    });
  });
}

test("custom Claude home reads external plugin registrations from that home", () => {
  const f = fixture(), plugin = join(f.home, "external-plugin");
  put(join(f.native, "settings.json"), JSON.stringify({ enabledPlugins: { "fixture@market": true } }));
  put(join(f.native, "plugins/installed_plugins.json"), JSON.stringify({ plugins: { "fixture@market": [{ scope: "user", installPath: plugin }] } }));
  put(join(plugin, ".claude-plugin/plugin.json"), JSON.stringify({ name: "fixture", skills: ["./custom-skills"] }));
  withOverride("CLAUDE_CONFIG_DIR", f.native, () => {
    expect(() => assertPortableAuthoringPath(join(plugin, "custom-skills/probe"), { homeDir: f.home })).toThrow("configured native discovery root");
    expect(() => assertPortableAuthoringPath(join(f.corpus, "probe"), { homeDir: f.home })).not.toThrow();
  });
});

test("relative CODEX_HOME resolves from the caller directory and excludes physical aliases", () => {
  const f = fixture(), alias = join(f.home, "alias");
  mkdirSync(f.native); symlinkSync(f.native, alias);
  withOverride("CODEX_HOME", relative(process.cwd(), alias), () => {
    expect(() => assertPortableAuthoringPath(join(f.native, "skills/probe"), { homeDir: f.home })).toThrow("native discovery root");
    expect(() => assertPortableAuthoringPath(join(f.corpus, "probe"), { homeDir: f.home })).not.toThrow();
  });
});

test("custom Hermes home fails closed even when its default home is absent", () => {
  const f = fixture();
  withOverride("HERMES_HOME", f.native, () => {
    expect(() => scaffoldPortableSkill("synthetic-probe", { homeDir: f.home, rootDir: join(f.native, "skills"), kind: "instruction" })).toThrow("custom Hermes homes/profiles");
    expect(existsSync(f.native)).toBe(false);
  });
});
