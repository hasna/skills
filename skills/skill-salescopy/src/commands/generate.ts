import { Command } from "commander";
import chalk from "chalk";
import {
  generateCopy,
  generateVariations,
  listCopyTypes,
  listTones,
} from "../lib/generator.js";
import {
  createSession,
  loadSession,
  addResultToSession,
} from "../lib/storage.js";
import { logger } from "../utils/logger.js";
import type { CopyType, Tone, Length } from "../types/index.js";

export function registerGenerateCommand(program: Command): void {
  program
    .command("generate")
    .description("Generate sales copy for a product")
    .requiredOption("-n, --name <name>", "Product name")
    .requiredOption("-d, --description <description>", "Product description")
    .option(
      "-t, --type <type>",
      "Copy type (sales-letter, landing-page, email-sequence, headline, bullet-points, call-to-action, testimonial-request, product-description)",
      "sales-letter"
    )
    .option(
      "--tone <tone>",
      "Tone (professional, casual, urgent, friendly, authoritative, empathetic, humorous)",
      "professional"
    )
    .option(
      "-l, --length <length>",
      "Length (short, medium, long)",
      "medium"
    )
    .option("--template <template>", "Template ID to use (e.g., aida, pas, fab)")
    .option("-f, --features <features>", "Comma-separated product features")
    .option("-b, --benefits <benefits>", "Comma-separated product benefits")
    .option("-p, --price <price>", "Product price")
    .option("-a, --audience <audience>", "Target audience description")
    .option("-i, --instructions <instructions>", "Custom instructions for the AI")
    .option("-s, --session <sessionId>", "Add result to existing session")
    .option("-v, --variations <count>", "Generate multiple variations", "1")
    .option("-o, --output <file>", "Save output to file")
    .option("-m, --model <model>", "OpenAI model to use", "gpt-4o")
    .option("--json", "Output result as JSON")
    .action(async (options) => {
      try {
        const copyType = options.type as CopyType;
        const tone = options.tone as Tone;
        const length = options.length as Length;
        const variationCount = parseInt(options.variations, 10);

        // Validate options
        if (!listCopyTypes().includes(copyType)) {
          logger.error(`Invalid copy type: ${copyType}`);
          logger.info(`Valid types: ${listCopyTypes().join(", ")}`);
          process.exit(1);
        }

        if (!listTones().includes(tone)) {
          logger.error(`Invalid tone: ${tone}`);
          logger.info(`Valid tones: ${listTones().join(", ")}`);
          process.exit(1);
        }

        const product = {
          name: options.name,
          description: options.description,
          features: options.features?.split(",").map((f: string) => f.trim()),
          benefits: options.benefits?.split(",").map((b: string) => b.trim()),
          price: options.price,
          targetAudience: options.audience,
        };

        const request = {
          product,
          copyType,
          tone,
          length,
          template: options.template,
          customInstructions: options.instructions,
        };

        logger.header("Sales Copy Generator");
        logger.label("Product", product.name);
        logger.label("Type", copyType);
        logger.label("Tone", tone);
        logger.label("Length", length);
        if (options.template) {
          logger.label("Template", options.template);
        }
        logger.divider();

        const config = {
          provider: "openai" as const,
          model: options.model,
        };

        let results;
        if (variationCount > 1) {
          logger.info(`Generating ${variationCount} variations...`);
          results = await generateVariations(request, variationCount, config);
        } else {
          logger.info("Generating copy...");
          const result = await generateCopy(request, config);
          results = [result];
        }

        // Handle session
        if (options.session) {
          const session = loadSession(options.session);
          if (!session) {
            logger.error(`Session not found: ${options.session}`);
          } else {
            for (const result of results) {
              addResultToSession(options.session, result);
            }
            logger.success(`Added ${results.length} result(s) to session ${options.session}`);
          }
        }

        // Output results
        if (options.json) {
          console.log(JSON.stringify(results, null, 2));
        } else {
          for (let i = 0; i < results.length; i++) {
            const result = results[i];
            if (results.length > 1) {
              console.log();
              console.log(chalk.bold.cyan(`═══ Variation ${i + 1} ═══`));
            }
            console.log();
            console.log(result.content);
            console.log();
            logger.divider();
            logger.label("ID", result.id);
            logger.label("Model", result.model);
            logger.label("Generated", new Date(result.timestamp).toLocaleString());
          }
        }

        // Save to file if requested
        if (options.output) {
          const fs = require("fs");
          const content = results.map((r) => r.content).join("\n\n---\n\n");
          fs.writeFileSync(options.output, content);
          logger.success(`Saved to ${options.output}`);
        }

        logger.success("Copy generated successfully");
      } catch (error) {
        logger.error(error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  program
    .command("types")
    .description("List available copy types")
    .action(() => {
      logger.header("Available Copy Types");
      for (const type of listCopyTypes()) {
        console.log(chalk.cyan("•"), type);
      }
    });

  program
    .command("tones")
    .description("List available tones")
    .action(() => {
      logger.header("Available Tones");
      for (const tone of listTones()) {
        console.log(chalk.cyan("•"), tone);
      }
    });
}
