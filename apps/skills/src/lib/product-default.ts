// The product default: where `skills login` signs in when nothing is configured.
//
// Owner rulings, 2026-09-23 (Todos PLA8-00366; mementos 8a69c230 and b9ef785e):
// "Default to skills.md (Recommended)", and "the oss is not neutral, it should be
// primarily for skills.md, users can run their own api url, but the goal is to be
// skills.md centerd ... just like codex". That supersedes the earlier R1 rule that
// an unconfigured install names no host at all — for SIGNING IN only.
//
// These notes are line comments on purpose: declaration emit drops them, so the
// packed .d.ts carries no vendor domain (see vendor-host-policy.ts).

/**
 * Where `skills login` signs in when no URL and no credential are configured.
 *
 * It is not a data default: with no credential every data surface still fails
 * closed and sends nothing. It is not a fallback for a credential that already
 * resolves either: a legacy internal key with no bound URL keeps its internal
 * gateway, for data and for signing in, and is never sent here. A completed
 * sign-in records this origin beside the key it minted. Select another server
 * with `skills login --url <origin>` or HASNA_SKILLS_API_URL.
 *
 * Typed as `string` so the emitted declaration carries no literal host.
 */
export const SKILLS_PRODUCT_DEFAULT_ORIGIN: string = "https://skills.md";
