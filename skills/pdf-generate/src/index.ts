#!/usr/bin/env bun

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "./cli";
import { generateHtml } from "./html";
import { writePdfDocument } from "./pdf-writer";
import { EXPORTS_DIR, SESSION_ID, SKILL_NAME, log } from "./runtime";

async function main() {
  try {
    log(`Starting ${SKILL_NAME} skill (Session: ${SESSION_ID})`);
    log(`Arguments: ${Bun.argv.slice(2).join(" ")}`);

    const options = parseArgs(Bun.argv.slice(2));

    if (!options.content && !options.template && !options.url) {
      console.error("Error: No content provided. Use --content, --file, --template, or --url");
      process.exit(1);
    }

    const html = generateHtml(options);
    log(`Generated HTML (${html.length} characters)`);

    const filename = options.filename
      ? `${options.filename}.pdf`
      : `document_${SESSION_ID}.pdf`;

    const htmlFile = join(EXPORTS_DIR, filename.replace(".pdf", ".html"));
    writeFileSync(htmlFile, html);
    log(`Saved HTML to: ${htmlFile}`);

    const pdfFile = join(EXPORTS_DIR, filename);
    await writePdfDocument(html, options, pdfFile);
    log(`Saved PDF to: ${pdfFile}`);

    console.log(JSON.stringify({
      success: true,
      message: "PDF document generated successfully",
      data: {
        pdfFile,
        htmlFile,
        filename,
        format: options.format,
        orientation: options.orientation,
        contentLength: html.length,
        template: options.template || null,
      },
    }, null, 2));
    log(`Successfully generated document: ${filename}`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log(`Error: ${errorMessage}`, "error");
    console.error(JSON.stringify({
      success: false,
      error: `Error generating PDF: ${errorMessage}`,
    }));
    process.exit(1);
  }
}

main();
