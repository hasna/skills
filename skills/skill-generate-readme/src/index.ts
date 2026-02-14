#!/usr/bin/env bun

/**
 * Generate README - Auto-generate comprehensive README.md files from codebase analysis
 *
 * This skill analyzes a codebase and generates a professional README.md with:
 * - Project detection (type, frameworks, dependencies)
 * - Badge generation
 * - Code examples
 * - Multiple templates
 * - Custom sections
 */

import { readFile, writeFile, readdir, stat, exists } from "fs/promises";
import { resolve, join, dirname, basename } from "path";
import { parseArgs } from "util";

// Types
interface PackageJson {
  name?: string;
  version?: string;
  description?: string;
  author?: string | { name: string; email?: string };
  license?: string;
  repository?: string | { type: string; url: string };
  homepage?: string;
  main?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  keywords?: string[];
  engines?: Record<string, string>;
}

interface PyProjectToml {
  tool?: {
    poetry?: {
      name?: string;
      version?: string;
      description?: string;
      authors?: string[];
      license?: string;
      homepage?: string;
      repository?: string;
      dependencies?: Record<string, string>;
    };
  };
  project?: {
    name?: string;
    version?: string;
    description?: string;
    authors?: Array<{ name: string; email?: string }>;
    license?: string;
    dependencies?: string[];
  };
}

interface CargoToml {
  package?: {
    name?: string;
    version?: string;
    description?: string;
    authors?: string[];
    license?: string;
    repository?: string;
    homepage?: string;
  };
  dependencies?: Record<string, any>;
}

interface ProjectInfo {
  name: string;
  version: string;
  description: string;
  author: string;
  license: string;
  repository: string;
  homepage: string;
  type: "nodejs" | "python" | "rust" | "go" | "ruby" | "php" | "java" | "unknown";
  frameworks: string[];
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  packageManager: "npm" | "yarn" | "pnpm" | "bun" | "pip" | "poetry" | "cargo" | "go" | "unknown";
  hasTests: boolean;
  hasCI: boolean;
  mainFile?: string;
}

interface Config {
  template: "minimal" | "standard" | "comprehensive";
  output: string;
  sections: {
    features: boolean;
    installation: boolean;
    usage: boolean;
    api: boolean;
    contributing: boolean;
    license: boolean;
    changelog: boolean;
    roadmap: boolean;
  };
  customSections: Array<{ title: string; content: string }>;
  badges: string[];
  noBadges: boolean;
  noToc: boolean;
  noExamples: boolean;
  license?: string;
  author?: string;
  repository?: string;
  homepage?: string;
  title?: string;
  description?: string;
}

interface Arguments {
  template: "minimal" | "standard" | "comprehensive";
  output: string;
  config?: string;
  sections?: string;
  exclude?: string;
  dryRun: boolean;
  force: boolean;
  noBadges: boolean;
  noToc: boolean;
  noExamples: boolean;
  includeChangelog: boolean;
  license?: string;
  badges?: string;
}

// Constants
const SKILL_NAME = "generate-readme";
const OUTPUT_DIR = process.env.SKILLS_OUTPUT_DIR || ".skills";
const PROJECT_ROOT = process.env.SKILLS_PROJECT_ROOT || process.cwd();
const CWD = process.env.SKILLS_CWD || process.cwd();

// Utility functions
function log(message: string, level: "info" | "error" | "success" = "info") {
  const prefix = {
    info: "ℹ",
    error: "✗",
    success: "✓",
  }[level];
  console.log(`${prefix} ${message}`);
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function findPackageFile(): Promise<string | null> {
  const packageFiles = [
    "package.json",
    "pyproject.toml",
    "Cargo.toml",
    "go.mod",
    "Gemfile",
    "composer.json",
    "pom.xml",
    "build.gradle",
  ];

  for (const file of packageFiles) {
    const path = join(CWD, file);
    if (await fileExists(path)) {
      return path;
    }
  }

  return null;
}

async function parsePackageJson(path: string): Promise<Partial<ProjectInfo>> {
  const content = await readFile(path, "utf-8");
  const pkg: PackageJson = JSON.parse(content);

  // Detect frameworks
  const frameworks: string[] = [];
  const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };

  const frameworkMap: Record<string, string> = {
    next: "Next.js",
    react: "React",
    vue: "Vue.js",
    "@angular/core": "Angular",
    express: "Express",
    "@nestjs/core": "NestJS",
    fastify: "Fastify",
    koa: "Koa",
    svelte: "Svelte",
    "@remix-run/react": "Remix",
    astro: "Astro",
  };

  for (const [dep, framework] of Object.entries(frameworkMap)) {
    if (allDeps[dep]) {
      frameworks.push(framework);
    }
  }

  // Determine package manager
  let packageManager: ProjectInfo["packageManager"] = "npm";
  if (await fileExists(join(CWD, "bun.lockb"))) packageManager = "bun";
  else if (await fileExists(join(CWD, "pnpm-lock.yaml"))) packageManager = "pnpm";
  else if (await fileExists(join(CWD, "yarn.lock"))) packageManager = "yarn";

  const repoUrl =
    typeof pkg.repository === "string" ? pkg.repository : pkg.repository?.url || "";

  return {
    name: pkg.name || basename(CWD),
    version: pkg.version || "1.0.0",
    description: pkg.description || "",
    author: typeof pkg.author === "string" ? pkg.author : pkg.author?.name || "",
    license: pkg.license || "MIT",
    repository: repoUrl.replace(/^git\+/, "").replace(/\.git$/, ""),
    homepage: pkg.homepage || "",
    type: "nodejs",
    frameworks,
    dependencies: pkg.dependencies || {},
    devDependencies: pkg.devDependencies || {},
    packageManager,
    mainFile: pkg.main,
  };
}

async function parsePyProjectToml(path: string): Promise<Partial<ProjectInfo>> {
  const content = await readFile(path, "utf-8");

  // Simple TOML parser for pyproject.toml
  const lines = content.split("\n");
  const info: Partial<ProjectInfo> = {
    type: "python",
    frameworks: [],
    dependencies: {},
    devDependencies: {},
  };

  let section = "";
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      section = trimmed.slice(1, -1);
    } else if (trimmed.includes("=")) {
      const [key, ...valueParts] = trimmed.split("=");
      const value = valueParts.join("=").trim().replace(/^["']|["']$/g, "");

      if (section === "tool.poetry" || section === "project") {
        if (key.trim() === "name") info.name = value;
        if (key.trim() === "version") info.version = value;
        if (key.trim() === "description") info.description = value;
        if (key.trim() === "license") info.license = value;
      }
    }
  }

  // Detect Python frameworks
  const frameworks: string[] = [];
  if (content.includes("django")) frameworks.push("Django");
  if (content.includes("fastapi")) frameworks.push("FastAPI");
  if (content.includes("flask")) frameworks.push("Flask");
  if (content.includes("tornado")) frameworks.push("Tornado");

  info.frameworks = frameworks;
  info.packageManager = content.includes("[tool.poetry]") ? "poetry" : "pip";

  return info;
}

async function parseCargoToml(path: string): Promise<Partial<ProjectInfo>> {
  const content = await readFile(path, "utf-8");

  // Simple TOML parser for Cargo.toml
  const lines = content.split("\n");
  const info: Partial<ProjectInfo> = {
    type: "rust",
    frameworks: [],
    dependencies: {},
    devDependencies: {},
    packageManager: "cargo",
  };

  let section = "";
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      section = trimmed.slice(1, -1);
    } else if (trimmed.includes("=") && section === "package") {
      const [key, ...valueParts] = trimmed.split("=");
      const value = valueParts.join("=").trim().replace(/^["']|["']$/g, "");

      if (key.trim() === "name") info.name = value;
      if (key.trim() === "version") info.version = value;
      if (key.trim() === "description") info.description = value;
      if (key.trim() === "license") info.license = value;
      if (key.trim() === "repository") info.repository = value;
      if (key.trim() === "homepage") info.homepage = value;
    }
  }

  // Detect Rust frameworks
  const frameworks: string[] = [];
  if (content.includes("actix-web")) frameworks.push("Actix Web");
  if (content.includes("rocket")) frameworks.push("Rocket");
  if (content.includes("tokio")) frameworks.push("Tokio");
  if (content.includes("axum")) frameworks.push("Axum");

  info.frameworks = frameworks;

  return info;
}

async function detectProjectInfo(): Promise<ProjectInfo> {
  const packageFile = await findPackageFile();

  if (!packageFile) {
    log("No package file found, using defaults", "info");
    return {
      name: basename(CWD),
      version: "1.0.0",
      description: "",
      author: "",
      license: "MIT",
      repository: "",
      homepage: "",
      type: "unknown",
      frameworks: [],
      dependencies: {},
      devDependencies: {},
      packageManager: "unknown",
      hasTests: false,
      hasCI: false,
    };
  }

  log(`Found package file: ${basename(packageFile)}`, "info");

  let info: Partial<ProjectInfo> = {};

  if (packageFile.endsWith("package.json")) {
    info = await parsePackageJson(packageFile);
  } else if (packageFile.endsWith("pyproject.toml")) {
    info = await parsePyProjectToml(packageFile);
  } else if (packageFile.endsWith("Cargo.toml")) {
    info = await parseCargoToml(packageFile);
  }

  // Check for tests
  const testDirs = ["test", "tests", "__tests__", "spec"];
  let hasTests = false;
  for (const dir of testDirs) {
    if (await fileExists(join(CWD, dir))) {
      hasTests = true;
      break;
    }
  }

  // Check for CI
  const ciFiles = [".github/workflows", ".gitlab-ci.yml", ".travis.yml", "circle.yml"];
  let hasCI = false;
  for (const file of ciFiles) {
    if (await fileExists(join(CWD, file))) {
      hasCI = true;
      break;
    }
  }

  return {
    name: info.name || basename(CWD),
    version: info.version || "1.0.0",
    description: info.description || "",
    author: info.author || "",
    license: info.license || "MIT",
    repository: info.repository || "",
    homepage: info.homepage || "",
    type: info.type || "unknown",
    frameworks: info.frameworks || [],
    dependencies: info.dependencies || {},
    devDependencies: info.devDependencies || {},
    packageManager: info.packageManager || "unknown",
    hasTests,
    hasCI,
    mainFile: info.mainFile,
  };
}

function generateBadges(project: ProjectInfo, config: Config): string[] {
  if (config.noBadges) return [];

  const badges: string[] = [];
  const badgeTypes = config.badges.length > 0 ? config.badges : ["npm", "license", "build"];

  for (const type of badgeTypes) {
    switch (type) {
      case "npm":
        if (project.type === "nodejs" && project.name) {
          badges.push(
            `[![npm version](https://badge.fury.io/js/${project.name}.svg)](https://www.npmjs.com/package/${project.name})`
          );
        }
        break;
      case "license":
        if (project.license) {
          badges.push(
            `[![License: ${project.license}](https://img.shields.io/badge/License-${project.license}-yellow.svg)](https://opensource.org/licenses/${project.license})`
          );
        }
        break;
      case "build":
        if (project.hasCI && project.repository) {
          const repo = project.repository.replace("https://github.com/", "");
          badges.push(
            `[![Build Status](https://github.com/${repo}/workflows/CI/badge.svg)](https://github.com/${repo}/actions)`
          );
        }
        break;
      case "coverage":
        badges.push(
          `[![Coverage Status](https://coveralls.io/repos/github/USER/REPO/badge.svg?branch=main)](https://coveralls.io/github/USER/REPO?branch=main)`
        );
        break;
      case "downloads":
        if (project.type === "nodejs" && project.name) {
          badges.push(
            `[![Downloads](https://img.shields.io/npm/dm/${project.name}.svg)](https://www.npmjs.com/package/${project.name})`
          );
        }
        break;
    }
  }

  return badges;
}

function generateInstallSection(project: ProjectInfo): string {
  const sections: string[] = ["## Installation"];

  switch (project.packageManager) {
    case "npm":
      sections.push("```bash\nnpm install " + project.name + "\n```");
      break;
    case "yarn":
      sections.push("```bash\nyarn add " + project.name + "\n```");
      break;
    case "pnpm":
      sections.push("```bash\npnpm add " + project.name + "\n```");
      break;
    case "bun":
      sections.push("```bash\nbun add " + project.name + "\n```");
      break;
    case "pip":
      sections.push("```bash\npip install " + project.name + "\n```");
      break;
    case "poetry":
      sections.push("```bash\npoetry add " + project.name + "\n```");
      break;
    case "cargo":
      sections.push("```toml\n[dependencies]\n" + project.name + ' = "' + project.version + '"\n```');
      break;
    default:
      sections.push("Installation instructions coming soon.");
  }

  return sections.join("\n\n");
}

function generateUsageSection(project: ProjectInfo, config: Config): string {
  const sections: string[] = ["## Usage"];

  if (config.noExamples) {
    sections.push("Usage examples coming soon.");
    return sections.join("\n\n");
  }

  // Generate basic usage example based on project type
  if (project.type === "nodejs") {
    sections.push("```javascript\nconst " + project.name.replace(/[^a-zA-Z0-9]/g, "") +
      " = require('" + project.name + "');\n\n// Your code here\n```");
  } else if (project.type === "python") {
    sections.push("```python\nimport " + project.name.replace(/[^a-zA-Z0-9]/g, "_") +
      "\n\n# Your code here\n```");
  } else if (project.type === "rust") {
    sections.push("```rust\nuse " + project.name.replace(/-/g, "_") +
      ";\n\nfn main() {\n    // Your code here\n}\n```");
  }

  return sections.join("\n\n");
}

function generateFeaturesSection(project: ProjectInfo): string {
  const sections: string[] = ["## Features"];

  const features: string[] = [];

  if (project.frameworks.length > 0) {
    features.push(`Built with ${project.frameworks.join(", ")}`);
  }

  if (project.hasTests) {
    features.push("Comprehensive test suite");
  }

  if (project.hasCI) {
    features.push("Continuous integration");
  }

  features.push("Easy to use API");
  features.push("Well documented");
  features.push("TypeScript support" + (project.type === "nodejs" ? "" : " (coming soon)"));

  sections.push(features.map(f => `- ${f}`).join("\n"));

  return sections.join("\n\n");
}

function generateTableOfContents(sections: string[]): string {
  const toc: string[] = ["## Table of Contents"];

  for (const section of sections) {
    const match = section.match(/^## (.+)$/m);
    if (match) {
      const title = match[1];
      const anchor = title.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      toc.push(`- [${title}](#${anchor})`);
    }
  }

  return toc.join("\n");
}

function generateContributingSection(): string {
  return `## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (\`git checkout -b feature/AmazingFeature\`)
3. Commit your changes (\`git commit -m 'Add some AmazingFeature'\`)
4. Push to the branch (\`git push origin feature/AmazingFeature\`)
5. Open a Pull Request`;
}

function generateLicenseSection(project: ProjectInfo): string {
  return `## License

This project is licensed under the ${project.license} License - see the LICENSE file for details.`;
}

function generateChangelogSection(): string {
  return `## Changelog

### [1.0.0] - ${new Date().toISOString().split("T")[0]}

#### Added
- Initial release`;
}

function generateAPISection(project: ProjectInfo): string {
  return `## API Reference

### Methods

#### \`example()\`

Description of example method.

**Parameters:**
- \`param1\` (string): Description of param1
- \`param2\` (number): Description of param2

**Returns:**
- Returns description

**Example:**
\`\`\`javascript
const result = example('value', 42);
\`\`\``;
}

async function generateReadme(project: ProjectInfo, config: Config): Promise<string> {
  const sections: string[] = [];

  // Title
  const title = config.title || project.name;
  sections.push(`# ${title}`);

  // Badges
  const badges = generateBadges(project, config);
  if (badges.length > 0) {
    sections.push(badges.join("\n"));
  }

  // Description
  const description = config.description || project.description || "A great project";
  sections.push(description);

  // Features
  if (config.sections.features && config.template !== "minimal") {
    sections.push(generateFeaturesSection(project));
  }

  // Table of Contents
  if (!config.noToc && config.template !== "minimal") {
    // We'll add this after we know all sections
  }

  // Installation
  if (config.sections.installation) {
    sections.push(generateInstallSection(project));
  }

  // Usage
  if (config.sections.usage) {
    sections.push(generateUsageSection(project, config));
  }

  // API Reference
  if (config.sections.api && config.template === "comprehensive") {
    sections.push(generateAPISection(project));
  }

  // Custom sections
  for (const customSection of config.customSections) {
    sections.push(`## ${customSection.title}\n\n${customSection.content}`);
  }

  // Contributing
  if (config.sections.contributing && config.template !== "minimal") {
    sections.push(generateContributingSection());
  }

  // Changelog
  if (config.sections.changelog && config.template === "comprehensive") {
    sections.push(generateChangelogSection());
  }

  // License
  if (config.sections.license) {
    sections.push(generateLicenseSection(project));
  }

  // Insert TOC after description if needed
  if (!config.noToc && config.template !== "minimal") {
    const toc = generateTableOfContents(sections.slice(2)); // Skip title and badges
    sections.splice(3, 0, toc); // Insert after description
  }

  return sections.join("\n\n") + "\n";
}

async function loadConfig(configPath?: string): Promise<Partial<Config>> {
  if (!configPath) {
    const defaultPath = join(CWD, ".readme-config.json");
    if (await fileExists(defaultPath)) {
      configPath = defaultPath;
    } else {
      return {};
    }
  }

  try {
    const content = await readFile(configPath, "utf-8");
    return JSON.parse(content);
  } catch (error) {
    log(`Failed to load config from ${configPath}`, "error");
    return {};
  }
}

function showHelp(): void {
  console.log(`
skill-generate-readme - Auto-generate comprehensive README.md files from codebase analysis

Usage:
  skills run generate-readme -- [options]

Options:
  -h, --help               Show this help message
  --template <type>        Template: minimal | standard | comprehensive (default: standard)
  --output <path>          Output file path (default: README.md)
  --config <path>          Custom config file path
  --sections <list>        Comma-separated sections to include
  --exclude <list>         Comma-separated sections to exclude
  --dry-run                Preview without writing file
  --force                  Overwrite existing README
  --no-badges              Disable badge generation
  --no-toc                 Disable table of contents
  --no-examples            Disable code examples
  --include-changelog      Include changelog section
  --license <type>         License type
  --badges <list>          Comma-separated badge types (npm,license,build,coverage,downloads)

Output includes:
  - Project detection (type, frameworks, dependencies)
  - Badge generation
  - Code examples
  - Installation instructions
  - API reference (comprehensive template)
  - Contributing guidelines
  - License section

Examples:
  skills run generate-readme -- --template comprehensive --force
  skills run generate-readme -- --sections "installation,usage" --no-badges

Note:
  Detects project type from package.json, pyproject.toml, Cargo.toml, etc.
`);
}

function parseArguments(): Arguments {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      help: { type: "boolean", short: "h" },
      template: { type: "string", default: "standard" },
      output: { type: "string", default: "README.md" },
      config: { type: "string" },
      sections: { type: "string" },
      exclude: { type: "string" },
      "dry-run": { type: "boolean", default: false },
      force: { type: "boolean", default: false },
      "no-badges": { type: "boolean", default: false },
      "no-toc": { type: "boolean", default: false },
      "no-examples": { type: "boolean", default: false },
      "include-changelog": { type: "boolean", default: false },
      license: { type: "string" },
      badges: { type: "string" },
    },
    strict: false,
  });

  if (values.help) {
    showHelp();
    process.exit(0);
  }

  return {
    template: (values.template as any) || "standard",
    output: values.output || "README.md",
    config: values.config,
    sections: values.sections,
    exclude: values.exclude,
    dryRun: values["dry-run"] || false,
    force: values.force || false,
    noBadges: values["no-badges"] || false,
    noToc: values["no-toc"] || false,
    noExamples: values["no-examples"] || false,
    includeChangelog: values["include-changelog"] || false,
    license: values.license,
    badges: values.badges,
  };
}

async function main() {
  try {
    log(`Starting ${SKILL_NAME}...`, "info");

    // Parse arguments
    const args = parseArguments();

    // Load config
    const fileConfig = await loadConfig(args.config);

    // Merge config
    const config: Config = {
      template: args.template,
      output: join(CWD, args.output),
      sections: {
        features: true,
        installation: true,
        usage: true,
        api: args.template === "comprehensive",
        contributing: args.template !== "minimal",
        license: true,
        changelog: args.includeChangelog || args.template === "comprehensive",
        roadmap: args.template === "comprehensive",
        ...fileConfig.sections,
      },
      customSections: fileConfig.customSections || [],
      badges: args.badges ? args.badges.split(",") : fileConfig.badges || [],
      noBadges: args.noBadges,
      noToc: args.noToc,
      noExamples: args.noExamples,
      ...fileConfig,
    };

    // Apply sections filter
    if (args.sections) {
      const included = args.sections.split(",");
      for (const key of Object.keys(config.sections)) {
        config.sections[key as keyof typeof config.sections] = included.includes(key);
      }
    }

    // Apply exclude filter
    if (args.exclude) {
      const excluded = args.exclude.split(",");
      for (const key of excluded) {
        if (key in config.sections) {
          config.sections[key as keyof typeof config.sections] = false;
        }
      }
    }

    // Detect project info
    log("Analyzing project...", "info");
    const project = await detectProjectInfo();

    log(`Detected: ${project.type} project`, "info");
    if (project.frameworks.length > 0) {
      log(`Frameworks: ${project.frameworks.join(", ")}`, "info");
    }

    // Check if output file exists
    if (!args.force && await fileExists(config.output)) {
      log(`File ${config.output} already exists. Use --force to overwrite.`, "error");
      process.exit(1);
    }

    // Generate README
    log(`Generating README with ${config.template} template...`, "info");
    const readme = await generateReadme(project, config);

    // Generate badges for summary
    const badges = generateBadges(project, config);

    // Dry run
    if (args.dryRun) {
      log("Dry run - preview:", "info");
      console.log("\n" + "=".repeat(80));
      console.log(readme);
      console.log("=".repeat(80) + "\n");
      log("Dry run complete. Use without --dry-run to write file.", "success");
      return;
    }

    // Write README
    await writeFile(config.output, readme, "utf-8");
    log(`README generated: ${config.output}`, "success");

    // Export to skills output directory
    const exportDir = join(OUTPUT_DIR, "exports", SKILL_NAME);
    await Bun.write(join(exportDir, basename(config.output)), readme);
    log(`Exported to: ${exportDir}/${basename(config.output)}`, "success");

    // Summary
    console.log("\n📝 Summary:");
    console.log(`  Template: ${config.template}`);
    console.log(`  Output: ${config.output}`);
    console.log(`  Sections: ${Object.entries(config.sections).filter(([_, v]) => v).map(([k]) => k).join(", ")}`);
    console.log(`  Badges: ${config.noBadges ? "disabled" : badges.length || "auto"}`);
    console.log(`  Lines: ${readme.split("\n").length}`);

  } catch (error) {
    log(`Error: ${error instanceof Error ? error.message : String(error)}`, "error");
    console.error(error);
    process.exit(1);
  }
}

main();
