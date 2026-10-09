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
  "codex-cli 0.160.0": ["hooks", "qualified-skill-catalog", "installed-plugin-review"],
  // rust-v0.160.1 (d27764b8) is the 0.160.0 content commit plus one remote
  // stdio MCP environment backport (#51121); its app-server protocol schema is
  // byte-identical and its native catalog acceptance test passes.
  "codex-cli 0.160.1": ["hooks", "qualified-skill-catalog", "installed-plugin-review"],
  // Exact 0.161.0 binary measured through the hook and skill catalog acceptance
  // paths; neighbouring releases remain unsupported. Native corpus admission
  // is independently required and is not granted by this entry.
  "codex-cli 0.161.0": ["hooks", "qualified-skill-catalog", "installed-plugin-review"],
  // Exact 0.162.0 protocol acceptance covers hooks, native catalog capture
  // and installed-plugin review. Native corpus admission remains separate.
  "codex-cli 0.162.0": ["hooks", "qualified-skill-catalog", "installed-plugin-review"],
};

/** `installed-plugin-review`: the 0.160 `plugin/installed` source identities and
 * plugin loader semantics behind local installation inputs, inert disabled
 * nonremote plugins and remote refresh denials. */
export type CodexNativeCapability = "hooks" | "qualified-skill-catalog" | "installed-plugin-review";

export function supportsCodexNativeCapability(version: unknown, capability: CodexNativeCapability): boolean {
  return typeof version === "string" && Object.hasOwn(MEASURED_CODEX_CAPABILITIES, version)
    && MEASURED_CODEX_CAPABILITIES[version]!.includes(capability);
}

export const SUPPORTED_CODEX_HOOK_VERSIONS = Object.freeze(Object.keys(MEASURED_CODEX_CAPABILITIES)
  .filter(version => supportsCodexNativeCapability(version, "hooks")));
