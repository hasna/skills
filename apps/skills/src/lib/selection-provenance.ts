/**
 * One read-only provenance receipt for the Skills selection chain.
 *
 * The chain holds four different facts, and reading any one of them as "the
 * version this station runs" is the defect this receipt removes:
 *
 *   selected  — the shared profile the authority serves right now;
 *   activated — the profile snapshot THIS machine last verified and activated,
 *               which is what its hooks, `skills context` and `skills load`
 *               resolve from;
 *   applied   — the station receipt the authority holds. Only an explicit
 *               `skills sync` writes it: the managed hook keeps station
 *               reporting off its blocking lifecycle path on purpose, so this
 *               record legitimately lags the activation;
 *   pinned    — the exact immutable profile revision one live session holds.
 *               A session keeps its revision when the profile moves on, so an
 *               older pin is custody by design, not drift;
 *   consumed  — the skills that session actually loaded, with their exact
 *               versions. An unloaded selection was never consumed.
 *
 * Every consumer is classified `current`, `behind`, `pinned` (held by design)
 * or `unverified`, and always carries the reason. Applying a record, reporting
 * a station or publishing a profile never closes adoption on its own.
 *
 * It only reads: no pin, receipt, cache entry or station record is created or
 * changed, no skill payload is fetched, and no credential is rendered. With no
 * authenticated authority read the reference is the locally synced snapshot and
 * every comparison is `unverified` rather than a guess.
 */
import { inspectSkillSession } from "./session-reconciliation.js";
import { readSkillProfile, readStationSkillState } from "./profile-admin.js";
import { readSelectionProfile, type SelectionCacheOptions } from "./selection-cache.js";

/** Bounded so one receipt can never carry an unbounded drift list. */
export const PROVENANCE_DRIFT_LIMIT = 200;
/** Foreign error text is bounded before it reaches a receipt that may be shared. */
const REASON_MAX_CHARS = 240;
const STATION_ID_MAX_CHARS = 200;

export type SelectionProvenanceStatus = "current" | "behind" | "pinned" | "unverified";
export type SelectionProvenanceSource = "local-receipt" | "authority-receipt" | "session-receipt";
export type SelectionProvenanceReference = "authority" | "synced-snapshot" | "unavailable";

export interface SelectionProvenanceVersion { slug: string; version: string; bundleDigest?: string }
export interface SelectionProvenanceConsumer {
  kind: "station" | "session";
  source: SelectionProvenanceSource;
  /** Station id, or the exact session id. Never a path. */
  id: string;
  profileId?: string;
  profileRevision?: string;
  observedAt?: string;
  selectionCount?: number;
  /** Only for a session: how many of its selections it really loaded. */
  loadedCount?: number;
  /** Only for a session: the exact versions it really loaded. */
  consumed?: SelectionProvenanceVersion[];
  status: SelectionProvenanceStatus;
  reason: string;
}
export interface SelectionProvenanceDrift {
  source: SelectionProvenanceSource;
  id: string;
  slug: string;
  selectedVersion: string;
  observedVersion: string;
}
export interface SelectionProvenanceReceipt {
  schemaVersion: 1;
  readOnly: true;
  selectionProfile: string;
  selected: {
    profileId: string;
    profileRevision?: string;
    selectionCount?: number;
    source: SelectionProvenanceReference;
    observedAt?: string;
    reason: string;
  };
  consumers: SelectionProvenanceConsumer[];
  drift: SelectionProvenanceDrift[];
  driftTruncated: boolean;
}
export interface SelectionProvenanceInput {
  profileId: string;
  stationId: string;
  sessionId?: string;
  /** Read the reference from the locally synced snapshot; never ask the authority. */
  cached?: boolean;
}
/** A station receipt reduced to what this receipt compares. */
export interface ProvenanceStationObservation {
  profileId: string;
  profileRevision: string;
  appliedAt: string;
  selections: readonly { slug: string; version: string }[];
}
export interface SelectionProvenanceOptions extends SelectionCacheOptions {
  /** Injected by the SDK and tests; defaults to the authenticated reads. */
  readSelected?: (profileId: string) => Promise<{ profileId: string; profileRevision: string; selections: readonly { slug: string; version: string }[] }>;
  readStation?: (stationId: string) => Promise<ProvenanceStationObservation>;
}

type Attempt<T> = { ok: true; value: T } | { ok: false; reason: string };
/** One consumer, plus the exact versions it is compared on. */
interface ConsumerResult { consumer: SelectionProvenanceConsumer; compared: readonly { slug: string; version: string }[] }
interface Reference {
  profileId: string;
  profileRevision?: string;
  selectionCount?: number;
  observedAt?: string;
  source: SelectionProvenanceReference;
  reason: string;
  selections: readonly { slug: string; version: string }[];
}

const noSelections: readonly { slug: string; version: string }[] = [];
/** Bounded, control-character-free text for a receipt that may be shared. */
function safeText(value: string): string {
  const flattened = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return flattened.length <= REASON_MAX_CHARS ? flattened : `${flattened.slice(0, REASON_MAX_CHARS - 1)}…`;
}
function errorText(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.trim() ? safeText(message) : "the read failed without a message";
}
/**
 * A failed read is a fact about verification, not a command failure: the
 * receipt says what could not be read and stays printable. Only our own bounded
 * message reaches the receipt, never a stack trace or a foreign body.
 */
async function attempt<T>(read: () => Promise<T>): Promise<Attempt<T>> {
  try {
    return { ok: true, value: await read() };
  } catch (error) {
    return { ok: false, reason: errorText(error) };
  }
}
/** Compared by exact revision: equal counts would pass a wholly rewritten profile. */
function sameRevision(observed: string | undefined, reference: string | undefined): boolean {
  return observed !== undefined && reference !== undefined && observed === reference;
}
function revisionReason(label: string, observed: string | undefined, reference: string | undefined, status: SelectionProvenanceStatus): string {
  const seen = observed ?? "unknown";
  if (status === "current") return `${label} revision ${seen} is the selected revision`;
  return `${label} revision ${seen} is not the selected revision ${reference ?? "unknown"}`;
}

/** The reference every consumer is compared with, and why it is that one. */
async function resolveReference(input: SelectionProvenanceInput, options: SelectionProvenanceOptions): Promise<Reference> {
  const fromSnapshot = (reason: string): Reference => {
    let receipt;
    try { receipt = readSelectionProfile(input.profileId, options); } catch (error) {
      return { profileId: input.profileId, source: "unavailable", reason: `${reason} The locally synced snapshot is unreadable as well: ${errorText(error)}`, selections: noSelections };
    }
    if (!receipt) return { profileId: input.profileId, source: "unavailable", reason: `${reason} Nothing is synced locally either, so no consumer can be compared.`, selections: noSelections };
    return {
      profileId: receipt.profile.profileId, profileRevision: receipt.profile.profileRevision, selectionCount: receipt.profile.selections.length,
      observedAt: receipt.verifiedAt, source: "synced-snapshot",
      reason: `${reason} Comparisons use the locally synced snapshot (posted work is not proof of adoption), so every consumer below is reported unverified rather than current.`,
      selections: receipt.profile.selections,
    };
  };
  if (input.cached) return fromSnapshot("--cached was requested, so the authority was not read.");
  const read = options.readSelected ?? (async (profileId: string) => {
    const profile = await readSkillProfile(profileId);
    return { profileId: profile.id, profileRevision: profile.revision, selections: profile.selections };
  });
  const attempted = await attempt(() => read(input.profileId));
  if (!attempted.ok) return fromSnapshot(`The authority did not answer for the selected profile: ${attempted.reason}`);
  const profile = attempted.value;
  if (!profile?.profileId || !profile.profileRevision || !Array.isArray(profile.selections)) {
    return { profileId: input.profileId, source: "unavailable", reason: "The authority returned a selection profile this client does not recognise, so no consumer can be compared.", selections: noSelections };
  }
  return {
    profileId: profile.profileId, profileRevision: profile.profileRevision, selectionCount: profile.selections.length,
    source: "authority", reason: `Read from the authority for profile ${profile.profileId}.`, selections: profile.selections,
  };
}

/** What this machine last verified and activated: what its hooks actually resolve. */
function activationConsumer(input: SelectionProvenanceInput, reference: Reference, options: SelectionProvenanceOptions): ConsumerResult {
  const base: SelectionProvenanceConsumer = { kind: "station", source: "local-receipt", id: input.stationId, status: "unverified", reason: "" };
  const refuse = (reason: string): ConsumerResult => ({ consumer: { ...base, reason }, compared: noSelections });
  let receipt;
  try { receipt = readSelectionProfile(input.profileId, options); } catch (error) {
    return refuse(`This machine's activated snapshot is unreadable: ${errorText(error)}`);
  }
  if (!receipt) return refuse(`This machine holds no activated snapshot for profile ${input.profileId}.`);
  const observed: SelectionProvenanceConsumer = {
    ...base, profileId: receipt.profile.profileId, profileRevision: receipt.profile.profileRevision,
    observedAt: receipt.verifiedAt, selectionCount: receipt.profile.selections.length,
  };
  if (receipt.profile.profileId !== reference.profileId) {
    return { consumer: { ...observed, status: "unverified", reason: `This machine last activated a different profile, ${receipt.profile.profileId}, not ${reference.profileId}.` }, compared: noSelections };
  }
  if (reference.source !== "authority") {
    return { consumer: { ...observed, status: "unverified", reason: `${reference.reason} This snapshot alone cannot say whether the machine is current.` }, compared: noSelections };
  }
  const status = sameRevision(receipt.profile.profileRevision, reference.profileRevision) ? "current" : "behind";
  return {
    consumer: { ...observed, status, reason: status === "current"
      ? revisionReason("This machine's activated snapshot", receipt.profile.profileRevision, reference.profileRevision, "current")
      : `${revisionReason("This machine's activated snapshot", receipt.profile.profileRevision, reference.profileRevision, "behind")}. Run skills sync to activate the selected revision here.` },
    compared: receipt.profile.selections,
  };
}

/** One station's sync state as the authority records it. */
async function stationConsumer(input: SelectionProvenanceInput, reference: Reference, options: SelectionProvenanceOptions): Promise<ConsumerResult> {
  const base: SelectionProvenanceConsumer = { kind: "station", source: "authority-receipt", id: input.stationId, status: "unverified", reason: "" };
  const refuse = (reason: string): ConsumerResult => ({ consumer: { ...base, reason }, compared: noSelections });
  if (reference.source !== "authority") {
    return refuse("The station receipt was not compared: this receipt has no authenticated selection to compare it with.");
  }
  const read = options.readStation ?? (async (stationId: string) => {
    const state = await readStationSkillState(stationId);
    return { profileId: state.profileId, profileRevision: state.profileRevision, appliedAt: state.appliedAt, selections: state.selections };
  });
  const attempted = await attempt(() => read(input.stationId));
  if (!attempted.ok) return refuse(`The authority did not answer for station ${input.stationId}: ${attempted.reason}`);
  const station = attempted.value;
  const observed: SelectionProvenanceConsumer = {
    ...base, profileId: station.profileId, profileRevision: station.profileRevision,
    observedAt: station.appliedAt, selectionCount: station.selections.length,
  };
  if (station.profileId !== reference.profileId) {
    return { consumer: { ...observed, status: "unverified", reason: `Station ${input.stationId} last applied a different profile, ${station.profileId}, not ${reference.profileId}.` }, compared: noSelections };
  }
  if (sameRevision(station.profileRevision, reference.profileRevision)) {
    return { consumer: { ...observed, status: "current", reason: revisionReason(`The receipt the authority holds for station ${input.stationId}`, station.profileRevision, reference.profileRevision, "current") }, compared: station.selections };
  }
  return {
    consumer: { ...observed, status: "behind", reason: `${revisionReason(`The receipt the authority holds for station ${input.stationId}`, station.profileRevision, reference.profileRevision, "behind")}. Only an explicit skills sync writes this record, so report it before treating the machine as adrift.` },
    compared: station.selections,
  };
}

/** One session's immutable pin and the versions it really loaded. */
function sessionConsumer(input: SelectionProvenanceInput, reference: Reference, options: SelectionProvenanceOptions): ConsumerResult {
  const unnamed: SelectionProvenanceConsumer = { kind: "session", source: "session-receipt", id: "unnamed", status: "unverified", reason: "No session was named, so its pin and load receipts were not read; pass --session <id>." };
  if (!input.sessionId) return { consumer: unnamed, compared: noSelections };
  const base: SelectionProvenanceConsumer = { kind: "session", source: "session-receipt", id: input.sessionId, status: "unverified", reason: "" };
  const refuse = (reason: string): ConsumerResult => ({ consumer: { ...base, reason }, compared: noSelections });
  let session;
  try { session = inspectSkillSession(input.sessionId, options); } catch (error) {
    return refuse(`The session receipt could not be read: ${errorText(error)}`);
  }
  const consumed = session.selections.filter(selection => selection.loaded).map(selection => ({ slug: selection.slug, version: selection.version, bundleDigest: selection.bundleDigest }));
  const observed: SelectionProvenanceConsumer = {
    ...base, profileId: session.profileId, profileRevision: session.profileRevision, observedAt: session.verifiedAt,
    selectionCount: session.selectionCount, loadedCount: session.loadedCount, consumed,
  };
  if (session.profileId !== reference.profileId) {
    return { consumer: { ...observed, status: "unverified", reason: `Session ${input.sessionId} is pinned to a different profile, ${session.profileId}, not ${reference.profileId}.` }, compared: noSelections };
  }
  if (reference.source !== "authority") {
    return { consumer: { ...observed, status: "unverified", reason: `${reference.reason} This pin alone cannot say whether the session is current.` }, compared: noSelections };
  }
  if (sameRevision(session.profileRevision, reference.profileRevision)) {
    return {
      consumer: { ...observed, status: "current", reason: `${revisionReason("The session pin", session.profileRevision, reference.profileRevision, "current")}; it loaded ${session.loadedCount} of ${session.selectionCount} selections.` },
      compared: consumed,
    };
  }
  return {
    consumer: { ...observed, status: "pinned", reason: `${revisionReason("The session pin", session.profileRevision, reference.profileRevision, "pinned")}. A session keeps its revision when the profile moves on, so this is custody by design; skills sessions reconcile moves it intentionally.` },
    compared: consumed,
  };
}

/** The exact versions one consumer differs on. Empty unless the reference is the authority. */
function driftFor(result: ConsumerResult, reference: Reference): SelectionProvenanceDrift[] {
  if (reference.source !== "authority" || result.compared.length === 0) return [];
  const selected = new Map(reference.selections.map(selection => [selection.slug, selection.version]));
  return result.compared
    .filter(selection => selected.has(selection.slug) && selected.get(selection.slug) !== selection.version)
    .map(selection => ({ source: result.consumer.source, id: result.consumer.id, slug: selection.slug, selectedVersion: selected.get(selection.slug)!, observedVersion: selection.version }))
    .sort((left, right) => left.slug.localeCompare(right.slug) || left.source.localeCompare(right.source));
}

export async function readSelectionProvenance(input: SelectionProvenanceInput, options: SelectionProvenanceOptions = {}): Promise<SelectionProvenanceReceipt> {
  if (!input.profileId?.trim()) throw new Error("A selection profile id is required to read selection provenance.");
  if (!input.stationId?.trim() || input.stationId.length > STATION_ID_MAX_CHARS) throw new Error("A station id is required to read selection provenance.");
  const reference = await resolveReference(input, options);
  const results = [activationConsumer(input, reference, options), await stationConsumer(input, reference, options), sessionConsumer(input, reference, options)];
  const drift = results.flatMap(result => driftFor(result, reference));
  return {
    schemaVersion: 1,
    readOnly: true,
    selectionProfile: input.profileId,
    selected: {
      profileId: reference.profileId,
      ...(reference.profileRevision === undefined ? {} : { profileRevision: reference.profileRevision, selectionCount: reference.selectionCount }),
      ...(reference.observedAt === undefined ? {} : { observedAt: reference.observedAt }),
      source: reference.source, reason: reference.reason,
    },
    consumers: results.map(result => result.consumer),
    drift: drift.slice(0, PROVENANCE_DRIFT_LIMIT),
    driftTruncated: drift.length > PROVENANCE_DRIFT_LIMIT,
  };
}
