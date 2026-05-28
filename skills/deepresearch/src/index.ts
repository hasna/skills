#!/usr/bin/env bun

import { program } from "commander";
import { runResearch } from "./research";
import type { DepthLevel, ModelProvider, ResearchConfig } from "./types";
import logger from "./utils/logger";

// ============================================================================
// CLI Setup
// ============================================================================

program
  .name("deepresearch")
  .description("Agentic deep research using Exa.ai search and LLM synthesis")
  .version("0.1.1");

// Install subcommand
program
  .command("install")
  .description("Disabled: register the root Skills MCP server instead")
  .option("--claude", "Show Claude Code MCP registration guidance")
  .option("--codex", "Show Codex MCP registration guidance")
  .option("--local", "Ignored; per-skill local folders are disabled")
  .action(async (options) => {
    const target = options.claude ? "claude" : options.codex ? "codex" : "all";
    logger.error("Direct per-skill installs are disabled.");
    logger.error(`Use: skills mcp --register ${target}`);
    process.exit(1);
  });

// Research command (default)
program
  .argument("<topic>", "Research topic or question")
  .option("-d, --depth <level>", "Research depth: quick, normal, deep", "normal")
  .option("-m, --model <provider>", "LLM for synthesis: claude, openai", "claude")
  .option("-o, --output <path>", "Custom output path for report")
  .option("-j, --json", "Also output sources as JSON")
  .option("--no-firecrawl", "Skip Firecrawl deep scraping")
  .action(async (topic: string, options) => {
    const validDepths: DepthLevel[] = ["quick", "normal", "deep"];
    const validModels: ModelProvider[] = ["claude", "openai"];

    if (!validDepths.includes(options.depth as DepthLevel)) {
      logger.error(`Invalid depth: ${options.depth}. Use: ${validDepths.join(", ")}`);
      process.exit(1);
    }

    if (!validModels.includes(options.model as ModelProvider)) {
      logger.error(`Invalid model: ${options.model}. Use: ${validModels.join(", ")}`);
      process.exit(1);
    }

    const config: ResearchConfig = {
      topic,
      depth: options.depth as DepthLevel,
      model: options.model as ModelProvider,
      output: options.output,
      json: options.json,
      firecrawl: options.firecrawl,
    };

    try {
      await runResearch(config);
    } catch (error) {
      logger.stopSpinner();
      logger.error(error instanceof Error ? error.message : "Unknown error");
      process.exit(1);
    }
  });

program.parse();
