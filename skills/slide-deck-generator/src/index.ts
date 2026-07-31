#!/usr/bin/env bun

import { mkdir, readFile, writeFile } from "fs/promises";
import { basename, dirname, join, resolve } from "path";

import { parseArgs } from "./cli.js";
import { buildSlides, draftsFromBrief, parseMarkdown, type DraftSlide } from "./model.js";
import { renderPptx } from "./pptx.js";
import {
  renderDeckMarkdown,
  renderHtml,
  renderSpeakerNotes,
  renderThemeGuide,
} from "./render.js";
import { THEMES } from "./types.js";
import { shorten, stripInlineMarkdown, titleCase } from "./utils.js";

const VERSION = "0.1.0";

async function writeOut(root: string, relativePath: string, contents: string): Promise<string> {
  const target = join(root, relativePath);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, contents, "utf8");
  return relativePath;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const theme = THEMES[options.theme];

  let sourceText = options.brief ?? "";
  let sourceLabel = "brief";
  if (options.source) {
    const sourcePath = resolve(options.source);
    try {
      sourceText = await readFile(sourcePath, "utf8");
    } catch {
      throw new Error(`Unable to read source file: ${sourcePath}`);
    }
    sourceLabel = sourcePath;
  }

  if (!sourceText.trim()) {
    throw new Error("Source text is empty. Nothing to build a deck from.");
  }

  const looksLikeMarkdown = /^\s*#|^\s*[-*+]\s+|^\s*\d+\.\s+/m.test(sourceText);
  let deckTitle = options.title;
  let drafts: DraftSlide[];

  if (looksLikeMarkdown) {
    const parsed = await parseMarkdown(sourceText);
    deckTitle = deckTitle ?? parsed.deckTitle;
    drafts = parsed.drafts;
    if (drafts.length === 0) drafts = draftsFromBrief(sourceText);
  } else {
    drafts = draftsFromBrief(sourceText);
  }

  if (!deckTitle) {
    const firstLine = sourceText.split("\n").map((line) => stripInlineMarkdown(line)).find(Boolean) ?? "Slide Deck";
    deckTitle = titleCase(shorten(firstLine, 70));
  }

  if (drafts.length === 0) {
    throw new Error("Could not derive any slides from the source text.");
  }

  const slides = buildSlides(deckTitle, drafts, options);
  const outputRoot = resolve(options.output);
  const written: string[] = [];

  const slidesJson = {
    title: deckTitle,
    theme: theme.name,
    audience: options.audience,
    format: options.format,
    slideCount: slides.length,
    slides,
  };

  written.push(await writeOut(outputRoot, "slides.json", `${JSON.stringify(slidesJson, null, 2)}\n`));
  written.push(await writeOut(outputRoot, "deck.md", renderDeckMarkdown(deckTitle, slides, theme, options)));
  written.push(await writeOut(outputRoot, "speaker-notes.md", renderSpeakerNotes(deckTitle, slides, options)));
  written.push(await writeOut(outputRoot, "theme-guide.md", renderThemeGuide(theme, slides)));
  written.push(await writeOut(outputRoot, "deck.html", renderHtml(deckTitle, slides, theme, options)));

  let pptxError: string | undefined;
  if (!options.noPptx) {
    await mkdir(outputRoot, { recursive: true });
    try {
      await renderPptx(join(outputRoot, "deck.pptx"), deckTitle, slides, theme, options);
      written.push("deck.pptx");
    } catch (error) {
      pptxError = error instanceof Error ? error.message : String(error);
    }
  }

  const manifest = {
    skill: "slide-deck-generator",
    skillVersion: VERSION,
    generatedAt: new Date().toISOString(),
    title: deckTitle,
    source: options.source ? { type: "file", path: sourceLabel } : { type: "brief", chars: sourceText.length },
    theme: theme.name,
    audience: options.audience,
    format: options.format,
    slideCount: slides.length,
    layouts: slides.map((slide) => slide.layout),
    outputDir: outputRoot,
    files: [...written, "manifest.json"].sort(),
    pptx: options.noPptx ? "skipped" : pptxError ? `failed: ${pptxError}` : "ok",
  };

  written.push(await writeOut(outputRoot, "manifest.json", `${JSON.stringify(manifest, null, 2)}\n`));

  if (pptxError) {
    process.stderr.write(`slide-deck-generator: warning: deck.pptx was not written (${pptxError})\n`);
  }

  if (options.json) {
    process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
    return;
  }

  console.log(
    [
      `slide-deck-generator v${VERSION}`,
      `  title      ${deckTitle}`,
      `  source     ${options.source ? basename(sourceLabel) : `brief (${sourceText.length} chars)`}`,
      `  theme      ${theme.label} (${theme.name})`,
      `  audience   ${options.audience} · format ${options.format}`,
      `  slides     ${slides.length}`,
      `  output     ${outputRoot}`,
      "",
      "Files:",
      ...manifest.files.map((file) => `  ${file}`),
      "",
      `Open the deck: ${join(outputRoot, "deck.html")} (← → to navigate, N for notes, Ctrl/Cmd-P to print)`,
    ].join("\n"),
  );
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`slide-deck-generator: ${message}\n`);
  process.exit(1);
});
