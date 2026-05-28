#!/usr/bin/env bun

import { writeArtifacts } from "./artifacts";
import { parseCliOptions } from "./cli";
import { buildDeckMarkdown, buildDesignDirection, buildSpeakerNotes } from "./markdown";
import { buildPdf } from "./pdf";
import { buildPptx } from "./pptx";
import { buildSlides } from "./slides";
import { ensureDir } from "./utils";

async function main() {
  const options = parseCliOptions();
  ensureDir(options.outputDir);

  const slides = buildSlides(options);
  const deckMarkdown = buildDeckMarkdown(options, slides);
  const speakerNotes = buildSpeakerNotes(options, slides);
  const designDirection = buildDesignDirection(options, slides);
  const pdf = buildPdf(deckMarkdown);
  const pptx = buildPptx(options, slides);
  const files = writeArtifacts(options, slides, {
    deckMarkdown,
    speakerNotes,
    designDirection,
    pdf,
    pptx,
  });

  console.log(`Generated pitch deck package for ${options.company}.`);
  console.log(`Output: ${options.outputDir}`);
  console.log(`- ${files.deck}`);
  console.log(`- ${files.pdf}`);
  console.log(`- ${files.pptx}`);
  console.log(`- ${files.slidesJson}`);
  console.log(`- ${files.speakerNotes}`);
  console.log(`- ${files.designDirection}`);
  console.log(`- ${files.manifest}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
