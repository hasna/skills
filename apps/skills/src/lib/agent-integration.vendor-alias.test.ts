import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyAgentIntegration, assertManagedAgentBridge, inventoryNativeSkills, planAgentIntegration } from "./agent-integration.js";
import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();

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
