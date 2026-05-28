import {
  getApiKey,
  getApiSecret,
  getCustomerId,
  getApiUrl,
  useRemoteServer,
  getRemoteServerUrl,
  getRemoteApiKeyAsync,
} from "./config";

export interface Contact {
  nameFirst: string;
  nameLast: string;
  email: string;
  phone: string;
  addressMailing: {
    address1: string;
    address2?: string;
    city: string;
    state: string;
    postalCode: string;
    country: string;
  };
  organization?: string;
  encoding?: "ASCII" | "UTF-8";
}

// V2 API consent format
export interface ConsentV2 {
  agreedAt: string;
  agreedBy: string;
  agreementKeys: string[];
  price: number; // Price in micro-units (e.g., 1500000 = $1.50)
  currency: string; // ISO currency code (e.g., "USD")
  registryPremiumPricing?: boolean;
  claimToken?: string;
}

// V2 API contacts format
export interface DomainContactsV2 {
  admin?: Contact;
  billing?: Contact;
  registrant?: Contact;
  tech?: Contact;
}

// V2 API purchase request format
export interface DomainPurchaseRequestV2 {
  domain: string;
  consent: ConsentV2;
  contacts?: DomainContactsV2;
  nameServers?: string[];
  period?: number;
  privacy?: boolean;
  renewAuto?: boolean;
}

// Legacy interface for backwards compatibility
export interface DomainPurchaseRequest {
  domain: string;
  consent: {
    agreedAt: string;
    agreedBy: string;
    agreementKeys: string[];
    price?: number;
    currency?: string;
  };
  contactAdmin?: Contact;
  contactBilling?: Contact;
  contactRegistrant: Contact;
  contactTech?: Contact;
  nameServers?: string[];
  period?: number;
  privacy?: boolean;
  renewAuto?: boolean;
}

// Convert legacy request to V2 format
export function toV2Request(request: DomainPurchaseRequest, price: number, currency: string): DomainPurchaseRequestV2 {
  return {
    domain: request.domain,
    consent: {
      agreedAt: request.consent.agreedAt,
      agreedBy: request.consent.agreedBy,
      agreementKeys: request.consent.agreementKeys,
      price: request.consent.price ?? price,
      currency: request.consent.currency ?? currency,
    },
    contacts: {
      registrant: request.contactRegistrant,
      admin: request.contactAdmin,
      billing: request.contactBilling,
      tech: request.contactTech,
    },
    nameServers: request.nameServers,
    period: request.period,
    privacy: request.privacy,
    renewAuto: request.renewAuto,
  };
}

export interface DomainAvailability {
  domain: string;
  available: boolean;
  price?: number;
  currency?: string;
  period?: number;
  definitive?: boolean;
  registryPremiumPricing?: boolean;
}

export interface Agreement {
  agreementKey: string;
  title: string;
  url: string;
  content?: string;
}

export interface DomainDetails {
  domain: string;
  status: string;
  createdAt: string;
  expires: string;
  renewAuto: boolean;
  privacy: boolean;
  nameServers?: string[];
  contactAdmin?: Contact;
  contactBilling?: Contact;
  contactRegistrant?: Contact;
  contactTech?: Contact;
}

function getHeaders() {
  const apiKey = getApiKey();
  const apiSecret = getApiSecret();

  if (!apiKey || !apiSecret) {
    throw new Error(
      "API credentials not configured. Run: service-domainpurchase config --api-key <key> --api-secret <secret>"
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

export const purchaseApi = {
  // Check single domain availability with pricing
  async checkAvailability(
    domain: string,
    forTransfer: boolean = false
  ): Promise<DomainAvailability> {
    const type = forTransfer ? "TRANSFER" : "REGISTRATION";
    const result = await apiRequest<DomainAvailability>(
      `/v2/domains/available?domain=${encodeURIComponent(domain)}&type=${type}&optimizeFor=ACCURACY`
    );

    if (!result.ok) {
      throw new Error(`API Error: ${JSON.stringify(result.data)}`);
    }

    return result.data;
  },

  // Get legal agreements for domain purchase
  async getAgreements(tlds: string[], privacy: boolean = false): Promise<Agreement[]> {
    const customerId = getCustomerId();
    if (!customerId) {
      throw new Error("Customer ID not configured");
    }

    const result = await apiRequest<Agreement[]>(
      `/v2/customers/${customerId}/domains/agreements?tlds=${tlds.join(",")}&privacy=${privacy}`
    );

    if (!result.ok) {
      throw new Error(`API Error: ${JSON.stringify(result.data)}`);
    }

    return result.data;
  },

  // Validate domain purchase request (dry run) - V2 API
  async validatePurchase(request: DomainPurchaseRequestV2): Promise<any> {
    const customerId = getCustomerId();
    if (!customerId) {
      throw new Error("Customer ID not configured");
    }

    const result = await apiRequest<any>(
      `/v2/customers/${customerId}/domains/register/validate`,
      "POST",
      request
    );

    return {
      valid: result.ok,
      status: result.status,
      data: result.data,
    };
  },

  // Purchase domain - V2 API
  async purchaseDomain(request: DomainPurchaseRequestV2): Promise<any> {
    const customerId = getCustomerId();
    if (!customerId) {
      throw new Error("Customer ID not configured");
    }

    const result = await apiRequest<any>(
      `/v2/customers/${customerId}/domains/register`,
      "POST",
      request
    );

    // 202 Accepted is success for registration
    if (!result.ok && result.status !== 202) {
      throw new Error(`Purchase failed: ${JSON.stringify(result.data)}`);
    }

    return result.data;
  },

  // Get domain details
  async getDomainDetails(domain: string): Promise<DomainDetails> {
    const customerId = getCustomerId();
    if (!customerId) {
      throw new Error("Customer ID not configured");
    }

    const result = await apiRequest<DomainDetails>(
      `/v2/customers/${customerId}/domains/${encodeURIComponent(domain)}?includes=contacts,nameServers`
    );

    if (!result.ok) {
      throw new Error(`API Error: ${JSON.stringify(result.data)}`);
    }

    return result.data;
  },

  // Update domain settings
  async updateDomain(
    domain: string,
    updates: {
      renewAuto?: boolean;
      privacy?: boolean;
      nameServers?: string[];
    }
  ): Promise<any> {
    const customerId = getCustomerId();
    if (!customerId) {
      throw new Error("Customer ID not configured");
    }

    const result = await apiRequest<any>(
      `/v2/customers/${customerId}/domains/${encodeURIComponent(domain)}`,
      "PATCH",
      updates
    );

    if (!result.ok) {
      throw new Error(`Update failed: ${JSON.stringify(result.data)}`);
    }

    return result.data;
  },

  // Renew domain
  async renewDomain(domain: string, period: number = 1): Promise<any> {
    const customerId = getCustomerId();
    if (!customerId) {
      throw new Error("Customer ID not configured");
    }

    const result = await apiRequest<any>(
      `/v2/customers/${customerId}/domains/${encodeURIComponent(domain)}/renew`,
      "POST",
      { period }
    );

    if (!result.ok) {
      throw new Error(`Renewal failed: ${JSON.stringify(result.data)}`);
    }

    return result.data;
  },

  // List owned domains
  async listOwnedDomains(limit: number = 100): Promise<any[]> {
    const customerId = getCustomerId();
    if (!customerId) {
      throw new Error("Customer ID not configured");
    }

    const result = await apiRequest<any[]>(
      `/v2/customers/${customerId}/domains?limit=${limit}`
    );

    if (!result.ok) {
      throw new Error(`API Error: ${JSON.stringify(result.data)}`);
    }

    return result.data;
  },

  // Delete/cancel domain (if allowed)
  async deleteDomain(domain: string): Promise<any> {
    const customerId = getCustomerId();
    if (!customerId) {
      throw new Error("Customer ID not configured");
    }

    const result = await apiRequest<any>(
      `/v2/customers/${customerId}/domains/${encodeURIComponent(domain)}`,
      "DELETE"
    );

    if (!result.ok) {
      throw new Error(`Delete failed: ${JSON.stringify(result.data)}`);
    }

    return result.data;
  },

  // Transfer domain in
  async initiateTransfer(
    domain: string,
    authCode: string,
    consent: DomainPurchaseRequest["consent"],
    contact: Contact
  ): Promise<any> {
    const customerId = getCustomerId();
    if (!customerId) {
      throw new Error("Customer ID not configured");
    }

    const result = await apiRequest<any>(
      `/v2/customers/${customerId}/domains/${encodeURIComponent(domain)}/transfer`,
      "POST",
      {
        authCode,
        consent,
        contactRegistrant: contact,
      }
    );

    if (!result.ok) {
      throw new Error(`Transfer failed: ${JSON.stringify(result.data)}`);
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

// ============ REMOTE SERVER API ============
// When useRemoteServer is enabled, calls go through the remote server
// instead of directly to the GoDaddy API. This simplifies credential management.

async function remoteApiRequest<T>(
  endpoint: string,
  method: string = "GET",
  body?: any
): Promise<{ status: number; data: T; ok: boolean }> {
  const baseUrl = getRemoteServerUrl();
  const apiKey = await getRemoteApiKeyAsync();
  const url = `${baseUrl}${endpoint}`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };

  if (apiKey) {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }

  const options: RequestInit = {
    method,
    headers,
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
    ok: response.ok,
  };
}

// Remote server API - proxies requests through the configured remote server
export const remoteApi = {
  async checkAvailability(domain: string): Promise<DomainAvailability> {
    const result = await remoteApiRequest<DomainAvailability>(
      `/check?domain=${encodeURIComponent(domain)}`
    );
    if (!result.ok) {
      throw new Error(`API Error: ${JSON.stringify(result.data)}`);
    }
    return result.data;
  },

  async getAgreements(tlds: string[], privacy: boolean = false): Promise<Agreement[]> {
    const result = await remoteApiRequest<Agreement[]>(
      `/agreements?tlds=${tlds.join(",")}&privacy=${privacy}`
    );
    if (!result.ok) {
      throw new Error(`API Error: ${JSON.stringify(result.data)}`);
    }
    return result.data;
  },

  async validatePurchase(request: DomainPurchaseRequestV2): Promise<any> {
    const result = await remoteApiRequest<any>("/validate", "POST", request);
    return {
      valid: result.ok,
      status: result.status,
      data: result.data,
    };
  },

  async purchaseDomain(request: DomainPurchaseRequestV2): Promise<any> {
    const result = await remoteApiRequest<any>("/purchase", "POST", request);
    if (!result.ok && result.status !== 202) {
      throw new Error(`Purchase failed: ${JSON.stringify(result.data)}`);
    }
    return result.data;
  },

  async listOwnedDomains(limit: number = 100): Promise<any[]> {
    const result = await remoteApiRequest<any[]>(`/list?limit=${limit}`);
    if (!result.ok) {
      throw new Error(`API Error: ${JSON.stringify(result.data)}`);
    }
    return result.data;
  },

  async getDomainDetails(domain: string): Promise<DomainDetails> {
    const result = await remoteApiRequest<DomainDetails>(
      `/info?domain=${encodeURIComponent(domain)}`
    );
    if (!result.ok) {
      throw new Error(`API Error: ${JSON.stringify(result.data)}`);
    }
    return result.data;
  },

  async updateDomain(
    domain: string,
    updates: { renewAuto?: boolean; privacy?: boolean; nameServers?: string[] }
  ): Promise<any> {
    const result = await remoteApiRequest<any>(
      `/update?domain=${encodeURIComponent(domain)}`,
      "PUT",
      updates
    );
    if (!result.ok) {
      throw new Error(`Update failed: ${JSON.stringify(result.data)}`);
    }
    return result.data;
  },

  async renewDomain(domain: string, period: number = 1): Promise<any> {
    const result = await remoteApiRequest<any>("/renew", "POST", { domain, period });
    if (!result.ok) {
      throw new Error(`Renewal failed: ${JSON.stringify(result.data)}`);
    }
    return result.data;
  },
};

// Smart API that automatically chooses between direct and remote based on config
export const domainApi = {
  checkAvailability: (domain: string, forTransfer?: boolean) =>
    useRemoteServer()
      ? remoteApi.checkAvailability(domain)
      : purchaseApi.checkAvailability(domain, forTransfer),

  getAgreements: (tlds: string[], privacy?: boolean) =>
    useRemoteServer()
      ? remoteApi.getAgreements(tlds, privacy)
      : purchaseApi.getAgreements(tlds, privacy),

  validatePurchase: (request: DomainPurchaseRequestV2) =>
    useRemoteServer()
      ? remoteApi.validatePurchase(request)
      : purchaseApi.validatePurchase(request),

  purchaseDomain: (request: DomainPurchaseRequestV2) =>
    useRemoteServer()
      ? remoteApi.purchaseDomain(request)
      : purchaseApi.purchaseDomain(request),

  listOwnedDomains: (limit?: number) =>
    useRemoteServer()
      ? remoteApi.listOwnedDomains(limit)
      : purchaseApi.listOwnedDomains(limit),

  getDomainDetails: (domain: string) =>
    useRemoteServer()
      ? remoteApi.getDomainDetails(domain)
      : purchaseApi.getDomainDetails(domain),

  updateDomain: (domain: string, updates: any) =>
    useRemoteServer()
      ? remoteApi.updateDomain(domain, updates)
      : purchaseApi.updateDomain(domain, updates),

  renewDomain: (domain: string, period?: number) =>
    useRemoteServer()
      ? remoteApi.renewDomain(domain, period)
      : purchaseApi.renewDomain(domain, period),
};
