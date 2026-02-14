import { getApiKey, getApiSecret, getCustomerId, getApiUrl } from "./config";

export interface DomainAvailability {
  domain: string;
  available: boolean;
  price?: number;
  currency?: string;
  period?: number;
  definitive?: boolean;
  registryPremiumPricing?: boolean;
}

export interface BulkAvailabilityResponse {
  domains: DomainAvailability[];
  errors?: Array<{ domain: string; message: string }>;
}

export interface DomainSummary {
  domain: string;
  status?: string;
  expires?: string;
  renewAuto?: boolean;
  privacy?: boolean;
}

function getHeaders() {
  const apiKey = getApiKey();
  const apiSecret = getApiSecret();

  if (!apiKey || !apiSecret) {
    throw new Error(
      "API credentials not configured. Run: service-domainsearch config --api-key <key> --api-secret <secret>"
    );
  }

  return {
    Authorization: `sso-key ${apiKey}:${apiSecret}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

async function apiRequest<T>(
  endpoint: string,
  method: string = "GET",
  body?: any
): Promise<{ status: number; data: T; ok: boolean }> {
  const baseUrl = getApiUrl();
  const url = `${baseUrl}${endpoint}`;

  const options: RequestInit = {
    method,
    headers: getHeaders(),
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url, options);
  const text = await response.text();

  let data: T;
  try {
    data = JSON.parse(text);
  } catch {
    data = { rawResponse: text.substring(0, 500) } as T;
  }

  return {
    status: response.status,
    data,
    ok: response.ok || response.status === 203,
  };
}

export const domainApi = {
  // Check single domain availability
  async checkAvailability(
    domain: string,
    type: "REGISTRATION" | "RENEWAL" | "TRANSFER" = "REGISTRATION",
    period: number = 1
  ): Promise<DomainAvailability> {
    const result = await apiRequest<DomainAvailability>(
      `/v2/domains/available?domain=${encodeURIComponent(domain)}&type=${type}&period=${period}&optimizeFor=ACCURACY`
    );

    if (!result.ok) {
      throw new Error(`API Error: ${JSON.stringify(result.data)}`);
    }

    return result.data;
  },

  // Bulk domain availability check (up to 500 domains)
  async checkBulkAvailability(
    domains: string[]
  ): Promise<BulkAvailabilityResponse> {
    const result = await apiRequest<BulkAvailabilityResponse>(
      `/v2/domains/available?optimizeFor=SPEED`,
      "POST",
      { domains }
    );

    if (!result.ok) {
      throw new Error(`API Error: ${JSON.stringify(result.data)}`);
    }

    return result.data;
  },

  // List owned domains
  async listOwnedDomains(limit: number = 100): Promise<DomainSummary[]> {
    const customerId = getCustomerId();
    if (!customerId) {
      throw new Error(
        "Customer ID not configured. Run: service-domainsearch config --customer-id <id>"
      );
    }

    const result = await apiRequest<DomainSummary[]>(
      `/v2/customers/${customerId}/domains?limit=${limit}`
    );

    if (!result.ok) {
      throw new Error(`API Error: ${JSON.stringify(result.data)}`);
    }

    return result.data;
  },

  // Get domain details
  async getDomainDetails(domain: string): Promise<any> {
    const customerId = getCustomerId();
    if (!customerId) {
      throw new Error("Customer ID not configured");
    }

    const result = await apiRequest<any>(
      `/v2/customers/${customerId}/domains/${encodeURIComponent(domain)}?includes=contacts,nameServers`
    );

    if (!result.ok) {
      throw new Error(`API Error: ${JSON.stringify(result.data)}`);
    }

    return result.data;
  },

  // Get supported TLDs
  async listTlds(): Promise<any[]> {
    const result = await apiRequest<any[]>(`/v1/domains/tlds`);

    if (!result.ok) {
      throw new Error(`API Error: ${JSON.stringify(result.data)}`);
    }

    return result.data;
  },

  // Domain suggestions
  async getSuggestions(query: string, limit: number = 20): Promise<any[]> {
    const result = await apiRequest<any[]>(
      `/v1/domains/suggest?query=${encodeURIComponent(query)}&limit=${limit}`
    );

    if (!result.ok) {
      throw new Error(`API Error: ${JSON.stringify(result.data)}`);
    }

    return result.data;
  },
};

// Format price from micro-units to dollars
export function formatPrice(
  microUnits: number,
  currency: string = "USD"
): string {
  return `${currency} ${(microUnits / 1000000).toFixed(2)}`;
}
