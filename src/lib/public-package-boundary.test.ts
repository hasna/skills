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

function hostedMetadataSlugs(): string[] {
  const skillsDir = join(process.cwd(), "skills");
  return readdirSync(skillsDir)
    .filter((entry) => {
      const skillDir = join(skillsDir, entry);
      if (!statSync(skillDir).isDirectory()) return false;
      const pkgPath = join(skillDir, "package.json");
      if (!existsSync(pkgPath)) return false;
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { skills?: { runtime?: string; source?: string } };
      return pkg.skills?.runtime === "hosted" || pkg.skills?.source === "remote" || pkg.skills?.source === "private-hosted";
    })
    .sort();
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
  test("excludes CLI test utilities while retaining public declarations", () => {
    const files = new Set(readPackedFiles());

    expect(files.has("dist/cli/cli.test-utils.d.ts")).toBe(false);
    expect(files.has("dist/index.d.ts")).toBe(true);
    expect(files.has("dist/storage.d.ts")).toBe(true);
    expect(
      [...files].some((file) => file.startsWith("dist/cli/commands/") && file.endsWith(".d.ts")),
    ).toBe(true);
  });

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

  test("keeps premium implementation source out of the packed public package", () => {
    const files = readPackedFiles();
    const packed = new Set(files);
    const premiumSlugs = hostedMetadataSlugs();

    const leakedPremiumSource = files.filter((path) =>
      premiumSlugs.some((slug) => path.startsWith(`skills/${slug}/src/`)),
    );

    expect(leakedPremiumSource).toEqual([]);
    for (const slug of premiumSlugs) {
      expect(packed.has(`skills/${slug}/package.json`)).toBe(true);
    }
  });

  test("keeps hosted premium implementation source out of the public repository", () => {
    const leakedPremiumSource = hostedMetadataSlugs()
      .filter((slug) => existsSync(join(process.cwd(), "skills", slug, "src")));

    expect(leakedPremiumSource).toEqual([]);
  });

  test("keeps hosted metadata free of provider credential instructions", () => {
    const forbiddenProviderEnvVars = [
      "OPENAI_API_KEY",
      "ANTHROPIC_API_KEY",
      "GEMINI_API_KEY",
      "GOOGLE_API_KEY",
      "GOOGLE_PROJECT_ID",
      "XAI_API_KEY",
      "FIRECRAWL_API_KEY",
      "EXA_API_KEY",
      "ELEVENLABS_API_KEY",
      "BROWSER_USE_API_KEY",
      "MINIMAX_API_KEY",
      "DEEPGRAM_API_KEY",
      "REPLICATE_API_KEY",
      "FAL_API_KEY",
      "STABILITY_API_KEY",
    ];
    const leaks: string[] = [];

    for (const slug of hostedMetadataSlugs()) {
      const skillDir = join(process.cwd(), "skills", slug);
      for (const file of collectSkillFiles(skillDir)) {
        const relative = file.replace(`${process.cwd()}/`, "");
        const content = readFileSync(file, "utf8");
        for (const marker of forbiddenProviderEnvVars) {
          if (content.includes(marker)) leaks.push(`${relative}: ${marker}`);
        }
      }
    }

    expect(leaks).toEqual([]);
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
