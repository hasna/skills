/** Narrowed-witness ledger: keeps an existing reviewed settings witness
 * verifying after an upgrade, without a new review, when only settings the
 * narrowed projection ignores have changed.
 *
 * A legacy full-file settings witness (raw bytes, claude-settings-v1..v4,
 * codex-settings-v1..v5) binds every field the narrowed projection
 * (claude-settings-v5, codex-settings-v7) binds, in full. So while the legacy
 * witness still verifies the current file, the narrowed digest of that file is
 * the narrowed digest of the reviewed state. The live hook records exactly that
 * observation, computed from the same bytes that matched the legacy witness.
 * Later, when the legacy witness no longer matches (a model switch, an "always
 * allow" rule, Codex's own notices or folder trust), the change is accepted only
 * when the current narrowed digest equals the recorded one: a change to a hook,
 * plugin, marketplace, skill setting, Skill rule or added directory still
 * reports drift. Nothing is ever recorded from a file the legacy witness does
 * not verify, so an unexplained change is never adopted.
 *
 * The ledger lives beside agent-policy.json in the Skills data directory, under
 * the same owner and permissions: it adds no trust the policy file does not
 * already carry. A V6 witness is never narrowed (it binds hook MCP
 * dependencies V7 does not carry), nor is any witness with review artifacts,
 * managed-plugin rules or a field projection.
 */
import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type { DiscoverySource } from "./agent-discovery.js";
import { hashClaudeSettingsReplacement, hashClaudeSettingsReplacementV2, hashClaudeSettingsReplacementV3, hashClaudeSettingsReplacementV4, hashClaudeSettingsReplacementV5, readNativeSettingsWitnessFile } from "./claude-settings-witness.js";
import { codexSettingsToleratesScreenReaderReceipt, hashCodexSettingsReplacement, hashCodexSettingsReplacementV2, hashCodexSettingsReplacementV3, hashCodexSettingsReplacementV4, hashCodexSettingsReplacementV5, hashCodexSettingsReplacementV7, type CodexReceiptSettingsMode } from "./codex-settings-witness.js";

export type NarrowedSettingsMode = "claude-settings-v5" | "codex-settings-v7";
export const NARROWED_WITNESS_LEDGER_FILE = "native-witness-narrowed.json";
const SCHEMA = "hasna.skills.narrowed-witness-ledger.v1";
const MAX_ENTRIES = 64, MAX_BYTES = 256 * 1024;
const CLAUDE_LEGACY: ReadonlySet<string> = new Set(["claude-settings-v1", "claude-settings-v2", "claude-settings-v3", "claude-settings-v4"]);
const CODEX_LEGACY: ReadonlySet<string> = new Set(["codex-settings-v1", "codex-settings-v2", "codex-settings-v3", "codex-settings-v4", "codex-settings-v5"]);
const HEX = /^[a-f0-9]{64}$/;

interface LedgerEntry { path: string; hashMode: string; sha256: string; narrowedMode: NarrowedSettingsMode; narrowedSha256: string; recordedAt: string }

/** The narrowed mode that covers this legacy full-file settings witness, or
 * null when it has none. */
export function narrowedLegacyWitnessMode(source: DiscoverySource): NarrowedSettingsMode | null {
  if (source.format !== undefined || source.fields !== undefined || source.managedPlugins !== undefined || source.reviewArtifact !== undefined || source.hookSources !== undefined) return null;
  if (typeof source.sha256 !== "string" || !HEX.test(source.sha256)) return null;
  const name = basename(source.path), parent = basename(dirname(source.path)), mode = source.hashMode;
  if (mode !== undefined && CLAUDE_LEGACY.has(mode)) return name === "settings.json" ? "claude-settings-v5" : null;
  if (mode !== undefined && CODEX_LEGACY.has(mode)) return name === "config.toml" ? "codex-settings-v7" : null;
  if (mode === undefined || mode === "bytes") {
    if (name === "settings.json" && parent === ".claude") return "claude-settings-v5";
    if (name === "config.toml" && parent === ".codex") return "codex-settings-v7";
  }
  return null;
}

const budget = () => ({ remaining: 2 * 1024 * 1024 });
function readSettings(source: DiscoverySource, mode: NarrowedSettingsMode): string {
  return readNativeSettingsWitnessFile(source.path, budget(), mode === "claude-settings-v5" ? "settings.json" : "config.toml");
}
function narrowedDigest(mode: NarrowedSettingsMode, text: string): string {
  return mode === "claude-settings-v5" ? hashClaudeSettingsReplacementV5(text, budget()) : hashCodexSettingsReplacementV7(text, budget());
}
/** Whether `text` is verified by the legacy witness exactly as discovery
 * verification would accept it (Codex's screen-reader receipt included). */
function legacyWitnessVerifies(source: DiscoverySource, text: string): boolean {
  const mode = source.hashMode, expected = source.sha256!;
  if (mode === undefined || mode === "bytes") return createHash("sha256").update(text).digest("hex") === expected;
  const exact = mode === "claude-settings-v1" ? hashClaudeSettingsReplacement(text, budget())
    : mode === "claude-settings-v2" ? hashClaudeSettingsReplacementV2(text, budget())
    : mode === "claude-settings-v3" ? hashClaudeSettingsReplacementV3(text, budget())
    : mode === "claude-settings-v4" ? hashClaudeSettingsReplacementV4(text, budget())
    : mode === "codex-settings-v1" ? hashCodexSettingsReplacement(text, budget())
    : mode === "codex-settings-v2" ? hashCodexSettingsReplacementV2(text, budget())
    : mode === "codex-settings-v3" ? hashCodexSettingsReplacementV3(text, budget())
    : mode === "codex-settings-v4" ? hashCodexSettingsReplacementV4(text, budget())
    : mode === "codex-settings-v5" ? hashCodexSettingsReplacementV5(text, budget()) : null;
  if (exact === expected) return true;
  return CODEX_LEGACY.has(mode) && codexSettingsToleratesScreenReaderReceipt(text, mode as CodexReceiptSettingsMode, expected);
}

function readLedger(path: string): LedgerEntry[] | null {
  const initial = lstatSync(path, { throwIfNoEntry: false });
  if (!initial) return [];
  if (!initial.isFile() || initial.size > MAX_BYTES) return null;
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    if (!fstatSync(fd).isFile()) return null;
    const bytes = Buffer.alloc(MAX_BYTES + 1); let length = 0;
    while (length < bytes.length) { const count = readSync(fd, bytes, length, bytes.length - length, null); if (!count) break; length += count; }
    if (length > MAX_BYTES) return null;
    const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, length)));
    if (!value || value.schema !== SCHEMA || !Array.isArray(value.entries) || value.entries.length > MAX_ENTRIES) return null;
    const entries: LedgerEntry[] = [];
    for (const entry of value.entries) {
      if (!entry || typeof entry !== "object" || Object.keys(entry).length !== 6 || typeof entry.path !== "string" || !entry.path.startsWith("/") || entry.path.length > 4096
        || typeof entry.hashMode !== "string" || !(entry.hashMode === "bytes" || CLAUDE_LEGACY.has(entry.hashMode) || CODEX_LEGACY.has(entry.hashMode))
        || typeof entry.sha256 !== "string" || !HEX.test(entry.sha256) || !["claude-settings-v5", "codex-settings-v7"].includes(entry.narrowedMode)
        || typeof entry.narrowedSha256 !== "string" || !HEX.test(entry.narrowedSha256) || typeof entry.recordedAt !== "string" || entry.recordedAt.length > 64) return null;
      entries.push(entry);
    }
    return entries;
  } catch { return null; } finally { closeSync(fd); }
}

export interface NarrowedWitnessLedger {
  /** The legacy witness no longer matches: accept only when the current file's
   * narrowed digest equals the one recorded for this exact witness. */
  accepts(source: DiscoverySource): boolean;
  /** The legacy witness verified the current file: record its narrowed digest,
   * re-proving the legacy match on the same bytes first. */
  observe(source: DiscoverySource): void;
  /** Paths accepted through a recorded narrowed digest during this check. */
  readonly accepted: string[];
}

/** Opened by the live hook only. `record` permits observations to be written
 * by flush(); reads never write. Every failure is fail-closed: an unreadable or
 * malformed ledger accepts nothing and is never overwritten. */
export function openNarrowedWitnessLedger(dataDir: string, options: { record: boolean } = { record: true }): NarrowedWitnessLedger & { flush(): void } {
  const path = join(dataDir, NARROWED_WITNESS_LEDGER_FILE);
  let entries: LedgerEntry[] | null;
  try { entries = readLedger(path); } catch { entries = null; }
  let dirty = false;
  const accepted: string[] = [];
  const key = (source: DiscoverySource) => [source.path, source.hashMode ?? "bytes", source.sha256];
  const find = (source: DiscoverySource, mode: NarrowedSettingsMode) => {
    const [path, hashMode, sha256] = key(source);
    return entries?.find(entry => entry.path === path && entry.hashMode === hashMode && entry.sha256 === sha256 && entry.narrowedMode === mode);
  };
  return {
    accepted,
    accepts(source) {
      try {
        const mode = narrowedLegacyWitnessMode(source);
        const entry = mode ? find(source, mode) : undefined;
        if (!mode || !entry) return false;
        if (narrowedDigest(mode, readSettings(source, mode)) !== entry.narrowedSha256) return false;
        accepted.push(source.path);
        return true;
      } catch { return false; }
    },
    observe(source) {
      try {
        const mode = narrowedLegacyWitnessMode(source);
        if (!mode || !entries || !options.record) return;
        // A recorded entry for this exact witness already holds the narrowed
        // digest of its review: equal legacy digests imply equal narrowed ones.
        const existing = find(source, mode);
        if (existing) return;
        const text = readSettings(source, mode);
        if (!legacyWitnessVerifies(source, text)) return;
        const narrowedSha256 = narrowedDigest(mode, text);
        const [entryPath, hashMode, sha256] = key(source) as [string, string, string];
        entries = [...entries, { path: entryPath, hashMode, sha256, narrowedMode: mode, narrowedSha256, recordedAt: new Date().toISOString() }]
          .sort((a, b) => a.recordedAt < b.recordedAt ? -1 : a.recordedAt > b.recordedAt ? 1 : 0).slice(-MAX_ENTRIES);
        dirty = true;
      } catch { /* an observation that cannot be proved is not recorded */ }
    },
    flush() {
      if (!dirty || !entries || !options.record) return;
      const temporary = join(dataDir, `.${NARROWED_WITNESS_LEDGER_FILE}.${process.pid}.${Date.now()}.tmp`);
      try {
        const current = lstatSync(path, { throwIfNoEntry: false });
        if (current && (!current.isFile() || current.isSymbolicLink())) return;
        writeFileSync(temporary, `${JSON.stringify({ schema: SCHEMA, entries }, null, 2)}\n`, { mode: 0o600, flag: "wx" });
        renameSync(temporary, path);
        dirty = false;
      } catch {
        // Best effort: the next verified prompt records it again.
        try { if (lstatSync(temporary, { throwIfNoEntry: false })?.isFile()) unlinkSync(temporary); } catch { /* left for the operator */ }
      }
    },
  };
}
