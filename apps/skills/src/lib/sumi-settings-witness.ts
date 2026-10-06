/** Explicit Sumi settings review: rendering preferences are not discovery.
 * Source contract: Sumi 0.2.58 config schema/normalizer and TUI statusline and
 * compact-tools consumers. All unknown, legacy and executable controls remain
 * bound; old byte witnesses retain their exact meaning until explicit migration.
 */
import { createHash } from "node:crypto";
import { hashSumiNativeJsonControls, readNativeSettingsWitnessFile, CLAUDE_SETTINGS_WITNESS_LIMITS, type ClaudeSettingsWitnessBudget } from "./claude-settings-witness.js";

export const SUMI_DISCOVERY_PROJECTION_FIELDS = ["skills", "plugin", "plugins", "permissions"] as const;
const budget = (): ClaudeSettingsWitnessBudget => ({ remaining: 256 * 1024 * 1024 });
export function readSumiSettingsPreimage(path: string): string {
  return readNativeSettingsWitnessFile(path, budget(), "sumi.json");
}
export function hashSumiSettingsReplacement(text: string, limits: ClaudeSettingsWitnessBudget): string {
  const bytes = Buffer.byteLength(text);
  if (bytes > CLAUDE_SETTINGS_WITNESS_LIMITS.bytes || !Number.isSafeInteger(limits.remaining) || limits.remaining < bytes) throw new Error("Sumi settings witness exceeds its byte limit");
  limits.remaining -= bytes;
  return hashSumiNativeJsonControls(text);
}
export function captureSumiSettings(path: string, limits: ClaudeSettingsWitnessBudget = budget()): { path: string; hashMode: "sumi-settings-v1"; sha256: string } {
  return { path, hashMode: "sumi-settings-v1", sha256: hashSumiNativeJsonControls(readNativeSettingsWitnessFile(path, limits, "sumi.json")) };
}
export function upgradeSumiSettingsWitness(previous: { path: string; hashMode?: "bytes"; sha256: string }, reviewedSettingsPath: string): ReturnType<typeof captureSumiSettings> {
  if (!previous || Object.keys(previous).some(key => !["path", "hashMode", "sha256"].includes(key)) || ![undefined, "bytes"].includes(previous.hashMode) || !/^[a-f0-9]{64}$/.test(previous.sha256)) throw new Error("Sumi settings upgrade requires one exact preserved byte witness");
  const before = readSumiSettingsPreimage(reviewedSettingsPath);
  if (createHash("sha256").update(before).digest("hex") !== previous.sha256) throw new Error("Reviewed Sumi preimage does not match its byte witness");
  const next = captureSumiSettings(previous.path);
  if (hashSumiNativeJsonControls(before) !== next.sha256) throw new Error("Sumi non-display settings changed; explicit discovery review required");
  return next;
}
