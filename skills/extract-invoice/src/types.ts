export interface InvoiceData {
  invoice_number: string | null;
  invoice_date: string | null;
  due_date: string | null;
  po_number: string | null;
  payment_terms: string | null;
  vendor: VendorInfo;
  customer: CustomerInfo;
  line_items: LineItem[];
  subtotal: number | null;
  tax: TaxInfo | null;
  discount: DiscountInfo | null;
  shipping: number | null;
  total: number | null;
  currency: string;
  payment_info: PaymentInfo | null;
  notes: string | null;
  confidence: number;
  raw_text?: string;
}

export interface VendorInfo {
  name: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  tax_id: string | null;
  website: string | null;
}

export interface CustomerInfo {
  name: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
}

export interface LineItem {
  description: string;
  quantity: number | null;
  unit: string | null;
  unit_price: number | null;
  tax_rate: number | null;
  subtotal: number | null;
  discount: number | null;
}

export interface TaxInfo {
  rate: number | null;
  amount: number;
  type?: string;
}

export interface DiscountInfo {
  type: "percentage" | "fixed" | null;
  value: number | null;
  amount: number;
}

export interface PaymentInfo {
  method: string | null;
  bank_name: string | null;
  account_number: string | null;
  routing_number: string | null;
  iban: string | null;
  swift: string | null;
  reference: string | null;
}

export interface ExtractionResult {
  file: string;
  success: boolean;
  data: InvoiceData | null;
  error?: string;
  processing_time_ms: number;
}

export interface Options {
  files: string[];
  format: "json" | "csv" | "excel" | "markdown";
  confidence: boolean;
  currency?: string;
  language?: string;
  pages?: string;
  batch: boolean;
  output?: string;
  verbose: boolean;
}
