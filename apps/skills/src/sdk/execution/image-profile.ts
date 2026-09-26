/**
 * Immutable image profiles.
 *
 * A run's image is the union of (a) a pinned runtime image — bun, node, or
 * python3 at an exact version, carrying the supervisor and NO skills corpus;
 * the bundle is fetched by digest at run time — and (b) an optional prebuilt
 * dependency layer built at publish time when the skill manifest's
 * `system_deps` are allowlisted. Nothing is installed at execution time.
 *
 * Version pins live in code; image digests and the system_deps allowlist are
 * deployment configuration, because a digest names a concrete artifact in a
 * concrete registry. An un-pinned runtime or an unknown system_deps entry
 * fails closed at admission — a launch never carries a guess.
 */

import type { FrozenAdmission, RuntimeName } from "./types.js";

export type { RuntimeName };

export interface PinnedRuntime {
  runtime: RuntimeName;
  /** Exact pinned runtime version. */
  version: string;
  /** Image digest; null until deployment config supplies one. */
  imageDigest: string | null;
}

export interface DependencyLayerRule {
  /** Canonical system_deps key: sorted, unique, comma-joined. */
  canonicalKey: string;
  /** Prebuilt layer tag produced at publish time. */
  layerTag: string;
}

export interface ImageProfileRegistryConfig {
  runtimes: PinnedRuntime[];
  /** system_deps allowlist: canonical key -> prebuilt layer tag. */
  dependencyLayers: Record<string, string>;
}

export interface ResolvedImageProfile {
  runtime: PinnedRuntime;
  runtimeImageDigest: string;
  dependencyLayerTag: string | null;
}

export type ImageProfileResolutionFailure =
  | { reason: "UNKNOWN_RUNTIME"; runtime: string }
  | { reason: "UNPINNED_RUNTIME"; runtime: RuntimeName }
  | { reason: "UNALLOWED_SYSTEM_DEPS"; systemDeps: string[] };

export class ImageProfileResolutionError extends Error {
  readonly failure: ImageProfileResolutionFailure;
  constructor(failure: ImageProfileResolutionFailure) {
    super(imageProfileFailureMessage(failure));
    this.name = "ImageProfileResolutionError";
    this.failure = failure;
  }
}

/**
 * Pinned runtime versions. These match what the package itself is built with
 * (bun 1.3.14) plus the node and python lines the corpus's runtime contracts
 * name. Digests are deployment configuration and start null: admission refuses
 * an unpinned launch.
 */
export const DEFAULT_IMAGE_PROFILES: ImageProfileRegistryConfig = {
  runtimes: [
    { runtime: "bun", version: "1.3.14", imageDigest: null },
    { runtime: "node", version: "22.14.0", imageDigest: null },
    { runtime: "python3", version: "3.12.9", imageDigest: null },
  ],
  dependencyLayers: {},
};

export interface ImageProfileRegistry {
  resolve(runtime: RuntimeName, systemDeps: string[]): ResolvedImageProfile;
}

export function createImageProfileRegistry(config: ImageProfileRegistryConfig = DEFAULT_IMAGE_PROFILES): ImageProfileRegistry {
  const runtimes = new Map<RuntimeName, PinnedRuntime>();
  for (const pinned of config.runtimes) {
    runtimes.set(pinned.runtime, { ...pinned });
  }
  const allowlist = new Map<string, string>(Object.entries(config.dependencyLayers));

  return {
    resolve(runtime, systemDeps) {
      const pinned = runtimes.get(runtime);
      if (!pinned) throw new ImageProfileResolutionError({ reason: "UNKNOWN_RUNTIME", runtime });
      if (!pinned.imageDigest) throw new ImageProfileResolutionError({ reason: "UNPINNED_RUNTIME", runtime });
      const canonicalKey = canonicalSystemDepsKey(systemDeps);
      const dependencyLayerTag = canonicalKey === "" ? null : (allowlist.get(canonicalKey) ?? null);
      if (systemDeps.length > 0 && dependencyLayerTag === null) {
        throw new ImageProfileResolutionError({ reason: "UNALLOWED_SYSTEM_DEPS", systemDeps });
      }
      return { runtime: { ...pinned }, runtimeImageDigest: pinned.imageDigest, dependencyLayerTag };
    },
  };
}

/** Canonical system_deps key: sorted, unique, comma-joined. */
export function canonicalSystemDepsKey(systemDeps: string[]): string {
  // Commas separate entries in existing deployment keys; accepting them inside
  // one entry would let a different dependency tuple select the same layer.
  if (systemDeps.some(dep => typeof dep !== "string" || dep.length === 0 || dep.includes(","))) {
    throw new ImageProfileResolutionError({ reason: "UNALLOWED_SYSTEM_DEPS", systemDeps: [...systemDeps] });
  }
  return Array.from(new Set(systemDeps)).sort().join(",");
}

/** Build an allowlist entry from a manifest's declared system_deps. */
export function dependencyLayerRule(layerTag: string, systemDeps: string[]): DependencyLayerRule {
  return { canonicalKey: canonicalSystemDepsKey(systemDeps), layerTag };
}

function imageProfileFailureMessage(failure: ImageProfileResolutionFailure): string {
  switch (failure.reason) {
    case "UNKNOWN_RUNTIME":
      return `image profile: unknown runtime '${failure.runtime}' (allowed: bun, node, python3)`;
    case "UNPINNED_RUNTIME":
      return `image profile: runtime '${failure.runtime}' has no image digest configured; an unpinned launch is refused`;
    case "UNALLOWED_SYSTEM_DEPS":
      return `image profile: system_deps [${failure.systemDeps.join(", ")}] are not allowlisted; prebuilt layer required`;
  }
}

/** Resolve + freeze the image half of an admission. */
export function resolveImageProfile(
  registry: ImageProfileRegistry,
  input: { runtime: RuntimeName; systemDeps: string[] },
): Pick<FrozenAdmission, "runtime" | "runtimeImageDigest" | "dependencyLayerTag"> {
  const resolved = registry.resolve(input.runtime, input.systemDeps);
  return {
    runtime: resolved.runtime.runtime,
    runtimeImageDigest: resolved.runtimeImageDigest,
    dependencyLayerTag: resolved.dependencyLayerTag,
  };
}
