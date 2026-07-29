export interface Company {
  id: string;
  name: string;
  vatNumber?: string;
  address?: Address;
  email?: string;
  phone?: string;
  bankAccount?: BankAccount;
}

export interface Address {
  street: string;
  city: string;
  postalCode: string;
  country: string;
}

export interface BankAccount {
  bankName: string;
  iban: string;
  bic?: string;
}

export interface InvoiceItem {
  description: string;
  quantity: number;
  unitPrice: number;
  vatRate?: number;
  total?: number;
}

export interface Invoice {
  id: string;
  number: string;
  issuer: Company;
  client: Company;
  items: InvoiceItem[];
  currency: string;
  subtotal: number;
  vatAmount: number;
  total: number;
  issueDate: string;
  dueDate: string;
  status: InvoiceStatus;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export type InvoiceStatus = "draft" | "sent" | "paid" | "overdue" | "cancelled";

export interface CreateInvoiceRequest {
  issuer: Company;
  client: Company;
  items: InvoiceItem[];
  currency?: string;
  issueDate?: string;
  dueDate?: string;
  notes?: string;
}

export interface InvoiceTemplate {
  id: string;
  name: string;
  description: string;
  styles: TemplateStyles;
}

export interface TemplateStyles {
  primaryColor: string;
  fontFamily: string;
  fontSize: string;
  logoUrl?: string;
}

export interface ApiConfig {
  baseUrl: string;
  timeout: number;
}

export interface GeneratorConfig {
  defaultCurrency: string;
  defaultVatRate: number;
  defaultPaymentTerms: number;
  outputDir: string;
}
