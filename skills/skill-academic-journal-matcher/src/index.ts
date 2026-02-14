#!/usr/bin/env bun
import { parseArgs } from "util";
import { readFileSync, existsSync } from "fs";

const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  options: {
    help: { type: "boolean" },
  },
  allowPositionals: true,
});

if (values.help || positionals.length === 0) {
  console.log(`
Academic Journal Matcher
Usage: skills run academic-journal-matcher -- <file>

Description:
  Analyzes a manuscript's title and abstract to suggest suitable academic journals.
`);
  process.exit(0);
}

const filePath = positionals[0];

if (!existsSync(filePath)) {
  console.error(`Error: File not found: ${filePath}`);
  process.exit(1);
}

const content = readFileSync(filePath, "utf-8");

async function matchJournal(text: string) {
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
            content: `You are an academic publishing consultant. Analyze the provided title and abstract. 
            Suggest 5 suitable academic journals for this manuscript.
            
            For each journal, provide:
            1. Journal Name
            2. Estimated Impact Factor (High/Medium/Low)
            3. Why it's a good match (Scope/Audience)
            
            Format as a list.`,
          },
          {
            role: "user",
            content: text.substring(0, 4000),
          },
        ],
        temperature: 0.3,
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

matchJournal(content)
  .then(console.log)
  .catch(e => {
    console.error(e.message);
    process.exit(1);
  });