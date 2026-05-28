/**
 * Shared API response types used by both the HTTP server and the dashboard.
 * Import from "@hasna/skills" to get type-safe API responses.
 */

export interface SkillResponse {
  name: string;
  displayName: string;
  description: string;
  category: string;
  tags: string[];
  pinned: boolean;
  envVars: string[];
  envVarsSet: string[];
  systemDeps: string[];
  cliCommand: string | null;
  source?: "official" | "custom" | "remote";
}

export interface SkillDetailResponse extends SkillResponse {
  docs: string | null;
}

export interface CategoryResponse {
  name: string;
  count: number;
}

export interface TagResponse {
  name: string;
  count: number;
}

export interface PinResponse {
  skill: string;
  success: boolean;
  error?: string;
  results?: Array<{ skill: string; success: boolean; error?: string }>;
}

export interface UnpinResponse {
  skill: string;
  success: boolean;
}

export interface VersionResponse {
  version: string;
  name: string;
}

export interface ExportResponse {
  version: number;
  skills: string[];
  timestamp: string;
}

export interface ImportResponse {
  imported: number;
  total: number;
  results: Array<{ skill: string; success: boolean; error?: string }>;
}

export interface SearchResponse extends SkillResponse {}

export interface CategoryPinResponse {
  category: string;
  count: number;
  success: boolean;
  results: Array<{ skill: string; success: boolean; error?: string }>;
}

export type InstallResponse = PinResponse;
export type RemoveResponse = UnpinResponse;
export type CategoryInstallResponse = CategoryPinResponse;

export interface ErrorResponse {
  error: string;
}
