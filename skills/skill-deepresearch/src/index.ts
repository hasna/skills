#!/usr/bin/env bun

import { program } from "commander";
import { mkdir, writeFile } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
import { runResearch } from "./research";
import type { DepthLevel, ModelProvider, ResearchConfig } from "./types";
import logger from "./utils/logger";

type Platform = "claude" | "codex";

// ============================================================================
// Install Command
// ============================================================================

const SKILL_MD_CONTENT = `---
name: skill-deepresearch
description: Perform deep research on any topic using Exa.ai for parallel semantic search and Claude/OpenAI for synthesis. Use when you need comprehensive research reports with citations, analysis of topics from multiple angles, or thorough investigation of technical subjects.
---

# Deep Research

Agentic deep research skill using Exa.ai for search and Claude/OpenAI for synthesis.

## CLI Usage

Run the CLI directly:

\`\`\`bash
# Basic usage
skill-deepresearch "What are the best practices for building RAG systems?"

# Quick research (6 queries)
skill-deepresearch "What is vector search?" --depth quick

# Normal research (15 queries, default)
skill-deepresearch "Best practices for ML systems" --depth normal

# Deep research (30 queries, 2 iterations)
skill-deepresearch "Compare React vs Vue" --depth deep

# Use OpenAI instead of Claude
skill-deepresearch "State of AI in 2024" --model openai

# Custom output location
skill-deepresearch "Kubernetes best practices" --output ./k8s-research.md

# Include raw sources JSON
skill-deepresearch "GraphQL vs REST APIs" --json
\`\`\`

## Options

| Option | Description | Default |
|--------|-------------|---------|
| \`-d, --depth <level>\` | Research depth: quick, normal, deep | normal |
| \`-m, --model <provider>\` | LLM: claude or openai | claude |
| \`-o, --output <path>\` | Custom output path | exports/ |
| \`-j, --json\` | Also save sources as JSON | false |
| \`--no-firecrawl\` | Skip deep scraping | false |

## Depth Levels

| Level | Queries | Iterations | Use Case |
|-------|---------|------------|----------|
| quick | 6 | 1 | Fast overview |
| normal | 15 | 1 | Standard research |
| deep | 30 | 2 | Thorough analysis |

## Data Directories

- **exports/** - Generated research reports
- **uploads/** - User-provided files for context
- **logs/** - Execution logs

## Requirements

- \`EXA_API_KEY\` in \`~/.secrets\` - Required for search
- \`ANTHROPIC_API_KEY\` in \`~/.secrets\` - Required for Claude synthesis
- \`OPENAI_API_KEY\` in \`~/.secrets\` - Required for OpenAI synthesis
- \`FIRECRAWL_API_KEY\` in \`~/.secrets\` - Optional for deep scraping
- Bun runtime with \`skill-deepresearch\` installed globally

## Install CLI

\`\`\`bash
bun add -g @hasnaxyz/skill-deepresearch
\`\`\`
`;

async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
}

function getSkillsDir(platform: Platform, local: boolean): string {
  if (local) {
    return platform === "claude" ? ".claude/skills" : ".codex/skills";
  }
  const home = homedir();
  return platform === "claude"
    ? join(home, ".claude", "skills")
    : join(home, ".codex", "skills");
}

async function installSkill(options: {
  platform: Platform;
  local: boolean;
}): Promise<void> {
  const skillName = "skill-deepresearch";
  const baseDir = getSkillsDir(options.platform, options.local);
  const skillDir = join(baseDir, skillName);

  try {
    logger.startSpinner(`Installing skill to ${options.platform === "claude" ? "Claude Code" : "Codex"}...`);

    // Create skill directory structure
    await ensureDir(skillDir);
    await ensureDir(join(skillDir, "exports"));
    await ensureDir(join(skillDir, "uploads"));
    await ensureDir(join(skillDir, "logs"));

    // Write SKILL.md
    const skillMdPath = join(skillDir, "SKILL.md");
    await writeFile(skillMdPath, SKILL_MD_CONTENT, "utf-8");

    logger.succeedSpinner(`Installed to ${skillDir}`);

    console.log();
    logger.success(`Skill ${skillName} installed successfully`);
    console.log();
    console.log("Created structure:");
    console.log(`  ${skillDir}/`);
    console.log(`  ├── SKILL.md`);
    console.log(`  ├── exports/`);
    console.log(`  ├── uploads/`);
    console.log(`  └── logs/`);
    console.log();
    console.log(`Invoke with: /${skillName}`);

  } catch (error) {
    logger.failSpinner("Install failed");
    if (error instanceof Error) {
      logger.error(error.message);
    }
    process.exit(1);
  }
}

// ============================================================================
// CLI Setup
// ============================================================================

program
  .name("skill-deepresearch")
  .description("Agentic deep research using Exa.ai search and LLM synthesis")
  .version("0.1.1");

// Install subcommand
program
  .command("install")
  .description("Install this skill to Claude Code or Codex")
  .option("--claude", "Install to Claude Code (~/.claude/skills/)")
  .option("--codex", "Install to OpenAI Codex (~/.codex/skills/)")
  .option("--local", "Install to local repo (.claude/skills/ or .codex/skills/)")
  .action(async (options) => {
    if (!options.claude && !options.codex) {
      logger.error("Please specify --claude or --codex");
      process.exit(1);
    }

    const platforms: Platform[] = [];
    if (options.claude) platforms.push("claude");
    if (options.codex) platforms.push("codex");

    for (const platform of platforms) {
      await installSkill({
        platform,
        local: options.local || false,
      });
    }
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
