#!/usr/bin/env bun
import { parseArgs } from "util";
import { readFileSync, existsSync } from "fs";

const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  options: {
    style: { type: "string", default: "apa" },
    help: { type: "boolean" },
  },
  allowPositionals: true,
});

if (values.help || positionals.length === 0) {
  console.log(`
Citation Formatter
Usage: skills run citation-formatter -- <file> --style <style>

Options:
  --style <name>    Citation style (APA, MLA, Chicago, IEEE, Harvard)
`);
  process.exit(0);
}

const filePath = positionals[0];

if (!existsSync(filePath)) {
  console.error(`Error: File not found: ${filePath}`);
  process.exit(1);
}

const content = readFileSync(filePath, "utf-8");

async function formatCitations(bibtex: string, style: string) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error("Error: OPENAI_API_KEY environment variable is required.");
    process.exit(1);
  }

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `You are a bibliography expert. Convert the following BibTeX entries into a formatted bibliography in ${style} style.
            
            - Ensure correct punctuation and italics.
            - Sort them alphabetically if appropriate for the style.
            - Return ONLY the formatted text.`,
          },
          {
            role: "user",
            content: bibtex,
          },
        ],
        temperature: 0,
      }),
    });

    const data = await response.json();
    if (data.error) {
      throw new Error(data.error.message);
    }
    return data.choices[0].message.content;
  } catch (e) {
    throw new Error(`AI Request failed: ${e}`);
  }
}

formatCitations(content, values.style as string)
  .then(console.log)
  .catch(e => {
    console.error(e.message);
    process.exit(1);
  });