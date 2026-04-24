/**
 * list / search / categories / tags — browsing commands
 */

import chalk from "chalk";
import type { Command } from "commander";
import {
  CATEGORIES,
  getSkillsByCategory,
  loadRegistry,
  loadRegistryProfile,
  searchSkills,
  findSimilarSkills,
  type SkillRegistryProfile,
} from "../../lib/registry.js";
import { getInstalledSkills, getInstallMeta } from "../../lib/installer.js";
import { normalizeSkillName } from "../../lib/utils.js";

export function registerBrowse(parent: Command) {
  // List
  parent
    .command("list")
    .alias("ls")
    .option("-c, --category <category>", "Filter by category")
    .option("-i, --installed", "Show only installed skills", false)
    .option("-t, --tags <tags>", "Filter by comma-separated tags (OR logic, case-insensitive)")
    .option("--all", "Show the full skill registry instead of the default basic set", false)
    .option("--json", "Output as JSON", false)
    .option("--brief", "One line per skill: name \u2014 description [category]", false)
    .option("--format <format>", "Output format: compact (names only) or csv (name,category,description)")
    .action((options) => handleList(options));

  // Search
  parent
    .command("search")
    .alias("s")
    .argument("<query>", "Search term")
    .option("--json", "Output as JSON", false)
    .option("--brief", "One line per skill: name \u2014 description [category]", false)
    .option("--format <format>", "Output format: compact (names only) or csv (name,category,description)")
    .option("-c, --category <category>", "Filter results by category")
    .option("-t, --tags <tags>", "Filter results by comma-separated tags (OR logic, case-insensitive)")
    .option("--all", "Search the full skill registry instead of the default basic set", false)
    .description("Search for skills")
    .action((query: string, options) => handleSearch(query, options));

  // Categories
  parent
    .command("categories")
    .option("--json", "Output as JSON", false)
    .description("List all categories")
    .action((options: { json: boolean }) => handleCategories(options));

  // Tags
  parent
    .command("tags")
    .option("--json", "Output as JSON", false)
    .description("List all unique tags with counts")
    .action((options: { json: boolean }) => handleTags(options));
}

function formatBrief(skill: { name: string; description: string; category: string }) {
  return `${skill.name} \u2014 ${skill.description} [${skill.category}]`;
}

function handleList(options: any) {
  const brief = options.brief && !options.json;
  const fmt = !options.json ? (options.format as string | undefined) : undefined;
  const profile: SkillRegistryProfile = options.all ? "all" : "basic";

  if (options.installed) {
    const installed = getInstalledSkills();
    if (options.json) {
      const meta = getInstallMeta();
      const registry = loadRegistry();
      console.log(JSON.stringify(installed.map((name) => {
        const m = meta.skills[name];
        const s = registry.find((r) => r.name === name);
        return { name, version: m?.version ?? null, installedAt: m?.installedAt ?? null, source: s?.source ?? "official" };
      })));
      return;
    }
    if (installed.length === 0) { console.log(chalk.dim("No skills installed")); return; }
    if (brief) { for (const name of installed) console.log(name); return; }
    const meta = getInstallMeta();
    const registry = loadRegistry();
    console.log(chalk.bold(`\nInstalled skills (${installed.length}):\n`));
    for (const name of installed) {
      const m = meta.skills[name];
      const s = registry.find((r) => r.name === name);
      console.log(`  ${chalk.cyan(name)}${s?.source === "custom" ? chalk.yellow(" [custom]") : ""}  ${m?.version ? chalk.dim(`v${m.version}`) : ""}  ${m?.installedAt ? chalk.dim(new Date(m.installedAt).toLocaleDateString()) : ""}`);
    }
    return;
  }

  const tagFilter = options.tags ? options.tags.split(",").map((t: string) => t.trim().toLowerCase()).filter(Boolean) : null;

  if (options.category) {
    const category = CATEGORIES.find((c: string) => c.toLowerCase() === options.category.toLowerCase());
    if (!category) { console.error(`Unknown category: ${options.category}\nAvailable: ${CATEGORIES.join(", ")}`); process.exitCode = 1; return; }
    let skills = loadRegistryProfile(profile).filter((s) => s.category === category);
    if (tagFilter) skills = skills.filter((s) => s.tags.some((tag) => tagFilter.includes(tag.toLowerCase())));
    if (options.json) { console.log(JSON.stringify(skills, null, 2)); return; }
    if (brief) { for (const s of skills) console.log(formatBrief(s)); return; }
    console.log(chalk.bold(`\n${category} (${skills.length}):\n`));
    for (const s of skills) console.log(`  ${chalk.cyan(s.name)} - ${s.description}`);
    return;
  }

  if (tagFilter) {
    const skills = loadRegistryProfile(profile).filter((s) => s.tags.some((tag) => tagFilter.includes(tag.toLowerCase())));
    if (options.json) { console.log(JSON.stringify(skills, null, 2)); return; }
    if (brief) { for (const s of skills) console.log(formatBrief(s)); return; }
    console.log(chalk.bold(`\nSkills matching tags [${tagFilter.join(", ")}] (${skills.length}):\n`));
    for (const s of skills) console.log(`  ${chalk.cyan(s.name)}${s.source === "custom" ? chalk.yellow(" [custom]") : ""} ${chalk.dim(`[${s.category}]`)} - ${s.description}`);
    return;
  }

  const allSkills = loadRegistryProfile(profile);
  if (options.json) { console.log(JSON.stringify(allSkills, null, 2)); return; }
  if (fmt === "compact") { for (const s of allSkills) console.log(s.name); return; }
  if (fmt === "csv") {
    console.log("name,category,description,source");
    for (const s of allSkills) { const desc = s.description.replace(/"/g, '""'); console.log(`${s.name},${s.category},"${desc}",${s.source ?? "official"}`); }
    return;
  }
  if (brief) {
    for (const s of [...allSkills].sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name))) console.log(formatBrief(s));
    return;
  }

  console.log(chalk.bold(`\nAvailable ${profile === "basic" ? "default " : ""}skills (${allSkills.length}):\n`));
  for (const category of CATEGORIES) {
    const skills = allSkills.filter((s) => s.category === category);
    if (skills.length === 0) continue;
    console.log(chalk.bold(`${category} (${skills.length}):`));
    for (const s of skills) console.log(`  ${chalk.cyan(s.name)}${s.source === "custom" ? chalk.yellow(" [custom]") : ""} - ${s.description}`);
    console.log();
  }
  const customUncategorized = allSkills.filter((s) => s.source === "custom" && !CATEGORIES.includes(s.category as (typeof CATEGORIES)[number]));
  if (customUncategorized.length > 0) {
    console.log(chalk.bold(`Custom (${customUncategorized.length}):`));
    for (const s of customUncategorized) console.log(`  ${chalk.yellow(s.name)} - ${s.description}`);
  }
}

function handleSearch(query: string, options: any) {
  const profile: SkillRegistryProfile = options.all ? "all" : "basic";
  let results = searchSkills(query, loadRegistryProfile(profile));

  if (options.category) {
    const category = CATEGORIES.find((c: string) => c.toLowerCase() === options.category!.toLowerCase());
    if (!category) { console.error(`Unknown category: ${options.category}\nAvailable: ${CATEGORIES.join(", ")}`); process.exitCode = 1; return; }
    results = results.filter((s) => s.category === category);
  }
  if (options.tags) {
    const tagFilter = options.tags.split(",").map((t: string) => t.trim().toLowerCase()).filter(Boolean);
    results = results.filter((s) => s.tags.some((tag) => tagFilter.includes(tag.toLowerCase())));
  }

  const brief = options.brief && !options.json;
  const fmt = !options.json ? options.format : undefined;

  if (options.json) { console.log(JSON.stringify(results, null, 2)); return; }
  if (results.length === 0) {
    console.log(chalk.dim(`No skills found for "${query}"`));
    const similar = findSimilarSkills(query, 5, loadRegistryProfile(profile));
    if (similar.length > 0) console.log(chalk.dim(`Related skills: ${similar.join(", ")}`));
    return;
  }
  if (fmt === "compact") { for (const s of results) console.log(s.name); return; }
  if (fmt === "csv") {
    console.log("name,category,description");
    for (const s of results) { const desc = s.description.replace(/"/g, '""'); console.log(`${s.name},${s.category},"${desc}"`); }
    return;
  }
  if (brief) { for (const s of results) console.log(formatBrief(s)); return; }
  console.log(chalk.bold(`\nFound ${results.length} skill(s):\n`));
  for (const s of results) {
    console.log(`  ${chalk.cyan(s.name)} ${chalk.dim(`[${s.category}]`)}`);
    console.log(`    ${s.description}`);
  }
}

function handleCategories(options: { json: boolean }) {
  const cats = CATEGORIES.map((category) => ({ name: category, count: getSkillsByCategory(category).length }));
  if (options.json) { console.log(JSON.stringify(cats, null, 2)); return; }
  console.log(chalk.bold("\nCategories:\n"));
  for (const { name, count } of cats) console.log(`  ${name} (${count})`);
}

function handleTags(options: { json: boolean }) {
  const tagCounts = new Map<string, number>();
  for (const skill of loadRegistry()) for (const tag of skill.tags) tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
  const sorted = Array.from(tagCounts.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([name, count]) => ({ name, count }));
  if (options.json) { console.log(JSON.stringify(sorted, null, 2)); return; }
  console.log(chalk.bold("\nTags:\n"));
  for (const { name, count } of sorted) console.log(`  ${chalk.cyan(name)} (${count})`);
}
