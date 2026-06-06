import { describe, expect, test } from "bun:test";
import {
  CLI_PATH,
  EXPECTED_ALL_SKILL_COUNT,
  EXPECTED_BASIC_SKILL_COUNT,
  PACKAGE_VERSION,
  SLOW_TEST_TIMEOUT,
  runCli,
  runCliInCwd,
} from "./cli.test-utils";

describe("CLI discovery", () => {
  describe("help", () => {
    test("outputs compact JSON skills list in non-TTY mode (no arguments)", async () => {
      const { stdout } = await runCli([]);
      const data = JSON.parse(stdout);
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBe(EXPECTED_BASIC_SKILL_COUNT);
      expect(data[0]).toHaveProperty("name");
      expect(data[0]).toHaveProperty("category");
      expect(data[0]).toHaveProperty("pricing");
      expect(data[0].pricing).toHaveProperty("formattedCost");
      // Compact mode — no description/tags to keep tokens low
      expect(data[0]).not.toHaveProperty("description");
      expect(data[0]).not.toHaveProperty("tags");
    });

    test("shows help with --help", async () => {
      const { stdout } = await runCli(["--help"]);
      expect(stdout).toContain("Discover and run AI agent skills");
    });

    test("shows version with --version", async () => {
      const { stdout } = await runCli(["--version"]);
      expect(stdout.trim()).toBe(PACKAGE_VERSION);
    });
  });

  describe("config --json", () => {
    test("shows, sets, gets, and reports paths as JSON", async () => {
      const { mkdtempSync, rmSync } = require("fs");
      const { tmpdir } = require("os");
      const tmpDir = mkdtempSync(require("path").join(tmpdir(), "cli-config-json-"));
      try {
        const empty = await runCliInCwd(["config", "show", "--json"], tmpDir, { HOME: tmpDir });
        expect(empty.exitCode).toBe(0);
        expect(JSON.parse(empty.stdout)).toEqual({});

        const set = await runCliInCwd(["config", "set", "apiUrl", "https://skills.md/api/v1/", "--json"], tmpDir, { HOME: tmpDir });
        expect(set.exitCode).toBe(0);
        const setData = JSON.parse(set.stdout);
        expect(setData).toMatchObject({ key: "apiUrl", value: "https://skills.md/api/v1", scope: "project" });

        const get = await runCliInCwd(["config", "get", "apiUrl", "--json"], tmpDir, { HOME: tmpDir });
        expect(JSON.parse(get.stdout)).toMatchObject({ key: "apiUrl", value: "https://skills.md/api/v1", set: true });

        const paths = await runCliInCwd(["config", "path", "--json"], tmpDir, { HOME: tmpDir });
        const pathData = JSON.parse(paths.stdout);
        expect(pathData.project.exists).toBe(true);
        expect(pathData.global.exists).toBe(false);
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });

  describe("registry sync", () => {
    test("outputs a registry sync artifact as JSON", async () => {
      const { stdout, exitCode } = await runCli([
        "registry",
        "sync",
        "--profile",
        "basic",
        "--no-docs",
        "--no-requirements",
        "--no-validation",
        "--json",
      ]);
      const data = JSON.parse(stdout);
      expect(exitCode).toBe(0);
      expect(data.schemaVersion).toBe(1);
      expect(data.source).toMatchObject({ packageName: "@hasna/skills", profile: "basic" });
      expect(data.summary.skillCount).toBe(EXPECTED_BASIC_SKILL_COUNT);
      expect(data.skills).toHaveLength(EXPECTED_BASIC_SKILL_COUNT);
      expect(data.skills[0]).not.toHaveProperty("docs");
      expect(data.skills[0]).not.toHaveProperty("requirements");
      expect(data.skills[0]).not.toHaveProperty("validation");
    });

    test("writes a registry sync artifact to --output", async () => {
      const { mkdtempSync, readFileSync, rmSync } = require("fs");
      const { tmpdir } = require("os");
      const tmpDir = mkdtempSync(require("path").join(tmpdir(), "cli-registry-sync-"));
      const output = require("path").join(tmpDir, "registry", "skills.json");
      try {
        const { stdout, exitCode } = await runCliInCwd([
          "registry",
          "sync",
          "--profile",
          "basic",
          "--no-docs",
          "--no-requirements",
          "--no-validation",
          "--output",
          output,
        ], tmpDir);
        expect(exitCode).toBe(0);
        expect(stdout).toContain("Registry sync artifact written");
        const data = JSON.parse(readFileSync(output, "utf8"));
        expect(data.summary.skillCount).toBe(EXPECTED_BASIC_SKILL_COUNT);
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test("rejects unknown registry profiles", async () => {
      const { stdout, exitCode } = await runCli([
        "registry",
        "sync",
        "--profile",
        "unknown",
        "--json",
      ]);
      expect(exitCode).not.toBe(0);
      expect(JSON.parse(stdout).error).toContain("Unknown registry profile");
    });
  });

  describe("categories", () => {
    test("lists categories", async () => {
      const { stdout } = await runCli(["categories"]);
      expect(stdout).toContain("Development Tools");
      expect(stdout).toContain("Business & Marketing");
      expect(stdout).toContain("Health & Wellness");
    });

    test("outputs JSON with --json", async () => {
      const { stdout } = await runCli(["categories", "--json"]);
      const data = JSON.parse(stdout);
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBe(17);
      expect(data[0]).toHaveProperty("name");
      expect(data[0]).toHaveProperty("count");
    });

    test("outputs remote categories with --remote --json", async () => {
      const server = Bun.serve({
        port: 0,
        fetch: () => Response.json([
          { name: "remote-one", category: "Remote Tools", tags: ["remote"] },
          { name: "remote-two", category: "Remote Tools", tags: ["remote"] },
        ]),
      });

      try {
        const { stdout, exitCode } = await runCli(["categories", "--remote", "--json"], {
          SKILLS_API_URL: `http://localhost:${server.port}`,
        });
        expect(exitCode).toBe(0);
        expect(JSON.parse(stdout)).toEqual([{ name: "Remote Tools", count: 2 }]);
      } finally {
        server.stop(true);
      }
    });
  });

  describe("list", () => {
    test("lists default basic skills", async () => {
      const { stdout } = await runCli(["list"]);
      expect(stdout).toContain(`Available default skills (${EXPECTED_BASIC_SKILL_COUNT})`);
      expect(stdout).toContain("image");
      expect(stdout).toContain("$0.04 estimated");
      expect(stdout).not.toContain("workout-cycle-planner");
      expect(stdout.toLowerCase()).not.toContain("openai");
      expect(stdout.toLowerCase()).not.toContain("gemini");
      expect(stdout.toLowerCase()).not.toContain("minimax");
    });

    test("lists all skills with --all", async () => {
      const { stdout } = await runCli(["list", "--all"]);
      expect(stdout).toContain(`Available skills (${EXPECTED_ALL_SKILL_COUNT})`);
      expect(stdout).toContain("Health & Wellness");
    });

    test("lists by category", async () => {
      const { stdout } = await runCli(["list", "--category", "Data & Analysis"]);
      expect(stdout).toContain("Data & Analysis (7)");
      expect(stdout).toContain("read-pdf");
    });

    test("lists full-registry categories with --all", async () => {
      const { stdout } = await runCli(["list", "--category", "Health & Wellness", "--all"]);
      expect(stdout).toContain("Health & Wellness (8)");
      expect(stdout).toContain("workout-cycle-planner");
    });

    test("fails for invalid category", async () => {
      const { stderr, exitCode } = await runCli(["list", "--category", "Fake Category"]);
      expect(stderr).toContain("Unknown category");
      expect(exitCode).not.toBe(0);
    });

    test("outputs JSON with --json", async () => {
      const { stdout } = await runCli(["list", "--json"]);
      const data = JSON.parse(stdout);
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBe(EXPECTED_BASIC_SKILL_COUNT);
      const image = data.find((skill: any) => skill.name === "image");
      expect(image.pricing).toMatchObject({
        tier: "premium",
        quoteDependsOnInput: true,
      });
      expect(JSON.stringify(image.pricing)).not.toContain("openai");
    });

    test("lists remote registry with --remote --json", async () => {
      const server = Bun.serve({
        port: 0,
        fetch: (req) => {
          expect(new URL(req.url).pathname).toBe("/api/v1/skills");
          return Response.json({
            skills: [
              {
                name: "remote-demo",
                displayName: "Remote Demo",
                description: "Demo from remote registry",
                category: "Remote Tools",
                tags: ["remote", "demo"],
              },
            ],
          });
        },
      });

      try {
        const { stdout, exitCode } = await runCli(["list", "--remote", "--json"], {
          SKILLS_API_URL: `http://localhost:${server.port}`,
        });
        const data = JSON.parse(stdout);
        expect(exitCode).toBe(0);
        expect(data).toHaveLength(1);
        expect(data[0].name).toBe("remote-demo");
        expect(data[0].source).toBe("remote");
      } finally {
        server.stop(true);
      }
    });

    test("outputs full JSON with --all --json", async () => {
      const { stdout } = await runCli(["list", "--all", "--json"]);
      const data = JSON.parse(stdout);
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBe(EXPECTED_ALL_SKILL_COUNT);
    });

    test("outputs complete full JSON when stdout is piped repeatedly", async () => {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const { stdout, exitCode } = await runCli(["list", "--all", "--json"]);
        expect(exitCode).toBe(0);
        expect(stdout.length).toBeGreaterThan(65_536);
        const data = JSON.parse(stdout);
        expect(Array.isArray(data)).toBe(true);
        expect(data.length).toBe(EXPECTED_ALL_SKILL_COUNT);
      }
    });

    test("lists by category with --json", async () => {
      const { stdout } = await runCli(["list", "--category", "Event Management", "--all", "--json"]);
      const data = JSON.parse(stdout);
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBe(4);
      for (const skill of data) {
        expect(skill.category).toBe("Event Management");
      }
    });
  });

  describe("search", () => {
    test("finds skills", async () => {
      const { stdout } = await runCli(["search", "pdf"]);
      expect(stdout).toContain("Found");
      expect(stdout).toContain("skill(s)");
      expect(stdout).toContain("Price:");
      expect(stdout).toContain("$0.05/run");
    });

    test("shows message for no results", async () => {
      const { stdout } = await runCli(["search", "zzzznonexistentzzzzz"]);
      expect(stdout).toContain("No skills found");
    });

    test("outputs JSON with --json", async () => {
      const { stdout } = await runCli(["search", "pdf", "--json"]);
      const data = JSON.parse(stdout);
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBeGreaterThan(0);
      expect(data[0]).toHaveProperty("name");
      expect(data[0]).toHaveProperty("pricing");
    });

    test("searches remote registry with --remote --json", async () => {
      const server = Bun.serve({
        port: 0,
        fetch: () => Response.json([
          {
            name: "remote-transcribe",
            displayName: "Remote Transcribe",
            description: "Transcribe audio on the hosted platform",
            category: "Remote Tools",
            tags: ["audio", "remote"],
          },
        ]),
      });

      try {
        const { stdout, exitCode } = await runCli(["search", "transcribe", "--remote", "--json"], {
          SKILLS_API_URL: `http://localhost:${server.port}`,
        });
        const data = JSON.parse(stdout);
        expect(exitCode).toBe(0);
        expect(data).toHaveLength(1);
        expect(data[0].name).toBe("remote-transcribe");
      } finally {
        server.stop(true);
      }
    });

    test("JSON output is empty array for no results", async () => {
      const { stdout } = await runCli(["search", "zzzznonexistentzzzzz", "--json"]);
      const data = JSON.parse(stdout);
      expect(data).toEqual([]);
    });
  });

  describe("info", () => {
    test("shows skill info", async () => {
      const { stdout } = await runCli(["info", "deepresearch"]);
      expect(stdout).toContain("Deep Research (Agentic)");
      expect(stdout).toContain("Research & Writing");
      expect(stdout).toContain("Pricing: $0.20/run");
      expect(stdout.toLowerCase()).not.toContain("exa");
      expect(stdout.toLowerCase()).not.toContain("openai");
      expect(stdout.toLowerCase()).not.toContain("claude");
    });

    test("fails for nonexistent skill", async () => {
      const { stderr, exitCode } = await runCli(["info", "nonexistent-xyz"]);
      expect(stderr).toContain("not found");
      expect(exitCode).not.toBe(0);
    });

    test("outputs JSON with --json", async () => {
      const { stdout } = await runCli(["info", "deepresearch", "--json"]);
      const data = JSON.parse(stdout);
      expect(data.name).toBe("deepresearch");
      expect(data.displayName).toBe("Deep Research (Agentic)");
      expect(data.category).toBe("Research & Writing");
      expect(Array.isArray(data.tags)).toBe(true);
      expect(data.pricing).toMatchObject({
        tier: "premium",
        formattedCost: "$0.20/run",
      });
      expect(JSON.stringify(data).toLowerCase()).not.toContain("exa");
      expect(JSON.stringify(data).toLowerCase()).not.toContain("openai");
      expect(JSON.stringify(data).toLowerCase()).not.toContain("claude");
    });

    test("shows remote skill info with auth and remote pricing", async () => {
      const server = Bun.serve({
        port: 0,
        fetch: (req) => {
          const url = new URL(req.url);
          expect(url.pathname).toBe("/api/v1/skills/remote-demo");
          expect(req.headers.get("authorization")).toBe("Bearer fixture-info");
          return Response.json({
            slug: "remote-demo",
            displayName: "Remote Demo",
            description: "Demo from remote registry",
            category: "Remote Tools",
            tags: ["remote", "demo"],
            version: "0.2.0",
            pricing: {
              tier: "premium",
              billingUnit: "run",
              costCents: 75,
              formattedCost: "$0.75/run",
              estimated: false,
              quoteDependsOnInput: false,
              quoteRequired: false,
              description: "Fixed remote price.",
            },
          });
        },
      });

      try {
        const { stdout, exitCode } = await runCli(["info", "remote-demo", "--remote", "--json"], {
          SKILLS_API_URL: `http://localhost:${server.port}/api/v1`,
          SKILLS_API_KEY: "fixture-info",
        });
        const data = JSON.parse(stdout);
        expect(exitCode).toBe(0);
        expect(data).toMatchObject({
          name: "remote-demo",
          displayName: "Remote Demo",
          category: "Remote Tools",
          source: "remote",
          version: "0.2.0",
          pricing: {
            formattedCost: "$0.75/run",
            estimated: false,
          },
        });
      } finally {
        server.stop(true);
      }
    });
  });

  describe("quote", () => {
    test("quotes fixed and variable premium skills without provider internals", async () => {
      const fixed = await runCli(["quote", "logo-design", "--json"]);
      expect(fixed.exitCode).toBe(0);
      expect(JSON.parse(fixed.stdout).pricing).toMatchObject({
        tier: "premium",
        formattedCost: "$0.50/run",
        quoteDependsOnInput: false,
      });

      const dataset = await runCli(["quote", "pdf-to-dataset", "--json"]);
      expect(dataset.exitCode).toBe(0);
      expect(JSON.parse(dataset.stdout).pricing).toMatchObject({
        tier: "premium",
        formattedCost: "$0.15/run",
        quoteDependsOnInput: false,
      });

      const markdown = await runCli(["quote", "pdf-to-markdown", "--json"]);
      expect(markdown.exitCode).toBe(0);
      expect(JSON.parse(markdown.stdout).pricing).toMatchObject({
        tier: "premium",
        formattedCost: "$0.05/run",
        quoteDependsOnInput: false,
      });

      const report = await runCli(["quote", "market-research-report", "--json"]);
      expect(report.exitCode).toBe(0);
      expect(JSON.parse(report.stdout).pricing).toMatchObject({
        tier: "premium",
        formattedCost: "$1.50/run",
        quoteDependsOnInput: false,
      });

      const customerFeedbackReport = await runCli(["quote", "customer-feedback-report", "--json"]);
      expect(customerFeedbackReport.exitCode).toBe(0);
      expect(JSON.parse(customerFeedbackReport.stdout).pricing).toMatchObject({
        tier: "premium",
        formattedCost: "$2.00/run",
        quoteDependsOnInput: false,
      });

      const proposal = await runCli(["quote", "proposal-pack", "--json"]);
      expect(proposal.exitCode).toBe(0);
      expect(JSON.parse(proposal.stdout).pricing).toMatchObject({
        tier: "premium",
        formattedCost: "$2.00/run",
        quoteDependsOnInput: false,
      });

      const pitchDeck = await runCli(["quote", "pitch-deck", "--json"]);
      expect(pitchDeck.exitCode).toBe(0);
      expect(JSON.parse(pitchDeck.stdout).pricing).toMatchObject({
        tier: "premium",
        formattedCost: "$3.00/run",
        quoteDependsOnInput: false,
      });

      const securityReport = await runCli(["quote", "security-audit-report", "--json"]);
      expect(securityReport.exitCode).toBe(0);
      expect(JSON.parse(securityReport.stdout).pricing).toMatchObject({
        tier: "premium",
        formattedCost: "$3.00/run",
        quoteDependsOnInput: false,
      });

      const brandKit = await runCli(["quote", "brand-kit", "--json"]);
      expect(brandKit.exitCode).toBe(0);
      expect(JSON.parse(brandKit.stdout).pricing).toMatchObject({
        tier: "premium",
        formattedCost: "$4.00/run",
        quoteDependsOnInput: false,
      });

      const productMockup = await runCli(["quote", "product-mockup", "--json"]);
      expect(productMockup.exitCode).toBe(0);
      expect(JSON.parse(productMockup.stdout).pricing).toMatchObject({
        tier: "premium",
        formattedCost: "$2.00/run",
        quoteDependsOnInput: false,
      });

      const seoContentPack = await runCli(["quote", "seo-content-pack", "--json"]);
      expect(seoContentPack.exitCode).toBe(0);
      expect(JSON.parse(seoContentPack.stdout).pricing).toMatchObject({
        tier: "premium",
        formattedCost: "$4.00/run",
        quoteDependsOnInput: false,
      });

      const landingPagePack = await runCli(["quote", "landing-page-pack", "--json"]);
      expect(landingPagePack.exitCode).toBe(0);
      expect(JSON.parse(landingPagePack.stdout).pricing).toMatchObject({
        tier: "premium",
        formattedCost: "$2.50/run",
        quoteDependsOnInput: false,
      });

      const onePageWebsite = await runCli(["quote", "one-page-website", "--json"]);
      expect(onePageWebsite.exitCode).toBe(0);
      expect(JSON.parse(onePageWebsite.stdout).pricing).toMatchObject({
        tier: "premium",
        formattedCost: "$5.00/run",
        quoteDependsOnInput: false,
      });

      const adCreativePack = await runCli(["quote", "ad-creative-pack", "--json"]);
      expect(adCreativePack.exitCode).toBe(0);
      expect(JSON.parse(adCreativePack.stdout).pricing).toMatchObject({
        tier: "premium",
        formattedCost: "$3.00/run",
        quoteDependsOnInput: false,
      });

      const emailSequence = await runCli(["quote", "email-sequence", "--json"]);
      expect(emailSequence.exitCode).toBe(0);
      expect(JSON.parse(emailSequence.stdout).pricing).toMatchObject({
        tier: "premium",
        formattedCost: "$2.50/run",
        quoteDependsOnInput: false,
      });

      const socialCalendar = await runCli(["quote", "social-content-calendar", "--json"]);
      expect(socialCalendar.exitCode).toBe(0);
      expect(JSON.parse(socialCalendar.stdout).pricing).toMatchObject({
        tier: "premium",
        formattedCost: "$3.00/run",
        quoteDependsOnInput: false,
      });

      const testSuite = await runCli(["quote", "test-suite-generator", "--json"]);
      expect(testSuite.exitCode).toBe(0);
      expect(JSON.parse(testSuite.stdout).pricing).toMatchObject({
        tier: "premium",
        formattedCost: "$2.50/run",
        quoteDependsOnInput: false,
      });

      const apiDocsPortal = await runCli(["quote", "api-docs-portal", "--json"]);
      expect(apiDocsPortal.exitCode).toBe(0);
      expect(JSON.parse(apiDocsPortal.stdout).pricing).toMatchObject({
        tier: "premium",
        formattedCost: "$2.50/run",
        quoteDependsOnInput: false,
      });

      const sdkGenerator = await runCli(["quote", "sdk-generator", "--json"]);
      expect(sdkGenerator.exitCode).toBe(0);
      expect(JSON.parse(sdkGenerator.stdout).pricing).toMatchObject({
        tier: "premium",
        formattedCost: "$6.00/run",
        quoteDependsOnInput: false,
      });

      const repoOnboardingReport = await runCli(["quote", "repo-onboarding-report", "--json"]);
      expect(repoOnboardingReport.exitCode).toBe(0);
      expect(JSON.parse(repoOnboardingReport.stdout).pricing).toMatchObject({
        tier: "premium",
        formattedCost: "$2.00/run",
        quoteDependsOnInput: false,
      });

      const audioTranscriptPack = await runCli(["quote", "audio-transcript-pack", "--json"]);
      expect(audioTranscriptPack.exitCode).toBe(0);
      expect(JSON.parse(audioTranscriptPack.stdout).pricing).toMatchObject({
        tier: "premium",
        formattedCost: "$1.50/run",
        quoteDependsOnInput: false,
      });

      const videoHighlightPack = await runCli(["quote", "video-highlight-pack", "--json"]);
      expect(videoHighlightPack.exitCode).toBe(0);
      expect(JSON.parse(videoHighlightPack.stdout).pricing).toMatchObject({
        tier: "premium",
        formattedCost: "$3.00/run",
        quoteDependsOnInput: false,
      });

      const slideDeckGenerator = await runCli(["quote", "slide-deck-generator", "--json"]);
      expect(slideDeckGenerator.exitCode).toBe(0);
      expect(JSON.parse(slideDeckGenerator.stdout).pricing).toMatchObject({
        tier: "premium",
        formattedCost: "$3.00/run",
        quoteDependsOnInput: false,
      });

      const meetingPack = await runCli(["quote", "meeting-pack", "--json"]);
      expect(meetingPack.exitCode).toBe(0);
      expect(JSON.parse(meetingPack.stdout).pricing).toMatchObject({
        tier: "premium",
        formattedCost: "$1.50/run",
        quoteDependsOnInput: false,
      });

      const invoiceReconciliation = await runCli(["quote", "invoice-reconciliation", "--json"]);
      expect(invoiceReconciliation.exitCode).toBe(0);
      expect(JSON.parse(invoiceReconciliation.stdout).pricing).toMatchObject({
        tier: "premium",
        formattedCost: "$2.00/run",
        quoteDependsOnInput: false,
      });

      const contractReviewReport = await runCli(["quote", "contract-review-report", "--json"]);
      expect(contractReviewReport.exitCode).toBe(0);
      expect(JSON.parse(contractReviewReport.stdout).pricing).toMatchObject({
        tier: "premium",
        formattedCost: "$3.00/run",
        quoteDependsOnInput: false,
      });

      const performanceAuditReport = await runCli(["quote", "performance-audit-report", "--json"]);
      expect(performanceAuditReport.exitCode).toBe(0);
      expect(JSON.parse(performanceAuditReport.stdout).pricing).toMatchObject({
        tier: "premium",
        formattedCost: "$3.00/run",
        quoteDependsOnInput: false,
      });

      const migrationPlanPack = await runCli(["quote", "migration-plan-pack", "--json"]);
      expect(migrationPlanPack.exitCode).toBe(0);
      expect(JSON.parse(migrationPlanPack.stdout).pricing).toMatchObject({
        tier: "premium",
        formattedCost: "$3.00/run",
        quoteDependsOnInput: false,
      });

      const batch = await runCli(["quote", "create-blog-article", "--count", "8", "--topic", "SaaS onboarding", "--json"]);
      expect(batch.exitCode).toBe(0);
      const data = JSON.parse(batch.stdout);
      expect(data.skill).toBe("blog-article");
      expect(data.pricing).toMatchObject({
        billingUnit: "article",
        unitCount: 8,
        costCents: 200,
        formattedCost: "$2.00 total",
      });
      expect(markdown.stdout.toLowerCase()).not.toContain("cerebras");
      expect(markdown.stdout.toLowerCase()).not.toContain("gpt-oss");
      expect(report.stdout.toLowerCase()).not.toContain("cerebras");
      expect(report.stdout.toLowerCase()).not.toContain("gpt-oss");
      expect(proposal.stdout.toLowerCase()).not.toContain("cerebras");
      expect(proposal.stdout.toLowerCase()).not.toContain("gpt-oss");
      expect(pitchDeck.stdout.toLowerCase()).not.toContain("cerebras");
      expect(pitchDeck.stdout.toLowerCase()).not.toContain("gpt-oss");
      expect(securityReport.stdout.toLowerCase()).not.toContain("cerebras");
      expect(securityReport.stdout.toLowerCase()).not.toContain("gpt-oss");
      expect(productMockup.stdout.toLowerCase()).not.toContain("openai");
      expect(productMockup.stdout.toLowerCase()).not.toContain("gemini");
      expect(productMockup.stdout.toLowerCase()).not.toContain("cerebras");
      expect(productMockup.stdout.toLowerCase()).not.toContain("gpt-oss");
      expect(seoContentPack.stdout.toLowerCase()).not.toContain("cerebras");
      expect(seoContentPack.stdout.toLowerCase()).not.toContain("gpt-oss");
      expect(landingPagePack.stdout.toLowerCase()).not.toContain("cerebras");
      expect(landingPagePack.stdout.toLowerCase()).not.toContain("gpt-oss");
      expect(onePageWebsite.stdout.toLowerCase()).not.toContain("openai");
      expect(onePageWebsite.stdout.toLowerCase()).not.toContain("gemini");
      expect(onePageWebsite.stdout.toLowerCase()).not.toContain("cerebras");
      expect(onePageWebsite.stdout.toLowerCase()).not.toContain("gpt-oss");
      expect(adCreativePack.stdout.toLowerCase()).not.toContain("cerebras");
      expect(adCreativePack.stdout.toLowerCase()).not.toContain("gpt-oss");
      expect(emailSequence.stdout.toLowerCase()).not.toContain("cerebras");
      expect(emailSequence.stdout.toLowerCase()).not.toContain("gpt-oss");
      expect(testSuite.stdout.toLowerCase()).not.toContain("cerebras");
      expect(testSuite.stdout.toLowerCase()).not.toContain("gpt-oss");
      expect(apiDocsPortal.stdout.toLowerCase()).not.toContain("cerebras");
      expect(apiDocsPortal.stdout.toLowerCase()).not.toContain("gpt-oss");
      expect(sdkGenerator.stdout.toLowerCase()).not.toContain("openai");
      expect(sdkGenerator.stdout.toLowerCase()).not.toContain("gemini");
      expect(sdkGenerator.stdout.toLowerCase()).not.toContain("cerebras");
      expect(sdkGenerator.stdout.toLowerCase()).not.toContain("gpt-oss");
      expect(batch.stdout).not.toContain("cerebras");
      expect(batch.stdout).not.toContain("gpt-oss");

      const invalidBatch = await runCli(["quote", "create-blog-article", "--count", "13", "--topic", "SaaS onboarding", "--json"]);
      expect(invalidBatch.exitCode).toBe(1);
      expect(JSON.parse(invalidBatch.stdout)).toMatchObject({
        code: "INVALID_BLOG_ARTICLE_OPTIONS",
        details: ["Count must be an integer between 1 and 12."],
      });
    }, SLOW_TEST_TIMEOUT);
  });

});
