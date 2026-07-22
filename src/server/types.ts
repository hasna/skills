export const SERVER_RUN_STATUSES = [
  "queued",
  "waiting_for_approval",
  "running",
  "succeeded",
  "failed",
  "cancel_requested",
  "cancelled",
  "retrying",
  "expired",
  "refunded",
] as const;

export type ServerRunStatus = (typeof SERVER_RUN_STATUSES)[number];

export interface ApiPrincipal {
  apiKeyId: string;
  orgId: string;
  orgSlug: string;
  orgName: string;
  userId: string;
  email: string;
  role: string;
  scopes: string[];
}

export interface ServerRunRecord {
  id: string;
  orgId: string;
  userId: string;
  skill: string;
  requestedSlug: string;
  status: ServerRunStatus;
  input: Record<string, unknown>;
  args: string[];
  idempotencyKey?: string;
  requestFingerprint?: string;
  correlationId: string;
  outputType?: string;
  outputPreview?: string;
  errorCode?: string;
  errorMessage?: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
}

export interface ServerRunLog {
  runId: string;
  sequence: number;
  level: "debug" | "info" | "warn" | "error";
  message: string;
  createdAt: string;
}

export interface ServerArtifact {
  id: string;
  runId: string;
  orgId: string;
  fileName: string;
  relativePath: string;
  contentType: string;
  byteSize: number;
  sha256: string;
  storageKind: "db" | "s3";
  storageKey?: string;
  bodyText?: string;
  createdAt: string;
}

export interface CreateRunInput {
  principal: ApiPrincipal;
  slug: string;
  requestedSlug?: string;
  input: Record<string, unknown>;
  args: string[];
  idempotencyKey?: string;
  quoteToken?: string;
  approved?: boolean;
}

export class IdempotencyKeyReuseError extends Error {
  readonly code = "IDEMPOTENCY_KEY_REUSED";

  constructor() {
    super("This idempotency key was already used for a different run request.");
    this.name = "IdempotencyKeyReuseError";
  }
}

export interface CreateRunResult {
  run: ServerRunRecord;
  created: boolean;
}

export interface ClaimRunInput {
  workerId: string;
}

export interface RunExecutionClaim {
  run: ServerRunRecord;
  claimed: true;
}

export type RunStartResult = RunExecutionClaim | { run: ServerRunRecord; claimed: false };

export type RunOutcomePatch = {
  status: Extract<ServerRunStatus, "succeeded" | "failed">;
} & Partial<Pick<ServerRunRecord, "outputType" | "outputPreview" | "errorCode" | "errorMessage" | "completedAt">>;

export interface SkillsProductStore {
  authenticateApiKeyHash(hash: string): Promise<ApiPrincipal | null>;
  ensureBootstrapApiKey?(token: string, principal?: Partial<ApiPrincipal>): Promise<void>;
  createRun(input: CreateRunInput): Promise<CreateRunResult>;
  listRuns(principal: ApiPrincipal, limit: number): Promise<ServerRunRecord[]>;
  getRun(principal: ApiPrincipal, runId: string): Promise<ServerRunRecord | null>;
  claimNextRun(input: ClaimRunInput): Promise<RunExecutionClaim | null>;
  startRun(runId: string): Promise<RunStartResult | null>;
  requestCancellation(principal: ApiPrincipal, runId: string): Promise<ServerRunRecord | null>;
  finishRun(runId: string, patch: RunOutcomePatch): Promise<ServerRunRecord | null>;
  appendLog(runId: string, orgId: string, level: ServerRunLog["level"], message: string): Promise<ServerRunLog>;
  listLogs(principal: ApiPrincipal, runId: string): Promise<ServerRunLog[]>;
  addArtifact(artifact: Omit<ServerArtifact, "createdAt">): Promise<ServerArtifact>;
  listArtifacts(principal: ApiPrincipal, runId: string): Promise<ServerArtifact[]>;
  getArtifact(principal: ApiPrincipal, runId: string, artifactId: string): Promise<ServerArtifact | null>;
}
