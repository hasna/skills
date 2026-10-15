/**
 * One read-only provenance receipt for the Skills selection chain.
 *
 * The chain holds four different facts, and reading any one of them as "the
 * version this station runs" is the defect this receipt removes:
 *
 *   selected  — the shared profile the authority serves right now;
 *   activated — the profile snapshot THIS MACHINE last verified and activated,
 *               which is what its hooks, `skills context` and `skills load`
 *               resolve from. It belongs to the local host, never to a station
 *               named on the command line;
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
 * Every consumer is classified `current`, `behind`, `pinned` or `unverified`,
 * and always carries a stable `reasonCode` plus its reason. Applying a record,
 * reporting a station or publishing a profile never closes adoption on its own.
 *
 * Identity is part of the comparison, not an afterthought: a revision that
 * matches under a different authority, workspace or profile is NOT current —
 * it is `IDENTITY_MISMATCH`, exactly as the resolver refuses it. Comparing
 * revisions alone would report a foreign pin as current.
 *
 * It only reads: no pin, receipt, cache entry or station record is created or
 * changed, no skill payload is fetched, and no credential is rendered. Nothing
 * from a reader's exception message is ever echoed: diagnostics are a fixed
 * vocabulary of codes and fixed sentences, because truncating foreign text is
 * not redacting it. With no authenticated authority read the reference is the
 * locally synced snapshot and every comparison is `unverified` rather than a
 * guess.
 */
import { inspectSkillSession } from "./session-reconciliation.js";
import { readStationSkillState } from "./profile-admin.js";
import { createProfileClient } from "./profile-client.js";
import { readSelectionProfile, type SelectionCacheOptions } from "./selection-cache.js";

/** Bounded so one receipt can never carry an unbounded drift list. */
export const PROVENANCE_DRIFT_LIMIT = 200;
/** A label is echoed only when it matches this: identifiers, not free text. */
const SAFE_LABEL = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const LABEL_MAX_CHARS = 200;

export type SelectionProvenanceStatus = "current" | "behind" | "pinned" | "unverified";
export type SelectionProvenanceSource = "local-receipt" | "authority-receipt" | "session-receipt";
export type SelectionProvenanceReference = "authority" | "synced-snapshot" | "unavailable";
/**
 * The fixed diagnostic vocabulary. A reader's exception text is never carried,
 * only one of these codes, so a foreign body or a credential inside an error
 * string cannot reach a receipt that may be shared.
 */
export type SelectionProvenanceReason =
  | "CURRENT_SCHEMA_MATCH"
  | "REVISION_BEHIND"
  | "PINNED_BY_DESIGN"
  | "IDENTITY_MISMATCH"
  | "DIFFERENT_PROFILE"
  | "NO_LOCAL_RECEIPT"
  | "NO_SESSION_NAMED"
  | "NO_SESSION_RECEIPT"
  | "NO_STATION_RECEIPT"
  | "READ_REFUSED"
  | "REFERENCE_NOT_AUTHORITY"
  | "REFERENCE_UNAVAILABLE"
  | "NO_STATION_REPORTED";

export interface SelectionProvenanceVersion { slug: string; version: string; bundleDigest?: string }
export interface SelectionProvenanceConsumer {
  kind: "station" | "session";
  source: SelectionProvenanceSource;
  /** The local host for a local receipt, the requested station only for the authority receipt. */
  id: string;
  /** Whether `id` names the host running this command or a station named on the command line. */
  idKind: "local-host" | "requested-station";
  profileId?: string;
  profileRevision?: string;
  /** Compared, never assumed: a matching revision under another identity is not current. */
  authority?: string;
  workspaceId?: string;
  observedAt?: string;
  selectionCount?: number;
  /** Only for a session: how many of its selections it really loaded. */
  loadedCount?: number;
  /** Only for a session: the exact versions it really loaded. */
  consumed?: SelectionProvenanceVersion[];
  status: SelectionProvenanceStatus;
  reasonCode: SelectionProvenanceReason;
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
    authority?: string;
    workspaceId?: string;
    source: SelectionProvenanceReference;
    observedAt?: string;
    reasonCode: SelectionProvenanceReason;
    reason: string;
  };
  consumers: SelectionProvenanceConsumer[];
  drift: SelectionProvenanceDrift[];
  driftTruncated: boolean;
  /**
   * What this receipt deliberately does not attest. Version and digest evidence
   * for published payloads, native discovery, native locks and live consumer
   * adoption are outside this command and stay unverified here rather than being
   * implied by a clean-looking result.
   */
  notAttested: string[];
}
export interface SelectionProvenanceInput {
  profileId: string;
  /** The station whose authority-held sync receipt is read. */
  stationId: string;
  /** The host this command runs on. Never conflated with `stationId`. */
  localStationId: string;
  sessionId?: string;
  /** Read the reference from the locally synced snapshot; never ask the authority. */
  cached?: boolean;
}
/** A station receipt reduced to what this receipt compares. */
export interface ProvenanceStationObservation {
  profileId: string;
  profileRevision: string;
  appliedAt: string;
  workspaceId?: string;
  selections: readonly { slug: string; version: string }[];
}
export interface SelectionProvenanceOptions extends SelectionCacheOptions {
  /** Injected by the SDK and tests; defaults to the authenticated reads. */
  readSelected?: (profileId: string) => Promise<{ profileId: string; profileRevision: string; authority?: string; workspaceId?: string; selections: readonly { slug: string; version: string }[] }>;
  readStation?: (stationId: string) => Promise<ProvenanceStationObservation>;
}

type Attempt<T> = { ok: true; value: T } | { ok: false; code: SelectionProvenanceReason };
/** One consumer, plus the exact versions it is compared on. */
interface ConsumerResult { consumer: SelectionProvenanceConsumer; compared: readonly { slug: string; version: string }[] }
interface Reference {
  profileId: string;
  profileRevision?: string;
  selectionCount?: number;
  authority?: string;
  workspaceId?: string;
  observedAt?: string;
  source: SelectionProvenanceReference;
  reasonCode: SelectionProvenanceReason;
  reason: string;
  selections: readonly { slug: string; version: string }[];
}
interface Identity { profileId?: string; profileRevision?: string; authority?: string; workspaceId?: string }

const noSelections: readonly { slug: string; version: string }[] = [];
/** Echo an identifier, or a fixed placeholder. Never free text, which may carry a capability. */
function label(value: string | undefined): string {
  return value !== undefined && SAFE_LABEL.test(value) ? value : "an unnamed value";
}
/**
 * A reader's failure is a fact about verification, not a command failure, and its
 * message is never carried: it may contain a foreign body or a bearer capability,
 * and bounding text is not redacting it. Only a stable class code is recorded.
 */
async function attempt<T>(read: () => Promise<T>): Promise<Attempt<T>> {
  try {
    return { ok: true, value: await read() };
  } catch {
    return { ok: false, code: "READ_REFUSED" };
  }
}
/** Compared by exact revision: equal counts would pass a wholly rewritten profile. */
function sameRevision(observed: string | undefined, reference: string | undefined): boolean {
  return observed !== undefined && reference !== undefined && observed === reference;
}
/** The resolver's identity rule, as a predicate: profile, authority and workspace all bind. */
function sameIdentity(observed: Identity, reference: Identity): boolean {
  if (observed.profileId !== undefined && reference.profileId !== undefined && observed.profileId !== reference.profileId) return false;
  if (observed.authority !== undefined && reference.authority !== undefined && observed.authority !== reference.authority) return false;
  if (observed.workspaceId !== undefined && reference.workspaceId !== undefined && observed.workspaceId !== reference.workspaceId) return false;
  return true;
}
/**
 * Whether every identity field this SOURCE is expected to record was available to
 * compare. A session and a local receipt carry authority and workspace; the
 * authority's station receipt records only the workspace, so requiring an
 * authority of it would mark every station unverified. A field that cannot be
 * compared is never treated as matching.
 */
type IdentityField = "authority" | "workspaceId";
function identityCompared(observed: Identity, reference: Identity, required: readonly IdentityField[]): boolean {
  return required.every(field => observed[field] !== undefined && reference[field] !== undefined);
}
function revisionReason(labelText: string, observed: string | undefined, reference: string | undefined, status: SelectionProvenanceStatus): string {
  const seen = label(observed);
  if (status === "current") return `${labelText} revision ${seen} is the selected revision`;
  return `${labelText} revision ${seen} is not the selected revision ${label(reference)}`;
}

/** The reference every consumer is compared with, and why it is that one. */
async function resolveReference(input: SelectionProvenanceInput, options: SelectionProvenanceOptions): Promise<Reference> {
  const fromSnapshot = (reasonCode: SelectionProvenanceReason, because: string): Reference => {
    let receipt;
    try { receipt = readSelectionProfile(input.profileId, options); } catch {
      return { profileId: input.profileId, source: "unavailable", reasonCode: "REFERENCE_UNAVAILABLE", reason: `${because} The locally synced snapshot is unreadable too.`, selections: noSelections };
    }
    if (!receipt) return { profileId: input.profileId, source: "unavailable", reasonCode: "REFERENCE_UNAVAILABLE", reason: `${because} Nothing is synced locally either, so no consumer can be compared.`, selections: noSelections };
    return {
      profileId: receipt.profile.profileId, profileRevision: receipt.profile.profileRevision, selectionCount: receipt.profile.selections.length,
      authority: receipt.profile.authority, workspaceId: receipt.profile.workspaceId,
      observedAt: receipt.verifiedAt, source: "synced-snapshot", reasonCode,
      reason: `${because} Comparisons use the locally synced snapshot (posted work is not proof of adoption), so every consumer below is reported unverified rather than current.`,
      selections: receipt.profile.selections,
    };
  };
  if (input.cached) return fromSnapshot("REFERENCE_NOT_AUTHORITY", "--cached was requested, so the authority was not read.");
  const read = options.readSelected ?? (async (profileId: string) => {
    // The client's own resolve, not the admin read: this is the abstraction whose
    // authority and workspace the stored receipts and the resolver both bind to,
    // so the identity compared below is the real one rather than a re-derived string.
    const client = await createProfileClient();
    const profile = await client.resolveProfile(profileId);
    return { profileId: profile.profileId, profileRevision: profile.profileRevision, authority: profile.authority, workspaceId: profile.workspaceId, selections: profile.selections };
  });
  const attempted = await attempt(() => read(input.profileId));
  if (!attempted.ok) return fromSnapshot("READ_REFUSED", "The authority did not answer for the selected profile.");
  const profile = attempted.value;
  if (!profile?.profileId || !profile.profileRevision || !Array.isArray(profile.selections)) {
    return { profileId: input.profileId, source: "unavailable", reasonCode: "REFERENCE_UNAVAILABLE", reason: "The authority returned a selection profile this client does not recognise, so no consumer can be compared.", selections: noSelections };
  }
  return {
    profileId: profile.profileId, profileRevision: profile.profileRevision, selectionCount: profile.selections.length,
    ...(profile.authority === undefined ? {} : { authority: profile.authority }),
    ...(profile.workspaceId === undefined ? {} : { workspaceId: profile.workspaceId }),
    source: "authority", reasonCode: "REFERENCE_NOT_AUTHORITY", reason: `Read from the authority for profile ${label(profile.profileId)}.`, selections: profile.selections,
  };
}

/** What this machine last verified and activated: what its hooks actually resolve. */
function activationConsumer(input: SelectionProvenanceInput, reference: Reference, options: SelectionProvenanceOptions): ConsumerResult {
  const base: SelectionProvenanceConsumer = {
    kind: "station", source: "local-receipt", id: input.localStationId, idKind: "local-host", status: "unverified", reasonCode: "NO_LOCAL_RECEIPT", reason: "",
  };
  const refuse = (reasonCode: SelectionProvenanceReason, reason: string): ConsumerResult => ({ consumer: { ...base, reasonCode, reason }, compared: noSelections });
  let receipt;
  try { receipt = readSelectionProfile(input.profileId, options); } catch {
    return refuse("READ_REFUSED", `This machine's activated snapshot for profile ${label(input.profileId)} could not be read.`);
  }
  if (!receipt) return refuse("NO_LOCAL_RECEIPT", `This machine holds no activated snapshot for profile ${label(input.profileId)}.`);
  const profile = receipt.profile;
  const observed: SelectionProvenanceConsumer = {
    ...base, profileId: profile.profileId, profileRevision: profile.profileRevision,
    ...(profile.authority === undefined ? {} : { authority: profile.authority }),
    ...(profile.workspaceId === undefined ? {} : { workspaceId: profile.workspaceId }),
    observedAt: receipt.verifiedAt, selectionCount: profile.selections.length,
  };
  if (!sameIdentity(observed, reference)) {
    return { consumer: { ...observed, status: "unverified", reasonCode: "IDENTITY_MISMATCH", reason: `This machine's activated snapshot is not the selected selection's identity: it differs in profile, authority or workspace, so it is not current whatever its revision.` }, compared: noSelections };
  }
  if (reference.source !== "authority") {
    return { consumer: { ...observed, status: "unverified", reasonCode: reference.reasonCode, reason: `${reference.reason} This snapshot alone cannot say whether the machine is current.` }, compared: noSelections };
  }
  if (!identityCompared(observed, reference, ["authority", "workspaceId"])) {
    return { consumer: { ...observed, status: "unverified", reasonCode: "IDENTITY_MISMATCH", reason: `The activated snapshot omits an identity field the selected profile records, so its identity cannot be compared; it is not reported current.` }, compared: noSelections };
  }
  const status: SelectionProvenanceStatus = sameRevision(profile.profileRevision, reference.profileRevision) ? "current" : "behind";
  return {
    consumer: {
      ...observed, status, reasonCode: status === "current" ? "CURRENT_SCHEMA_MATCH" : "REVISION_BEHIND",
      reason: status === "current"
        ? revisionReason("This machine's activated snapshot", profile.profileRevision, reference.profileRevision, "current")
        : `${revisionReason("This machine's activated snapshot", profile.profileRevision, reference.profileRevision, "behind")}. Run skills sync to activate the selected revision here.`,
    },
    compared: profile.selections,
  };
}

/** One station's sync state as the authority records it. */
async function stationConsumer(input: SelectionProvenanceInput, reference: Reference, options: SelectionProvenanceOptions): Promise<ConsumerResult> {
  const base: SelectionProvenanceConsumer = {
    kind: "station", source: "authority-receipt", id: input.stationId, idKind: "requested-station", status: "unverified", reasonCode: "NO_STATION_REPORTED", reason: "",
  };
  const refuse = (reasonCode: SelectionProvenanceReason, reason: string): ConsumerResult => ({ consumer: { ...base, reasonCode, reason }, compared: noSelections });
  if (reference.source !== "authority") {
    return refuse("REFERENCE_NOT_AUTHORITY", "The station receipt was not compared: this receipt has no authenticated selection to compare it with.");
  }
  const read = options.readStation ?? (async (stationId: string) => {
    const state = await readStationSkillState(stationId);
    return { profileId: state.profileId, profileRevision: state.profileRevision, appliedAt: state.appliedAt, workspaceId: state.workspaceId, selections: state.selections };
  });
  const attempted = await attempt(() => read(input.stationId));
  if (!attempted.ok) return refuse("READ_REFUSED", `The authority did not answer for station ${label(input.stationId)}.`);
  const station = attempted.value;
  const observed: SelectionProvenanceConsumer = {
    ...base, profileId: station.profileId, profileRevision: station.profileRevision,
    ...(station.workspaceId === undefined ? {} : { workspaceId: station.workspaceId }),
    observedAt: station.appliedAt, selectionCount: station.selections.length,
  };
  if (!sameIdentity(observed, reference)) {
    return { consumer: { ...observed, status: "unverified", reasonCode: "IDENTITY_MISMATCH", reason: `Station ${label(input.stationId)} last applied a different selection identity: it differs in profile or workspace from the selected profile.` }, compared: noSelections };
  }
  if (!identityCompared(observed, reference, ["workspaceId"])) {
    return { consumer: { ...observed, status: "unverified", reasonCode: "IDENTITY_MISMATCH", reason: `The receipt the authority holds for station ${label(input.stationId)} does not record the workspace the selected profile binds, so its identity cannot be compared; it is not reported current.` }, compared: noSelections };
  }
  if (sameRevision(station.profileRevision, reference.profileRevision)) {
    return { consumer: { ...observed, status: "current", reasonCode: "CURRENT_SCHEMA_MATCH", reason: revisionReason(`The receipt the authority holds for station ${label(input.stationId)}`, station.profileRevision, reference.profileRevision, "current") }, compared: station.selections };
  }
  return {
    consumer: {
      ...observed, status: "behind", reasonCode: "REVISION_BEHIND",
      reason: `${revisionReason(`The receipt the authority holds for station ${label(input.stationId)}`, station.profileRevision, reference.profileRevision, "behind")}. Only an explicit skills sync writes this record, so report it before treating the machine as adrift.`,
    },
    compared: station.selections,
  };
}

/** One session's immutable pin and the versions it really loaded. */
function sessionConsumer(input: SelectionProvenanceInput, reference: Reference, options: SelectionProvenanceOptions): ConsumerResult {
  const unnamed: SelectionProvenanceConsumer = {
    kind: "session", source: "session-receipt", id: "unnamed", idKind: "local-host", status: "unverified", reasonCode: "NO_SESSION_NAMED",
    reason: "No session was named, so its pin and load receipts were not read; pass --session <id>.",
  };
  if (!input.sessionId) return { consumer: unnamed, compared: noSelections };
  const base: SelectionProvenanceConsumer = {
    kind: "session", source: "session-receipt", id: input.sessionId, idKind: "local-host", status: "unverified", reasonCode: "NO_SESSION_RECEIPT", reason: "",
  };
  const refuse = (reasonCode: SelectionProvenanceReason, reason: string): ConsumerResult => ({ consumer: { ...base, reasonCode, reason }, compared: noSelections });
  let session;
  try { session = inspectSkillSession(input.sessionId, options); } catch {
    return refuse("READ_REFUSED", `The session receipt for the named session could not be read.`);
  }
  const consumed = session.selections.filter(selection => selection.loaded).map(selection => ({ slug: selection.slug, version: selection.version, bundleDigest: selection.bundleDigest }));
  const observed: SelectionProvenanceConsumer = {
    ...base, profileId: session.profileId, profileRevision: session.profileRevision,
    ...(session.authority === undefined ? {} : { authority: session.authority }),
    ...(session.workspaceId === undefined ? {} : { workspaceId: session.workspaceId }),
    observedAt: session.verifiedAt, selectionCount: session.selectionCount, loadedCount: session.loadedCount, consumed,
  };
  if (!sameIdentity(observed, reference)) {
    return { consumer: { ...observed, status: "unverified", reasonCode: "IDENTITY_MISMATCH", reason: "The session pin is not the selected selection's identity: it differs in profile, authority or workspace, so it is not current whatever its revision." }, compared: noSelections };
  }
  if (reference.source !== "authority") {
    return { consumer: { ...observed, status: "unverified", reasonCode: reference.reasonCode, reason: `${reference.reason} This pin alone cannot say whether the session is current.` }, compared: noSelections };
  }
  if (!identityCompared(observed, reference, ["authority", "workspaceId"])) {
    return { consumer: { ...observed, status: "unverified", reasonCode: "IDENTITY_MISMATCH", reason: "The session receipt omits an identity field the selected profile records, so its identity cannot be compared; it is not reported current." }, compared: noSelections };
  }
  if (sameRevision(session.profileRevision, reference.profileRevision)) {
    return {
      consumer: { ...observed, status: "current", reasonCode: "CURRENT_SCHEMA_MATCH", reason: `${revisionReason("The session pin", session.profileRevision, reference.profileRevision, "current")}; it loaded ${session.loadedCount} of ${session.selectionCount} selections.` },
      compared: consumed,
    };
  }
  return {
    consumer: {
      ...observed, status: "pinned", reasonCode: "PINNED_BY_DESIGN",
      reason: `${revisionReason("The session pin", session.profileRevision, reference.profileRevision, "pinned")}. A session keeps its revision when the profile moves on, so this is custody by design; skills sessions reconcile moves it intentionally.`,
    },
    compared: consumed,
  };
}

/** The exact versions one consumer differs on. Empty unless the reference is the authority. */
function driftFor(result: ConsumerResult, reference: Reference): SelectionProvenanceDrift[] {
  if (reference.source !== "authority" || result.compared.length === 0) return [];
  // A consumer from another identity is never diffed: its selections are not the
  // selected profile's, so every row would be a false difference.
  if (result.consumer.status === "unverified" && result.consumer.reasonCode === "IDENTITY_MISMATCH") return [];
  const selected = new Map(reference.selections.map(selection => [selection.slug, selection.version]));
  return result.compared
    .filter(selection => selected.has(selection.slug) && selected.get(selection.slug) !== selection.version)
    .map(selection => ({ source: result.consumer.source, id: result.consumer.id, slug: selection.slug, selectedVersion: selected.get(selection.slug)!, observedVersion: selection.version }))
    .sort((left, right) => left.slug.localeCompare(right.slug) || left.source.localeCompare(right.source));
}

export async function readSelectionProvenance(input: SelectionProvenanceInput, options: SelectionProvenanceOptions = {}): Promise<SelectionProvenanceReceipt> {
  if (!input.profileId?.trim()) throw new Error("A selection profile id is required to read selection provenance.");
  if (!input.stationId?.trim() || input.stationId.length > LABEL_MAX_CHARS) throw new Error("A station id is required to read selection provenance.");
  if (!input.localStationId?.trim() || input.localStationId.length > LABEL_MAX_CHARS) throw new Error("The local host id is required to read selection provenance.");
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
      ...(reference.authority === undefined ? {} : { authority: reference.authority }),
      ...(reference.workspaceId === undefined ? {} : { workspaceId: reference.workspaceId }),
      ...(reference.observedAt === undefined ? {} : { observedAt: reference.observedAt }),
      source: reference.source, reasonCode: reference.reasonCode, reason: reference.reason,
    },
    consumers: results.map(result => result.consumer),
    drift: drift.slice(0, PROVENANCE_DRIFT_LIMIT),
    driftTruncated: drift.length > PROVENANCE_DRIFT_LIMIT,
    notAttested: [
      "Published version and digest evidence for skill payloads: read it with skills versions and skills review-export.",
      "Native discovery, native locks and project locks: read them with skills hook check and skills sessions recover-lock.",
      "Live consumer adoption: a receipt shows what a session loaded, never that an agent honoured it.",
    ],
  };
}
