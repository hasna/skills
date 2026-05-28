import { Command } from "commander";
import chalk from "chalk";
import {
  listSessions,
  loadSession,
  createSession,
  deleteSession,
} from "../lib/storage.js";
import { logger } from "../utils/logger.js";

export function registerSessionsCommand(program: Command): void {
  const sessions = program
    .command("sessions")
    .description("Manage generation sessions");

  sessions
    .command("list")
    .alias("ls")
    .description("List all sessions")
    .option("-n, --limit <count>", "Limit number of sessions", "10")
    .option("--json", "Output as JSON")
    .action((options) => {
      const sessionList = listSessions().slice(0, parseInt(options.limit, 10));

      if (options.json) {
        console.log(JSON.stringify(sessionList, null, 2));
        return;
      }

      logger.header("Sessions");

      if (sessionList.length === 0) {
        logger.warning("No sessions found");
        return;
      }

      for (const session of sessionList) {
        console.log();
        console.log(
          chalk.bold.cyan(session.product.name),
          chalk.gray(`(${session.id})`)
        );
        console.log(chalk.gray(session.product.description.slice(0, 80) + "..."));
        console.log(chalk.yellow("Results:"), session.results.length);
        console.log(
          chalk.yellow("Updated:"),
          new Date(session.updatedAt).toLocaleString()
        );
      }
    });

  sessions
    .command("show <id>")
    .description("Show session details")
    .option("--json", "Output as JSON")
    .action((id, options) => {
      const session = loadSession(id);

      if (!session) {
        logger.error(`Session not found: ${id}`);
        process.exit(1);
      }

      if (options.json) {
        console.log(JSON.stringify(session, null, 2));
        return;
      }

      logger.header(`Session: ${session.product.name}`);
      logger.label("ID", session.id);
      logger.label("Product", session.product.name);
      logger.label("Description", session.product.description);
      logger.label("Results", String(session.results.length));
      logger.label("Created", new Date(session.createdAt).toLocaleString());
      logger.label("Updated", new Date(session.updatedAt).toLocaleString());

      if (session.results.length > 0) {
        console.log();
        console.log(chalk.bold("Results:"));
        for (const result of session.results) {
          logger.divider();
          console.log(chalk.cyan("ID:"), result.id);
          console.log(chalk.cyan("Type:"), result.copyType);
          console.log(chalk.cyan("Tone:"), result.tone || "default");
          console.log(chalk.cyan("Model:"), result.model);
          console.log(
            chalk.cyan("Generated:"),
            new Date(result.timestamp).toLocaleString()
          );
          console.log();
          console.log(result.content.slice(0, 200) + "...");
        }
      }
    });

  sessions
    .command("create")
    .description("Create a new session")
    .requiredOption("-n, --name <name>", "Product name")
    .requiredOption("-d, --description <description>", "Product description")
    .action((options) => {
      const session = createSession({
        name: options.name,
        description: options.description,
      });

      logger.success(`Session created: ${session.id}`);
      console.log();
      console.log(chalk.gray("Use this session ID with --session flag:"));
      console.log(
        chalk.cyan(
          `  service-salescopygenerate generate -n "${options.name}" -d "..." --session ${session.id}`
        )
      );
    });

  sessions
    .command("delete <id>")
    .description("Delete a session")
    .action((id) => {
      const deleted = deleteSession(id);

      if (deleted) {
        logger.success(`Session deleted: ${id}`);
      } else {
        logger.error(`Session not found: ${id}`);
        process.exit(1);
      }
    });

  sessions
    .command("export <id>")
    .description("Export session results to file")
    .requiredOption("-o, --output <file>", "Output file path")
    .option("--format <format>", "Output format (txt, json, md)", "md")
    .action((id, options) => {
      const session = loadSession(id);

      if (!session) {
        logger.error(`Session not found: ${id}`);
        process.exit(1);
      }

      const fs = require("fs");
      let content: string;

      switch (options.format) {
        case "json":
          content = JSON.stringify(session, null, 2);
          break;
        case "txt":
          content = session.results.map((r) => r.content).join("\n\n---\n\n");
          break;
        case "md":
        default:
          content = `# ${session.product.name}\n\n`;
          content += `${session.product.description}\n\n`;
          for (const result of session.results) {
            content += `## ${result.copyType} (${result.tone || "default"})\n\n`;
            content += `${result.content}\n\n`;
            content += `---\n\n`;
          }
          break;
      }

      fs.writeFileSync(options.output, content);
      logger.success(`Exported to ${options.output}`);
    });
}
