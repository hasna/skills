import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  ARTICLE_GENERATION_SLUG,
  MEDIA_GENERATION_PRICES,
  PREMIUM_SKILLS,
} from "../platform/skills/pricing";

interface PackedFile {
  path: string;
}

interface PackManifest {
  files: PackedFile[];
}

function premiumPackageSlugs(): string[] {
  return [
    ...new Set([
      ...PREMIUM_SKILLS.map((skill) => skill.slug),
      ...MEDIA_GENERATION_PRICES.map((price) => price.slug),
      ARTICLE_GENERATION_SLUG,
    ]),
  ].sort();
}

function readPackedFiles(): string[] {
  const result = Bun.spawnSync(["npm", "pack", "--dry-run", "--json", "--ignore-scripts"], {
    cwd: process.cwd(),
    stdout: "pipe",
    stderr: "pipe",
  });

  expect(result.exitCode, new TextDecoder().decode(result.stderr)).toBe(0);
  const output = new TextDecoder().decode(result.stdout);
  const manifests = JSON.parse(output) as PackManifest[];
  return manifests[0].files.map((file) => file.path).sort();
}

describe("public package boundary", () => {
  test("keeps premium implementation source out of the packed public package", () => {
    const files = readPackedFiles();
    const packed = new Set(files);
    const premiumSlugs = premiumPackageSlugs().filter((slug) => existsSync(join(process.cwd(), "skills", slug)));

    const leakedPremiumSource = files.filter((path) =>
      premiumSlugs.some((slug) => path.startsWith(`skills/${slug}/src/`)),
    );

    expect(leakedPremiumSource).toEqual([]);
    for (const slug of premiumSlugs) {
      expect(packed.has(`skills/${slug}/package.json`)).toBe(true);
    }
  });

  test("does not strip free local skill source from the packed public package", () => {
    const files = readPackedFiles();
    expect(files).toContain("skills/brand-style-guide/src/index.ts");
  });
});
