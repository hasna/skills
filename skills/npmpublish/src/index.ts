#!/usr/bin/env bun

import { program } from "commander";
import { readFile, writeFile } from "fs/promises";
import { join } from "path";
import { execSync } from "child_process";
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
// CLI Setup
// ============================================================================

program
  .name("npmpublish")
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
  .description("Disabled: register the root Skills MCP server instead")
  .option("--claude", "Show Claude Code MCP registration guidance")
  .option("--codex", "Show Codex MCP registration guidance")
  .option("--local", "Ignored; per-skill local folders are disabled")
  .action(async (options) => {
    const target = options.claude ? "claude" : options.codex ? "codex" : "all";
    console.error(chalk.red("Direct per-skill installs are disabled."));
    console.error(`Use: skills mcp --register ${target}`);
    process.exit(1);
  });

program.parse();
