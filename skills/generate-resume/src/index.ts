#!/usr/bin/env bun

/**
 * Generate Resume Skill
 *
 * Creates professional resumes and CVs with customizable templates,
 * multiple formats, and ATS-friendly designs.
 */

import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

import { parseArguments, showHelp } from "./cli";
import {
  importFromLinkedIn,
  parseCertifications,
  parseEducation,
  parseExperience,
  parseLanguages,
  parseProjects,
  parseSkills,
} from "./parsers";
import { generateCoverLetterHTML, generateMarkdown, generateResumeHTML } from "./renderers";
import type { CoverLetterData, ResumeData } from "./types";

async function main() {
  const args = parseArguments();

  if (args.help) {
    showHelp();
    return;
  }

  // LinkedIn import
  if (args["from-linkedin"]) {
    const linkedinData = await importFromLinkedIn(args["from-linkedin"]);
    Object.assign(args, linkedinData);
  }

  // Cover letter mode
  if (args["cover-letter"]) {
    if (!args.name || !args.company || !args.position || !args["letter-content"]) {
      console.error("Error: Cover letter requires --name, --company, --position, and --letter-content");
      process.exit(1);
    }

    const letterData: CoverLetterData = {
      name: args.name,
      email: args.email,
      phone: args.phone,
      location: args.location,
      company: args.company,
      position: args.position,
      content: args["letter-content"],
      template: args["letter-template"] || "standard",
      date: new Date().toISOString().split("T")[0],
    };

    const html = generateCoverLetterHTML(letterData);

    const outputDir = process.env.SKILLS_OUTPUT_DIR || process.env.SKILLS_PROJECT_ROOT || process.cwd();
    const exportsDir = join(outputDir, ".skills", "exports", "generate-resume");
    await mkdir(exportsDir, { recursive: true });

    const outputPath = args.output
      ? args.output.startsWith("/") ? args.output : join(process.cwd(), args.output)
      : join(exportsDir, "cover-letter.html");
    await writeFile(outputPath, html);

    console.log(`\nCover letter generated successfully!`);
    console.log(`File: ${outputPath}`);
    console.log("\nTo convert to PDF: Open in browser and print to PDF");

    if (args.open) {
      const openCmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
      Bun.spawn([openCmd, outputPath]);
    }

    return;
  }

  // Validate required fields
  if (!args.name) {
    console.error("Error: --name is required");
    console.log("\nRun with --help for usage information");
    process.exit(1);
  }

  // Build resume data
  const resumeData: ResumeData = {
    name: args.name,
    email: args.email,
    phone: args.phone,
    location: args.location,
    website: args.website,
    linkedin: args.linkedin,
    github: args.github,
    portfolio: args.portfolio,
    twitter: args.twitter,
    photo: args.photo,
    title: args.title,
    summary: args.summary,
    experience: args.experience ? parseExperience(args.experience as string[]) : [],
    education: args.education ? parseEducation(args.education as string[]) : [],
    skills: args.skill ? parseSkills(args.skill as string[]) : [],
    projects: args.project ? parseProjects(args.project as string[]) : [],
    certifications: args.certification ? parseCertifications(args.certification as string[]) : [],
    languages: args.language ? parseLanguages(args.language as string[]) : [],
    template: args.template || "modern",
    layout: args.layout || "single-column",
    color: args.color || "#2563eb",
    font: args.font || "inter",
    fontSize: args["font-size"] || "medium",
    spacing: args.spacing || "normal",
    atsFriendly: args["ats-friendly"] || false,
    includePhoto: args["include-photo"] || false,
    pageNumbers: args["page-numbers"] || false,
  };

  // Determine output
  const outputDir = process.env.SKILLS_OUTPUT_DIR || process.env.SKILLS_PROJECT_ROOT || process.cwd();
  const exportsDir = join(outputDir, ".skills", "exports", "generate-resume");
  await mkdir(exportsDir, { recursive: true });

  const format = args.format || "pdf";
  const ext = format === "markdown" ? "md" : format === "html" ? "html" : "html";
  const defaultFilename = `resume-${args.name.toLowerCase().replace(/\s+/g, "-")}.${ext}`;

  // Handle absolute vs relative paths
  let outputPath: string;
  if (args.output) {
    outputPath = args.output.startsWith("/") ? args.output : join(process.cwd(), args.output);
  } else {
    outputPath = join(exportsDir, defaultFilename);
  }

  // Generate output
  let content = "";
  if (format === "markdown") {
    content = generateMarkdown(resumeData);
  } else {
    content = generateResumeHTML(resumeData);
  }

  await writeFile(outputPath, content);

  // Save metadata
  const metadataPath = join(exportsDir, `metadata.json`);
  await writeFile(metadataPath, JSON.stringify(resumeData, null, 2));

  console.log(`\n✓ Resume generated successfully!`);
  console.log(`File: ${outputPath}`);
  console.log(`Metadata: ${metadataPath}`);

  if (format === "pdf" || (format === "html" && !args.output?.endsWith(".html"))) {
    console.log("\nTo convert to PDF:");
    console.log(`  1. Open in browser: file://${outputPath}`);
    console.log(`  2. Print to PDF using browser's print function`);
  }

  console.log("\n" + "=".repeat(50));
  console.log(`Resume: ${resumeData.name}`);
  console.log(`Template: ${resumeData.template}`);
  console.log(`Layout: ${resumeData.layout}`);
  console.log(`Format: ${format}`);
  console.log("=".repeat(50) + "\n");

  if (args.open) {
    const openCmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
    Bun.spawn([openCmd, outputPath]);
  }
}

// Run
main().catch((error) => {
  console.error("Error:", error.message);
  process.exit(1);
});
