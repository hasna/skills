import type {
  Company,
  Invoice,
  CreateInvoiceRequest,
  ApiConfig,
} from "../types/index.js";

function getApiConfig(): ApiConfig {
  return {
    baseUrl: process.env.API_BASE_URL || "http://localhost:8007/api/v1",
    timeout: parseInt(process.env.API_TIMEOUT || "30000", 10),
  };
}

async function apiRequest<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const config = getApiConfig();
  const url = `${config.baseUrl}${endpoint}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeout);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...options.headers,
      },
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(
        (error as { detail?: string }).detail ||
          `API error: ${response.status} ${response.statusText}`
      );
    }

    return response.json() as Promise<T>;
  } finally {
    clearTimeout(timeout);
  }
}

export async function listCompanies(): Promise<Company[]> {
  return apiRequest<Company[]>("/companies");
}

export async function getCompany(id: string): Promise<Company> {
  return apiRequest<Company>(`/companies/${id}`);
}

export async function createCompany(
  company: Omit<Company, "id">
): Promise<Company> {
  return apiRequest<Company>("/companies", {
    method: "POST",
    body: JSON.stringify(company),
  });
}

export async function updateCompany(
  id: string,
  company: Partial<Company>
): Promise<Company> {
  return apiRequest<Company>(`/companies/${id}`, {
    method: "PUT",
    body: JSON.stringify(company),
  });
}

export async function deleteCompany(id: string): Promise<void> {
  await apiRequest<void>(`/companies/${id}`, {
    method: "DELETE",
  });
}

export async function listInvoices(): Promise<Invoice[]> {
  return apiRequest<Invoice[]>("/invoices");
}

export async function getInvoice(id: string): Promise<Invoice> {
  return apiRequest<Invoice>(`/invoices/${id}`);
}

export async function createInvoice(
  request: CreateInvoiceRequest
): Promise<Invoice> {
  return apiRequest<Invoice>("/invoices", {
    method: "POST",
    body: JSON.stringify(request),
  });
}

export async function downloadInvoicePdf(
  id: string,
  outputPath: string
): Promise<void> {
  const config = getApiConfig();
  const url = `${config.baseUrl}/invoices/${id}/pdf`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download PDF: ${response.statusText}`);
  }

  const buffer = await response.arrayBuffer();
  const fs = require("fs");
  fs.writeFileSync(outputPath, Buffer.from(buffer));
}

export async function checkApiHealth(): Promise<boolean> {
  try {
    const config = getApiConfig();
    const response = await fetch(`${config.baseUrl.replace("/api/v1", "")}/health`);
    return response.ok;
  } catch {
    return false;
  }
}
