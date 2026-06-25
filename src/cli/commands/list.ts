/**
 * list / search / categories / tags — browsing commands
 */

import chalk from "chalk";
import type { Command } from "commander";
import {
  CATEGORIES,
  loadRegistry,
  loadRegistryProfile,
  searchSkills,
  findSimilarSkills,
  type SkillMeta,
  type SkillRegistryProfile,
} from "../../lib/registry.js";
import { loadRemoteRegistry } from "../../lib/remote-registry.js";
import { getInstalledSkills, getInstallMeta } from "../../lib/installer.js";
import {
  getPublicSkillDiscovery,
  publicDiscoveryPriceLabel,
  type PublicSkillDiscovery,
} from "../../lib/discovery.js";
import {
  DEFAULT_LIST_LIMIT,
  DEFAULT_SEARCH_LIMIT,
  DEFAULT_TAG_LIMIT,
  paginate,
  parsePageLimit,
  parsePageOffset,
  showingLabel,
  truncateText,
  type Page,
} from "../../lib/compact-output.js";

export function registerBrowse(parent: Command) {
  // List
  parent
    .command("list")
    .alias("ls")
    .option("-c, --category <category>", "Filter by category")
    .option("-p, --pinned", "Show only pinned skills", false)
    .option("-t, --tags <tags>", "Filter by comma-separated tags (OR logic, case-insensitive)")
    .option("--all", "Show the full skill registry instead of the default basic set", false)
    .option("--remote", "Use remote registry from SKILLS_API_URL or config apiUrl", false)
    .option("--json", "Output as JSON", false)
    .option("--brief", "One line per skill: name \u2014 description [category]", false)
    .option("--format <format>", "Output format: compact (names only) or csv (name,category,price,description)")
    .option("--limit <n>", "Maximum rows to print for human output (default: 30, use 0 or all for every row)")
    .option("--cursor <n>", "Numeric offset for human-output pagination", "0")
    .option("--verbose", "Show longer descriptions and tags in human output", false)
    .action((options) => {
      return handleList(options).catch(handleBrowseError);
    });

  // Search
  parent
    .command("search")
    .alias("s")
    .argument("<query>", "Search term")
    .option("--json", "Output as JSON", false)
    .option("--brief", "One line per skill: name \u2014 description [category]", false)
    .option("--format <format>", "Output format: compact (names only) or csv (name,category,price,description)")
    .option("-c, --category <category>", "Filter results by category")
    .option("-t, --tags <tags>", "Filter results by comma-separated tags (OR logic, case-insensitive)")
    .option("--all", "Search the full skill registry instead of the default basic set", false)
    .option("--remote", "Use remote registry from SKILLS_API_URL or config apiUrl", false)
    .option("--limit <n>", "Maximum rows to print for human output (default: 20, use 0 or all for every row)")
    .option("--cursor <n>", "Numeric offset for human-output pagination", "0")
    .option("--verbose", "Show longer descriptions and tags in human output", false)
    .description("Search for skills")
    .action((query: string, options) => {
      return handleSearch(query, options).catch(handleBrowseError);
    });

  // Categories
  parent
    .command("categories")
    .option("--json", "Output as JSON", false)
    .option("--remote", "Use remote registry from SKILLS_API_URL or config apiUrl", false)
    .description("List all categories")
    .action((options: { json: boolean; remote: boolean }) => {
      return handleCategories(options).catch(handleBrowseError);
    });

  // Tags
  parent
    .command("tags")
    .option("--json", "Output as JSON", false)
    .option("--remote", "Use remote registry from SKILLS_API_URL or config apiUrl", false)
    .option("--limit <n>", "Maximum rows to print for human output (default: 80, use 0 or all for every row)")
    .option("--cursor <n>", "Numeric offset for human-output pagination", "0")
    .description("List all unique tags with counts")
    .action((options: { json: boolean; remote: boolean }) => {
      return handleTags(options).catch(handleBrowseError);
    });
}

function formatBrief(skill: PublicSkillDiscovery) {
  return `${skill.name} \u2014 ${truncateText(skill.description, 110)} (${publicDiscoveryPriceLabel(skill)}) [${skill.category}]`;
}

function formatSkillLine(skill: PublicSkillDiscovery, options: { verbose?: boolean } = {}): string {
  const description = truncateText(skill.description, options.verbose ? 180 : 88);
  const tags = options.verbose && skill.tags.length ? chalk.dim(` tags: ${skill.tags.join(", ")}`) : "";
  return `  ${chalk.cyan(skill.name)}${skill.source === "custom" ? chalk.yellow(" [custom]") : ""} ${chalk.dim(`[${skill.category}]`)} ${chalk.dim(`(${publicDiscoveryPriceLabel(skill)})`)} - ${description}${tags}`;
}

function enrichDiscovery<T extends SkillMeta>(skills: T[]): Array<PublicSkillDiscovery<T>> {
  return skills.map(getPublicSkillDiscovery);
}

function handleBrowseError(error: unknown) {
  console.error(chalk.red((error as Error).message));
  process.exitCode = 1;
}

async function writeJson(value: unknown, space?: number) {
  const text = `${JSON.stringify(value, null, space)}\n`;
  await new Promise<void>((resolve, reject) => {
    process.stdout.write(text, (error?: Error | null) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

async function getBrowseRegistry(options: { all?: boolean; remote?: boolean }): Promise<SkillMeta[]> {
  if (options.remote) return loadRemoteRegistry();
  const profile: SkillRegistryProfile = options.all ? "all" : "basic";
  return loadRegistryProfile(profile);
}

function registryCategories(registry: SkillMeta[]): string[] {
  const known = CATEGORIES.filter((category) => registry.some((skill) => skill.category === category));
  const extra = Array.from(new Set(registry.map((skill) => skill.category)))
    .filter((category) => !CATEGORIES.includes(category as (typeof CATEGORIES)[number]))
    .sort();
  return [...known, ...extra];
}

function availableCategories(options: { remote?: boolean }, registry: SkillMeta[]): string[] {
  return options.remote ? registryCategories(registry) : [...CATEGORIES];
}

async function handleList(options: any) {
  const brief = options.brief && !options.json;
  const fmt = !options.json ? (options.format as string | undefined) : undefined;
  const profile: SkillRegistryProfile = options.all ? "all" : "basic";
  const registry = await getBrowseRegistry(options);
  const limit = parsePageLimit(options.limit, DEFAULT_LIST_LIMIT, { allowAll: true });
  const offset = parsePageOffset(options.cursor);

  if (options.pinned) {
    const installed = getInstalledSkills();
    if (options.json) {
      const meta = getInstallMeta();
      const registry = loadRegistry();
      await writeJson(installed.map((name) => {
        const m = meta.skills[name];
        const s = registry.find((r) => r.name === name);
        return { name, version: m?.version ?? null, installedAt: m?.installedAt ?? null, source: s?.source ?? "official" };
      }));
      return;
    }
    if (installed.length === 0) { console.log(chalk.dim("No pinned skills")); return; }
    if (brief) { for (const name of installed) console.log(name); return; }
    const meta = getInstallMeta();
    const registry = loadRegistry();
    const page = paginate(installed, { limit, offset });
    console.log(chalk.bold(`\nPinned skills (${showingLabel(installed.length, page.items.length, page.offset)}):\n`));
    for (const name of page.items) {
      const m = meta.skills[name];
      const s = registry.find((r) => r.name === name);
      console.log(`  ${chalk.cyan(name)}${s?.source === "custom" ? chalk.yellow(" [custom]") : ""}  ${m?.version ? chalk.dim(`v${m.version}`) : ""}  ${m?.installedAt ? chalk.dim(new Date(m.installedAt).toLocaleDateString()) : ""}`);
    }
    printPageHint(page, "skills list --pinned");
    return;
  }

  const tagFilter = options.tags ? options.tags.split(",").map((t: string) => t.trim().toLowerCase()).filter(Boolean) : null;

  if (options.category) {
    const categories = availableCategories(options, registry);
    const category = categories.find((c: string) => c.toLowerCase() === options.category.toLowerCase());
    if (!category) { console.error(`Unknown category: ${options.category}\nAvailable: ${categories.join(", ")}`); process.exitCode = 1; return; }
    let skills = registry.filter((s) => s.category === category);
    if (tagFilter) skills = skills.filter((s) => s.tags.some((tag) => tagFilter.includes(tag.toLowerCase())));
    const output = enrichDiscovery(skills);
    if (options.json) { await writeJson(output, 2); return; }
    const page = paginate(output, { limit, offset });
    if (brief) { for (const s of page.items) console.log(formatBrief(s)); printPageHint(page, listCommand(options)); return; }
    console.log(chalk.bold(`\n${category} (${showingLabel(output.length, page.items.length, page.offset)}):\n`));
    for (const s of page.items) console.log(formatSkillLine(s, { verbose: options.verbose }));
    printSkillHint(page, listCommand(options));
    return;
  }

  if (tagFilter) {
    const skills = registry.filter((s) => s.tags.some((tag) => tagFilter.includes(tag.toLowerCase())));
    const output = enrichDiscovery(skills);
    if (options.json) { await writeJson(output, 2); return; }
    const page = paginate(output, { limit, offset });
    if (brief) { for (const s of page.items) console.log(formatBrief(s)); printPageHint(page, listCommand(options)); return; }
    console.log(chalk.bold(`\nSkills matching tags [${tagFilter.join(", ")}] (${showingLabel(output.length, page.items.length, page.offset)}):\n`));
    for (const s of page.items) console.log(formatSkillLine(s, { verbose: options.verbose }));
    printSkillHint(page, listCommand(options));
    return;
  }

  const allSkills = enrichDiscovery(registry);
  if (options.json) { await writeJson(allSkills, 2); return; }
  if (fmt === "compact") { for (const s of allSkills) console.log(s.name); return; }
  if (fmt === "csv") {
    console.log("name,category,price,description,source");
    for (const s of allSkills) { const desc = s.description.replace(/"/g, '""'); console.log(`${s.name},${s.category},"${publicDiscoveryPriceLabel(s)}","${desc}",${s.source ?? "official"}`); }
    return;
  }
  if (brief) {
    const sorted = [...allSkills].sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
    const page = paginate(sorted, { limit, offset });
    for (const s of page.items) console.log(formatBrief(s));
    printPageHint(page, listCommand(options));
    return;
  }

  const sorted = [...allSkills].sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
  const page = paginate(sorted, { limit, offset });
  console.log(chalk.bold(`\nAvailable ${profile === "basic" ? "default " : ""}skills (${showingLabel(allSkills.length, page.items.length, page.offset)}):\n`));
  for (const s of page.items) console.log(formatSkillLine(s, { verbose: options.verbose }));
  printSkillHint(page, listCommand(options));
}

async function handleSearch(query: string, options: any) {
  const registry = await getBrowseRegistry(options);
  let results = searchSkills(query, registry);

  if (options.category) {
    const categories = availableCategories(options, registry);
    const category = categories.find((c: string) => c.toLowerCase() === options.category!.toLowerCase());
    if (!category) { console.error(`Unknown category: ${options.category}\nAvailable: ${categories.join(", ")}`); process.exitCode = 1; return; }
    results = results.filter((s) => s.category === category);
  }
  if (options.tags) {
    const tagFilter = options.tags.split(",").map((t: string) => t.trim().toLowerCase()).filter(Boolean);
    results = results.filter((s) => s.tags.some((tag) => tagFilter.includes(tag.toLowerCase())));
  }

  const brief = options.brief && !options.json;
  const fmt = !options.json ? options.format : undefined;

  const output = enrichDiscovery(results);
  if (options.json) { await writeJson(output, 2); return; }
  if (results.length === 0) {
    console.log(chalk.dim(`No skills found for "${query}"`));
    const similar = findSimilarSkills(query, 5, registry);
    if (similar.length > 0) console.log(chalk.dim(`Related skills: ${similar.join(", ")}`));
    return;
  }
  if (fmt === "compact") { for (const s of output) console.log(s.name); return; }
  if (fmt === "csv") {
    console.log("name,category,price,description");
    for (const s of output) { const desc = s.description.replace(/"/g, '""'); console.log(`${s.name},${s.category},"${publicDiscoveryPriceLabel(s)}","${desc}"`); }
    return;
  }
  const limit = parsePageLimit(options.limit, DEFAULT_SEARCH_LIMIT, { allowAll: true });
  const offset = parsePageOffset(options.cursor);
  const page = paginate(output, { limit, offset });
  if (brief) { for (const s of page.items) console.log(formatBrief(s)); printPageHint(page, searchCommand(query, options)); return; }
  console.log(chalk.bold(`\nFound ${skillCountLabel(output.length, page.items.length, page.offset)} for "${query}":\n`));
  for (const s of page.items) {
    console.log(formatSkillLine(s, { verbose: options.verbose }));
  }
  printSkillHint(page, searchCommand(query, options));
}

async function handleCategories(options: { json: boolean; remote: boolean }) {
  const registry = await getBrowseRegistry({ all: true, remote: options.remote });
  const cats = registryCategories(registry).map((category) => ({
    name: category,
    count: registry.filter((skill) => skill.category === category).length,
  }));
  if (options.json) { await writeJson(cats, 2); return; }
  console.log(chalk.bold("\nCategories:\n"));
  for (const { name, count } of cats) console.log(`  ${name} (${count})`);
}

async function handleTags(options: { json: boolean; remote: boolean; limit?: string; cursor?: string }) {
  const tagCounts = new Map<string, number>();
  for (const skill of await getBrowseRegistry({ all: true, remote: options.remote })) {
    for (const tag of skill.tags) tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
  }
  const sorted = Array.from(tagCounts.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([name, count]) => ({ name, count }));
  if (options.json) { await writeJson(sorted, 2); return; }
  const page = paginate(sorted, {
    limit: parsePageLimit(options.limit, DEFAULT_TAG_LIMIT, { allowAll: true }),
    offset: parsePageOffset(options.cursor),
  });
  console.log(chalk.bold(`\nTags: ${showingLabel(sorted.length, page.items.length, page.offset)}\n`));
  for (const { name, count } of page.items) console.log(`  ${chalk.cyan(name)} (${count})`);
  printPageHint(page, `skills tags${options.remote ? " --remote" : ""}`);
}

function printSkillHint<T>(page: Page<T>, command: string): void {
  printPageHint(page, command);
  console.log(chalk.dim(`Details: skills show <name> or rerun with --verbose. Use --json for the full machine-readable payload.`));
}

function printPageHint<T>(page: Page<T>, command: string): void {
  if (!page.hasMore || page.nextOffset === null) return;
  console.log(chalk.dim(`\nNext: ${command} --cursor ${page.nextOffset} --limit ${page.limit}`));
}

function listCommand(options: any): string {
  const parts = ["skills list"];
  if (options.all) parts.push("--all");
  if (options.remote) parts.push("--remote");
  if (options.category) parts.push("--category", quoteArg(options.category));
  if (options.tags) parts.push("--tags", quoteArg(options.tags));
  if (options.pinned) parts.push("--pinned");
  return parts.join(" ");
}

function searchCommand(query: string, options: any): string {
  const parts = ["skills search", quoteArg(query)];
  if (options.all) parts.push("--all");
  if (options.remote) parts.push("--remote");
  if (options.category) parts.push("--category", quoteArg(options.category));
  if (options.tags) parts.push("--tags", quoteArg(options.tags));
  return parts.join(" ");
}

function quoteArg(value: string): string {
  return value.includes(" ") ? JSON.stringify(value) : value;
}

function skillCountLabel(total: number, shown: number, offset: number): string {
  if (offset > 0 || shown < total) return `${shown} of ${total} skill(s), cursor ${offset}`;
  return `${total} skill(s)`;
}
