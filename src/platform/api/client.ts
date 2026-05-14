import { getApiKey as getStoredApiKey, getApiUrl } from "../../lib/auth-store.js";
import { normalizeRemoteSkillRunContract, type RemoteSkillRunContract } from "./run-contract.js";

export class PlatformClient {
  private apiUrl: string;
  private apiKey: string;

  constructor(apiKey: string, apiUrl = getApiUrl()) {
    this.apiKey = apiKey;
    this.apiUrl = apiUrl.replace(/\/$/, "");
  }

  private async request(path: string, options?: RequestInit): Promise<Response> {
    return fetch(`${this.apiUrl}${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        ...options?.headers,
      },
    });
  }

  async listSkills(): Promise<any[]> {
    const res = await this.request("/api/v1/skills");
    return res.json();
  }

  async getSkillMd(slug: string): Promise<string | null> {
    const res = await this.request(`/api/v1/skills/${slug}/skill.md`);
    if (!res.ok) return null;
    return res.text();
  }

  async getSkill(slug: string): Promise<any | null> {
    const res = await this.request(`/api/v1/skills/${slug}`);
    if (!res.ok) return null;
    return res.json();
  }

  async quoteSkill(slug: string, input?: Record<string, unknown>, args?: string[]): Promise<any> {
    const res = await this.request(`/api/v1/skills/${slug}/quote`, {
      method: "POST",
      body: JSON.stringify({ input, args }),
    });
    return res.json();
  }

  async submitRun(slug: string, input?: Record<string, unknown>, args?: string[]): Promise<RemoteSkillRunContract> {
    const res = await this.request(`/api/v1/runs/${slug}`, {
      method: "POST",
      body: JSON.stringify({ input, args }),
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
    const payload = await res.json();
    return Array.isArray(payload) ? payload : [];
  }

  async listRuns(limit = 20): Promise<any[]> {
    const res = await this.request(`/api/v1/runs?limit=${limit}`);
    return res.json();
  }

  async getRunArtifacts(runId: string): Promise<any[]> {
    const res = await this.request(`/api/v1/runs/${runId}/artifacts`);
    return res.json();
  }

  async downloadRunArtifact(runId: string, artifactId: string): Promise<Response> {
    return this.request(`/api/v1/runs/${runId}/artifacts/${artifactId}/download`, {
      method: "GET",
    });
  }

  async getBillingStatus(): Promise<any> {
    const res = await this.request("/api/v1/billing/status");
    return res.json();
  }

  async createCheckout(): Promise<{ url: string }> {
    const res = await this.request("/api/v1/billing/checkout", { method: "POST" });
    return res.json();
  }

  async createPortal(): Promise<{ url: string }> {
    const res = await this.request("/api/v1/billing/portal", { method: "POST" });
    return res.json();
  }

  async createCreditCheckout(amount: "1" | "5" | "20" | "50" | "100"): Promise<{ url: string; pack: string }> {
    const res = await this.request("/api/v1/billing/credits", {
      method: "POST",
      body: JSON.stringify({ amount }),
    });
    return res.json();
  }

  async syncUpstream(): Promise<any> {
    const res = await this.request("/api/v1/admin/sync", { method: "POST" });
    return res.json();
  }
}

export function createPlatformClient(): PlatformClient | null {
  const apiKey = getStoredApiKey();
  if (!apiKey) return null;
  return new PlatformClient(apiKey);
}
