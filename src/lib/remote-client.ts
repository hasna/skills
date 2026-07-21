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
  private artifactDescriptors = new Map<string, Readonly<Record<string, unknown>>>();
  private artifactListEpochs = new Map<string, number>();

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
    const prefix = `${runId}\u0000`;
    const epoch = (this.artifactListEpochs.get(runId) ?? 0) + 1;
    this.artifactListEpochs.set(runId, epoch);
    for (const key of this.artifactDescriptors.keys()) {
      if (key.startsWith(prefix)) this.artifactDescriptors.delete(key);
    }

    const res = await this.request(`/api/v1/runs/${runId}/artifacts`);
    if (!res.ok) return [];

    let payload: unknown;
    try {
      payload = await res.json();
    } catch {
      return [];
    }
    const artifacts = sanitizeCustomerArtifactList(payload);
    if (this.artifactListEpochs.get(runId) !== epoch) return [];
    for (const artifact of artifacts) {
      if (artifact && typeof artifact === "object" && typeof (artifact as Record<string, unknown>).id === "string") {
        const descriptor = immutableArtifactDescriptor(artifact as Record<string, unknown>);
        this.artifactDescriptors.set(`${prefix}${descriptor.id}`, descriptor);
      }
    }
    return structuredClone(artifacts);
  }

  async downloadRunArtifact(runId: string, artifactId: string, _artifact?: unknown): Promise<Response> {
    const descriptorKey = `${runId}\u0000${artifactId}`;
    const descriptorEpoch = this.artifactListEpochs.get(runId);
    const descriptor = this.artifactDescriptors.get(descriptorKey);
    const response = await this.request(`/api/v1/runs/${runId}/artifacts/${artifactId}/download`, {
      method: "GET",
    });
    const descriptorIsCurrent = this.artifactListEpochs.get(runId) === descriptorEpoch
      && this.artifactDescriptors.get(descriptorKey) === descriptor;
    return sanitizeCustomerArtifactDownload(
      response,
      descriptorIsCurrent ? descriptor : undefined,
      { runId, artifactId },
    );
  }

  private async customerJson<T = any>(response: Response): Promise<T> {
    return toCustomerCreditPayload(await response.json()) as T;
  }

}

function immutableArtifactDescriptor(
  value: Record<string, unknown>,
): Readonly<Record<string, unknown>> {
  return deepFreeze(structuredClone(value));
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}

export function createRemoteSkillsClient(): RemoteSkillsClient | null {
  const apiKey = getStoredApiKey();
  if (!apiKey) return null;
  return new RemoteSkillsClient(apiKey);
}
