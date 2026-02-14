#!/usr/bin/env bun
import { parseArgs } from "util";
import { readFileSync, existsSync } from "fs";

const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  options: {
    agency: { type: "string", default: "General" },
    help: { type: "boolean" },
  },
  allowPositionals: true,
});

if (values.help || positionals.length === 0) {
  console.log(`
Grant Compliance Scanner
Usage: skills run grant-compliance-scanner -- <file> --agency <agency>

Options:
  --agency <name>    Funding agency (e.g., NIH, NSF, ERC)
`);
  process.exit(0);
}

const filePath = positionals[0];

if (!existsSync(filePath)) {
  console.error(`Error: File not found: ${filePath}`);
  process.exit(1);
}

const content = readFileSync(filePath, "utf-8");

async function scanCompliance(text: string, agency: string) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error("Error: OPENAI_API_KEY environment variable is required.");
    process.exit(1);
  }

  const agencyRules = {
    NIH: "Look for: Specific Aims page limit (1 page), Research Strategy structure (Significance, Innovation, Approach), Font size (Arial/Helvetica 11pt+), Margins (0.5 inch).",
    NSF: "Look for: Intellectual Merit, Broader Impacts, Data Management Plan, Postdoc Mentoring Plan (if applicable).",
    ERC: "Look for: High-risk/High-gain, PI track record, Extended Synopsis (5 pages).",
    General: "Look for: Clear objectives, budget justification, timeline, impact statement.",
  };

  const rules = agencyRules[agency as keyof typeof agencyRules] || agencyRules["General"];

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
            content: `You are a grant compliance officer. Review the following grant proposal text against the requirements for ${agency}.
            
            Specific focus areas: ${rules}
            
            Report any missing sections, formatting issues (if inferable from text), or content weaknesses related to compliance.
            Format the output as a checklist:
            - [PASS/FAIL/WARN] Requirement: Comment`,
          },
          {
            role: "user",
            content: text.substring(0, 15000), // Truncate to avoid token limits if very large
          },
        ],
        temperature: 0.1,
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

scanCompliance(content, values.agency as string)
  .then(console.log)
  .catch(e => {
    console.error(e.message);
    process.exit(1);
  });