import { Command } from "commander";
import chalk from "chalk";
import {
  listInvoicesLocal,
  loadInvoiceLocal,
} from "../lib/storage.js";
import {
  listInvoices,
  getInvoice,
  downloadInvoicePdf,
  checkApiHealth,
} from "../lib/api.js";
import { logger } from "../utils/logger.js";
import type { Invoice } from "../types/index.js";

export function registerInvoicesCommand(program: Command): void {
  const invoices = program.command("invoices").description("Manage invoices");

  invoices
    .command("list")
    .alias("ls")
    .description("List all invoices")
    .option("-n, --limit <count>", "Limit number of invoices", "20")
    .option("--api", "Use API instead of local storage")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        let invoiceList: Invoice[];

        if (options.api && (await checkApiHealth())) {
          invoiceList = await listInvoices();
        } else {
          invoiceList = listInvoicesLocal();
        }

        invoiceList = invoiceList.slice(0, parseInt(options.limit, 10));

        if (options.json) {
          console.log(JSON.stringify(invoiceList, null, 2));
          return;
        }

        logger.header("Invoices");

        if (invoiceList.length === 0) {
          logger.warning("No invoices found");
          logger.info("Generate one with: service-invoicegenerate generate --issuer <id> --client <id> -d 'Description' -a 1000");
          return;
        }

        for (const invoice of invoiceList) {
          console.log();
          console.log(
            chalk.bold.cyan(invoice.number),
            getStatusBadge(invoice.status)
          );
          console.log(
            chalk.gray(`${invoice.issuer.name} → ${invoice.client.name}`)
          );
          console.log(
            chalk.yellow("Total:"),
            chalk.bold(`${invoice.total.toFixed(2)} ${invoice.currency}`)
          );
          console.log(
            chalk.yellow("Date:"),
            invoice.issueDate,
            chalk.gray(`Due: ${invoice.dueDate}`)
          );
        }
      } catch (error) {
        logger.error(error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  invoices
    .command("show <id>")
    .description("Show invoice details")
    .option("--json", "Output as JSON")
    .action((id, options) => {
      // Try to find by ID or invoice number
      let invoice = loadInvoiceLocal(id);

      if (!invoice) {
        const allInvoices = listInvoicesLocal();
        invoice =
          allInvoices.find((inv) => inv.number === id) ||
          allInvoices.find((inv) => inv.id.startsWith(id)) ||
          null;
      }

      if (!invoice) {
        logger.error(`Invoice not found: ${id}`);
        process.exit(1);
      }

      if (options.json) {
        console.log(JSON.stringify(invoice, null, 2));
        return;
      }

      logger.header(`Invoice ${invoice.number}`);
      console.log(getStatusBadge(invoice.status));
      console.log();

      logger.label("ID", invoice.id);
      logger.label("Issue Date", invoice.issueDate);
      logger.label("Due Date", invoice.dueDate);

      console.log();
      console.log(chalk.bold("From:"));
      logger.label("  Name", invoice.issuer.name);
      if (invoice.issuer.vatNumber) {
        logger.label("  VAT", invoice.issuer.vatNumber);
      }

      console.log();
      console.log(chalk.bold("To:"));
      logger.label("  Name", invoice.client.name);
      if (invoice.client.vatNumber) {
        logger.label("  VAT", invoice.client.vatNumber);
      }

      console.log();
      console.log(chalk.bold("Items:"));
      for (const item of invoice.items) {
        console.log(
          chalk.gray("  •"),
          item.description,
          chalk.gray(`(${item.quantity} x ${item.unitPrice.toFixed(2)})`)
        );
      }

      console.log();
      logger.divider();
      logger.label("Subtotal", `${invoice.subtotal.toFixed(2)} ${invoice.currency}`);
      logger.label("VAT", `${invoice.vatAmount.toFixed(2)} ${invoice.currency}`);
      console.log(
        chalk.bold("Total:"),
        chalk.bold.green(`${invoice.total.toFixed(2)} ${invoice.currency}`)
      );

      if (invoice.notes) {
        console.log();
        console.log(chalk.bold("Notes:"));
        console.log(chalk.gray(invoice.notes));
      }
    });

  invoices
    .command("download <id>")
    .description("Download invoice as PDF")
    .requiredOption("-o, --output <file>", "Output file path")
    .action(async (id, options) => {
      try {
        if (!(await checkApiHealth())) {
          logger.error("API service not available");
          logger.info("Start the API service with: docker-compose up -d");
          process.exit(1);
        }

        // Find invoice
        let invoice = loadInvoiceLocal(id);
        if (!invoice) {
          const allInvoices = listInvoicesLocal();
          invoice =
            allInvoices.find((inv) => inv.number === id) ||
            allInvoices.find((inv) => inv.id.startsWith(id)) ||
            null;
        }

        const invoiceId = invoice?.id || id;

        logger.info(`Downloading PDF for invoice ${id}...`);
        await downloadInvoicePdf(invoiceId, options.output);
        logger.success(`PDF saved to ${options.output}`);
      } catch (error) {
        logger.error(error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  invoices
    .command("export <id>")
    .description("Export invoice as JSON")
    .requiredOption("-o, --output <file>", "Output file path")
    .action((id, options) => {
      let invoice = loadInvoiceLocal(id);

      if (!invoice) {
        const allInvoices = listInvoicesLocal();
        invoice =
          allInvoices.find((inv) => inv.number === id) ||
          allInvoices.find((inv) => inv.id.startsWith(id)) ||
          null;
      }

      if (!invoice) {
        logger.error(`Invoice not found: ${id}`);
        process.exit(1);
      }

      const fs = require("fs");
      fs.writeFileSync(options.output, JSON.stringify(invoice, null, 2));
      logger.success(`Invoice exported to ${options.output}`);
    });
}

function getStatusBadge(status: string): string {
  const badges: Record<string, string> = {
    draft: chalk.gray("[DRAFT]"),
    sent: chalk.blue("[SENT]"),
    paid: chalk.green("[PAID]"),
    overdue: chalk.red("[OVERDUE]"),
    cancelled: chalk.yellow("[CANCELLED]"),
  };
  return badges[status] || chalk.gray(`[${status.toUpperCase()}]`);
}
