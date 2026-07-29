/**
 * vendor-host-guard.ts — machinery for the R1 boundary checks.
 *
 * R1: unconfigured OSS never produces a URL on a vendor-controlled host.
 *
 * WHAT THIS FILE CHECKS, PRECISELY — read this before trusting its silence.
 *
 * There are two checks with deliberately different strengths, and the
 * difference is the whole design:
 *
 *   1. `findDisallowedCodeUrls` — the STRONG check, over executable code.
 *      Every absolute http(s) URL that appears in a *string literal* in a
 *      packed `.ts`/`.js`-family file must be on `APPROVED_CODE_HOSTS`.
 *      It is an allowlist and it is position-independent: URLs are found by
 *      walking the TypeScript AST for string literals, so it does not matter
 *      whether the literal sits in a variable initializer, an object property,
 *      a function or constructor parameter default, a class field, a ternary
 *      branch, a `||`/`??` fallback, or a bare call argument. A host nobody has
 *      approved fails — including a vendor domain nobody has thought of yet.
 *
 *      An earlier version of this guard matched two hand-written syntactic
 *      shapes with regexes. It missed constructor parameter defaults and object
 *      properties, which is exactly how the rule gets broken in practice. The
 *      AST walk exists because a regex cannot honestly express "a URL literal
 *      is reachable as a default, in any position".
 *
 *   2. `findVendorHostReferences` — the WEAK check, over everything else
 *      (Markdown, JSON, plain text). It is a denylist keyed on
 *      `VENDOR_CONTROLLED_DOMAINS`, so it catches a *known* vendor domain in
 *      prose and does NOT catch an unknown one. That limit is real and stated
 *      here rather than glossed. It is acceptable only because prose cannot
 *      make a request; code can, and code is covered by check 1.
 *
 * Both run over the PACKED FILE LIST rather than `src/`: the `files` negation
 * globs in package.json mean the repository and the published package are
 * different sets of bytes, and only the published set is what a user installs.
 *
 * `typescript` is a devDependency. That is fine: this module is imported only
 * by the test suite and by `scripts/release-guard.ts`, both of which run with
 * devDependencies installed (`prepack` already shells out to `tsc`). Nothing in
 * the published runtime graph imports it.
 */

export * from "./vendor-host-policy.js";
export * from "./vendor-host-url.js";
export * from "./vendor-host-folding.js";
export * from "./vendor-host-code-scan.js";
export * from "./vendor-host-package.js";
