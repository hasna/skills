/** Native capabilities measured against exact Codex releases. The transport
 * still verifies executable trust, the native version handshake and each RPC
 * response. Unknown releases require the native acceptance tests before entry.
 */
const MEASURED_CODEX_CAPABILITIES: Readonly<Record<string, readonly CodexNativeCapability[]>> = {
  "codex-cli 0.153.0": ["hooks"],
  "codex-cli 0.154.0": ["hooks"],
  "codex-cli 0.155.0": ["hooks"],
  "codex-cli 0.155.1": ["hooks"],
  "codex-cli 0.156.1": ["hooks"],
  "codex-cli 0.157.0": ["hooks"],
  "codex-cli 0.157.1": ["hooks"],
  "codex-cli 0.158.0": ["hooks"],
  "codex-cli 0.159.0": ["hooks"],
  "codex-cli 0.159.2": ["hooks", "qualified-skill-catalog"],
  "codex-cli 0.160.0": ["hooks", "qualified-skill-catalog"],
};

export type CodexNativeCapability = "hooks" | "qualified-skill-catalog";

export function supportsCodexNativeCapability(version: unknown, capability: CodexNativeCapability): boolean {
  return typeof version === "string" && Object.hasOwn(MEASURED_CODEX_CAPABILITIES, version)
    && MEASURED_CODEX_CAPABILITIES[version]!.includes(capability);
}

export const SUPPORTED_CODEX_HOOK_VERSIONS = Object.freeze(Object.keys(MEASURED_CODEX_CAPABILITIES)
  .filter(version => supportsCodexNativeCapability(version, "hooks")));
