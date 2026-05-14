import { writeFileSync } from "node:fs";
import { htmlToPlainText } from "./html";
import { loadPdfLib } from "./runtime";
import { PAGE_FORMATS, type GenerateOptions } from "./types";

function pageSizeToPoints(format: string, orientation: "portrait" | "landscape"): [number, number] {
  const size = PAGE_FORMATS[format] ?? PAGE_FORMATS.A4;
  const width = (size.width / 25.4) * 72;
  const height = (size.height / 25.4) * 72;
  return orientation === "landscape" ? [height, width] : [width, height];
}

function wrapText(text: string, maxCharacters: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    let current = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = current ? `${current} ${word}` : word;
      if (candidate.length > maxCharacters && current) {
        lines.push(current);
        current = word;
      } else {
        current = candidate;
      }
    }
    if (current) lines.push(current);
    lines.push("");
  }
  return lines;
}

export async function writePdfDocument(html: string, options: GenerateOptions, outputPath: string): Promise<void> {
  const { PDFDocument, StandardFonts, rgb } = await loadPdfLib();
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const [width, height] = pageSizeToPoints(options.format, options.orientation);
  const margin = 54;
  const fontSize = 11;
  const lineHeight = 16;
  const maxCharacters = Math.max(40, Math.floor((width - margin * 2) / (fontSize * 0.52)));
  const lines = wrapText(htmlToPlainText(html), maxCharacters);

  let page = pdfDoc.addPage([width, height]);
  let y = height - margin;

  if (options.title) {
    page.drawText(options.title, {
      x: margin,
      y,
      size: 18,
      font: boldFont,
      color: rgb(0.12, 0.18, 0.26),
    });
    y -= lineHeight * 2;
  }

  for (const line of lines) {
    if (y < margin) {
      page = pdfDoc.addPage([width, height]);
      y = height - margin;
    }

    if (line) {
      page.drawText(line, {
        x: margin,
        y,
        size: fontSize,
        font,
        color: rgb(0.1, 0.1, 0.1),
      });
    }
    y -= lineHeight;
  }

  const bytes = await pdfDoc.save();
  writeFileSync(outputPath, bytes);
}
