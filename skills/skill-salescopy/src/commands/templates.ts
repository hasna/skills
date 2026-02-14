import { Command } from "commander";
import chalk from "chalk";
import { loadTemplates, saveTemplate } from "../lib/storage.js";
import { logger } from "../utils/logger.js";
import type { Template, CopyType } from "../types/index.js";

export function registerTemplatesCommand(program: Command): void {
  const templates = program
    .command("templates")
    .description("Manage copy templates");

  templates
    .command("list")
    .alias("ls")
    .description("List available templates")
    .option("-t, --type <type>", "Filter by copy type")
    .option("--json", "Output as JSON")
    .action((options) => {
      let templateList = loadTemplates();

      if (options.type) {
        templateList = templateList.filter((t) => t.copyType === options.type);
      }

      if (options.json) {
        console.log(JSON.stringify(templateList, null, 2));
        return;
      }

      logger.header("Available Templates");

      if (templateList.length === 0) {
        logger.warning("No templates found");
        return;
      }

      for (const template of templateList) {
        console.log();
        console.log(chalk.bold.cyan(template.name), chalk.gray(`(${template.id})`));
        console.log(chalk.gray(template.description));
        console.log(chalk.yellow("Type:"), template.copyType);
        console.log(chalk.yellow("Structure:"), template.structure.join(" → "));
      }
    });

  templates
    .command("show <id>")
    .description("Show template details")
    .option("--json", "Output as JSON")
    .action((id, options) => {
      const templateList = loadTemplates();
      const template = templateList.find((t) => t.id === id);

      if (!template) {
        logger.error(`Template not found: ${id}`);
        process.exit(1);
      }

      if (options.json) {
        console.log(JSON.stringify(template, null, 2));
        return;
      }

      logger.header(template.name);
      logger.label("ID", template.id);
      logger.label("Description", template.description);
      logger.label("Copy Type", template.copyType);
      logger.label("Structure", template.structure.join(" → "));
      console.log();
      console.log(chalk.bold("Prompt:"));
      console.log(template.prompt);
    });

  templates
    .command("create")
    .description("Create a new template")
    .requiredOption("-i, --id <id>", "Template ID")
    .requiredOption("-n, --name <name>", "Template name")
    .requiredOption("-d, --description <description>", "Template description")
    .requiredOption(
      "-t, --type <type>",
      "Copy type (sales-letter, landing-page, email-sequence, headline, bullet-points, call-to-action, testimonial-request, product-description)"
    )
    .requiredOption("-s, --structure <structure>", "Comma-separated structure elements")
    .requiredOption("-p, --prompt <prompt>", "Generation prompt")
    .action((options) => {
      const template: Template = {
        id: options.id,
        name: options.name,
        description: options.description,
        copyType: options.type as CopyType,
        structure: options.structure.split(",").map((s: string) => s.trim()),
        prompt: options.prompt,
      };

      saveTemplate(template);
      logger.success(`Template created: ${template.name}`);
    });
}
