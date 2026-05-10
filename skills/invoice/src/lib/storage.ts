import { readFileSync, writeFileSync, existsSync, readdirSync } from "fs";
import { join } from "path";
import type { Company, Invoice } from "../types/index.js";
import { getCompaniesDir, getInvoicesDir, ensureDir } from "../utils/paths.js";

// Local company storage (for offline mode)
export function saveCompanyLocal(company: Company): void {
  const companiesDir = getCompaniesDir();
  ensureDir(companiesDir);

  const companyPath = join(companiesDir, `${company.id}.json`);
  writeFileSync(companyPath, JSON.stringify(company, null, 2));
}

export function loadCompanyLocal(id: string): Company | null {
  const companyPath = join(getCompaniesDir(), `${id}.json`);

  if (!existsSync(companyPath)) {
    return null;
  }

  const content = readFileSync(companyPath, "utf-8");
  return JSON.parse(content) as Company;
}

export function listCompaniesLocal(): Company[] {
  const companiesDir = getCompaniesDir();

  if (!existsSync(companiesDir)) {
    return [];
  }

  const files = readdirSync(companiesDir).filter((f) => f.endsWith(".json"));

  return files.map((file) => {
    const content = readFileSync(join(companiesDir, file), "utf-8");
    return JSON.parse(content) as Company;
  });
}

export function deleteCompanyLocal(id: string): boolean {
  const companyPath = join(getCompaniesDir(), `${id}.json`);

  if (!existsSync(companyPath)) {
    return false;
  }

  const fs = require("fs");
  fs.unlinkSync(companyPath);
  return true;
}

// Local invoice storage
export function saveInvoiceLocal(invoice: Invoice): void {
  const invoicesDir = getInvoicesDir();
  ensureDir(invoicesDir);

  const invoicePath = join(invoicesDir, `${invoice.id}.json`);
  writeFileSync(invoicePath, JSON.stringify(invoice, null, 2));
}

export function loadInvoiceLocal(id: string): Invoice | null {
  const invoicePath = join(getInvoicesDir(), `${id}.json`);

  if (!existsSync(invoicePath)) {
    return null;
  }

  const content = readFileSync(invoicePath, "utf-8");
  return JSON.parse(content) as Invoice;
}

export function listInvoicesLocal(): Invoice[] {
  const invoicesDir = getInvoicesDir();

  if (!existsSync(invoicesDir)) {
    return [];
  }

  const files = readdirSync(invoicesDir).filter((f) => f.endsWith(".json"));

  return files
    .map((file) => {
      const content = readFileSync(join(invoicesDir, file), "utf-8");
      return JSON.parse(content) as Invoice;
    })
    .sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
}

export function getNextInvoiceNumber(): string {
  const invoices = listInvoicesLocal();
  const year = new Date().getFullYear();
  const prefix = `INV-${year}-`;

  let maxNumber = 0;
  for (const invoice of invoices) {
    if (invoice.number.startsWith(prefix)) {
      const num = parseInt(invoice.number.replace(prefix, ""), 10);
      if (!isNaN(num) && num > maxNumber) {
        maxNumber = num;
      }
    }
  }

  return `${prefix}${String(maxNumber + 1).padStart(4, "0")}`;
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
}

export function createLocalCompany(data: Omit<Company, "id">): Company {
  const company: Company = {
    id: generateId(),
    ...data,
  };
  saveCompanyLocal(company);
  return company;
}

export function createLocalInvoice(
  issuer: Company,
  client: Company,
  items: { description: string; quantity: number; unitPrice: number; vatRate?: number }[],
  options: {
    currency?: string;
    notes?: string;
    dueInDays?: number;
  } = {}
): Invoice {
  const { currency = "EUR", notes, dueInDays = 30 } = options;
  const vatRate = items[0]?.vatRate ?? 19;

  const calculatedItems = items.map((item) => ({
    ...item,
    vatRate: item.vatRate ?? vatRate,
    total: item.quantity * item.unitPrice,
  }));

  const subtotal = calculatedItems.reduce((sum, item) => sum + item.total, 0);
  const vatAmount = subtotal * (vatRate / 100);
  const total = subtotal + vatAmount;

  const now = new Date();
  const dueDate = new Date(now);
  dueDate.setDate(dueDate.getDate() + dueInDays);

  const invoice: Invoice = {
    id: generateId(),
    number: getNextInvoiceNumber(),
    issuer,
    client,
    items: calculatedItems,
    currency,
    subtotal,
    vatAmount,
    total,
    issueDate: now.toISOString().split("T")[0],
    dueDate: dueDate.toISOString().split("T")[0],
    status: "draft",
    notes,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };

  saveInvoiceLocal(invoice);
  return invoice;
}
