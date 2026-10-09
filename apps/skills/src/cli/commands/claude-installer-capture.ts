import { closeSync, constants, fstatSync, lstatSync, openSync, readSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { captureClaudeMarketplaceRegistry, captureClaudeMarketplaceRegistryV2 } from "../../lib/claude-marketplace-registry.js";
import { captureClaudePluginManifestFile } from "../../lib/claude-plugin-manifest-witness.js";
import { captureClaudeSettings, captureClaudeSettingsV2, captureClaudeSettingsV3, captureClaudeSettingsV4 } from "../../lib/claude-settings-witness.js";
import { captureClaudeInstallerCandidate } from "../../lib/claude-prospective-review.js";
import { captureDiscoveryDirectories, captureDiscoveryPathSources } from "../../lib/agent-discovery.js";
import { captureManagedPluginRegistry } from "../../lib/plugin-discovery.js";
import { captureSkillsCliProducerIdentity } from "../../lib/codex-hook-trust-identity.js";

const REQUEST_SCHEMA = "skills.claude-installer-capture/v1";
const RESULT_SCHEMA = "skills.claude-installer-capture-result/v1";
const MAX_REQUEST_BYTES = 64 * 1024;
type JsonObject = Record<string, unknown>;

class CaptureRefusal extends Error {}
function need(condition: unknown, code: string): asserts condition {
  if (!condition) throw new CaptureRefusal(code);
}
function object(value: unknown): value is JsonObject {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function exactKeys(value: JsonObject, expected: readonly string[], operation: string): void {
  if (Object.keys(value).length !== expected.length || !expected.every(key => Object.hasOwn(value, key))) {
    throw new CaptureRefusal(`INVALID_REQUEST_FIELDS: ${operation} requires exactly these fields: ${expected.join(", ")}`);
  }
}
function canonicalPath(value: unknown): asserts value is string {
  need(typeof value === "string" && isAbsolute(value) && resolve(value) === value && !/[\x00-\x1f\x7f]/.test(value), "INVALID_PATH: path fields must be normalized absolute paths without control characters");
}
function readRequest(path: string): unknown {
  canonicalPath(path);
  const before = lstatSync(path, { throwIfNoEntry: false });
  if (!before?.isFile() || before.isSymbolicLink() || before.size > MAX_REQUEST_BYTES) throw new CaptureRefusal("INVALID_REQUEST_FILE: --request must name a regular non-symlink JSON file no larger than 64 KiB");
  const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | constants.O_NONBLOCK);
  try {
    const opened = fstatSync(fd);
    need(opened.isFile() && opened.dev === before.dev && opened.ino === before.ino && opened.size === before.size, "INVALID_REQUEST_FILE: --request must remain the same regular file while read");
    const bytes = Buffer.alloc(MAX_REQUEST_BYTES + 1);
    let length = 0;
    while (length < bytes.length) {
      const count = readSync(fd, bytes, length, bytes.length - length, null);
      if (!count) break;
      length += count;
    }
    const after = fstatSync(fd), current = lstatSync(path);
    need(length <= MAX_REQUEST_BYTES && length === opened.size && after.size === opened.size && after.mtimeMs === opened.mtimeMs && after.ctimeMs === opened.ctimeMs && current.dev === opened.dev && current.ino === opened.ino && current.mtimeMs === opened.mtimeMs && current.ctimeMs === opened.ctimeMs, "INVALID_REQUEST_FILE: --request must remain unchanged while read");
    try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, length))); }
    catch { throw new CaptureRefusal("INVALID_REQUEST_JSON: --request must contain one valid UTF-8 JSON object"); }
  } finally { closeSync(fd); }
}
function paths(value: unknown): string[] {
  need(Array.isArray(value) && value.length <= 4096, "INVALID_PATHS: paths must be an ordered array of at most 4096 normalized absolute paths");
  for (const path of value) canonicalPath(path);
  return value;
}
function captureOwned(operation: string, operationCapture: () => unknown): unknown {
  try { return operationCapture(); }
  catch (error) {
    if (error instanceof CaptureRefusal) throw error;
    const messages: Record<string, string> = {
      settings: "SETTINGS_CAPTURE_REJECTED: path must be an unchanged regular Claude settings file accepted by the selected claude-settings-v1 through v4 witness",
      "marketplace-registry": "MARKETPLACE_REGISTRY_REJECTED: path must be an unchanged known_marketplaces.json accepted by the selected registry witness",
      "managed-plugin-registry": "MANAGED_PLUGIN_REGISTRY_REJECTED: path and managedPlugins must identify a valid installed registry plus non-empty {bindingId,storeRoot} admission witnesses",
      "path-bytes": "PATH_BYTES_CAPTURE_REJECTED: paths must be an ordered list of canonical source paths accepted by the path-bytes witness",
      "discovery-directories": "DIRECTORY_CAPTURE_REJECTED: paths must be an ordered list of canonical readable discovery directories",
      "plugin-manifest": "PLUGIN_MANIFEST_REJECTED: path must identify an unchanged regular .claude-plugin/plugin.json file within the manifest bounds",
      candidate: "CANDIDATE_CAPTURE_REJECTED: root must contain a valid generic-name Claude catalog and manifests, and policyPath must match the package-owned Skills policy resolver",
    };
    throw new CaptureRefusal(messages[operation] ?? "CAPTURE_REJECTED: selected operation did not accept its input");
  }
}
function capture(request: JsonObject): unknown {
  need(request.schema === REQUEST_SCHEMA, `INVALID_SCHEMA: schema must be ${REQUEST_SCHEMA}`);
  canonicalPath(request.commandPath);
  need(typeof request.operation === "string", "INVALID_OPERATION: operation must be settings, marketplace-registry, managed-plugin-registry, path-bytes, discovery-directories, plugin-manifest, or candidate");
  switch (request.operation) {
    case "settings": {
      exactKeys(request, ["schema", "commandPath", "operation", "kind", "path"], "settings");
      canonicalPath(request.path);
      const capture = request.kind === "claude-settings-v1" ? captureClaudeSettings
        : request.kind === "claude-settings-v2" ? captureClaudeSettingsV2
        : request.kind === "claude-settings-v3" ? captureClaudeSettingsV3
        : request.kind === "claude-settings-v4" ? captureClaudeSettingsV4 : null;
      need(capture, "INVALID_SETTINGS_KIND: kind must be claude-settings-v1, claude-settings-v2, claude-settings-v3, or claude-settings-v4");
      return captureOwned("settings", () => capture(request.path as string));
    }
    case "marketplace-registry": {
      exactKeys(request, ["schema", "commandPath", "operation", "kind", "path"], "marketplace-registry");
      canonicalPath(request.path);
      const capture = request.kind === "claude-marketplace-registry-v1" ? captureClaudeMarketplaceRegistry
        : request.kind === "claude-marketplace-registry-v2" ? captureClaudeMarketplaceRegistryV2 : null;
      need(capture, "INVALID_MARKETPLACE_KIND: kind must be claude-marketplace-registry-v1 or claude-marketplace-registry-v2");
      return captureOwned("marketplace-registry", () => capture(request.path as string));
    }
    case "managed-plugin-registry": {
      exactKeys(request, ["schema", "commandPath", "operation", "path", "managedPlugins"], "managed-plugin-registry");
      canonicalPath(request.path);
      need(Array.isArray(request.managedPlugins), "INVALID_MANAGED_PLUGINS: managedPlugins must be a non-empty array of {bindingId,storeRoot} witnesses");
      return captureOwned("managed-plugin-registry", () => captureManagedPluginRegistry(request.path as string, request.managedPlugins as Array<{ bindingId: string; storeRoot: string }>));
    }
    case "path-bytes": {
      exactKeys(request, ["schema", "commandPath", "operation", "paths"], "path-bytes");
      return captureOwned("path-bytes", () => captureDiscoveryPathSources(paths(request.paths)));
    }
    case "discovery-directories": {
      exactKeys(request, ["schema", "commandPath", "operation", "paths"], "discovery-directories");
      return captureOwned("discovery-directories", () => captureDiscoveryDirectories(paths(request.paths)));
    }
    case "plugin-manifest": {
      exactKeys(request, ["schema", "commandPath", "operation", "path"], "plugin-manifest");
      canonicalPath(request.path);
      return captureOwned("plugin-manifest", () => captureClaudePluginManifestFile(request.path as string));
    }
    case "candidate": {
      exactKeys(request, ["schema", "commandPath", "operation", "root", "policyPath"], "candidate");
      canonicalPath(request.root); canonicalPath(request.policyPath);
      return captureOwned("candidate", () => captureClaudeInstallerCandidate(request.root as string, request.policyPath as string));
    }
    default: throw new CaptureRefusal("INVALID_OPERATION: operation must be settings, marketplace-registry, managed-plugin-registry, path-bytes, discovery-directories, plugin-manifest, or candidate");
  }
}

/** Execute one fixed, read-only Claude installer witness operation through this installed CLI. */
export function captureClaudeInstallerRequest(requestPath: string) {
  const request = readRequest(requestPath);
  need(object(request), "INVALID_REQUEST: --request must contain a versioned object matching one operation schema");
  const commandPath = request.commandPath;
  canonicalPath(commandPath);
  let before: ReturnType<typeof captureSkillsCliProducerIdentity>, result: unknown, after: ReturnType<typeof captureSkillsCliProducerIdentity>;
  try { before = captureSkillsCliProducerIdentity(commandPath); }
  catch (error) {
    const code = error instanceof Error ? /^CODEX_HOOK_TRUST_[A-Z0-9_]+$/.exec(error.message)?.[0] : undefined;
    throw new CaptureRefusal(`PRODUCER_UNVERIFIED: commandPath must resolve to this trusted @hasna/skills CLI and runtime${code ? ` (${code})` : ""}`);
  }
  try { result = capture(request); }
  catch (error) {
    if (error instanceof CaptureRefusal) throw error;
    throw new CaptureRefusal("CAPTURE_REJECTED: selected Skills witness refused the input; provide a canonical unchanged source that matches its documented schema");
  }
  try { after = captureSkillsCliProducerIdentity(commandPath); }
  catch { throw new CaptureRefusal("PRODUCER_CHANGED: commandPath or its launcher/runtime changed during capture; rerun with the same trusted Skills command"); }
  need(JSON.stringify(before) === JSON.stringify(after), "PRODUCER_CHANGED: commandPath or its launcher/runtime changed during capture; rerun with the same trusted Skills command");
  return { schema: RESULT_SCHEMA, producer: before, operation: request.operation, result };
}

export function safeClaudeInstallerCaptureError(error: unknown): string {
  return error instanceof CaptureRefusal ? error.message : "CAPTURE_REJECTED: input or producer failed a Skills-owned safety check; verify the accepted request shape and source paths";
}
