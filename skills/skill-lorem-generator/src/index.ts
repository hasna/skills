#!/usr/bin/env bun
import { LoremIpsum } from "lorem-ipsum";

const args = process.argv.slice(2);
const countArg = args.find(a => a.startsWith("count="))?.split("=")[1] || "1";
const unitsArg = args.find(a => a.startsWith("units="))?.split("=")[1] || "paragraphs";
const formatArg = args.find(a => a.startsWith("format="))?.split("=")[1] || "text";

const lorem = new LoremIpsum({
  sentencesPerParagraph: {
    max: 8,
    min: 4
  },
  wordsPerSentence: {
    max: 16,
    min: 4
  }
});

async function main() {
  const count = parseInt(countArg);
  let output = "";

  if (unitsArg === "paragraphs") {
    output = lorem.generateParagraphs(count);
  } else if (unitsArg === "sentences") {
    output = lorem.generateSentences(count);
  } else if (unitsArg === "words") {
    output = lorem.generateWords(count);
  } else {
    console.error("Invalid units. Use paragraphs, sentences, or words.");
    process.exit(1);
  }

  if (formatArg === "html") {
    if (unitsArg === "paragraphs") {
      output = output.split("\n").map(p => `<p>${p}</p>`).join("\n");
    }
  } else if (formatArg === "markdown") {
     // Already mostly markdown compatible, but could add headers etc if requested
  }

  console.log(output);
}

main();
