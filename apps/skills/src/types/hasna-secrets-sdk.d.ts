/**
 * SH-00058. @hasna/secrets is an optional dependency that only an install with
 * access to it receives, so Skills must typecheck without it. This declares only
 * the part of its SDK entry Skills uses (SecretsSdk in src/lib/execution-secrets.ts).
 * Where the package is installed, TypeScript resolves its real types instead, and
 * src/lib/secrets-sdk-types.test.ts checks this declaration against them.
 */
declare module "@hasna/secrets/sdk" {
  export function createSecretsClientFromEnv(env?: Record<string, string | undefined>): {
    readonly baseUrl: string;
    getSecret(query: { key: string }, init?: RequestInit): Promise<{ key: string; value: string; expires_at?: string | null }>;
  };
}
