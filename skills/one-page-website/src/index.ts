#!/usr/bin/env bun

import { mkdir, readFile, writeFile } from "fs/promises";
import { join, resolve, relative } from "path";

import { buildContent, buildTokens, fnv1a, normalizeHex, selectPreset, slugify } from "./design.js";
import { copyDoc, deployNotes, siteReadme } from "./docs.js";
import { buildHtml, SECTION_LABELS, type NavEntry } from "./page.js";
import { buildCss, buildJs } from "./styles.js";
import {
  KNOWN_SECTIONS,
  type CliOptions,
  type CopyOverride,
  type KnownSection,
} from "./types.js";

const VERSION = "0.1.0";

async function loadMarked() {
  try {
    return await import("marked");
  } catch {
    throw new Error("Missing dependency 'marked'. Run bun install in this skill directory.");
  }
}

interface ParsedCopy {
  heroTitle?: string;
  heroLead?: string;
  overrides: CopyOverride[];
}

async function parseCopyFile(path: string): Promise<ParsedCopy> {
  const { marked } = await loadMarked();
  const source = await readFile(path, "utf8");
  const tokens = marked.lexer(source);

  const overrides: CopyOverride[] = [];
  let heroTitle: string | undefined;
  const preamble: unknown[] = [];
  let current: { title: string; tokens: unknown[] } | null = null;

  const flush = () => {
    if (!current) return;
    const slug = slugify(current.title);
    const known = (KNOWN_SECTIONS as readonly string[]).includes(slug);
    overrides.push({
      slug,
      title: current.title,
      html: marked.parser(current.tokens as never).trim(),
      known,
    });
    current = null;
  };

  for (const token of tokens as Array<Record<string, unknown>>) {
    if (token.type === "heading" && token.depth === 1) {
      flush();
      heroTitle = String(token.text ?? "").trim();
      continue;
    }
    if (token.type === "heading" && token.depth === 2) {
      flush();
      current = { title: String(token.text ?? "").trim(), tokens: [] };
      continue;
    }
    if (current) current.tokens.push(token);
    else preamble.push(token);
  }
  flush();

  const heroLead =
    preamble.length > 0 ? marked.parser(preamble as never).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() : undefined;

  return { heroTitle, heroLead: heroLead || undefined, overrides };
}

/* ------------------------------------------------------------------ */
/* stylesheet                                                          */
/* ------------------------------------------------------------------ */


function printHelp(): void {
  console.log(`one-page-website v${VERSION}

Generate a deployable static one-page site. Semantic, responsive, accessible,
dark-mode aware, zero external requests, zero API keys, zero network access.

USAGE:
  one-page-website --name <text> [options]
  one-page-website "<name>" [options]

OPTIONS:
      --name <text>         Brand or product name (positional works)  [required]
      --tagline <text>      Hero headline                     [generated from name]
      --sections <list>     Comma list of: hero,features,proof,pricing,faq,cta
                                                              [all six]
      --style <text>        Style preset keyword or phrase    [clean]
      --copy <file>         Markdown file whose H2 sections override the copy
      --goal <text>         Primary CTA label                 [Book a demo]
      --audience <text>     Who the page is for               [software teams]
      --features <list>     Comma list of feature card titles [generated]
      --accent <hex>        Force the accent color (#RRGGBB)  [from style preset]
  -o, --output <dir>        Output directory                  [./one-page-website]
      --json                Print the run summary as JSON
      --help                Show this help message
      --version             Show the current version

STYLE PRESETS:
  clean (default) | editorial | bold | warm | technical

OUTPUTS:
  site/index.html           The page, with the stylesheet inlined
  site/styles.css           Same stylesheet as a standalone file
  site/script.js            Progressive enhancement: nav, FAQ, scroll, scrollspy
  site/README.md            How to run, split the CSS, and edit tokens
  section-map.json          Sections, ids, nav labels, copy overrides applied
  copy.md                   The generated copy, ready to edit and feed back in
  deploy-notes.md           Host commands, cache headers, CSP, pre-ship checklist
  manifest.json             Every file written, with byte sizes

EXAMPLES:
  one-page-website --name "MeterKit" --tagline "Usage billing that finance trusts"
  one-page-website "Relay" --sections hero,features,cta --style bold
  one-page-website --name "Ledgerly" --copy ./copy.md --accent "#0F7B7B" -o ./out
`);
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    sections: KNOWN_SECTIONS.join(","),
    style: "clean",
    goal: "Book a demo",
    audience: "software teams",
    output: "./one-page-website",
    json: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
      case "--version":
      case "-v":
        console.log(VERSION);
        process.exit(0);
      case "--name":
        options.name = argv[++i];
        break;
      case "--tagline":
        options.tagline = argv[++i];
        break;
      case "--sections":
        options.sections = argv[++i] ?? options.sections;
        break;
      case "--style":
        options.style = argv[++i] ?? options.style;
        break;
      case "--copy":
        options.copy = argv[++i];
        break;
      case "--goal":
        options.goal = argv[++i] ?? options.goal;
        break;
      case "--audience":
        options.audience = argv[++i] ?? options.audience;
        break;
      case "--features":
        options.features = argv[++i];
        break;
      case "--accent": {
        const value = normalizeHex(argv[++i] ?? "");
        if (!value) {
          throw new Error(`Invalid --accent value: ${argv[i]} (expected a hex color such as #0F7B7B)`);
        }
        options.accent = value;
        break;
      }
      case "--output":
      case "-o":
        options.output = argv[++i] ?? options.output;
        break;
      case "--json":
        options.json = true;
        break;
      default:
        if (arg.startsWith("-")) {
          throw new Error(`Unknown option: ${arg}`);
        }
        if (!options.name) {
          options.name = arg;
          break;
        }
        throw new Error(`Unexpected argument: ${arg}`);
    }
  }

  if (!options.name || options.name.trim() === "") {
    throw new Error("Missing required --name <text> argument (a positional name also works)");
  }

  return options;
}

interface WrittenFile {
  path: string;
  type: string;
  bytes: number;
}

async function writeOutput(
  outDir: string,
  relPath: string,
  contents: string,
  type: string,
  files: WrittenFile[],
): Promise<void> {
  const target = join(outDir, relPath);
  await mkdir(join(target, ".."), { recursive: true });
  await writeFile(target, contents, "utf8");
  files.push({ path: relPath, type, bytes: Buffer.byteLength(contents, "utf8") });
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const outDir = resolve(options.output);

  const sections = options.sections
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);

  const unknown = sections.filter((section) => !(KNOWN_SECTIONS as readonly string[]).includes(section));
  if (unknown.length > 0) {
    throw new Error(
      `Unknown section(s): ${unknown.join(", ")}. Valid sections are: ${KNOWN_SECTIONS.join(", ")}`,
    );
  }
  if (sections.length === 0) {
    throw new Error("--sections resolved to an empty list");
  }
  if (!sections.includes("hero")) {
    sections.unshift("hero");
  }

  const seed = fnv1a(`${options.name}|${options.tagline ?? ""}|${options.audience}|${options.goal}`);
  const content = buildContent(options, seed);
  const preset = selectPreset(options.style);
  const tokens = buildTokens(preset, options.accent);

  const overrides = new Map<string, CopyOverride>();
  const customSections: CopyOverride[] = [];
  let copySource: string | null = null;

  if (options.copy) {
    copySource = resolve(options.copy);
    const parsed = await parseCopyFile(copySource);
    if (parsed.heroTitle) content.tagline = parsed.heroTitle;
    if (parsed.heroLead) content.lead = parsed.heroLead;
    for (const override of parsed.overrides) {
      if (override.known) overrides.set(override.slug, override);
      else customSections.push(override);
    }
  }

  const navEntries: NavEntry[] = sections
    .filter((section) => section !== "hero")
    .map((section) => ({ id: section, label: SECTION_LABELS[section as KnownSection] }));
  for (const custom of customSections) {
    navEntries.splice(Math.max(0, navEntries.length - 1), 0, { id: custom.slug, label: custom.title });
  }

  const css = buildCss(tokens);
  const js = buildJs();
  const html = buildHtml({ content, tokens, css, sections, overrides, customSections, navEntries });

  const files: WrittenFile[] = [];
  await writeOutput(outDir, "site/index.html", html, "text/html", files);
  await writeOutput(outDir, "site/styles.css", css, "text/css", files);
  await writeOutput(outDir, "site/script.js", js, "text/javascript", files);
  await writeOutput(outDir, "site/README.md", siteReadme(content, tokens, sections), "text/markdown", files);
  await writeOutput(outDir, "copy.md", copyDoc(content, sections), "text/markdown", files);
  await writeOutput(outDir, "deploy-notes.md", deployNotes(content), "text/markdown", files);

  const sectionMap = {
    name: content.name,
    tagline: content.tagline,
    goal: content.goal,
    audience: content.audience,
    style: { input: options.style, preset: preset.name, accent: tokens.accent },
    copySource,
    sections: sections.map((section) => ({
      id: section,
      label: SECTION_LABELS[section as KnownSection],
      anchor: `#${section}`,
      inNav: section !== "hero",
      copyOverride: overrides.has(section),
    })),
    customSections: customSections.map((custom) => ({
      id: custom.slug,
      label: custom.title,
      anchor: `#${custom.slug}`,
      inNav: true,
      copyOverride: true,
    })),
    nav: navEntries,
  };

  await writeOutput(outDir, "section-map.json", `${JSON.stringify(sectionMap, null, 2)}\n`, "application/json", files);

  const manifest = {
    skill: "one-page-website",
    version: VERSION,
    generatedAt: new Date().toISOString(),
    input: {
      name: content.name,
      tagline: content.tagline,
      sections,
      style: options.style,
      stylePreset: preset.name,
      accent: tokens.accent,
      goal: content.goal,
      audience: content.audience,
      copy: copySource,
    },
    outputDir: outDir,
    files: files.slice().sort((a, b) => a.path.localeCompare(b.path)),
  };

  const manifestPath = join(outDir, "manifest.json");
  await mkdir(outDir, { recursive: true });
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  if (options.json) {
    process.stdout.write(`${JSON.stringify({ ...manifest, sectionMap }, null, 2)}\n`);
    return;
  }

  console.log(`one-page-website: wrote ${files.length + 1} files to ${outDir}`);
  console.log(`  name       ${content.name}`);
  console.log(`  style      ${options.style} -> preset "${preset.name}", accent ${tokens.accent}`);
  console.log(`  sections   ${sections.join(", ")}${customSections.length ? ` (+${customSections.map((c) => c.slug).join(", ")})` : ""}`);
  if (copySource) {
    console.log(`  copy       ${copySource} (${overrides.size} known + ${customSections.length} custom section(s))`);
  }
  console.log(`  serve      cd ${relative(process.cwd(), join(outDir, "site")) || join(outDir, "site")} && python3 -m http.server 8000`);
  console.log(`  manifest   ${relative(process.cwd(), manifestPath) || manifestPath}`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`one-page-website: ${message}\n`);
  process.exit(1);
});
