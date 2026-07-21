import { getApiKey as getStoredApiKey, getApiUrl } from "./auth-store.js";
import { normalizeRemoteSkillRunContract, type RemoteSkillRunContract } from "./remote-run-contract.js";
import { toAuthoritativePublicCreditQuote, toCustomerCreditPayload } from "./public-credits.js";
import { addSkillsProtocolHeaders } from "./remote-protocol.js";
import {
  sanitizeCustomerArtifactDownload,
  sanitizeCustomerArtifactList,
  sanitizeCustomerExecutionLogs,
} from "./customer-artifacts.js";

export interface RemoteRunAuthorization {
  quoteToken?: string;
  approved?: boolean;
}

export class RemoteSkillsClient {
  private apiUrl: string;
  private apiKey: string;

  constructor(apiKey: string, apiUrl = getApiUrl()) {
    this.apiKey = apiKey;
    this.apiUrl = apiUrl.replace(/\/$/, "");
  }

  private async request(path: string, options?: RequestInit): Promise<Response> {
    const headers = new Headers(options?.headers);
    headers.set("Authorization", `Bearer ${this.apiKey}`);
    headers.set("Content-Type", "application/json");
    return fetch(`${this.apiUrl}${path}`, {
      ...options,
      headers: addSkillsProtocolHeaders(headers),
    });
  }

  async listSkills(): Promise<any[]> {
    const res = await this.request("/api/v1/skills");
    return this.customerJson<any[]>(res);
  }

  async getSkillMd(slug: string): Promise<string | null> {
    const res = await this.request(`/api/v1/skills/${slug}/skill.md`);
    if (!res.ok) return null;
    return res.text();
  }

  async getSkill(slug: string): Promise<any | null> {
    const res = await this.request(`/api/v1/skills/${slug}`);
    if (!res.ok) return null;
    return this.customerJson(res);
  }

  async quoteSkill(slug: string, input?: Record<string, unknown>, args?: string[]): Promise<any> {
    const res = await this.request(`/api/v1/skills/${slug}/quote`, {
      method: "POST",
      body: JSON.stringify({ input, args }),
    });
    const payload = await this.customerJson<Record<string, unknown>>(res);
    if (payload.creditQuote !== undefined) {
      payload.creditQuote = toAuthoritativePublicCreditQuote(payload.creditQuote);
    }
    return payload;
  }

  async submitRun(
    slug: string,
    input?: Record<string, unknown>,
    args?: string[],
    authorization: RemoteRunAuthorization = {},
  ): Promise<RemoteSkillRunContract> {
    const res = await this.request(`/api/v1/runs/${slug}`, {
      method: "POST",
      body: JSON.stringify({ input, args, ...authorization }),
    });
    return normalizeRemoteSkillRunContract(await res.json(), slug);
  }

  async getRun(runId: string): Promise<RemoteSkillRunContract | null> {
    const res = await this.request(`/api/v1/runs/${runId}`);
    if (!res.ok) return null;
    return normalizeRemoteSkillRunContract(await res.json());
  }

  async getRunLogs(runId: string): Promise<any[]> {
    const res = await this.request(`/api/v1/runs/${runId}/logs`);
    if (!res.ok) return [];
    return sanitizeCustomerExecutionLogs(await res.json());
  }

  async listRuns(limit = 20): Promise<any[]> {
    const res = await this.request(`/api/v1/runs?limit=${limit}`);
    return this.customerJson<any[]>(res);
  }

  async getRunArtifacts(runId: string): Promise<any[]> {
    const res = await this.request(`/api/v1/runs/${runId}/artifacts`);
    return sanitizeCustomerArtifactList(await res.json());
  }

  async downloadRunArtifact(runId: string, artifactId: string, artifact?: unknown): Promise<Response> {
    const response = await this.request(`/api/v1/runs/${runId}/artifacts/${artifactId}/download`, {
      method: "GET",
    });
    return sanitizeCustomerArtifactDownload(response, artifact);
  }

  private async customerJson<T = any>(response: Response): Promise<T> {
    return toCustomerCreditPayload(await response.json()) as T;
  }

}

export function createRemoteSkillsClient(): RemoteSkillsClient | null {
  const apiKey = getStoredApiKey();
  if (!apiKey) return null;
  return new RemoteSkillsClient(apiKey);
}
