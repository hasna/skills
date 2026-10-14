import type { DiscoverySource } from "./agent-discovery.js";

/** What changed under a reviewed native discovery witness: a bound source
 * file's projected bytes, or a bound directory's membership. */
export type NativeDiscoveryWitnessKind = "input" | "membership";

/** A reviewed discovery witness no longer matches the current file system. It is
 * drift of something the review bound, never an invalid, missing or unresolvable
 * binding, which keep their own plain errors. The message is unchanged from the
 * plain error each site threw before, so every caller that does not tolerate
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

/** Live Codex prompt hook only. Decides, per changed witness, whether the change
 * is provably one a Codex vendor plugin refresh makes; accepted changes are
 * collected instead of refusing. Every other change still throws. */
export interface NativeDiscoveryWitnessTolerance {
  acceptsInput(source: DiscoverySource): boolean;
  acceptsMembership(path: string): boolean;
  readonly changes: NativeDiscoveryWitnessChange[];
}

/** Throw the change unless an opted-in tolerance accepted it. */
export function witnessChanged(change: NativeDiscoveryWitnessChange, tolerance: NativeDiscoveryWitnessTolerance | undefined, accepted: boolean): void {
  if (!tolerance || !accepted) throw change;
  tolerance.changes.push(change);
}
