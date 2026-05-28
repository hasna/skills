import { Command } from "commander";
import chalk from "chalk";
import {
  listCompaniesLocal,
  loadCompanyLocal,
  createLocalCompany,
  deleteCompanyLocal,
  saveCompanyLocal,
} from "../lib/storage.js";
import {
  listCompanies,
  createCompany,
  deleteCompany,
  checkApiHealth,
} from "../lib/api.js";
import { logger } from "../utils/logger.js";
import type { Company } from "../types/index.js";

export function registerCompaniesCommand(program: Command): void {
  const companies = program
    .command("companies")
    .description("Manage companies");

  companies
    .command("list")
    .alias("ls")
    .description("List all companies")
    .option("--api", "Use API instead of local storage")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        let companyList: Company[];

        if (options.api && (await checkApiHealth())) {
          companyList = await listCompanies();
        } else {
          companyList = listCompaniesLocal();
        }

        if (options.json) {
          console.log(JSON.stringify(companyList, null, 2));
          return;
        }

        logger.header("Companies");

        if (companyList.length === 0) {
          logger.warning("No companies found");
          logger.info("Create one with: service-invoicegenerate companies create --name 'Company Name'");
          return;
        }

        for (const company of companyList) {
          console.log();
          console.log(chalk.bold.cyan(company.name), chalk.gray(`(${company.id})`));
          if (company.vatNumber) {
            console.log(chalk.yellow("VAT:"), company.vatNumber);
          }
          if (company.email) {
            console.log(chalk.yellow("Email:"), company.email);
          }
          if (company.address) {
            const addr = company.address;
            console.log(
              chalk.yellow("Address:"),
              `${addr.street}, ${addr.postalCode} ${addr.city}, ${addr.country}`
            );
          }
        }
      } catch (error) {
        logger.error(error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  companies
    .command("show <id>")
    .description("Show company details")
    .option("--json", "Output as JSON")
    .action((id, options) => {
      const company = loadCompanyLocal(id);

      if (!company) {
        logger.error(`Company not found: ${id}`);
        process.exit(1);
      }

      if (options.json) {
        console.log(JSON.stringify(company, null, 2));
        return;
      }

      logger.header(company.name);
      logger.label("ID", company.id);
      if (company.vatNumber) {
        logger.label("VAT Number", company.vatNumber);
      }
      if (company.email) {
        logger.label("Email", company.email);
      }
      if (company.phone) {
        logger.label("Phone", company.phone);
      }
      if (company.address) {
        console.log();
        console.log(chalk.bold("Address:"));
        logger.label("  Street", company.address.street);
        logger.label("  City", company.address.city);
        logger.label("  Postal Code", company.address.postalCode);
        logger.label("  Country", company.address.country);
      }
      if (company.bankAccount) {
        console.log();
        console.log(chalk.bold("Bank Account:"));
        logger.label("  Bank", company.bankAccount.bankName);
        logger.label("  IBAN", company.bankAccount.iban);
        if (company.bankAccount.bic) {
          logger.label("  BIC", company.bankAccount.bic);
        }
      }
    });

  companies
    .command("create")
    .description("Create a new company")
    .requiredOption("-n, --name <name>", "Company name")
    .option("-v, --vat <vatNumber>", "VAT number")
    .option("-e, --email <email>", "Email address")
    .option("-p, --phone <phone>", "Phone number")
    .option("--street <street>", "Street address")
    .option("--city <city>", "City")
    .option("--postal <postalCode>", "Postal code")
    .option("--country <country>", "Country")
    .option("--bank <bankName>", "Bank name")
    .option("--iban <iban>", "IBAN")
    .option("--bic <bic>", "BIC/SWIFT")
    .option("--api", "Use API instead of local storage")
    .action(async (options) => {
      try {
        const companyData: Omit<Company, "id"> = {
          name: options.name,
          vatNumber: options.vat,
          email: options.email,
          phone: options.phone,
        };

        if (options.street || options.city) {
          companyData.address = {
            street: options.street || "",
            city: options.city || "",
            postalCode: options.postal || "",
            country: options.country || "",
          };
        }

        if (options.iban) {
          companyData.bankAccount = {
            bankName: options.bank || "",
            iban: options.iban,
            bic: options.bic,
          };
        }

        let company: Company;

        if (options.api && (await checkApiHealth())) {
          company = await createCompany(companyData);
        } else {
          company = createLocalCompany(companyData);
        }

        logger.success(`Company created: ${company.name}`);
        logger.label("ID", company.id);
      } catch (error) {
        logger.error(error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  companies
    .command("delete <id>")
    .description("Delete a company")
    .option("--api", "Use API instead of local storage")
    .action(async (id, options) => {
      try {
        if (options.api && (await checkApiHealth())) {
          await deleteCompany(id);
        } else {
          const deleted = deleteCompanyLocal(id);
          if (!deleted) {
            logger.error(`Company not found: ${id}`);
            process.exit(1);
          }
        }

        logger.success(`Company deleted: ${id}`);
      } catch (error) {
        logger.error(error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });
}
