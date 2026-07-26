/**
 * vendor-host-guard.ts — machinery for the R1 boundary checks.
 *
 * R1: unconfigured OSS never produces a URL on a vendor-controlled host.
 *
 * Two independent checks live here, because neither one alone survives the way
 * this rule was broken before. On 2026-07-24 a default endpoint was changed
 * from one vendor host to a *different* vendor host and nothing noticed.
 *
 *   1. `findEndpointDefaults` — the DOMAIN-AGNOSTIC property. It flags any
 *      shipped file that hard-codes a literal URL as the default value of an
 *      API endpoint, regardless of which host that URL names. Swapping the
 *      vendor domain does not help you pass it; only deleting the default does.
 *      This is the check that would have caught the original regression.
 *
 *   2. `findVendorHostReferences` — a named-domain backstop for vendor hosts
 *      that appear anywhere else in the shipped bytes (docs, examples, error
 *      strings) where no "default value" syntax exists to key off. It is a
 *      denylist and is therefore explicitly the weaker of the two.
 *
 * Both are meant to be run over the PACKED FILE LIST rather than `src/`: the
 * `files` negation globs in package.json mean the repository and the published
 * package are different sets of bytes, and only the published set matters.
 */

/**
 * Registrable domains the vendor controls. Adding a new vendor domain to the
 * codebase without adding it here does NOT make it invisible — check 1 above is
 * domain-agnostic and still fires on any endpoint default.
 */
export const VENDOR_CONTROLLED_DOMAINS: readonly string[] = [
  "skills.md",
  "hasna.xyz",
  "hasna.dev",
  "hasna.com",
];

/**
 * Exact URLs that may appear in shipped bytes despite being on a vendor domain.
 * Matched on the full URL, never on the domain, so an endpoint on the same
 * domain is still a failure. Keep this list minimal and justified.
 */
export const VENDOR_HOST_URL_EXCEPTIONS: readonly { url: string; reason: string }[] = [
  {
    url: "https://hasna.dev/schemas/skill.v1.json",
    reason:
      "Stable `$schema` namespace identifier for the portable skill format. It is an " +
      "identity string compared by value and never fetched, so it is not an endpoint.",
  },
];

/**
 * The ONLY registrable domains a shipped file may hard-code as an endpoint
 * default. These are third-party providers the user configures directly with
 * their own key (R2's "BYO key, documented, never proxied"); the literal is the
 * provider's own published API address, not a service we operate.
 *
 * This list is an allowlist on purpose. Any other host — including a host the
 * vendor controls, and including a vendor domain nobody has thought of yet —
 * fails the check until someone adds it here in a reviewed change. That is what
 * makes the check survive a swap from one vendor domain to another.
 */
export const ENDPOINT_DEFAULT_ALLOWED_DOMAINS: readonly string[] = [
  "openai.com",
  "anthropic.com",
  "googleapis.com",
];

/** Multi-part public suffixes we need to fold correctly when reducing to eTLD+1. */
const MULTI_PART_SUFFIXES = new Set([
  "co.uk", "org.uk", "ac.uk", "com.au", "net.au", "org.au",
  "co.jp", "com.br", "co.nz", "co.in", "com.mx", "co.za",
]);

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1", "[::1]"]);

/** Reduce a hostname to its registrable domain (approximate eTLD+1). */
export function registrableDomain(host: string): string {
  const bare = host.toLowerCase().replace(/^\[|\]$/g, "").replace(/:\d+$/, "");
  const labels = bare.split(".").filter(Boolean);
  if (labels.length <= 2) return labels.join(".");
  const lastTwo = labels.slice(-2).join(".");
  return MULTI_PART_SUFFIXES.has(lastTwo) ? labels.slice(-3).join(".") : lastTwo;
}

export function isLoopbackHost(host: string): boolean {
  return LOOPBACK_HOSTS.has(host.toLowerCase().replace(/:\d+$/, ""));
}

export function isVendorControlledHost(host: string): boolean {
  return VENDOR_CONTROLLED_DOMAINS.includes(registrableDomain(host));
}

export interface UrlReference {
  /** The matched URL, trimmed of trailing punctuation. */
  url: string;
  /** Host component, lower-cased, port stripped. */
  host: string;
}

const ABSOLUTE_URL = /\bhttps?:\/\/[^\s"'`<>()[\]{}\\|^,;]+/gi;

/** Every absolute http(s) URL in a blob of text, with its host extracted. */
export function extractUrlReferences(text: string): UrlReference[] {
  const references: UrlReference[] = [];
  for (const match of text.matchAll(ABSOLUTE_URL)) {
    const url = match[0].replace(/[.:!?]+$/, "");
    const authority = url.slice(url.indexOf("//") + 2).split(/[/?#]/)[0];
    const host = authority.replace(/^[^@]*@/, "").replace(/:\d+$/, "").toLowerCase();
    if (!host) continue;
    references.push({ url, host });
  }
  return references;
}

export interface ScanSource {
  /** Package-relative path, used for reporting. */
  file: string;
  content: string;
}

export interface VendorHostFinding {
  file: string;
  url: string;
  host: string;
}

/** Backstop: vendor-domain URLs anywhere in the shipped bytes. */
export function findVendorHostReferences(sources: Iterable<ScanSource>): VendorHostFinding[] {
  const allowed = new Set(VENDOR_HOST_URL_EXCEPTIONS.map((entry) => entry.url));
  const findings: VendorHostFinding[] = [];
  for (const source of sources) {
    for (const reference of extractUrlReferences(source.content)) {
      if (!isVendorControlledHost(reference.host)) continue;
      if (allowed.has(reference.url)) continue;
      findings.push({ file: source.file, url: reference.url, host: reference.host });
    }
  }
  return findings;
}

export interface EndpointDefaultFinding {
  file: string;
  /** The identifier or env var whose default was hard-coded. */
  subject: string;
  url: string;
  host: string;
}

// A literal URL used as the `||` / `??` fallback of an API-URL lookup, e.g.
//   process.env.SKILLS_API_URL || config.apiUrl || "https://anything"
// Survives bundling and minification because the string literal survives.
/** Identifier tails that mean "this value is a network endpoint". */
const ENDPOINT_NAME_TAILS = [
  "API_URL", "APIURL", "ApiUrl", "apiUrl",
  "API_BASE", "ApiBase", "apiBase",
  "API_ORIGIN", "ApiOrigin", "apiOrigin",
  "API_HOST", "ApiHost", "apiHost",
];

/** Additional tails accepted only for a direct declaration (too loose for a `||` chain). */
const DECLARATION_ONLY_NAME_TAILS = ["ENDPOINT", "Endpoint", "BASE_URL", "BaseUrl", "baseUrl"];

const endpointName = (tails: string[]) => `([\\w$]*(?:${tails.join("|")}))`;

const ENV_FALLBACK_DEFAULT = new RegExp(
  `\\b${endpointName(ENDPOINT_NAME_TAILS)}\\b` +
    "((?:\\s*(?:\\|\\||\\?\\?)\\s*(?:[\\w$.()\\[\\]\"'`?!]+\\s*))*?\\s*(?:\\|\\||\\?\\?)\\s*)" +
    "([\"'`])(https?://[^\"'`]+)\\3",
  "g",
);

// A literal URL assigned to a declaration whose name says "endpoint", e.g.
//   const DEFAULT_SELF_HOSTED_API_URL = "https://anything"
const NAMED_ENDPOINT_DEFAULT = new RegExp(
  "\\b(?:const|let|var|readonly|static)\\s+" +
    `${endpointName([...ENDPOINT_NAME_TAILS, ...DECLARATION_ONLY_NAME_TAILS])}\\b` +
    "\\s*(?::[^=]+)?=\\s*" +
    "([\"'`])(https?://[^\"'`]+)\\2",
  "g",
);

/**
 * Property scan: does this file ship a hard-coded default for a network
 * endpoint on a host that is not an approved third-party provider?
 *
 * It never asks "is this host the vendor's". It asks "is this host on the short
 * approved list", so renaming the vendor's domain does not route around it.
 *
 * Loopback addresses are excluded — they name the reader's own machine, not
 * somebody else's service, and appear legitimately in scaffolding templates.
 * Loopback as a *credential* target is covered by the resolver property test,
 * which asserts an unconfigured install resolves to nothing at all.
 */
export function findEndpointDefaults(sources: Iterable<ScanSource>): EndpointDefaultFinding[] {
  const findings: EndpointDefaultFinding[] = [];
  for (const source of sources) {
    for (const [pattern, urlGroup, subjectGroup] of [
      [ENV_FALLBACK_DEFAULT, 4, 1],
      [NAMED_ENDPOINT_DEFAULT, 3, 1],
    ] as const) {
      pattern.lastIndex = 0;
      for (const match of source.content.matchAll(pattern)) {
        const url = match[urlGroup];
        const authority = url.slice(url.indexOf("//") + 2).split(/[/?#]/)[0];
        const host = authority.replace(/^[^@]*@/, "").replace(/:\d+$/, "").toLowerCase();
        if (isLoopbackHost(host)) continue;
        if (ENDPOINT_DEFAULT_ALLOWED_DOMAINS.includes(registrableDomain(host))) continue;
        findings.push({ file: source.file, subject: match[subjectGroup], url, host });
      }
    }
  }
  return findings;
}

/**
 * Read every text file in the published package as a scan source.
 *
 * Deliberately driven by the packer's own file list rather than by walking
 * `src/`: package.json's `files` negation globs mean the repository and the
 * published tarball are different sets of bytes, and the tarball is what a user
 * actually installs and runs.
 */
export function readPackedSources(
  packedFiles: readonly string[],
  root: string,
  fs: {
    existsSync: (path: string) => boolean;
    statSync: (path: string) => { isFile: () => boolean };
    readFileSync: (path: string) => Buffer;
  },
  joinPath: (...parts: string[]) => string,
): ScanSource[] {
  const sources: ScanSource[] = [];
  for (const file of packedFiles) {
    const absolute = joinPath(root, file);
    if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) continue;
    const buffer = fs.readFileSync(absolute);
    if (buffer.includes(0)) continue; // binary
    sources.push({ file, content: buffer.toString("utf8") });
  }
  return sources;
}

export function formatFindings(
  findings: ReadonlyArray<VendorHostFinding | EndpointDefaultFinding>,
): string {
  return findings
    .map((finding) =>
      "subject" in finding
        ? `  ${finding.file}: ${finding.subject} defaults to ${finding.url}`
        : `  ${finding.file}: ${finding.url}`,
    )
    .join("\n");
}
