import { homedir } from "os";
import { join } from "path";

export function getDataDir(): string {
  return join(process.cwd(), "data");
}

export function getInvoicesDir(): string {
  return join(getDataDir(), "invoices");
}

export function getCompaniesDir(): string {
  return join(getDataDir(), "companies");
}

export function getConfigPath(): string {
  return join(homedir(), ".config", "service-invoicegenerate", "config.json");
}

export function ensureDir(dir: string): void {
  const fs = require("fs");
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}
