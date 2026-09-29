import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyAgentIntegration, assertManagedAgentBridge, inventoryNativeSkills, planAgentIntegration } from "./agent-integration.js";
import { normalizeCodexInlinePathConfig } from "./agent-codex.js";
import { DATA_DIR_ENV } from "./config.js";
import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();

test("ordinary Codex skill tables are a no-op for inline normalization", () => {
  const ordinary = `model = "gpt-5.5"\n[[skills.config]]\npath = "/tmp/skill/SKILL.md"\nenabled = false\n[skills.bundled]\nenabled = false\n`;
  expect(normalizeCodexInlinePathConfig(ordinary)).toBe(ordinary);
});

test("unsupported inline Codex selector fields are refused", () => {
  expect(() => normalizeCodexInlinePathConfig(`[skills]\nconfig = [{ path = "/tmp/skill/SKILL.md", enabled = false, source = "unreviewed" }]\n`)).toThrow("unsupported inline");
});

test("an explicit empty inline Codex config is refused without changing the source", () => {
  const original = `[skills]\nconfig = []\n[skills.bundled]\nenabled = false\n`;
  expect(() => normalizeCodexInlinePathConfig(original)).toThrow("unsupported inline");
  expect(original).toBe(`[skills]\nconfig = []\n[skills.bundled]\nenabled = false\n`);
});

const fixtures: string[] = [];
afterEach(() => {
  for (const root of fixtures.splice(0)) rmSync(root, { recursive: true, force: true });
});

function vendorAlias() {
  const root = mkdtempSync(join(tmpdir(), "skills-disabled-vendor-alias-"));
  fixtures.push(root);
  const home = join(root, "home");
  const chrome = join(home, ".codex", "plugins", "cache", "openai-bundled", "chrome");
  const version = join(chrome, "1.0.0");
  const skill = join(version, "skills", "control-chrome");
  mkdirSync(skill, { recursive: true, mode: 0o700 });
  writeFileSync(join(skill, "SKILL.md"), "---\nname: control-chrome\n---\nSynthetic vendor skill.\n");
  symlinkSync(version, join(chrome, "latest"));
  return { home, skill, version };
}

test("a sibling cache alias is inert when every inventoried skill is exactly disabled", () => {
  const { home, skill } = vendorAlias();
  const inventory = inventoryNativeSkills(home, { agents: ["codex"], includeVendor: true, disabledVendorPaths: [skill] });
  expect(inventory.filter(entry => entry.vendor).map(entry => entry.path)).toEqual([skill]);
});

test("the Codex hook accepts a disabled cache alias and refuses a new skill", () => {
  const { home, skill, version } = vendorAlias();
  writeFileSync(join(home, ".codex", "config.toml"), `[[skills.config]]\npath = "${join(skill, "SKILL.md")}"\nenabled = false\n`);
  const dataDir = join(home, ".hasna", "skills");
  const plan = planAgentIntegration({ home, dataDir, agents: ["codex"], command: "skills", profileId: "fleet", projectDir: home });
  expect(plan.nativeSkills.filter(entry => entry.vendor).map(entry => entry.path)).toEqual([skill]);
  applyAgentIntegration(plan);
  expect(() => assertManagedAgentBridge("codex", { home, dataDir, projectDir: home, profileId: "fleet" })).not.toThrow();
  const newSkill = join(version, "skills", "new-skill");
  mkdirSync(newSkill, { recursive: true, mode: 0o700 });
  writeFileSync(join(newSkill, "SKILL.md"), "---\nname: new-skill\n---\nSynthetic new skill.\n");
  expect(() => assertManagedAgentBridge("codex", { home, dataDir, projectDir: home, profileId: "fleet" })).toThrow("Refusing symlink path");
});

test("a sibling cache alias still refuses an enabled or newly added skill", () => {
  const { home, skill, version } = vendorAlias();
  expect(() => inventoryNativeSkills(home, { agents: ["codex"], includeVendor: true })).toThrow("Refusing symlink path");
  const newSkill = join(version, "skills", "new-skill");
  mkdirSync(newSkill, { recursive: true, mode: 0o700 });
  writeFileSync(join(newSkill, "SKILL.md"), "---\nname: new-skill\n---\nSynthetic new skill.\n");
  expect(() => inventoryNativeSkills(home, { agents: ["codex"], includeVendor: true, disabledVendorPaths: [skill] })).toThrow("Refusing symlink path");
});

test("disabled paths cannot be relative or refer to a different skill", () => {
  const { home, skill } = vendorAlias();
  expect(() => inventoryNativeSkills(home, { agents: ["codex"], includeVendor: true, disabledVendorPaths: ["control-chrome"] })).toThrow("Disabled vendor paths must be exact absolute paths");
  expect(() => inventoryNativeSkills(home, { agents: ["codex"], includeVendor: true, disabledVendorPaths: [`${skill}-other`] })).toThrow("Refusing symlink path");
});

test("a later enabled alias selector overrides the versioned disable", () => {
  const { home, skill } = vendorAlias();
  const alias = join(home, ".codex", "plugins", "cache", "openai-bundled", "chrome", "latest", "skills", "control-chrome", "SKILL.md");
  writeFileSync(join(home, ".codex", "config.toml"), `[[skills.config]]\npath = "${join(skill, "SKILL.md")}"\nenabled = false\n[[skills.config]]\npath = "${alias}"\nenabled = true\n`);
  expect(() => planAgentIntegration({ home, dataDir: join(home, ".hasna", "skills"), agents: ["codex"], command: "skills", profileId: "fleet", projectDir: home })).toThrow("Refusing symlink path");
});

test("a selector with another lexical name may still enable the canonical document", () => {
  const { home, skill } = vendorAlias();
  const selector = join(home, "enabled-selector.md");
  symlinkSync(join(skill, "SKILL.md"), selector);
  writeFileSync(join(home, ".codex", "config.toml"), `[[skills.config]]\npath = "${join(skill, "SKILL.md")}"\nenabled = false\n[[skills.config]]\npath = "${selector}"\nenabled = true\n`);
  expect(() => planAgentIntegration({ home, dataDir: join(home, ".hasna", "skills"), agents: ["codex"], command: "skills", profileId: "fleet", projectDir: home })).toThrow("Refusing symlink path");
});

test("a relative selector may resolve to the same native document", () => {
  const { home, skill } = vendorAlias();
  const relativeAlias = "plugins/cache/openai-bundled/chrome/latest/skills/control-chrome/SKILL.md";
  writeFileSync(join(home, ".codex", "config.toml"), `[[skills.config]]\npath = "${join(skill, "SKILL.md")}"\nenabled = false\n[[skills.config]]\npath = "${relativeAlias}"\nenabled = true\n`);
  expect(() => planAgentIntegration({ home, dataDir: join(home, ".hasna", "skills"), agents: ["codex"], command: "skills", profileId: "fleet", projectDir: home })).toThrow("Refusing symlink path");
});

test("a native name selector may re-enable the skill", () => {
  const { home, skill } = vendorAlias();
  writeFileSync(join(home, ".codex", "config.toml"), `[[skills.config]]\npath = "${join(skill, "SKILL.md")}"\nenabled = false\n[[skills.config]]\nname = "control-chrome"\nenabled = true\n`);
  expect(() => planAgentIntegration({ home, dataDir: join(home, ".hasna", "skills"), agents: ["codex"], command: "skills", profileId: "fleet", projectDir: home })).toThrow("Refusing symlink path");
});

test("a malformed selector row cannot prove that the native layer disables a skill", () => {
  const { home, skill } = vendorAlias();
  writeFileSync(join(home, ".codex", "config.toml"), `[[skills.config]]\npath = "${join(skill, "SKILL.md")}"\nenabled = false\n[[skills.config]]\npath = "${join(home, "unused", "SKILL.md")}"\n`);
  expect(() => planAgentIntegration({ home, dataDir: join(home, ".hasna", "skills"), agents: ["codex"], command: "skills", profileId: "fleet", projectDir: home })).toThrow("Refusing symlink path");
});

test("a directory selector does not disable the native skill document", () => {
  const { home, skill } = vendorAlias();
  writeFileSync(join(home, ".codex", "config.toml"), `[[skills.config]]\npath = "${skill}"\nenabled = false\n`);
  expect(() => planAgentIntegration({ home, dataDir: join(home, ".hasna", "skills"), agents: ["codex"], command: "skills", profileId: "fleet", projectDir: home })).toThrow("Refusing symlink path");
});

test("the native app-server inline skills array plans and applies without rewriting unrelated TOML", () => {
  const { home, skill } = vendorAlias();
  const dataDir = join(home, ".hasna", "skills");
  const configPath = join(home, ".codex", "config.toml");
  const cacheAlias = join(home, ".codex", "plugins", "cache", "openai-bundled", "chrome", "latest");
  const skillPath = join(skill, "SKILL.md");
  const original = `# preserved header\nmodel = "gpt-5.5"\n[skills]\nconfig= [{ path = "${skillPath}", enabled = false }]\nkeep_this = "preserved value"\n[skills.bundled]\nenabled = false\n[tools]\nmode = "preserved tool mode"\n`;
  writeFileSync(configPath, original);

  const plan = planAgentIntegration({ home, dataDir, agents: ["codex"], command: "skills", profileId: "fleet", projectDir: home });
  expect(plan.nativeSkills.filter(entry => entry.vendor).map(entry => entry.path)).toEqual([skill]);
  const configChange = plan.changes.find(change => change.path === configPath);
  expect(configChange).toBeDefined();
  expect(configChange?.after).toContain("# preserved header");
  expect(configChange?.after).toContain('keep_this = "preserved value"');
  expect(configChange?.after).toContain('mode = "preserved tool mode"');
  expect(configChange?.after).not.toContain("config= [{");
  const planned = Bun.TOML.parse(configChange!.after!) as Record<string, any>;
  expect(planned.model).toBe("gpt-5.5");
  expect(planned.skills.keep_this).toBe("preserved value");
  expect(planned.tools.mode).toBe("preserved tool mode");
  expect(planned.skills.config).toContainEqual({ path: skillPath, enabled: false });

  applyAgentIntegration(plan);
  const applied = Bun.TOML.parse(readFileSync(configPath, "utf8")) as Record<string, any>;
  expect(applied.model).toBe("gpt-5.5");
  expect(applied.skills.keep_this).toBe("preserved value");
  expect(applied.tools.mode).toBe("preserved tool mode");
  expect(applied.skills.config).toContainEqual({ path: skillPath, enabled: false });
});

test("native inline path/name selector ambiguity still refuses hook planning", () => {
  const { home, skill } = vendorAlias();
  const configPath = join(home, ".codex", "config.toml");
  const cacheAlias = join(home, ".codex", "plugins", "cache", "openai-bundled", "chrome", "latest");
  writeFileSync(configPath, `[skills]\nconfig = [{ path = "${join(skill, "SKILL.md")}", name = "control-chrome", enabled = false }]\n[skills.bundled]\nenabled = false\n`);
  expect(() => planAgentIntegration({ home, dataDir: join(home, ".hasna", "skills"), agents: ["codex"], command: "skills", profileId: "fleet", projectDir: home, reviewedCacheAlias: cacheAlias })).toThrow("one path or name selector");
});

test("hook planning refuses an explicit empty inline config without writing the file", () => {
  const { home } = vendorAlias();
  const configPath = join(home, ".codex", "config.toml");
  const original = `[skills]\nconfig = []\n[skills.bundled]\nenabled = false\n`;
  writeFileSync(configPath, original);
  const cacheAlias = join(home, ".codex", "plugins", "cache", "openai-bundled", "chrome", "latest");
  expect(() => planAgentIntegration({ home, dataDir: join(home, ".hasna", "skills"), agents: ["codex"], command: "skills", profileId: "fleet", projectDir: home, reviewedCacheAlias: cacheAlias })).toThrow("unsupported inline");
  expect(readFileSync(configPath, "utf8")).toBe(original);
});

test("a native inline path array converts without losing later skills-table assignments", () => {
  const { home, skill } = vendorAlias();
  const configPath = join(home, ".codex", "config.toml");
  const cacheAlias = join(home, ".codex", "plugins", "cache", "openai-bundled", "chrome", "latest");
  writeFileSync(configPath, `[skills]\nconfig = [{ path = "${join(skill, "SKILL.md")}", enabled = false }]\nkeep_this = "must stay under skills"\n[skills.bundled]\nenabled = false\n`);
  const plan = planAgentIntegration({ home, dataDir: join(home, ".hasna", "skills"), agents: ["codex"], command: "skills", profileId: "fleet", projectDir: home });
  const configChange = plan.changes.find(change => change.path === configPath);
  expect(configChange).toBeDefined();
  const parsed = Bun.TOML.parse(configChange!.after!) as Record<string, any>;
  expect(parsed.skills.keep_this).toBe("must stay under skills");
  expect(parsed.skills.config).toContainEqual({ path: join(skill, "SKILL.md"), enabled: false });
});

test("hook planning accepts only the exact reviewed sibling cache alias", () => {
  const { home, skill } = vendorAlias();
  const configPath = join(home, ".codex", "config.toml");
  const cacheAlias = join(home, ".codex", "plugins", "cache", "openai-bundled", "chrome", "latest");
  writeFileSync(configPath, `[[skills.config]]\npath = "${join(skill, "SKILL.md")}"\nenabled = true\n[skills.bundled]\nenabled = false\n`);
  expect(() => planAgentIntegration({ home, dataDir: join(home, ".hasna", "skills"), agents: ["codex"], command: "skills", profileId: "fleet", projectDir: home })).toThrow("Refusing symlink path");
  expect(() => planAgentIntegration({ home, dataDir: join(home, ".hasna", "skills"), agents: ["codex"], command: "skills", profileId: "fleet", projectDir: home, reviewedCacheAlias: `${cacheAlias}-other` })).toThrow("Refusing symlink path");
  const plan = planAgentIntegration({ home, dataDir: join(home, ".hasna", "skills"), agents: ["codex"], command: "skills", profileId: "fleet", projectDir: home, reviewedCacheAlias: cacheAlias });
  expect(plan.nativeSkills.filter(entry => entry.vendor).map(entry => entry.path)).toEqual([skill]);
});

test("hook install CLI forwards the exact reviewed cache alias and keeps unreviewed aliases refused", async () => {
  const { home, skill } = vendorAlias();
  const dataDir = join(home, ".hasna", "skills");
  const configPath = join(home, ".codex", "config.toml");
  const cacheAlias = join(home, ".codex", "plugins", "cache", "openai-bundled", "chrome", "latest");
  writeFileSync(configPath, `[[skills.config]]\npath = "${join(skill, "SKILL.md")}"\nenabled = true\n[skills.bundled]\nenabled = false\n`);

  const run = async (withAlias: boolean) => {
    const args = [process.execPath, "run", "src/cli/index.tsx", "hook", "install", "--agent", "codex", ...(withAlias ? ["--reviewed-cache-alias", cacheAlias] : []), "--json"];
    const child = Bun.spawn(args, { cwd: process.cwd(), env: { ...process.env, HOME: home, [DATA_DIR_ENV]: dataDir }, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    return { stdout, stderr, exitCode };
  };
  const accepted = await run(true);
  expect(accepted.exitCode).toBe(0);
  expect(JSON.parse(accepted.stdout).applied).toBe(false);
  expect(JSON.parse(accepted.stdout).nativeSkills.filter((entry: { vendor?: boolean }) => entry.vendor)).toHaveLength(1);
  const refused = await run(false);
  expect(refused.exitCode).toBe(1);
  expect(refused.stderr).toContain("Refusing symlink path");
});
