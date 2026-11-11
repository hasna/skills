/** Capture a fresh explicit Claude (or other agent) discovery review.
 *
 * A saved reviewed binding cannot be fed back as `--discovery-inputs`: it
 * carries the SDK's automatic configuration projections (`format`/`fields`),
 * and explicit reviews accept only full source witnesses. Before this module
 * the only way to rebuild the review was to hand-assemble witness captures
 * through the public SDK, which is not a supported operator path. This capture
 * re-derives the current discovery through the same resolver `hook install`
 * uses, replaces each projected configuration source with its typed or full
 * witness, and binds the current plugin cache directories, so a legitimate
 * fresh review can be produced after an operator-reviewed settings or plugin
 * change. The capture is read-only on native state and never applies itself;
 * the exact bytes must still pass `hook install --discovery-inputs`, and every
 * stale or forged witness is still refused there.
 */
import { lstatSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, isAbsolute, join, resolve } from "node:path";
import {
  agentDiscoveryConfigPath,
  captureDiscoveryByteSources,
  captureDiscoveryDirectories,
  resolveAgentDiscovery,
  type AgentDiscoveryBinding,
  type DiscoveryExecutable,
  type DiscoverySource,
  type ReviewedDiscoveryInputs,
} from "./agent-discovery.js";
import { captureClaudeSettingsV5 } from "./claude-settings-witness.js";
import { captureCodexSettingsV8 } from "./codex-settings-witness.js";
import { captureSumiSettings } from "./sumi-settings-witness.js";
import type { IntegrationAgent } from "./agent-adapters.js";

export const DISCOVERY_REVIEW_CAPTURE_SCHEMA = "hasna.skills.discovery-review-capture.v1" as const;
/** Sources compared against the saved binding and reported to the operator. */
const MAX_REPORTED_CHANGES = 64;

export interface DiscoveryReviewSourceChange {
  path: string;
  kind: "added" | "removed" | "changed";
  previousSha256: string | null;
  currentSha256: string | null;
}

export interface DiscoveryReviewCapture {
  schema: typeof DISCOVERY_REVIEW_CAPTURE_SCHEMA;
  agent: IntegrationAgent;
  review: ReviewedDiscoveryInputs;
  /** The exact bytes to write as the `--discovery-inputs` file. */
  reviewText: string;
  reviewSha256: string;
  sourceCount: number;
  directoryCount: number;
  previousMethod: "automatic" | "reviewed" | null;
  changes: DiscoveryReviewSourceChange[];
  changesTruncated: boolean;
}

export interface DiscoveryReviewCaptureOptions {
  home: string;
  agent: IntegrationAgent;
  canonical?: (path: string) => string;
  executable?: DiscoveryExecutable | null;
  /** The saved binding, for the operator-facing change report only. It never
   * contributes a witness to the captured review. */
  previous?: AgentDiscoveryBinding;
}

const isProjected = (source: DiscoverySource): boolean => source.format !== undefined || source.fields !== undefined;

/** The review-safe witness for one agent configuration file. Typed settings
 * witnesses are used where the resolver defines one; otherwise the exact file
 * bytes are bound. Both are accepted explicitly by discovery review. */
function configWitness(agent: IntegrationAgent, path: string): DiscoverySource {
  if (agent === "claude") return captureClaudeSettingsV5(path);
  if (agent === "codex") return captureCodexSettingsV8(path);
  if (agent === "sumi") return captureSumiSettings(path);
  const source = captureDiscoveryByteSources([path])[0];
  if (!source) throw new Error(`Fresh discovery review could not capture the agent configuration: ${path}`);
  return source;
}

/** Plugin roots whose directory membership a Claude install already reviews.
 * A root is either a plugin root (manifest inside it) or its `skills`
 * directory (manifest in the parent). Missing or manifestless roots are left
 * to their source witnesses. */
function claudePluginDirectories(roots: readonly string[]): string[] {
  const directories = new Set<string>();
  for (const root of roots) for (const candidate of [root, dirname(root)]) {
    if (lstatSync(join(candidate, ".claude-plugin", "plugin.json"), { throwIfNoEntry: false })?.isFile()) directories.add(candidate);
  }
  return [...directories].sort();
}

function savedSourceHashes(binding: AgentDiscoveryBinding): Map<string, string> {
  const hashes = new Map<string, string>();
  for (const source of binding.sources) {
    if (isProjected(source) || source.sha256 === null) continue;
    // One path may retain several witnesses; the newest typed/raw one is the
    // only one a fresh review can compare meaningfully.
    hashes.set(source.path, source.sha256);
  }
  return hashes;
}

function reportChanges(previous: AgentDiscoveryBinding | undefined, sources: readonly DiscoverySource[]): { changes: DiscoveryReviewSourceChange[]; truncated: boolean } {
  if (!previous) return { changes: [], truncated: false };
  const before = savedSourceHashes(previous), after = new Map<string, string>();
  for (const source of sources) if (!isProjected(source) && source.sha256 !== null) after.set(source.path, source.sha256);
  const changes: DiscoveryReviewSourceChange[] = [];
  for (const [path, currentSha256] of after) {
    const previousSha256 = before.get(path) ?? null;
    if (previousSha256 === currentSha256) continue;
    changes.push({ path, kind: previousSha256 === null ? "added" : "changed", previousSha256, currentSha256 });
  }
  for (const [path, previousSha256] of before) if (!after.has(path)) changes.push({ path, kind: "removed", previousSha256, currentSha256: null });
  changes.sort((left, right) => left.path.localeCompare(right.path));
  return { changes: changes.slice(0, MAX_REPORTED_CHANGES), truncated: changes.length > MAX_REPORTED_CHANGES };
}

/** Re-derive the current explicit review for one agent. Throws the resolver's
 * own refusal when the current native state still needs a dedicated review
 * (an unsupported plugin control, plugin hooks, an unresolved root, ...). */
export function captureDiscoveryReview(options: DiscoveryReviewCaptureOptions): DiscoveryReviewCapture {
  const canonical = options.canonical ?? resolve;
  const binding = resolveAgentDiscovery({ home: options.home, agent: options.agent, canonical, executable: options.executable ?? null });
  const configPath = canonical(agentDiscoveryConfigPath(resolve(options.home), options.agent));
  const sources: DiscoverySource[] = [];
  for (const source of binding.sources) {
    if (!isProjected(source)) {
      if (!sources.some(existing => JSON.stringify(existing) === JSON.stringify(source))) sources.push(source);
      continue;
    }
    if (source.path !== configPath) throw new Error(`Fresh discovery review cannot represent the projected witness for ${source.path}`);
    if (sources.some(existing => existing.path === configPath && !isProjected(existing))) continue;
    sources.push(configWitness(options.agent, source.path));
  }
  if (!sources.some(source => source.path === configPath && !isProjected(source))) throw new Error(`Fresh discovery review is missing the agent configuration source: ${configPath}`);

  const roots = [...binding.roots];
  const directoryPaths = new Set<string>((binding.directories ?? []).map(directory => directory.path));
  if (options.agent === "claude") for (const path of claudePluginDirectories(roots)) directoryPaths.add(path);
  const directories = directoryPaths.size ? captureDiscoveryDirectories([...directoryPaths].sort()) : [];
  const review: ReviewedDiscoveryInputs = {
    version: 1,
    agents: [{
      agent: options.agent,
      roots,
      sources,
      ...(directories.length ? { directories } : {}),
      pluginHooks: "reviewed-no-skill-injection",
    }],
  };
  // Validate with the exact resolver an install uses, including manifest
  // normalization and cache-closure requirements, before offering the artifact.
  resolveAgentDiscovery({ home: options.home, agent: options.agent, reviewed: review, canonical, executable: options.executable ?? null });
  const reviewText = `${JSON.stringify(review, null, 2)}\n`;
  const reported = reportChanges(options.previous, sources);
  return {
    schema: DISCOVERY_REVIEW_CAPTURE_SCHEMA,
    agent: options.agent,
    review,
    reviewText,
    reviewSha256: createHash("sha256").update(reviewText).digest("hex"),
    sourceCount: sources.length,
    directoryCount: directories.length,
    previousMethod: options.previous?.method ?? null,
    changes: reported.changes,
    changesTruncated: reported.truncated,
  };
}

/** A review file must name an absolute new path: the command never overwrites
 * a previous review or a file it did not create. */
export function assertDiscoveryReviewOutputPath(output: string): string {
  if (!isAbsolute(output)) throw new Error("DISCOVERY_REVIEW_OUTPUT_ABSOLUTE_REQUIRED: --output must be an absolute path");
  return output;
}
