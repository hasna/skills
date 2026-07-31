import { writeFile } from "fs/promises";
import type { CliOptions, Slide, Theme } from "./types.js";

async function loadPptxGenJs() {
  try {
    const mod = await import("pptxgenjs");
    return (mod.default ?? mod) as any;
  } catch {
    throw new Error("Missing dependency 'pptxgenjs'. Run bun install in this skill directory.");
  }
}

/* -------------------------------------------------------------------------- */
/* CLI                                                                         */
/* -------------------------------------------------------------------------- */


export async function renderPptx(
  path: string,
  deckTitle: string,
  slides: Slide[],
  theme: Theme,
  options: CliOptions,
): Promise<void> {
  const PptxGenJS = await loadPptxGenJs();
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_16x9";
  pptx.author = "slide-deck-generator";
  pptx.company = "";
  pptx.title = deckTitle;
  pptx.subject = `${options.format} deck for ${options.audience}`;

  for (const slide of slides) {
    const pptSlide = pptx.addSlide();
    const isSection = slide.layout === "section";
    pptSlide.background = { color: isSection ? theme.accent : theme.background };
    const bodyColor = isSection ? theme.accentText : theme.text;
    const mutedColor = isSection ? theme.accentText : theme.muted;

    if (slide.layout === "title" || slide.layout === "closing") {
      pptSlide.addText(slide.title, {
        x: 0.6,
        y: 1.5,
        w: 8.8,
        h: 1.4,
        align: "center",
        fontSize: 40,
        bold: true,
        color: bodyColor,
      });
      if (slide.subtitle) {
        pptSlide.addText(slide.subtitle, {
          x: 0.6,
          y: 2.9,
          w: 8.8,
          h: 0.6,
          align: "center",
          fontSize: 18,
          color: mutedColor,
        });
      }
      pptSlide.addShape("rect", { x: 4.4, y: 3.6, w: 1.2, h: 0.06, fill: { color: theme.accent } });
      if (slide.bullets.length > 0) {
        pptSlide.addText(
          slide.bullets.map((bullet) => ({ text: bullet, options: { bullet: true } })),
          { x: 1.6, y: 3.9, w: 6.8, h: 1.3, fontSize: 14, color: mutedColor, align: "center" },
        );
      }
    } else if (slide.layout === "quote") {
      pptSlide.addShape("rect", { x: 0.6, y: 1.4, w: 0.08, h: 2.6, fill: { color: theme.accent } });
      pptSlide.addText(slide.title, {
        x: 1.0,
        y: 1.4,
        w: 8.2,
        h: 2.6,
        fontSize: 26,
        italic: true,
        color: bodyColor,
        valign: "middle",
      });
    } else {
      pptSlide.addText(slide.title, {
        x: 0.6,
        y: 0.5,
        w: 8.8,
        h: 0.9,
        fontSize: 30,
        bold: true,
        color: bodyColor,
      });
      pptSlide.addShape("rect", { x: 0.6, y: 1.42, w: 1.1, h: 0.06, fill: { color: theme.accent } });
      if (slide.subtitle) {
        pptSlide.addText(slide.subtitle, {
          x: 0.6,
          y: 1.55,
          w: 8.8,
          h: 0.4,
          fontSize: 14,
          color: mutedColor,
        });
      }
      if (slide.bullets.length > 0) {
        pptSlide.addText(
          slide.bullets.map((bullet) => ({
            text: bullet,
            options: { bullet: { code: "2022" }, breakLine: true },
          })),
          {
            x: 0.7,
            y: slide.subtitle ? 2.05 : 1.75,
            w: 8.6,
            h: 3.2,
            fontSize: 16,
            color: bodyColor,
            lineSpacingMultiple: 1.3,
            valign: "top",
          },
        );
      }
    }

    pptSlide.addText(`${slide.index} / ${slides.length}`, {
      x: 8.3,
      y: 5.05,
      w: 1.1,
      h: 0.3,
      fontSize: 10,
      color: mutedColor,
      align: "right",
    });

    pptSlide.addNotes(slide.notes);
  }

  const buffer = (await pptx.write({ outputType: "nodebuffer" })) as Buffer;
  await writeFile(path, buffer);
}

/* -------------------------------------------------------------------------- */
/* Main                                                                        */
/* -------------------------------------------------------------------------- */


