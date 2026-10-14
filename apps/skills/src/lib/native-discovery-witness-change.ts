/** What changed under a reviewed native discovery witness: a bound source file's
 * projected bytes, a bound directory's membership, or the reviewed Codex plugin
 * capability controls. */
export type NativeDiscoveryWitnessKind = "input" | "membership" | "capability";

/** A reviewed discovery witness no longer matches the current file system. It is
 * drift of something the review bound, never an invalid, missing or unresolvable
 * binding, which keep their own plain errors. The message is unchanged from the
 * plain error each site threw before, so every caller that does not collect
 * these sees exactly the same refusal. */
export class NativeDiscoveryWitnessChange extends Error {
  readonly kind: NativeDiscoveryWitnessKind;
  /** Canonical path the witness bound, or null when the site names none. */
  readonly path: string | null;
  constructor(kind: NativeDiscoveryWitnessKind, path: string | null, message: string) {
    super(message);
    this.kind = kind;
    this.path = path;
  }
}

/** Throw the change, or hand it to an opted-in collector and continue. Only the
 * live Codex prompt hook supplies a collector; every other caller refuses. */
export function witnessChanged(change: NativeDiscoveryWitnessChange, collector?: NativeDiscoveryWitnessChange[]): void {
  if (!collector) throw change;
  collector.push(change);
}
