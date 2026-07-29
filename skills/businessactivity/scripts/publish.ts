#!/usr/bin/env bun
/**
 * Auto-versioning publish script
 * - Fetches current npm version
 * - Auto-bumps patch version if local version <= npm version
 * - Creates git tag
 * - Publishes to npm
 */

import { $ } from 'bun';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

interface PackageJson {
  name: string;
  version: string;
  [key: string]: unknown;
}

type BumpType = 'patch' | 'minor' | 'major';

function parseVersion(version: string): { major: number; minor: number; patch: number } {
  const [major, minor, patch] = version.split('.').map(Number);
  return { major, minor, patch };
}

function bumpVersion(version: string, type: BumpType = 'patch'): string {
  const { major, minor, patch } = parseVersion(version);

  switch (type) {
    case 'major':
      return `${major + 1}.0.0`;
    case 'minor':
      return `${major}.${minor + 1}.0`;
    case 'patch':
    default:
      return `${major}.${minor}.${patch + 1}`;
  }
}

function compareVersions(a: string, b: string): number {
  const vA = parseVersion(a);
  const vB = parseVersion(b);

  if (vA.major !== vB.major) return vA.major - vB.major;
  if (vA.minor !== vB.minor) return vA.minor - vB.minor;
  return vA.patch - vB.patch;
}

async function getNpmVersion(packageName: string): Promise<string | null> {
  try {
    const result = await $`npm view ${packageName} version 2>/dev/null`.text();
    return result.trim() || null;
  } catch {
    return null;
  }
}

async function hasUncommittedChanges(): Promise<boolean> {
  try {
    const result = await $`git status --porcelain`.text();
    return result.trim().length > 0;
  } catch {
    return false;
  }
}

async function isGitRepo(): Promise<boolean> {
  try {
    await $`git rev-parse --git-dir 2>/dev/null`.text();
    return true;
  } catch {
    return false;
  }
}

async function createGitTag(version: string, packageName: string): Promise<boolean> {
  const tagName = `${packageName}@${version}`;

  try {
    // Check if tag already exists
    const existingTags = await $`git tag -l ${tagName}`.text();
    if (existingTags.trim()) {
      console.log(`⚠️  Tag ${tagName} already exists, skipping tag creation`);
      return true;
    }

    await $`git tag -a ${tagName} -m "Release ${tagName}"`;
    console.log(`✅ Created git tag: ${tagName}`);
    return true;
  } catch (error) {
    console.error(`❌ Failed to create git tag: ${error}`);
    return false;
  }
}

async function commitVersionBump(version: string, packageName: string): Promise<boolean> {
  try {
    await $`git add package.json`;
    await $`git commit -m "chore(${packageName}): bump version to ${version}"`;
    console.log(`✅ Committed version bump`);
    return true;
  } catch (error) {
    console.error(`❌ Failed to commit: ${error}`);
    return false;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const bumpType = (args.find(a => ['patch', 'minor', 'major'].includes(a)) || 'patch') as BumpType;
  const skipGit = args.includes('--skip-git');
  const dryRun = args.includes('--dry-run');
  const force = args.includes('--force');

  // Read package.json
  const pkgPath = join(process.cwd(), 'package.json');
  const pkg: PackageJson = JSON.parse(readFileSync(pkgPath, 'utf-8'));

  console.log(`\n📦 Publishing ${pkg.name}\n`);

  // Get current npm version
  const npmVersion = await getNpmVersion(pkg.name);
  let newVersion = pkg.version;

  if (npmVersion) {
    console.log(`📌 Current npm version: ${npmVersion}`);
    console.log(`📌 Local version: ${pkg.version}`);

    // Check if we need to bump
    if (compareVersions(pkg.version, npmVersion) <= 0) {
      newVersion = bumpVersion(npmVersion, bumpType);
      console.log(`🔄 Auto-bumping to: ${newVersion}`);
    } else {
      console.log(`✅ Local version is ahead, using: ${pkg.version}`);
    }
  } else {
    console.log(`📌 Package not yet published to npm`);
    console.log(`📌 Using local version: ${pkg.version}`);
  }

  // Update package.json if version changed
  if (newVersion !== pkg.version) {
    if (dryRun) {
      console.log(`\n🧪 DRY RUN: Would update version to ${newVersion}`);
    } else {
      pkg.version = newVersion;
      writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
      console.log(`✅ Updated package.json to version ${newVersion}`);
    }
  }

  // Git operations
  const isGit = await isGitRepo();

  if (isGit && !skipGit) {
    const hasChanges = await hasUncommittedChanges();

    if (hasChanges && newVersion !== pkg.version) {
      if (dryRun) {
        console.log(`🧪 DRY RUN: Would commit version bump`);
      } else {
        await commitVersionBump(newVersion, pkg.name.replace('@hasnaxyz/', ''));
      }
    }

    if (dryRun) {
      console.log(`🧪 DRY RUN: Would create tag ${pkg.name}@${newVersion}`);
    } else {
      await createGitTag(newVersion, pkg.name.replace('@hasnaxyz/', ''));
    }
  }

  // Build
  console.log(`\n🔨 Building...`);
  if (!dryRun) {
    await $`bun run build`;
  } else {
    console.log(`🧪 DRY RUN: Would run build`);
  }

  // Publish
  console.log(`\n🚀 Publishing to npm...`);
  if (dryRun) {
    console.log(`🧪 DRY RUN: Would publish ${pkg.name}@${newVersion}`);
  } else {
    try {
      await $`npm publish`;
      console.log(`\n✅ Successfully published ${pkg.name}@${newVersion}`);
    } catch (error) {
      console.error(`\n❌ Publish failed: ${error}`);
      process.exit(1);
    }
  }

  // Push tags
  if (isGit && !skipGit && !dryRun) {
    console.log(`\n📤 Pushing tags to remote...`);
    try {
      await $`git push --tags`;
      console.log(`✅ Pushed tags to remote`);
    } catch {
      console.log(`⚠️  Could not push tags (no remote or not configured)`);
    }
  }

  console.log(`\n✨ Done!\n`);
}

main().catch(console.error);
