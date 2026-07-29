import { Command } from "commander";
import chalk from "chalk";
import {
  listCompaniesLocal,
  loadCompanyLocal,
  createLocalInvoice,
} from "../lib/storage.js";
import { createInvoice, downloadInvoicePdf, checkApiHealth } from "../lib/api.js";
import { logger } from "../utils/logger.js";
import { getInvoicesDir, ensureDir } from "../utils/paths.js";
import { join } from "path";

export function registerGenerateCommand(program: Command): void {
  program
    .command("generate")
    .description("Generate a new invoice")
    .requiredOption("--issuer <id>", "Issuer company ID")
    .requiredOption("--client <id>", "Client company ID")
    .requiredOption("-d, --description <description>", "Item description")
    .requiredOption("-a, --amount <amount>", "Item amount (price)")
    .option("-q, --quantity <quantity>", "Item quantity", "1")
    .option("-c, --currency <currency>", "Currency code", "EUR")
    .option("-v, --vat <rate>", "VAT rate percentage", "19")
    .option("-n, --notes <notes>", "Invoice notes")
    .option("--due-days <days>", "Payment due in days", "30")
    .option("--api", "Use API instead of local storage")
    .option("-o, --output <file>", "Output PDF file path")
    .option("--json", "Output result as JSON")
    .action(async (options) => {
      try {
        const useApi = options.api && (await checkApiHealth());

        // Load companies
        const issuer = loadCompanyLocal(options.issuer);
        const client = loadCompanyLocal(options.client);

        if (!issuer) {
          logger.error(`Issuer company not found: ${options.issuer}`);
          logger.info("Use 'service-invoicegenerate companies list' to see available companies");
          process.exit(1);
        }

        if (!client) {
          logger.error(`Client company not found: ${options.client}`);
          logger.info("Use 'service-invoicegenerate companies list' to see available companies");
          process.exit(1);
        }

        const items = [
          {
            description: options.description,
            quantity: parseFloat(options.quantity),
            unitPrice: parseFloat(options.amount),
            vatRate: parseFloat(options.vat),
          },
        ];

        logger.header("Invoice Generator");
        logger.label("Issuer", issuer.name);
        logger.label("Client", client.name);
        logger.label("Amount", `${options.amount} ${options.currency}`);
        logger.label("VAT", `${options.vat}%`);
        logger.divider();

        let invoice;

        if (useApi) {
          logger.info("Generating invoice via API...");
          invoice = await createInvoice({
            issuer,
            client,
            items,
            currency: options.currency,
            notes: options.notes,
          });
        } else {
          logger.info("Generating invoice locally...");
          invoice = createLocalInvoice(issuer, client, items, {
            currency: options.currency,
            notes: options.notes,
            dueInDays: parseInt(options.dueDays, 10),
          });
        }

        if (options.json) {
          console.log(JSON.stringify(invoice, null, 2));
        } else {
          console.log();
          logger.success("Invoice generated successfully");
          console.log();
          logger.label("Invoice Number", invoice.number);
          logger.label("Subtotal", `${invoice.subtotal.toFixed(2)} ${invoice.currency}`);
          logger.label("VAT", `${invoice.vatAmount.toFixed(2)} ${invoice.currency}`);
          logger.label("Total", chalk.bold(`${invoice.total.toFixed(2)} ${invoice.currency}`));
          logger.label("Issue Date", invoice.issueDate);
          logger.label("Due Date", invoice.dueDate);
          logger.label("ID", invoice.id);
        }

        // Download PDF if output specified and API available
        if (options.output && useApi) {
          logger.info("Downloading PDF...");
          await downloadInvoicePdf(invoice.id, options.output);
          logger.success(`PDF saved to ${options.output}`);
        } else if (options.output) {
          // Save JSON locally as fallback
          const outputPath = options.output.replace(/\.pdf$/i, ".json");
          const fs = require("fs");
          fs.writeFileSync(outputPath, JSON.stringify(invoice, null, 2));
          logger.success(`Invoice JSON saved to ${outputPath}`);
          logger.warning("PDF generation requires running API service");
        }
      } catch (error) {
        logger.error(error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  program
    .command("quick")
    .description("Quick invoice generation with minimal options")
    .requiredOption("--from <name>", "Issuer company name (will create if not exists)")
    .requiredOption("--to <name>", "Client company name (will create if not exists)")
    .requiredOption("-a, --amount <amount>", "Invoice amount")
    .requiredOption("-d, --description <description>", "Service/product description")
    .option("-c, --currency <currency>", "Currency code", "EUR")
    .option("--json", "Output result as JSON")
    .action(async (options) => {
      try {
        const {
          createLocalCompany,
          listCompaniesLocal,
          createLocalInvoice,
        } = await import("../lib/storage.js");

        // Find or create issuer
        let issuer = listCompaniesLocal().find(
          (c) => c.name.toLowerCase() === options.from.toLowerCase()
        );
        if (!issuer) {
          issuer = createLocalCompany({ name: options.from });
          logger.info(`Created issuer company: ${issuer.name}`);
        }

        // Find or create client
        let client = listCompaniesLocal().find(
          (c) => c.name.toLowerCase() === options.to.toLowerCase()
        );
        if (!client) {
          client = createLocalCompany({ name: options.to });
          logger.info(`Created client company: ${client.name}`);
        }

        const items = [
          {
            description: options.description,
            quantity: 1,
            unitPrice: parseFloat(options.amount),
          },
        ];

        const invoice = createLocalInvoice(issuer, client, items, {
          currency: options.currency,
        });

        if (options.json) {
          console.log(JSON.stringify(invoice, null, 2));
        } else {
          logger.success(`Invoice ${invoice.number} created`);
          logger.label("Total", `${invoice.total.toFixed(2)} ${invoice.currency}`);
        }
      } catch (error) {
        logger.error(error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });
}
