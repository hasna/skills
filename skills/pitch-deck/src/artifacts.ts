import { writeFileSync } from "fs";
import { join } from "path";
import { RUN_ID, SKILL_NAME } from "./constants";
import type { DeckOptions, Slide } from "./types";
import { toManifestPath, writeJson } from "./utils";

export function writeArtifacts(
  options: DeckOptions,
  slides: Slide[],
  content: {
    deckMarkdown: string;
    speakerNotes: string;
    designDirection: string;
    pdf: string;
    pptx: Buffer;
  },
) {
  const deckPath = join(options.outputDir, "deck.md");
  const pdfPath = join(options.outputDir, "deck.pdf");
  const pptxPath = join(options.outputDir, "deck.pptx");
  const slidesPath = join(options.outputDir, "slides.json");
  const speakerNotesPath = join(options.outputDir, "speaker-notes.md");
  const designDirectionPath = join(options.outputDir, "design-direction.md");
  const manifestPath = join(options.outputDir, "manifest.json");

  writeFileSync(deckPath, content.deckMarkdown);
  writeFileSync(pdfPath, content.pdf);
  writeFileSync(pptxPath, content.pptx);
  writeJson(slidesPath, slides);
  writeFileSync(speakerNotesPath, content.speakerNotes);
  writeFileSync(designDirectionPath, content.designDirection);
  writeJson(manifestPath, {
    schemaVersion: 1,
    skill: SKILL_NAME,
    runId: RUN_ID,
    generatedAt: new Date().toISOString(),
    input: {
      brief: options.brief,
      company: options.company,
      audience: options.audience,
      slideCount: options.slideCount,
      tone: options.tone,
    },
    slideCount: slides.length,
    files: {
      deck: toManifestPath(options.outputDir, deckPath),
      pdf: toManifestPath(options.outputDir, pdfPath),
      pptx: toManifestPath(options.outputDir, pptxPath),
      slides: toManifestPath(options.outputDir, slidesPath),
      speakerNotes: toManifestPath(options.outputDir, speakerNotesPath),
      designDirection: toManifestPath(options.outputDir, designDirectionPath),
    },
  });

  return {
    deck: deckPath,
    pdf: pdfPath,
    pptx: pptxPath,
    slidesJson: slidesPath,
    speakerNotes: speakerNotesPath,
    designDirection: designDirectionPath,
    manifest: manifestPath,
  };
}
