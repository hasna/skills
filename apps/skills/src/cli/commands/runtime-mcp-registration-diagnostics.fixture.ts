// Test-only projection: never return captured messages, config, paths or commands.
export const firstRunModes = ["claude-first-run", "claude-first-run-no-userid", ...["invalid-userid", "unknown", "wrong-server", "unrelated-server", "concurrent-creator", "policy-refused", "native-refusal-after-write", "dangling-link", "config-dir-alias", "post-symlink", "post-hardlink", "parent-drift", "late-lock"].map(kind => `claude-first-run-${kind}`)];
export const bootstrapModes = ["claude-native-bootstrap", "claude-native-bootstrap-existing", "claude-native-bootstrap-unknown",
  "claude-native-bootstrap-existing-change", "claude-native-bootstrap-userid", "claude-native-bootstrap-existing-userid-change", "claude-native-bootstrap-existing-remove", "claude-native-bootstrap-unrelated-change",
  "claude-native-bootstrap-wrong-server", "claude-native-bootstrap-existing-theme-drop", "claude-native-bootstrap-no-skills-entry",
  "claude-native-bootstrap-existing-exit1", "claude-native-bootstrap-existing-concurrent", "claude-native-bootstrap-existing-hardlink",
  "claude-native-bootstrap-existing-concurrent-logout", "claude-native-bootstrap-existing-exit1-no-add", ...["firstStartTime", "firstStartVersion", "machineID", "opusProMigrationComplete",
    "sonnet1m45MigrationComplete", "seenNotifications", "hasResetAutoModeOptInForDefaultOffer", "migrationVersion"]
    .map(field => `claude-native-bootstrap-invalid-${field}`)];
export const registrationModes = [...firstRunModes, ...bootstrapModes, "profile", "environment-profile", "transient", "default", "claude-native", "claude-config-dir", "claude-custom-oauth", "claude-legacy", "claude-unavailable", "claude-drift", "claude-locked", "claude-late-lock", "claude-policy-refused", "claude-blocked", "claude-unknown-refusal", "claude-spawn-refused", "setup", "auth", "gateway", "bad-url", "aliases", "invalid-toml"];
const agents = ["claude", "codex", "gemini", "pi", "opencode", "cursor", "windsurf"] as const;
const refusalMessages = {
  ACCESS_METADATA_UNAVAILABLE: "configuration access metadata could not be verified or preserved",
  UNSAFE_PATH: "refused an unsafe or unowned configuration path",
  OWNERSHIP_UNAVAILABLE: "configuration ownership cannot be verified on this platform",
  LOCKED: "configuration is locked; no foreign lock was removed",
  INVALID_CONFIG: "existing configuration is invalid",
  BACKUP_FAILED: "could not preserve and verify the original configuration",
  WRITE_FAILED: "could not prepare the replacement configuration",
  CONFIG_CHANGED: "configuration or its path changed during registration",
  VERIFY_FAILED: "could not verify the committed configuration; retain the backup for recovery",
  UPDATE_REFUSED: "configuration update was refused",
} as const;
type Refusal = keyof typeof refusalMessages | "CLAUDE_REFUSED" | "UNKNOWN" | "NONE";
type Agent = typeof agents[number];
type Entry = { agent: Agent; success: boolean; refusal: Refusal; argsChecked: boolean; argsPresent: boolean; argsMatch: boolean };
type Diagnostic = { mode: string; exitMatches: boolean; resultsAvailable: boolean; agents: Entry[] };
const marker = "SKILLS_MCP_FIXTURE_DIAGNOSTIC ";
const validId = (id: string) => id.length === 36 && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id);
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const exactKeys = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).sort().join(",") === keys.sort().join(",");
export const registrationArgsMatch = (args: unknown): boolean => Array.isArray(args) && args.length === 1 && args[0] === "--stdio";

function refusalCategory(agent: Agent, success: boolean, error: unknown): Refusal {
  if (success) return "NONE";
  if (agent === "claude") return error === "Could not safely update the Claude user MCP configuration; native admission or config checks refused the update" ? "CLAUDE_REFUSED" : "UNKNOWN";
  const prefix = agent === "codex" ? "Could not safely update the Codex MCP configuration: "
    : agent === "opencode" ? "Could not safely update the OpenCode MCP configuration: " : "Could not safely update the agent MCP configuration: ";
  for (const [category, message] of Object.entries(refusalMessages)) {
    if (error === prefix + message) return category as keyof typeof refusalMessages;
  }
  return "UNKNOWN";
}

export function registrationFailureLine(input: {
  mode: string; id: string; logs: string; exitMatches: boolean; args?: { agent: string; value: unknown };
}): string | undefined {
  if (input.exitMatches && (!input.args || registrationArgsMatch(input.args.value))) return undefined;
  if (!registrationModes.includes(input.mode) || !validId(input.id)
    || (input.args && !agents.includes(input.args.agent as Agent))) return undefined;
  let results: Record<string, unknown>[] | undefined;
  try {
    // These private logs include config and command fields. Project only the
    // seven exact agent identities, success booleans and known static refusals.
    const parsed: unknown = input.logs.length <= 256 * 1024 ? JSON.parse(input.logs) : undefined;
    const candidate = object(parsed) ? parsed.results : undefined;
    if (Array.isArray(candidate) && candidate.length === agents.length
      && agents.every(agent => candidate.filter((entry: unknown) => object(entry) && entry.agent === agent && typeof entry.success === "boolean").length === 1)) {
      results = candidate as Record<string, unknown>[];
    }
  } catch { /* Missing or malformed results are represented by a boolean only. */ }
  const diagnostic: Diagnostic = { mode: input.mode, exitMatches: input.exitMatches, resultsAvailable: results !== undefined,
    agents: results ? agents.map(agent => {
      const result = results!.find(entry => entry.agent === agent)!;
      const argsChecked = input.args?.agent === agent;
      return { agent, success: result.success as boolean, refusal: refusalCategory(agent, result.success as boolean, result.error),
        argsChecked, argsPresent: argsChecked && input.args!.value !== undefined, argsMatch: argsChecked && registrationArgsMatch(input.args!.value) };
    }) : [] };
  return marker + input.id + " " + JSON.stringify(diagnostic);
}

// The invocation ID prevents accepting a marker copied from another fixture.
// Reconstruct every field after validation; never echo the matched raw line.
export function readRegistrationFailure(stderr: string, mode: string, id: string): Diagnostic | undefined {
  if (stderr.length > 64 * 1024 || !registrationModes.includes(mode) || !validId(id)) return undefined;
  const prefix = marker + id + " ";
  if (!stderr.startsWith(prefix) || stderr.indexOf(marker, marker.length) !== -1) return undefined;
  const line = stderr.split("\n", 1)[0]!;
  if (line.length > 4096) return undefined;
  try {
    const encoded = line.slice(prefix.length), data: unknown = JSON.parse(encoded);
    if (!object(data) || !exactKeys(data, ["mode", "exitMatches", "resultsAvailable", "agents"])
      || data.mode !== mode || typeof data.exitMatches !== "boolean" || typeof data.resultsAvailable !== "boolean"
      || !Array.isArray(data.agents) || data.agents.length !== (data.resultsAvailable ? agents.length : 0)
      || JSON.stringify(data) !== encoded) return undefined;
    const entries: Entry[] = [];
    for (let index = 0; index < data.agents.length; index++) {
      const entry: unknown = data.agents[index];
      if (!object(entry) || !exactKeys(entry, ["agent", "success", "refusal", "argsChecked", "argsPresent", "argsMatch"])
        || entry.agent !== agents[index] || typeof entry.success !== "boolean" || typeof entry.argsChecked !== "boolean"
        || typeof entry.argsPresent !== "boolean" || typeof entry.argsMatch !== "boolean"
        || typeof entry.refusal !== "string" || ![...Object.keys(refusalMessages), "CLAUDE_REFUSED", "UNKNOWN", "NONE"].includes(entry.refusal)
        || (entry.success ? entry.refusal !== "NONE" : entry.refusal === "NONE")
        || (!entry.argsChecked && (entry.argsPresent || entry.argsMatch)) || (entry.argsMatch && !entry.argsPresent)) return undefined;
      entries.push({ agent: agents[index]!, success: entry.success, refusal: entry.refusal as Refusal,
        argsChecked: entry.argsChecked, argsPresent: entry.argsPresent, argsMatch: entry.argsMatch });
    }
    if (entries.filter(entry => entry.argsChecked).length > 1
      || (data.exitMatches && !entries.some(entry => entry.argsChecked && !entry.argsMatch))) return undefined;
    return { mode, exitMatches: data.exitMatches, resultsAvailable: data.resultsAvailable, agents: entries };
  } catch { return undefined; }
}

// A malformed success receipt must not make the test runner print raw stdout.
export function readRegistrationReceipt(stdout: string, mode: string) {
  if (stdout.length > 4096 || !registrationModes.includes(mode)) return undefined;
  try {
    const data: unknown = JSON.parse(stdout);
    const flags = ["refused", "consumerSelectionVerified", "stdioSelected", "unrelatedEntriesPreserved", "credentialsUnchanged", "credentialsNotDisclosed"];
    if (!object(data) || !exactKeys(data, ["mode", "adapters", ...flags, "networkCalls", "mockedAuthRequests"])
      || data.mode !== mode || !flags.every(key => typeof data[key] === "boolean")
      || typeof data.adapters !== "number" || !Number.isInteger(data.adapters) || data.adapters < 0 || data.adapters > 7
      || ![0, 1].includes(data.networkCalls as number) || ![0, 1].includes(data.mockedAuthRequests as number)) return undefined;
    return { mode, adapters: data.adapters, refused: data.refused as boolean, consumerSelectionVerified: data.consumerSelectionVerified as boolean,
      stdioSelected: data.stdioSelected as boolean, unrelatedEntriesPreserved: data.unrelatedEntriesPreserved as boolean,
      credentialsUnchanged: data.credentialsUnchanged as boolean, credentialsNotDisclosed: data.credentialsNotDisclosed as boolean,
      networkCalls: data.networkCalls as number, mockedAuthRequests: data.mockedAuthRequests as number };
  } catch { return undefined; }
}
