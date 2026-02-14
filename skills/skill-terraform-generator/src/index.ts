#!/usr/bin/env bun
import OpenAI from "openai";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";

const args = process.argv.slice(2);

if (args.includes("-h") || args.includes("--help")) {
  console.log(`
skill-terraform-generator - Generate Terraform infrastructure as code using AI

Usage:
  skills run terraform-generator -- provider=<provider> description="<description>"

Options:
  -h, --help               Show this help message
  provider=<provider>      Cloud provider: aws | gcp | azure (required)
  description=<text>       Description of infrastructure to create (required)

Examples:
  skills run terraform-generator -- provider=aws description="S3 bucket with versioning enabled"
  skills run terraform-generator -- provider=gcp description="Cloud Run service with custom domain"
  skills run terraform-generator -- provider=azure description="App Service with SQL database"

Output:
  Generates Terraform configuration files (main.tf, variables.tf, etc.)
  Files are saved to the exports directory.
`);
  process.exit(0);
}

const providerArg = args.find(a => a.startsWith("provider="))?.split("=")[1];
const descArg = args.find(a => a.startsWith("description="))?.split("=")[1];

if (!process.env.OPENAI_API_KEY) {
  console.error("Error: OPENAI_API_KEY not found.");
  process.exit(1);
}

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

async function main() {
  if (!providerArg || !descArg) {
    console.log("Usage: skills run terraform-generator -- provider=<aws|gcp|azure> description=\"...\"");
    process.exit(1);
  }

  console.log(`Generating Terraform for ${providerArg}: "${descArg}"...`);

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: `You are an expert DevOps engineer specializing in Terraform.
          Generate Terraform configuration files for the requested infrastructure.
          Return the response as a JSON object where keys are filenames (e.g., "main.tf", "variables.tf") and values are the file contents.
          Do not include markdown formatting or explanations outside the JSON.
          Ensure the code follows best practices and is valid HCL.`
        },
        {
          role: "user",
          content: `Provider: ${providerArg}\nDescription: ${descArg}`
        }
      ],
      response_format: { type: "json_object" }
    });

    const content = completion.choices[0].message.content;
    if (!content) {
      throw new Error("No content generated");
    }

    const files = JSON.parse(content);
    const outputDir = process.env.SKILLS_EXPORTS_DIR || "terraform-output";
    
    // Ensure output dir exists (if running locally without runner)
    if (!process.env.SKILLS_EXPORTS_DIR) {
        await mkdir(outputDir, { recursive: true });
    }

    for (const [filename, fileContent] of Object.entries(files)) {
      const filePath = join(outputDir, filename);
      await writeFile(filePath, fileContent as string);
      console.log(`Generated: ${filename}`);
    }

    console.log(`\nSuccess! Terraform files generated in ${outputDir}`);

  } catch (error: any) {
    console.error("Generation failed:", error.message);
    process.exit(1);
  }
}

main();
