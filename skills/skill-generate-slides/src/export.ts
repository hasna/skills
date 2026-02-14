/**
 * Export format handling (PDF generation)
 */

import { join } from "node:path";
import { writeFile, unlink } from "node:fs/promises";
import { Presentation, SlideOptions } from "./parse.js";
import { renderHTML } from "./render.js";

export async function generatePDF(presentation: Presentation, options: SlideOptions): Promise<Buffer> {
  console.log("📄 Generating PDF...");

  // Generate HTML first
  const html = renderHTML(presentation, options);

  // Write temp HTML file
  const tempDir = options.dir;
  const tempHtml = join(tempDir, `temp-${Date.now()}.html`);
  await writeFile(tempHtml, html);

  try {
    // Use puppeteer to convert to PDF
    const puppeteer = await import("puppeteer");
    const browser = await puppeteer.default.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    const page = await browser.newPage();
    await page.goto(`file://${tempHtml}`, { waitUntil: "networkidle0" });

    // Set viewport based on aspect ratio
    const viewport =
      options.aspectRatio === "16:9"
        ? { width: 1920, height: 1080 }
        : options.aspectRatio === "4:3"
          ? { width: 1024, height: 768 }
          : { width: 1920, height: 1200 };

    await page.setViewport(viewport);

    const pdfBuffer = await page.pdf({
      format: "A4",
      landscape: true,
      printBackground: true,
      margin: { top: 0, bottom: 0, left: 0, right: 0 },
    });

    await browser.close();

    // Clean up temp file
    await unlink(tempHtml);

    return Buffer.from(pdfBuffer);
  } catch (error: any) {
    // Clean up temp file on error
    try {
      await unlink(tempHtml);
    } catch {}

    console.warn("   ⚠️  PDF generation failed, falling back to HTML");
    console.warn(`   Error: ${error.message}`);
    throw error;
  }
}
