#!/usr/bin/env bun

import { program } from "commander";
import { readFile, writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { execSync } from "child_process";
import { homedir } from "os";
import chalk from "chalk";
import ora from "ora";
import semver from "semver";

interface PackageJson {
  name: string;
  version: string;
  publishConfig?: {
    access?: string;
  };
  private?: boolean;
  [key: string]: unknown;
}

type BumpType = "patch" | "minor" | "major";
type Platform = "claude" | "codex";

// ============================================================================
// Publish Command
// ============================================================================

async function readPackageJson(dir: string): Promise<PackageJson> {
  const pkgPath = join(dir, "package.json");
  const content = await readFile(pkgPath, "utf-8");
  return JSON.parse(content) as PackageJson;
}

async function writePackageJson(dir: string, pkg: PackageJson): Promise<void> {
  const pkgPath = join(dir, "package.json");
  await writeFile(pkgPath, JSON.stringify(pkg, null, 2) + "\n", "utf-8");
}

function bumpVersion(version: string, type: BumpType): string {
  const newVersion = semver.inc(version, type);
  if (!newVersion) {
    throw new Error(`Invalid version: ${version}`);
  }
  return newVersion;
}

function ensurePrivate(pkg: PackageJson): boolean {
  let modified = false;
  if (!pkg.publishConfig) {
    pkg.publishConfig = { access: "restricted" };
    modified = true;
  } else if (pkg.publishConfig.access !== "restricted") {
    pkg.publishConfig.access = "restricted";
    modified = true;
  }
  return modified;
}

async function publish(options: {
  bump: BumpType;
  public: boolean;
  dryRun: boolean;
  dir: string;
}): Promise<void> {
  const spinner = ora();
  const dir = options.dir;

  try {
    spinner.start("Reading package.json...");
    const pkg = await readPackageJson(dir);
    spinner.succeed(`Package: ${chalk.cyan(pkg.name)} v${pkg.version}`);

    if (!options.public) {
      spinner.start("Ensuring private access...");
      const wasModified = ensurePrivate(pkg);
      if (wasModified) {
        spinner.succeed("Set publishConfig.access to restricted");
      } else {
        spinner.succeed("Already configured for private access");
      }
    } else {
      spinner.info(chalk.yellow("Publishing as PUBLIC package"));
      if (pkg.publishConfig) {
        pkg.publishConfig.access = "public";
      } else {
        pkg.publishConfig = { access: "public" };
      }
    }

    spinner.start(`Bumping version (${options.bump})...`);
    const oldVersion = pkg.version;
    const newVersion = bumpVersion(oldVersion, options.bump);
    pkg.version = newVersion;
    spinner.succeed(`Version: ${chalk.dim(oldVersion)} → ${chalk.green(newVersion)}`);

    spinner.start("Updating package.json...");
    await writePackageJson(dir, pkg);
    spinner.succeed("package.json updated");

    if (options.dryRun) {
      console.log();
      console.log(chalk.yellow("DRY RUN - would publish:"));
      console.log(`  Package: ${pkg.name}`);
      console.log(`  Version: ${newVersion}`);
      console.log(`  Access: ${pkg.publishConfig?.access || "default"}`);
      return;
    }

    spinner.start("Publishing to npm...");
    const accessFlag = options.public ? "--access public" : "--access restricted";
    execSync(`bun publish ${accessFlag}`, {
      cwd: dir,
      stdio: "pipe",
      env: { ...process.env },
    });
    spinner.succeed(`Published ${chalk.cyan(pkg.name)}@${chalk.green(newVersion)}`);

    if (!options.public) {
      spinner.start("Confirming private access on npm...");
      try {
        execSync(`npm access set status=private ${pkg.name}`, {
          cwd: dir,
          stdio: "pipe",
          env: { ...process.env },
        });
        spinner.succeed("Confirmed private access");
      } catch {
        spinner.info("Access already configured");
      }
    }

    console.log();
    console.log(chalk.green("✓"), `Successfully published ${pkg.name}@${newVersion}`);
    console.log(chalk.dim(`  Install: bun add ${pkg.name}`));

  } catch (error) {
    spinner.fail("Publish failed");
    if (error instanceof Error) {
      console.error(chalk.red(error.message));
      if (error.message.includes("ENEEDAUTH") || error.message.includes("auth")) {
        console.error(chalk.dim("Make sure NPM_TOKEN is set in ~/.secrets"));
      }
    }
    process.exit(1);
  }
}

// ============================================================================
// Install Command
// ============================================================================

const SKILL_MD_CONTENT = `---
name: skill-npmpublish
description: Publish npm packages with sensible defaults. Automatically sets private access and bumps patch version (0.0.1). Use when publishing packages to npm, especially for internal/private packages.
---

# npm Publish

Publish npm packages to the npm registry with sensible defaults:
- **Private by default** - Sets \`publishConfig.access: restricted\`
- **Patch bump by default** - Increments version by 0.0.1

## CLI Usage

Run the CLI directly:

\`\`\`bash
# Publish with defaults (private, patch bump)
skill-npmpublish

# Specify bump type
skill-npmpublish --bump minor    # 0.1.0
skill-npmpublish --bump major    # 1.0.0
skill-npmpublish --bump patch    # 0.0.1 (default)

# Publish as public (use carefully!)
skill-npmpublish --public

# Dry run (see what would happen)
skill-npmpublish --dry-run

# Publish from a different directory
skill-npmpublish --dir /path/to/package
\`\`\`

## Options

| Option | Description | Default |
|--------|-------------|---------|
| \`-b, --bump <type>\` | Version bump: patch, minor, major | patch |
| \`--public\` | Publish as public package | false (private) |
| \`--dry-run\` | Preview without publishing | false |
| \`-d, --dir <path>\` | Package directory | current dir |

## Data Directories

- **exports/** - Published package logs
- **uploads/** - Files to include in publish
- **logs/** - Execution logs

## Requirements

- \`NPM_TOKEN\` in \`~/.secrets\` for authentication
- Valid \`package.json\` in target directory
- Bun runtime with \`skill-npmpublish\` installed globally

## Install CLI

\`\`\`bash
bun add -g @hasnaxyz/skill-npmpublish
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
  const spinner = ora();
  const skillName = "skill-npmpublish";
  const baseDir = getSkillsDir(options.platform, options.local);
  const skillDir = join(baseDir, skillName);

  try {
    spinner.start(`Installing skill to ${options.platform === "claude" ? "Claude Code" : "Codex"}...`);

    // Create skill directory structure
    await ensureDir(skillDir);
    await ensureDir(join(skillDir, "exports"));
    await ensureDir(join(skillDir, "uploads"));
    await ensureDir(join(skillDir, "logs"));

    // Write SKILL.md
    const skillMdPath = join(skillDir, "SKILL.md");
    await writeFile(skillMdPath, SKILL_MD_CONTENT, "utf-8");

    spinner.succeed(`Installed to ${chalk.cyan(skillDir)}`);

    console.log();
    console.log(chalk.green("✓"), `Skill ${chalk.cyan(skillName)} installed successfully`);
    console.log();
    console.log("Created structure:");
    console.log(chalk.dim(`  ${skillDir}/`));
    console.log(chalk.dim(`  ├── SKILL.md`));
    console.log(chalk.dim(`  ├── exports/`));
    console.log(chalk.dim(`  ├── uploads/`));
    console.log(chalk.dim(`  └── logs/`));
    console.log();
    console.log(`Invoke with: ${chalk.cyan(`/${skillName}`)}`);

  } catch (error) {
    spinner.fail("Install failed");
    if (error instanceof Error) {
      console.error(chalk.red(error.message));
    }
    process.exit(1);
  }
}

// ============================================================================
// CLI Setup
// ============================================================================

program
  .name("skill-npmpublish")
  .description("Publish npm packages with sensible defaults: private access, patch bumps")
  .version("0.1.1");

// Default publish command (when no subcommand given)
program
  .option("-b, --bump <type>", "Version bump type: patch, minor, major", "patch")
  .option("--public", "Publish as public package (default: private)")
  .option("--dry-run", "Show what would be published without publishing")
  .option("-d, --dir <path>", "Directory containing package.json", process.cwd())
  .action(async (options) => {
    const validBumps: BumpType[] = ["patch", "minor", "major"];
    if (!validBumps.includes(options.bump as BumpType)) {
      console.error(chalk.red(`Invalid bump type: ${options.bump}`));
      console.error(`Valid types: ${validBumps.join(", ")}`);
      process.exit(1);
    }

    await publish({
      bump: options.bump as BumpType,
      public: options.public || false,
      dryRun: options.dryRun || false,
      dir: options.dir,
    });
  });

// Install subcommand
program
  .command("install")
  .description("Install this skill to Claude Code or Codex")
  .option("--claude", "Install to Claude Code (~/.claude/skills/)")
  .option("--codex", "Install to OpenAI Codex (~/.codex/skills/)")
  .option("--local", "Install to local repo (.claude/skills/ or .codex/skills/)")
  .action(async (options) => {
    if (!options.claude && !options.codex) {
      console.error(chalk.red("Please specify --claude or --codex"));
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

program.parse();
