import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { useDefaultTestTimeout } from "../test-preload.js";
import { clearRegistryCache, getAllTags, getSkillsByCategory, getSkillsByTag, loadRegistry } from "../index.js";

useDefaultTestTimeout();

const first = Object.freeze({
  name: "first-skill", category: "Content Generation",
  tags: Object.freeze(["Writing", "AI", "writing"]),
  productMetadata: Object.freeze({ credits: 7 }),
});
const second = Object.freeze({
  name: "second-skill", category: "content generation",
  tags: Object.freeze(["EMAIL", "Workflow"]),
  productMetadata: Object.freeze({ credits: 11 }),
});
const third = Object.freeze({
  name: "third-skill", category: "Content Generation",
  tags: Object.freeze([] as string[]),
  productMetadata: Object.freeze({ credits: 2 }),
});
const catalog = Object.freeze([first, second, third]);

let workspace: string;
let priorCwd: string;

beforeEach(() => {
  priorCwd = process.cwd();
  workspace = mkdtempSync(join(tmpdir(), "skills-caller-catalog-"));
  process.chdir(workspace);
  clearRegistryCache();
});

afterEach(() => {
  process.chdir(priorCwd);
  clearRegistryCache();
  if (process.env.SKILLS_KEEP_TEST_FIXTURES !== "1") rmSync(workspace, { recursive: true, force: true });
});

describe("caller-owned catalog queries through the public root export", () => {
  test("matches categories exactly and keeps caller order, references and extra fields", () => {
    const result = getSkillsByCategory("Content Generation", catalog);
    expect(result).toEqual([first, third]);
    expect(result[0]).toBe(first);
    expect(result[1]).toBe(third);
    expect(result[0]?.productMetadata).toBe(first.productMetadata);
    expect(result).not.toBe(catalog);
    expect(getSkillsByCategory("content generation", catalog)).toEqual([second]);
    expect(getSkillsByCategory("Content", catalog)).toEqual([]);
  });

  test("matches case-insensitive tag substrings without duplicate records", () => {
    const result = getSkillsByTag("RIT", catalog);
    expect(result).toEqual([first]);
    expect(result[0]).toBe(first);
    expect(result[0]?.productMetadata).toBe(first.productMetadata);
    expect(getSkillsByTag("ai", catalog)).toEqual([first, second]);
    expect(getSkillsByTag("not-present", catalog)).toEqual([]);
  });

  test("keeps the empty tag query behavior for tagged and untagged records", () => {
    expect(getSkillsByTag("", catalog)).toEqual([first, second]);
  });

  test("returns lowercase unique sorted tags and leaves frozen input untouched", () => {
    expect(getAllTags(catalog)).toEqual(["ai", "email", "workflow", "writing"]);
    expect(first.tags).toEqual(["Writing", "AI", "writing"]);
    expect(catalog).toEqual([first, second, third]);
    expect(Object.isFrozen(catalog)).toBe(true);
    expect(Object.isFrozen(first.tags)).toBe(true);
  });

  test("uses explicit catalogs even when ambient configuration is refused", () => {
    writeFileSync(join(workspace, "skills.config.json"), JSON.stringify({ mode: "retired-mode" }));
    expect(() => loadRegistry()).toThrow();
    expect(getSkillsByCategory("Content Generation", catalog)).toEqual([first, third]);
    expect(getSkillsByTag("rit", catalog)).toEqual([first]);
    expect(getAllTags(catalog)).toEqual(["ai", "email", "workflow", "writing"]);
  });

  test("an explicit empty catalog never falls back to ambient configuration", () => {
    writeFileSync(join(workspace, "skills.config.json"), JSON.stringify({ mode: "retired-mode" }));
    expect(() => loadRegistry()).toThrow();
    const empty = Object.freeze([]);
    expect(getSkillsByCategory("Content Generation", empty)).toEqual([]);
    expect(getSkillsByTag("", empty)).toEqual([]);
    expect(getAllTags(empty)).toEqual([]);
  });

  test("omitted and undefined catalogs retain the configured registry", () => {
    const extension = join(workspace, "extensions", "ambient-skill");
    mkdirSync(extension, { recursive: true });
    writeFileSync(join(extension, "SKILL.md"), "---\nname: ambient-skill\ncategory: Content Generation\ntags: [Ambient, WRITING]\n---\nFixture.\n");
    writeFileSync(join(workspace, "skills.config.json"), JSON.stringify({ extensionsDir: join(workspace, "extensions") }));
    const ambient = loadRegistry();
    expect(ambient.map(skill => skill.name)).toEqual(["ambient-skill"]);
    expect(getSkillsByCategory("Content Generation")).toEqual(ambient);
    expect(getSkillsByCategory("Content Generation", undefined)).toEqual(ambient);
    expect(getSkillsByCategory("Content Generation")[0]).toBe(ambient[0]);
    expect(getSkillsByTag("bIeN")).toEqual(ambient);
    expect(getSkillsByTag("bIeN", undefined)).toEqual(ambient);
    expect(getSkillsByTag("WRIT")[0]).toBe(ambient[0]);
    expect(getAllTags()).toEqual(["ambient", "writing"]);
    expect(getAllTags(undefined)).toEqual(["ambient", "writing"]);
    expect(getSkillsByCategory("Content Generation", [])).toEqual([]);
    expect(getSkillsByTag("ambient", [])).toEqual([]);
    expect(getAllTags([])).toEqual([]);
  });
});
