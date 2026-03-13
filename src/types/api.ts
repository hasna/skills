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
  installed: boolean;
  envVars: string[];
  envVarsSet: string[];
  systemDeps: string[];
  cliCommand: string | null;
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

export interface InstallResponse {
  skill: string;
  success: boolean;
  error?: string;
  results?: Array<{ skill: string; success: boolean; error?: string }>;
}

export interface RemoveResponse {
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

export interface CategoryInstallResponse {
  category: string;
  count: number;
  success: boolean;
  results: Array<{ skill: string; success: boolean; error?: string }>;
}

export interface ErrorResponse {
  error: string;
}
