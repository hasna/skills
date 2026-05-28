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
Lab Notebook Formatter
Usage: skills run lab-notebook-formatter -- <file>

Description:
  Transforms rough, shorthand lab notes into structured, formal entries 
  (Hypothesis, Materials, Methods, Observations, Conclusions) using AI.
`);
  process.exit(0);
}

const filePath = positionals[0];

if (!existsSync(filePath)) {
  console.error(`Error: File not found: ${filePath}`);
  process.exit(1);
}

const content = readFileSync(filePath, "utf-8");

async function formatNotes(notes: string) {
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
            content: `You are a scientific lab assistant. Your task is to take rough, shorthand lab notes and format them into a structured, formal lab notebook entry. 
            
            The structure should be:
            1. **Hypothesis/Objective**: What was the goal?
            2. **Materials**: List of reagents and equipment.
            3. **Methods**: Step-by-step procedure (past tense, passive voice).
            4. **Observations/Results**: Data collected or things noticed.
            5. **Conclusions**: Interpretation of results.
            
            Maintain the scientific accuracy but improve the grammar and clarity.`,
          },
          {
            role: "user",
            content: notes,
          },
        ],
        temperature: 0.2,
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

formatNotes(content)
  .then(console.log)
  .catch(e => {
    console.error(e.message);
    process.exit(1);
  });