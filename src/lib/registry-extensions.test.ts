import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DATA_DIR_ENV, INSTALLED_SKILLS_DIRNAME, getConfigPath } from "./config.js";
import { clearRegistryCache, loadRegistry } from "./registry.js";
import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();

const created: string[] = [];

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  created.push(dir);
  return dir;
}

function writeSkill(parent: string, name: string, description: string): void {
  const skillDir = join(parent, name);
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(
    join(skillDir, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${description}\ncategory: Development Tools\ntags: [extension, test]\n---\n\n# ${name}\n`,
  );
}

afterEach(() => {
  clearRegistryCache();
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("configured extension registry", () => {
  test("reads extensions in place and applies official < extension < custom precedence", () => {
    const dataDir = process.env[DATA_DIR_ENV]!;
    const extensionsDir = tempDir("skills-extensions-");
    writeSkill(extensionsDir, "extension-only", "extension-only copy");
    writeSkill(extensionsDir, "market-research-report", "extension copy");

    const installedDir = join(dataDir, INSTALLED_SKILLS_DIRNAME);
    writeSkill(installedDir, "extension-only", "custom copy");
    writeFileSync(getConfigPath("global"), JSON.stringify({ extensionsDir }));

    clearRegistryCache();
    const registry = loadRegistry();

    const officialCollision = registry.find((skill) => skill.name === "market-research-report");
    expect(officialCollision?.source).toBe("extension");
    expect(officialCollision?.description).toBe("extension copy");

    const customCollision = registry.find((skill) => skill.name === "extension-only");
    expect(customCollision?.source).toBe("custom");
    expect(customCollision?.description).toBe("custom copy");
  });

  test("does not copy extension-only skills into installed", () => {
    const dataDir = process.env[DATA_DIR_ENV]!;
    const extensionsDir = tempDir("skills-extensions-");
    writeSkill(extensionsDir, "external-corpus-skill", "read from its checkout");
    writeFileSync(getConfigPath("global"), JSON.stringify({ extensionsDir }));

    clearRegistryCache();
    expect(loadRegistry().find((skill) => skill.name === "external-corpus-skill")?.source).toBe("extension");
    expect(existsSync(join(dataDir, INSTALLED_SKILLS_DIRNAME, "external-corpus-skill"))).toBe(false);
  });
});
