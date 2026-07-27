import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { useDefaultTestTimeout } from "./test-preload.js";

useDefaultTestTimeout();

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const forbiddenPackages = ["@hasna/" + "cloud", "open-" + "cloud", "@hasna/" + "wallets"];
const forbiddenLegacyStorageTerms = [
  "cloud" + " setup",
  "cloud" + " sync",
  "HASNA_SKILLS_" + "CLOUD",
  "SKILLS_" + "CLOUD",
  "register" + "CloudTools",
  "cloud" + "-sync",
];

function readIfExists(path: string): string {
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

function sourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", "dist", "bin", ".git"].includes(entry.name)) continue;
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...sourceFiles(fullPath));
      continue;
    }
    if (!/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(entry.name)) continue;
    if (entry.name.endsWith(".test.ts") || entry.name.endsWith(".test.tsx")) continue;
    files.push(fullPath);
  }
  return files;
}

describe("no private cloud package boundary", () => {
  test("package metadata and lockfile do not depend on private cloud packages", () => {
    const metadata = ["package.json", "bun.lock", "package-lock.json", "pnpm-lock.yaml", "yarn.lock"]
      .map((file) => [file, readIfExists(join(repoRoot, file))] as const);
    const offenders = metadata.flatMap(([file, content]) =>
      forbiddenPackages
        .filter((pkg) => content.includes(pkg))
        .map((pkg) => `${file}:${pkg}`)
    );

    expect(offenders).toEqual([]);
  });

  test("runtime source does not import private cloud packages", () => {
    const offenders = sourceFiles(join(repoRoot, "src")).flatMap((file) => {
      const content = readFileSync(file, "utf8");
      return forbiddenPackages
        .filter((pkg) => content.includes(pkg))
        .map((pkg) => `${file.replace(repoRoot + "/", "")}:${pkg}`);
    });

    expect(offenders).toEqual([]);
  });

  test("runtime docs and source avoid legacy shared storage naming", () => {
    const files = [
      join(repoRoot, "README.md"),
      ...sourceFiles(join(repoRoot, "src")),
    ];
    const offenders = files.flatMap((file) => {
      const content = readFileSync(file, "utf8");
      return forbiddenLegacyStorageTerms
        .filter((term) => content.includes(term))
        .map((term) => `${file.replace(repoRoot + "/", "")}:${term}`);
    });

    expect(offenders).toEqual([]);
  });

  test("public entrypoint exposes native storage surface", () => {
    const entrypoint = readFileSync(join(repoRoot, "src", "index.ts"), "utf8");
    expect(entrypoint).toContain("SKILLS_NATIVE_STORAGE_ENV");
    expect(entrypoint).toContain("createSkillsPostgresSyncStore");
    expect(entrypoint).toContain("createSkillsS3ObjectStore");
    expect(entrypoint).not.toContain("register" + "CloudTools");
  });
});
