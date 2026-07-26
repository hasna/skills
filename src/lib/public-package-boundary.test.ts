import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getPackedFiles } from "./packlist";

const cloudPackage = "@hasna" + "/cloud";
const cloudNodeModulesPath = "node_modules/@hasna/" + "cloud";

// Single source of truth for the published file list: the packager itself.
function readPackedFiles(): string[] {
  return getPackedFiles(process.cwd());
}

function collectSkillFiles(dir: string): string[] {
  const result: string[] = [];
  for (const entry of readdirSync(dir)) {
    const entryPath = join(dir, entry);
    const stats = statSync(entryPath);
    if (stats.isDirectory()) {
      result.push(...collectSkillFiles(entryPath));
    } else {
      result.push(entryPath);
    }
  }
  return result;
}

function collectFiles(dir: string): string[] {
  const result: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist" || entry === "bin" || entry === ".git") continue;
    const entryPath = join(dir, entry);
    const stats = statSync(entryPath);
    if (stats.isDirectory()) {
      result.push(...collectFiles(entryPath));
    } else {
      result.push(entryPath);
    }
  }
  return result;
}

function buildEntryPointsForBoundaryScan(): string[] {
  const outputDir = mkdtempSync(join(tmpdir(), "hasna-skills-boundary-"));
  const builds: string[][] = [
    [
      "bun",
      "build",
      "./src/cli/index.tsx",
      "--outdir",
      join(outputDir, "bin"),
      "--target",
      "bun",
    ],
    [
      "bun",
      "build",
      "./src/mcp/index.ts",
      "--outfile",
      join(outputDir, "bin", "mcp.js"),
      "--target",
      "bun",
    ],
    [
      "bun",
      "build",
      "./src/index.ts",
      "./src/storage.ts",
      "--outdir",
      join(outputDir, "dist"),
      "--target",
      "bun",
    ],
  ];

  for (const command of builds) {
    const result = Bun.spawnSync(command, {
      cwd: process.cwd(),
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(result.exitCode, new TextDecoder().decode(result.stderr)).toBe(0);
  }

  return [
    join(outputDir, "bin", "index.js"),
    join(outputDir, "bin", "mcp.js"),
    join(outputDir, "dist", "index.js"),
    join(outputDir, "dist", "storage.js"),
  ];
}

describe("public package boundary", () => {
  test("keeps private cloud and self-dependencies out of package metadata", () => {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
      scripts?: Record<string, string>;
    };
    const dependencies = pkg.dependencies ?? {};
    expect(dependencies[cloudPackage]).toBeUndefined();
    expect(dependencies["@hasna/skills"]).toBeUndefined();

    const scripts = JSON.stringify(pkg.scripts ?? {});
    expect(scripts).not.toContain("aws:bootstrap");
    expect(scripts).not.toContain("preview-stripe");
    expect(scripts).not.toContain("production-stripe");

    const lock = readFileSync(join(process.cwd(), "bun.lock"), "utf8");
    expect(lock).not.toContain(cloudPackage);
    expect(lock).not.toContain("@hasna/skills@");
    expect(lock).not.toContain("@hasnatools/platform-skills");
  });




  test("does not strip free local skill source from the packed public package", () => {
    const files = readPackedFiles();
    expect(files).toContain("skills/brand-style-guide/src/index.ts");
  });

  test("keeps legacy service server and cloud scaffolds out of the public package", () => {
    const files = readPackedFiles();
    for (const forbidden of [
      "skills/domainpurchase/src/lib/config.ts",
      "skills/domainpurchase/src/lib/api-client.ts",
      "skills/domainpurchase/.env.example",
      "skills/sms/src/server.ts",
      "skills/sms/src/sse-server.ts",
      "skills/sms/scripts/buy-number.ts",
      "skills/managemcp/src/db/index.ts",
      "skills/managemcp/scripts/migrate.ts",
      "skills/managemcp/.env.example",
    ]) {
      expect(files).not.toContain(forbidden);
    }
  });

  test("keeps retired storage cloud names out of public sources", () => {
    const retiredMarkers = [
      ["cloud", "sync"].join("-"),
      ["HASNA_SKILLS", "CLOUD"].join("_"),
      ["OPEN_SKILLS", "CLOUD"].join("_"),
      ["SKILLS", "CLOUD"].join("_"),
      ["CLOUD", "TABLES"].join("_"),
      ["cloud", "Push"].join(""),
      ["cloud", "Pull"].join(""),
      ["cloud", "Sync"].join(""),
      ["get", "Cloud", "Database"].join(""),
      ["get", "Cloud", "Mode"].join(""),
      ["get", "Cloud", "Status"].join(""),
      ["run", "Cloud"].join(""),
      ["commands", "cloud"].join("/"),
      ["@hasna", "cloud"].join("/"),
      ["open", "cloud"].join("-"),
      ["skills", "cloud"].join("_"),
      // Retired deployment/storage "mode" vocabulary. Three unrelated concepts
      // were all called mode, and the third crept in while the first two were
      // being written; a payload-shape assertion cannot catch a doc telling the
      // next contributor to rebuild it, so the words are banned outright.
      // Markers are assembled from fragments so this file does not match itself.
      ["HASNA_SKILLS", "STORAGE", "MODE"].join("_"),
      ["SKILLS", "STORAGE", "MODE"].join("_"),
      ["Skills", "Storage", "Mode"].join(""),
      ["get", "Storage", "Mode"].join(""),
      ["MODE", "ALIASES"].join("_"),
      ["MODE", "VALUES"].join("_"),
      ["setup --", "mode"].join(""),
      ["self-hosted", " mode"].join(""),
      ["local-only", " mode"].join(""),
    ];
    const roots = ["src", "docs", "scripts", "README.md", "package.json"];
    const files = roots.flatMap((root) => {
      const path = join(process.cwd(), root);
      if (!existsSync(path)) return [];
      return statSync(path).isDirectory() ? collectFiles(path) : [path];
    });

    const leaks: string[] = [];
    for (const file of files) {
      const content = readFileSync(file, "utf8");
      for (const marker of retiredMarkers) {
        if (content.includes(marker)) leaks.push(`${file.replace(`${process.cwd()}/`, "")}: ${marker}`);
      }
    }

    expect(leaks).toEqual([]);
  });

  test("keeps private implementation markers out of built entrypoints", () => {
    const builtFiles = buildEntryPointsForBoundaryScan();

    const forbiddenMarkers = [
      cloudPackage,
      cloudNodeModulesPath,
      "@hasnatools/platform-skills",
      "src/platform/",
      "src/platform",
      "STRIPE_",
      "aws:bootstrap",
      "preview-stripe",
      "production-stripe",
    ];

    try {
      for (const file of builtFiles) {
        const content = readFileSync(file, "utf8");
        for (const marker of forbiddenMarkers) {
          expect(content).not.toContain(marker);
        }
      }
    } finally {
      rmSync(join(builtFiles[0], "..", ".."), { recursive: true, force: true });
    }
  });

  test("bundles CLI runtime dependencies that are fragile under global installs", () => {
    const builtFiles = buildEntryPointsForBoundaryScan();

    try {
      const cli = readFileSync(builtFiles[0], "utf8");
      expect(cli).not.toContain("from \"signal-exit\"");
      expect(cli).not.toContain("from 'signal-exit'");
      expect(cli).not.toContain("require(\"signal-exit\")");
      expect(cli).not.toContain("require('signal-exit')");
    } finally {
      rmSync(join(builtFiles[0], "..", ".."), { recursive: true, force: true });
    }
  });
});
