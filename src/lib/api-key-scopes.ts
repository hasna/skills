export const API_KEY_SCOPES = [
  "skills:read",
  "runs:read",
  "runs:write",
  "artifacts:read",
] as const;

export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];
