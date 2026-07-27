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

import ts from "typescript";
import { decodeForScanning, looksBinary } from "./file-bytes.js";

/**
 * Registrable domains the vendor controls. A URL on one of these fails both
 * checks. Adding a new vendor domain to the codebase without adding it here
 * does NOT make it invisible: check 1 is an allowlist, so an unlisted domain
 * fails as "unapproved" even if nobody has classified it as ours.
 */
export const VENDOR_CONTROLLED_DOMAINS: readonly string[] = [
  "skills.md",
  "hasna.xyz",
  "hasna.dev",
  "hasna.com",
];

/**
 * POLICY — third-party endpoint defaults vs vendor endpoint defaults.
 *
 * R1 bans defaulting to hosts *we operate*. It does not ban a bring-your-own-key
 * skill from naming the public API of the provider whose key the user supplies:
 * `api.openai.com` in a skill pointed at the user's own OpenAI account is the
 * provider's published address, not a service we run, and there is no other
 * value it could sensibly take. That is legitimate under R2's "third-party
 * provider the user configures directly (BYO key — documented, never proxied)".
 *
 * So the distinction is explicit rather than accidental:
 *
 *   - a default endpoint on a host WE operate            → forbidden, always;
 *   - a default endpoint on an approved third-party host → allowed;
 *   - a default endpoint on any other host               → forbidden until
 *     reviewed and listed here with a reason.
 *
 * Every entry is a registrable domain plus its justification. This list doubles
 * as the inventory of every host the published code is able to name.
 */
export const APPROVED_CODE_HOSTS: readonly { domain: string; reason: string }[] = [
  // --- Third-party provider APIs (BYO key: the user supplies the credential) ---
  { domain: "openai.com", reason: "OpenAI public API and docs; BYO OPENAI_API_KEY." },
  { domain: "anthropic.com", reason: "Anthropic public API; BYO ANTHROPIC_API_KEY." },
  { domain: "x.ai", reason: "xAI public API; BYO XAI_API_KEY." },
  { domain: "googleapis.com", reason: "Google public APIs (Gemini, Gmail, Calendar); BYO Google credential." },
  { domain: "godaddy.com", reason: "GoDaddy domain API used by the domain-search skill; BYO DOMAIN_API_KEY." },
  { domain: "amazonaws.com", reason: "AWS service endpoints from the bundled AWS SDK; BYO AWS credentials." },
  { domain: "amazon.com", reason: "AWS docs links inside the bundled AWS SDK." },
  { domain: "amazonaws-us-gov.com", reason: "AWS GovCloud endpoints from the bundled AWS SDK." },
  { domain: "api.aws", reason: "AWS dual-stack service endpoint domain from the bundled AWS SDK." },
  { domain: "amazonaws.cn", reason: "AWS China partition endpoints from the bundled AWS SDK." },
  { domain: "amazonwebservices.com.cn", reason: "AWS China partition endpoints from the bundled AWS SDK." },
  { domain: "amazonaws-eusc.eu", reason: "AWS European Sovereign Cloud endpoints from the bundled AWS SDK." },
  { domain: "adc-e.uk", reason: "AWS UK partition endpoints from the bundled AWS SDK." },
  { domain: "ic.gov", reason: "AWS Top Secret partition endpoints from the bundled AWS SDK." },
  { domain: "sgov.gov", reason: "AWS Secret partition endpoints from the bundled AWS SDK." },
  { domain: "169.254.169.254", reason: "AWS EC2 instance metadata address, hard-coded by the bundled AWS SDK." },
  { domain: "169.254.170.2", reason: "AWS ECS container credentials address, hard-coded by the bundled AWS SDK." },

  // --- Reserved / non-routable example hosts used in generated docs and tests ---
  { domain: "example.com", reason: "RFC 2606 reserved example domain." },
  { domain: "example.org", reason: "RFC 2606 reserved example domain." },
  { domain: "example.net", reason: "RFC 2606 reserved example domain." },

  // --- Documentation and reference links embedded in generated scaffolding ---
  { domain: "github.com", reason: "This project's own repository and GitHub docs links." },
  { domain: "githubusercontent.com", reason: "Raw GitHub content links in generated docs." },
  { domain: "npmjs.org", reason: "The npm registry, named by install instructions." },
  { domain: "json-schema.org", reason: "JSON Schema spec URIs (identifiers, not endpoints)." },
  { domain: "w3.org", reason: "W3C namespace URIs in generated SVG/XML (identifiers, not endpoints)." },
  { domain: "sitemaps.org", reason: "Sitemap protocol namespace URI in generated XML." },
  { domain: "nextjs.org", reason: "Framework docs link in generated project scaffolding." },
  { domain: "react.dev", reason: "Framework docs link in generated project scaffolding." },
  { domain: "reactjs.org", reason: "Legacy framework docs link in generated project scaffolding." },
  { domain: "tailwindcss.com", reason: "Framework docs link in generated project scaffolding." },
  { domain: "prisma.io", reason: "ORM docs link in generated project scaffolding." },
  { domain: "drizzle.team", reason: "ORM docs link in generated project scaffolding." },
  { domain: "shadcn.com", reason: "Component library docs link in generated project scaffolding." },
  { domain: "vercel.com", reason: "Deployment docs link in generated project scaffolding." },
  { domain: "railway.app", reason: "Deployment docs link in generated project scaffolding." },
  { domain: "jsdelivr.net", reason: "CDN link in generated static dashboard markup." },
  { domain: "ffmpeg.org", reason: "Install instructions for the ffmpeg system dependency." },
  { domain: "swagger.io", reason: "Public OpenAPI sample spec used as a CLI usage example." },
  { domain: "opencode.ai", reason: "Supported agent runtime named in agent-registration output." },
  { domain: "stripe.com", reason: "Docs link in the third-party site-analysis skill's checklist output." },
  { domain: "realfavicongenerator.net", reason: "Reference link in generated favicon instructions." },
  { domain: "picsum.photos", reason: "Placeholder image service in generated mock data." },
  { domain: "pravatar.cc", reason: "Placeholder avatar service in generated mock data." },
  { domain: "youtube.com", reason: "Public video URLs accepted as input by the downloader skill." },
  { domain: "canny.io", reason: "Third-party link inside a bundled dependency." },
  { domain: "fburl.com", reason: "Third-party link inside a bundled dependency (React)." },
  { domain: "a.co", reason: "Third-party link inside a bundled dependency (AWS SDK)." },
];

/**
 * Exact URLs that may appear despite being on a vendor domain. Matched on the
 * full URL, never on the domain, so a real endpoint on the same domain still
 * fails. Keep minimal and justified.
 */
export const VENDOR_HOST_URL_EXCEPTIONS: readonly { url: string; reason: string }[] = [
  {
    url: "https://hasna.dev/schemas/skill.v1.json",
    reason:
      "Stable `$schema` namespace identifier for the portable skill format. It is an " +
      "identity string compared by value and never fetched, so it is not an endpoint.",
  },
];

/** Multi-part public suffixes we need to fold correctly when reducing to eTLD+1. */
const MULTI_PART_SUFFIXES = new Set([
  "co.uk", "org.uk", "ac.uk", "com.au", "net.au", "org.au",
  "co.jp", "com.br", "co.nz", "co.in", "com.mx", "co.za",
  "com.cn", "net.cn", "org.cn",
]);

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1", "[::1]"]);

const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;

/** Reduce a hostname to its registrable domain (approximate eTLD+1). */
export function registrableDomain(host: string): string {
  const bare = host.toLowerCase().replace(/^\[|\]$/g, "").replace(/:\d+$/, "");
  if (IPV4.test(bare)) return bare;
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

export function isApprovedCodeHost(host: string): boolean {
  const domain = registrableDomain(host);
  return APPROVED_CODE_HOSTS.some((entry) => entry.domain === domain);
}

/**
 * Packed files allowed to contain a host whose TLD is supplied by `{…}` template
 * syntax (`https://s3.{partitionResult#dnsSuffix}`). These are bundles of the
 * AWS SDK, whose endpoint-rule engine substitutes the DNS suffix per partition.
 *
 * File-scoped on purpose: the carve-out used to be package-wide, which meant any
 * file could park a partial authority next to a runtime value and be exempted.
 * A host completed from a *code* expression is never exempt, in any file.
 */
export const TEMPLATE_HOST_FILES: readonly { file: string; reason: string }[] = [
  { file: "bin/server.js", reason: "Bundles the AWS SDK endpoint-rule tables (S3, STS, SSO, signin)." },
  { file: "bin/worker.js", reason: "Bundles the AWS SDK endpoint-rule tables (S3, STS, SSO, signin)." },
  { file: "bin/index.js", reason: "Bundles the AWS SDK endpoint-rule tables via the storage module." },
  { file: "bin/mcp.js", reason: "Bundles the AWS SDK endpoint-rule tables via the storage module." },
  { file: "bin/migrate.js", reason: "Bundles the AWS SDK endpoint-rule tables via the storage module." },
  { file: "dist/index.js", reason: "Bundles the AWS SDK endpoint-rule tables via the storage module." },
  { file: "dist/storage.js", reason: "Bundles the AWS SDK endpoint-rule tables." },
];

function allowsTemplateHost(file: string): boolean {
  return TEMPLATE_HOST_FILES.some((entry) => entry.file === file);
}

/**
 * Sites that build a host out of a computed value.
 *
 * Building a host from configuration is exactly what R1 asks for, so these are
 * not defects — but they are also the shape an endpoint default hides in, so
 * each one is acknowledged here rather than exempted by a blanket rule. Matched
 * on file AND exact URL fragment, never on file alone, and never on line number
 * so that rebuilding a bundle does not churn the list. A new dynamic-host site
 * fails until someone reads it and adds it.
 */
export const DYNAMIC_HOST_SITES: readonly { file: string; path: string; expr: string; reason: string }[] = [
  {
    file: "src/mcp/http.ts",
    path: "",
    expr: "req.headers.host",
    reason: "Parses an INBOUND request's Host header to resolve a relative URL; nothing is dialled.",
  },
  {
    file: "bin/mcp.js",
    path: "",
    expr: "req.headers.host",
    reason: "Bundled copy of src/mcp/http.ts inbound Host-header parsing.",
  },
  {
    file: "src/mcp/http.ts",
    path: "/mcp",
    expr: "listenPort",
    reason: "Logs the address the MCP server just bound to.",
  },
  {
    file: "bin/mcp.js",
    path: "/mcp",
    expr: "listenPort",
    reason: "Bundled copy of the MCP bound-address log line.",
  },
  {
    file: "src/server/index.ts",
    path: "",
    expr: "config.host",
    reason: "Logs the address the API server just bound to.",
  },
  {
    file: "bin/server.js",
    path: "",
    expr: "config.host",
    reason: "Bundled copy of the API server bound-address log line.",
  },
  {
    file: "src/server/config.ts",
    path: "",
    expr: "hostname.includes",
    reason: "Derives the server's own public origin from its bound host and port, with no vendor default.",
  },
  {
    file: "bin/server.js",
    path: "",
    expr: "hostname.includes",
    reason: "Bundled copy of the server's own-origin derivation.",
  },
  {
    file: "bin/worker.js",
    path: "",
    expr: "hostname.includes",
    reason: "Bundled copy of the server's own-origin derivation.",
  },
  {
    file: "bin/migrate.js",
    path: "",
    expr: "hostname.includes",
    reason: "Bundled copy of the server's own-origin derivation.",
  },
  {
    file: "bin/server.js",
    path: "",
    expr: "DEFAULT_LINK_LOCAL_HOST",
    reason: "Bundled AWS SDK appends a relative path to the ECS link-local credentials address.",
  },
  {
    file: "skills/brand-assets/src/index.ts",
    path: "",
    expr: "${input}",
    reason:
      "Adds a scheme to the URL the user named on the command line when they omitted one. " +
      "The host comes entirely from --url, which is required and has no default: the skill " +
      "refuses to run without it and has no brand-name search fallback, so nothing is dialled " +
      "that the user did not type.",
  },
  {
    file: "bin/worker.js",
    path: "",
    expr: "DEFAULT_LINK_LOCAL_HOST",
    reason: "Bundled AWS SDK appends a relative path to the ECS link-local credentials address.",
  },
];

/**
 * Path component of a URL, used as the annotation key. Deliberately not the full
 * URL: a dynamic-host URL renders as a bare scheme, and storing that literal
 * would both read as noise and trip the repo's own insecure-HTTP scanner.
 */
export function urlPath(url: string): string {
  const afterScheme = url.slice(url.indexOf("//") + 2);
  const separator = afterScheme.search(/[/?#]/);
  return separator === -1 ? "" : afterScheme.slice(separator);
}

/**
 * Is this specific site annotated?
 *
 * Matched on file AND url path AND a substring of the host-producing EXPRESSION.
 * The expression is what makes the annotation site-scoped: keying on
 * (file, path) alone degenerated to keying on the file, because every
 * computed host with no path renders to the same bare scheme — so one annotated
 * site silently pre-approved every future one in the same file.
 */
function isAnnotatedDynamicHost(file: string, url: string, expressionText: string): boolean {
  const path = urlPath(url);
  return DYNAMIC_HOST_SITES.some(
    (entry) => entry.file === file && entry.path === path && expressionText.includes(entry.expr),
  );
}

// ---------------------------------------------------------------------------
// Sentinels.
//
// Marking "a hole goes here" needs a character that CANNOT occur in the input,
// or the marker is forgeable: the previous version used a literal \x01, so a
// \x01 written into a string literal made the guard treat a complete hostname as
// templated and skip it. Sentinels are therefore chosen per input and *verified
// absent* from it before use.
// ---------------------------------------------------------------------------

const SENTINEL_START = 0xe000; // Unicode Private Use Area
const SENTINEL_END = 0xf8ff;

interface Sentinels {
  /** Stands for `{…}` / `${…}` template syntax inside a single literal. */
  placeholder: string;
  /** Stands for a value computed by code (a non-constant concatenation operand). */
  hole: string;
}

/**
 * The Private Use Area, reserved here for sentinels.
 *
 * `sanitizeForScanning` deletes every character in this range from any text
 * before it is scanned, which is what makes a sentinel unforgeable: the marker
 * cannot occur in the input because the input cannot contain it. Verifying
 * absence was not enough — absence was checked against the file's RAW bytes
 * while the sentinel was compared against COOKED literal text, so `""`
 * written as a six-character escape was absent from one and present in the
 * other, and could be used to make a complete hostname look templated.
 */
const PRIVATE_USE_AREA = new RegExp(`[\\u${SENTINEL_START.toString(16)}-\\u${SENTINEL_END.toString(16)}]`, "gu");

/**
 * Normalise text before any URL is read out of it.
 *
 *  - Private Use Area characters are removed, so sentinels stay out of band.
 *  - Tab, LF and CR are removed because the WHATWG URL parser removes them
 *    before parsing: `https://example.com\n@vendor.invalid/x` is a request to
 *    vendor.invalid with `example.com` as userinfo, and a scanner that stops at the
 *    newline reads the opposite of what the runtime does.
 */
export function sanitizeForScanning(text: string): string {
  return text.replace(PRIVATE_USE_AREA, "").replace(/[\t\n\r]/g, "");
}

/**
 * Sanitiser for free text (Markdown, JSON, shell, dotenv).
 *
 * Deliberately does NOT strip newlines. Removing them is right inside a single
 * URL string, where the runtime parser removes them too; applied to a whole
 * file it concatenates unrelated lines, and a verbatim `https://vendor.invalid` at
 * end-of-line became `vendor.invalidUse` — invisible to every host rule.
 */
export function sanitizeProseForScanning(text: string): string {
  return text.replace(PRIVATE_USE_AREA, "");
}

/**
 * Two distinct sentinel characters.
 *
 * They are not searched for: `sanitizeForScanning` deletes the whole Private Use
 * Area from every literal as it is read, so these characters cannot appear in
 * the input and no per-input search is needed.
 */
export function pickSentinels(): Sentinels {
  return { placeholder: String.fromCharCode(SENTINEL_START), hole: String.fromCharCode(SENTINEL_START + 1) };
}

/**
 * Placeholder syntaxes that appear inside URL templates.
 *
 * Applied ONLY to a URL's authority, never to the surrounding text. Applying it
 * to whole text was a blinding bug: `\{[^}]*\}` spans from the first `{` to the
 * first `}`, so every URL inside a flat JSON object — `{"apiUrl":"https://…"}`
 * — was deleted before matching, in code and in prose alike.
 */
const URL_PLACEHOLDER = /\$\{[^}]*\}|\{[^}]*\}|<[^>]*>|%[sd]/g;

/**
 * Absolute URLs, including templated ones.
 *
 * No leading `\b`: a word boundary meant one prefix character (`"_https://…"`)
 * removed the URL from the scan entirely. The authority may be EMPTY so that a
 * bare `https://` fragment is still seen — that is the shape a split host takes,
 * and it must surface as an uncertifiable host rather than as nothing at all.
 */
const ABSOLUTE_URL_SOURCE = "https?://(?:\\$?\\{[^{}\\s\"'`]*\\}|[^\\s\"'`<>()\\[\\]{}\\\\|^,;])*";

/** A final label that could plausibly be a public TLD. */
const TLD_SHAPED = /^[a-z]{2,24}$/;

/** C0/C1 control characters, which are never legal in a hostname. */
const CONTROL_CHARS = new RegExp("[\\u0000-\\u001f\\u007f-\\u009f]", "g");

export interface UrlReference {
  /** The matched URL, trimmed of trailing punctuation. Sentinels removed. */
  url: string;
  /** Host as far as it is statically known, with sentinels still in place. */
  markedHost: string;
  /** Registrable domain, or undefined when it cannot be determined statically. */
  domain?: string;
  /** When `domain` is undefined, what supplied the undeterminable tail. */
  undeterminedBy?: "placeholder" | "hole";
}

/**
 * Drop the port from an authority whose userinfo has already been removed.
 *
 * The port is dropped even when it is dynamic: `http://localhost:${port}` names
 * a perfectly determinate host, and treating the port as part of the host would
 * report the reader's own machine as an uncertifiable destination.
 */
function stripPort(authority: string): string {
  if (authority.startsWith("[")) {
    const close = authority.indexOf("]");
    return close === -1 ? authority : authority.slice(0, close + 1);
  }
  const colon = authority.lastIndexOf(":");
  return colon === -1 ? authority : authority.slice(0, colon);
}

function stripSentinels(text: string, sentinels: Sentinels): string {
  return text.split(sentinels.placeholder).join("").split(sentinels.hole).join("");
}

/**
 * Registrable domain of a host that may contain sentinels.
 *
 * A sentinel anywhere before a complete static suffix is harmless
 * (`{Region}.signin.amazonaws.cn` is still `amazonaws.cn`). A sentinel in or
 * after the final label means the TLD itself is dynamic, and the host cannot be
 * certified — that is reported, not silently skipped.
 */
function resolveMarkedHost(
  markedHost: string,
  sentinels: Sentinels,
): { domain?: string; undeterminedBy?: "placeholder" | "hole" } {
  const lastPlaceholder = markedHost.lastIndexOf(sentinels.placeholder);
  const lastHole = markedHost.lastIndexOf(sentinels.hole);
  const lastSentinel = Math.max(lastPlaceholder, lastHole);

  if (lastSentinel === -1) {
    const host = markedHost;
    return host ? { domain: registrableDomain(host) } : {};
  }

  const undeterminedBy = lastHole > lastPlaceholder ? "hole" : "placeholder";
  const staticSuffix = markedHost.slice(lastSentinel + 1).replace(/^\.+/, "");
  const labels = staticSuffix.split(".").filter(Boolean);
  if (labels.length >= 2 && TLD_SHAPED.test(labels[labels.length - 1])) {
    return { domain: registrableDomain(staticSuffix) };
  }
  return { undeterminedBy };
}

/**
 * Every absolute http(s) URL in a blob of text.
 *
 * `text` is expected to be already sentinel-marked when it came from folding.
 * Placeholder syntax inside the text is masked here so that a `{…}` body
 * containing `/`, `?` or `#` cannot cut the authority in half.
 */
export function extractUrlReferences(text: string, sentinels?: Sentinels): UrlReference[] {
  const marks = sentinels ?? pickSentinels();
  // Text that arrived with sentinels was sanitised when its literals were read
  // and now carries the guard's markers; stripping the PUA again would delete
  // them. Tab/LF/CR removal still applies to both paths.
  const scannable = sentinels ? text.replace(/[\t\n\r]/g, "") : sanitizeProseForScanning(text);
  const pattern = new RegExp(ABSOLUTE_URL_SOURCE, "gi");
  const references: UrlReference[] = [];
  for (const match of scannable.matchAll(pattern)) {
    const raw = match[0].replace(/[.:!?]+$/, "");
    // Placeholder masking is confined to the MATCHED URL, and runs before the
    // authority is split off so that a `{…}` body containing `/`, `?` or `#`
    // cannot cut the host in half. It must never be able to delete a URL from
    // the surrounding text — doing that erased every URL inside a JSON object.
    const masked = raw.replace(URL_PLACEHOLDER, marks.placeholder);
    const authority = masked.slice(masked.indexOf("//") + 2).split(/[/?#]/)[0];
    const markedHost = stripPort(authority.replace(/^[^@]*@/, ""))
      // Control characters are not legal in a hostname. Dropping them stops a
      // stray byte from turning a vendor host into a merely "unapproved" one,
      // and denies any classification game played with in-band control bytes.
      .replace(CONTROL_CHARS, "")
      .toLowerCase();
    // An EMPTY authority means the literal is a bare scheme — `"https://"` used
    // in a `startsWith` test, not a host. When a scheme literal is actually
    // concatenated with something, folding puts a hole after it and the
    // authority is non-empty, so the split-host case is still reported.
    if (!markedHost) continue;
    references.push({
      url: stripSentinels(raw, marks),
      markedHost,
      ...resolveMarkedHost(markedHost, marks),
    });
  }
  return references;
}

export interface ScanSource {
  /** Package-relative path, used for reporting. */
  file: string;
  content: string;
  /** Set when the bytes could not be decoded as text; `content` is then empty. */
  undecodable?: string;
}

export interface VendorHostFinding {
  file: string;
  url: string;
  host: string;
}

/**
 * WEAK backstop: known vendor domains anywhere in the shipped bytes.
 *
 * A denylist over raw text. It cannot see a vendor domain that is not on
 * `VENDOR_CONTROLLED_DOMAINS`, and it cannot see a host split across string
 * literals. Both gaps are closed for executable code by `findDisallowedCodeUrls`,
 * which folds constants and works from an allowlist. This check exists for prose,
 * which cannot issue a request.
 */
export function findVendorHostReferences(sources: Iterable<ScanSource>): VendorHostFinding[] {
  const allowed = new Set(VENDOR_HOST_URL_EXCEPTIONS.map((entry) => entry.url));
  const findings: VendorHostFinding[] = [];
  for (const source of sources) {
    if (!source.content) continue;
    if (source.file === VENDOR_DOMAIN_DECLARATION_FILE) continue;

    for (const reference of extractUrlReferences(source.content)) {
      if (!reference.domain || !VENDOR_CONTROLLED_DOMAINS.includes(reference.domain)) continue;
      if (allowed.has(reference.url)) continue;
      findings.push({ file: source.file, url: reference.url, host: reference.markedHost });
    }

    // The scheme-anchored match above only sees a vendor domain when it is the
    // authority of a contiguous `https://…`. A bare domain, a broken scheme or a
    // scheme-relative `//host` is invisible to it — and prose ships too:
    // README.md, install scripts and .env.example files are all in the package.
    for (const hit of findVendorDomainTokens(source.content)) {
      findings.push({ file: source.file, url: hit.domain, host: hit.domain });
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// The strong check — AST scan of executable code.
// ---------------------------------------------------------------------------

export const CODE_FILE_PATTERN = /\.(?:[cm]?[jt]sx?)$/i;

export function isCodeFile(file: string): boolean {
  return CODE_FILE_PATTERN.test(file);
}

/**
 * Where a URL literal sits. Used only for REPORTING — the pass/fail decision is
 * position-independent on purpose, so a syntactic form nobody enumerated here
 * still cannot hide a URL.
 */
export type UrlLiteralPosition =
  | "parameter default"
  | "object property"
  | "class field"
  | "variable initializer"
  | "fallback operand"
  | "ternary branch"
  | "call argument"
  | "return value"
  | "literal";

/**
 * A vendor domain written into a string literal, whether or not it forms a URL.
 *
 * The URL-shaped checks are value-dependent: they have to reconstruct what the
 * program will produce, and every reconstruction is a finite set of cases that
 * an attacker can step outside of (`.concat`, `.slice`, `.replace`, a `const`
 * referenced by name, a JSON blob parsed at runtime). This check is
 * value-INDEPENDENT: the vendor's own domain has to appear somewhere in the
 * bytes for the program to reach the vendor, so looking for the domain as a
 * token catches every assembly trick at once.
 *
 * It is a denylist, so it says nothing about a vendor domain nobody has listed —
 * that case is what the URL allowlist is for. The two are deliberately different
 * shapes because they fail in different directions.
 */
/**
 * The one file that must name the vendor's domains: this one, where the
 * denylist is declared. Excluded from the token check only — every URL-shaped
 * check still applies to it, it ships in no published artifact, and a test
 * asserts both facts.
 */
export const VENDOR_DOMAIN_DECLARATION_FILE = "src/lib/vendor-host-guard.ts";

export function findVendorDomainTokens(text: string): { domain: string; index: number }[] {
  let scannable = sanitizeProseForScanning(text).toLowerCase();
  // Audited exact-URL exceptions are removed before the token search, so an
  // approved identifier is not reported twice under two different rules.
  for (const exception of VENDOR_HOST_URL_EXCEPTIONS) {
    scannable = scannable.split(exception.url.toLowerCase()).join(" ");
  }
  const hits: { domain: string; index: number }[] = [];
  for (const domain of VENDOR_CONTROLLED_DOMAINS) {
    const pattern = new RegExp(`(^|[^a-z0-9-])${domain.replace(/\./g, "\\.")}($|[^a-z0-9-])`, "g");
    for (const match of scannable.matchAll(pattern)) {
      hits.push({ domain, index: match.index ?? 0 });
    }
  }
  return hits;
}

export type CodeFindingKind =
  /** Host resolves to a domain we operate. */
  | "vendor-host"
  /** Host resolves to a domain that is not on APPROVED_CODE_HOSTS. */
  | "unapproved-host"
  /** The TLD is supplied by code, so no host can be certified. */
  | "undeterminable-host"
  /** The file could not be parsed, so its contents were never inspected. */
  | "unparsable"
  /** The bytes could not be decoded as text, so they were never inspected. */
  | "undecodable"
  /** A vendor domain appears in a string literal, in any form. */
  | "vendor-domain-token";

export interface CodeUrlFinding {
  file: string;
  line: number;
  kind: CodeFindingKind;
  /** True only for `kind === "vendor-host"`. */
  vendor: boolean;
  url?: string;
  host?: string;
  domain?: string;
  position?: UrlLiteralPosition;
  detail?: string;
}

function classifyPosition(node: ts.Node): UrlLiteralPosition {
  let child: ts.Node = node;
  let current: ts.Node | undefined = node.parent;
  while (current) {
    if (ts.isParameter(current) && current.initializer === child) return "parameter default";
    if (ts.isPropertyAssignment(current) && current.initializer === child) return "object property";
    if (ts.isPropertyDeclaration(current) && current.initializer === child) return "class field";
    if (ts.isVariableDeclaration(current) && current.initializer === child) return "variable initializer";
    if (ts.isBinaryExpression(current)) {
      const kind = current.operatorToken.kind;
      if (
        kind === ts.SyntaxKind.BarBarToken ||
        kind === ts.SyntaxKind.QuestionQuestionToken ||
        kind === ts.SyntaxKind.BarBarEqualsToken ||
        kind === ts.SyntaxKind.QuestionQuestionEqualsToken
      ) {
        return "fallback operand";
      }
    }
    if (ts.isConditionalExpression(current)) return "ternary branch";
    if (ts.isCallExpression(current) || ts.isNewExpression(current)) return "call argument";
    if (ts.isReturnStatement(current)) return "return value";
    if (ts.isFunctionLike(current) || ts.isStatement(current)) break;
    child = current;
    current = current.parent;
  }
  return "literal";
}

// ---------------------------------------------------------------------------
// Constant folding.
//
// `"https://" + "skills.md/api/v1"` is a compile-time constant that no
// per-literal scan can see: the first fragment holds only a scheme, the second
// holds no "//" at all. Folding the expression before extraction is the only
// honest way to read what the program will actually use.
// ---------------------------------------------------------------------------

type FoldSegment = { text: string } | { hole: ts.Node };

interface Folded {
  segments: FoldSegment[];
  /** Sub-expressions that were not constant, so the walker can still scan them. */
  holes: ts.Node[];
}

function unwrap(node: ts.Node): ts.Node {
  let current = node;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isTypeAssertionExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function constantSeparator(node: ts.CallExpression): string | undefined {
  if (node.arguments.length === 0) return ",";
  if (node.arguments.length > 1) return undefined;
  const arg = unwrap(node.arguments[0]);
  return ts.isStringLiteralLike(arg) ? arg.text : undefined;
}

/**
 * Module-local constant bindings, so `const H = "skills.md"` used by name is
 * resolved rather than treated as an opaque runtime value.
 *
 * Without this, moving the host one `const` away from the URL was enough to turn
 * a hard-coded endpoint into an "undeterminable host", which the annotation
 * carve-outs then waved through. Scope is deliberately shallow — a single
 * assignment to a `const` with a constant initialiser — because anything cleverer
 * would need a type checker, and the guard should be honest about being a
 * syntactic tool.
 */
type ConstantBindings = Map<string, string | Map<string, string>>;

function collectConstantBindings(source: ts.SourceFile): ConstantBindings {
  const bindings: ConstantBindings = new Map();

  // Two passes, because one pass is order-dependent and therefore unsound: a
  // name declared twice was folded to whichever declaration the walk reached
  // LAST, so a function-local vendor host could be masked by an unrelated
  // top-level `const` of the same name written below it. A name that is bound
  // or assigned more than once anywhere in the file is not a constant.
  const declarations = new Map<string, number>();
  const count = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      declarations.set(node.name.text, (declarations.get(node.name.text) ?? 0) + 1);
    }
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isIdentifier(node.left)
    ) {
      declarations.set(node.left.text, (declarations.get(node.left.text) ?? 0) + 2);
    }
    if (ts.isParameter(node) && ts.isIdentifier(node.name)) {
      declarations.set(node.name.text, (declarations.get(node.name.text) ?? 0) + 2);
    }
    ts.forEachChild(node, count);
  };
  count(source);

  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const name = node.name.text;
      if ((declarations.get(name) ?? 0) !== 1) {
        ts.forEachChild(node, visit);
        return;
      }
      const initializer = unwrap(node.initializer);
      const literal = literalString(initializer);
      if (literal !== undefined) {
        bindings.set(name, literal);
      } else if (ts.isObjectLiteralExpression(initializer)) {
        const properties = new Map<string, string>();
        for (const property of initializer.properties) {
          if (!ts.isPropertyAssignment(property)) continue;
          const key = ts.isIdentifier(property.name) || ts.isStringLiteralLike(property.name)
            ? property.name.text
            : undefined;
          const value = key === undefined ? undefined : literalString(unwrap(property.initializer));
          if (key !== undefined && value !== undefined) properties.set(key, value);
        }
        if (properties.size > 0) bindings.set(name, properties);
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(source);
  return bindings;
}

function literalString(node: ts.Node): string | undefined {
  const target = unwrap(node);
  // Sanitised HERE, at the point the literal is read: folding inserts sentinels
  // afterwards, so stripping the Private Use Area later would remove the
  // guard's own markers instead of the attacker's.
  if (ts.isStringLiteralLike(target)) return sanitizeForScanning(target.text);
  if (ts.isNumericLiteral(target)) return sanitizeForScanning(target.text);
  return undefined;
}

const MAX_FOLD_DEPTH = 40;

/**
 * Evaluate a fully-constant string expression.
 *
 * The previous version folded exactly three forms — `+`, template literals and
 * `Array#join`. Everything else produced fragments that the URL matcher could
 * not see, so `"https://".concat("skills.md/api/v1")` and
 * `"_https://skills.md/x".slice(1)` shipped clean. The method set below is still
 * finite, but anything outside it now degrades to a *reported* uncertifiable
 * host rather than to silence, and the vendor-domain token check runs over every
 * literal regardless of how the value is assembled.
 */
function constantString(node: ts.Node, bindings: ConstantBindings, depth = 0): string | undefined {
  if (depth > MAX_FOLD_DEPTH) return undefined;
  const target = unwrap(node);
  const recurse = (child: ts.Node) => constantString(child, bindings, depth + 1);

  const literal = literalString(target);
  if (literal !== undefined) return literal;

  if (ts.isIdentifier(target)) {
    const bound = bindings.get(target.text);
    return typeof bound === "string" ? bound : undefined;
  }

  if (ts.isPropertyAccessExpression(target) && ts.isIdentifier(target.expression)) {
    const bound = bindings.get(target.expression.text);
    if (bound instanceof Map) return bound.get(target.name.text);
    return undefined;
  }

  if (ts.isBinaryExpression(target) && target.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = recurse(target.left);
    const right = recurse(target.right);
    return left === undefined || right === undefined ? undefined : left + right;
  }

  if (ts.isTemplateExpression(target)) {
    let out = sanitizeForScanning(target.head.text);
    for (const span of target.templateSpans) {
      const value = recurse(span.expression);
      if (value === undefined) return undefined;
      out += value + sanitizeForScanning(span.literal.text);
    }
    return out;
  }

  if (ts.isNoSubstitutionTemplateLiteral(target)) return sanitizeForScanning(target.text);

  if (ts.isTaggedTemplateExpression(target)) {
    const tag = target.tag;
    const isStringRaw =
      ts.isPropertyAccessExpression(tag) &&
      ts.isIdentifier(tag.expression) &&
      tag.expression.text === "String" &&
      tag.name.text === "raw";
    if (isStringRaw) return recurse(target.template);
    return undefined;
  }

  if (ts.isArrayLiteralExpression(target)) {
    const parts = target.elements.map(recurse);
    return parts.some((part) => part === undefined) ? undefined : parts.join(" ");
  }

  if (ts.isCallExpression(target)) return constantCall(target, bindings, depth);

  return undefined;
}

/** String/array methods and global functions whose constant result we can compute. */
function constantCall(
  call: ts.CallExpression,
  bindings: ConstantBindings,
  depth: number,
): string | undefined {
  const recurse = (child: ts.Node) => constantString(child, bindings, depth + 1);
  const args = call.arguments.map(recurse);

  if (ts.isIdentifier(call.expression)) {
    const name = call.expression.text;
    if (args.some((arg) => arg === undefined)) return undefined;
    try {
      if (name === "decodeURIComponent") return decodeURIComponent(args[0] as string);
      if (name === "decodeURI") return decodeURI(args[0] as string);
      if (name === "atob") return Buffer.from(args[0] as string, "base64").toString("binary");
    } catch {
      return undefined;
    }
    return undefined;
  }

  if (!ts.isPropertyAccessExpression(call.expression)) return undefined;
  const method = call.expression.name.text;
  const receiverNode = unwrap(call.expression.expression);

  if (
    ts.isIdentifier(receiverNode) &&
    receiverNode.text === "String" &&
    method === "fromCharCode" &&
    args.every((arg) => arg !== undefined)
  ) {
    return String.fromCharCode(...args.map((arg) => Number(arg)));
  }

  // Array receivers: join / concat / flat / reduce over constant elements.
  if (ts.isArrayLiteralExpression(receiverNode)) {
    const elements = receiverNode.elements.map(recurse);
    if (elements.some((element) => element === undefined)) return undefined;
    const values = elements as string[];
    if (method === "join") return values.join(args.length === 0 ? "," : (args[0] ?? ""));
    if (method === "flat") return values.join("");
    if (method === "reduce") {
      // Only the canonical string-accumulating reduce is folded.
      const seed = args.length > 1 ? (args[1] ?? "") : "";
      return seed + values.join("");
    }
    if (method === "concat") {
      const extra = args.every((arg) => arg !== undefined) ? (args as string[]).join("") : undefined;
      return extra === undefined ? undefined : values.join("") + extra;
    }
    return undefined;
  }

  const receiver = recurse(receiverNode);
  if (receiver === undefined) return undefined;
  if (args.some((arg) => arg === undefined)) return undefined;
  const text = args as string[];

  try {
    switch (method) {
      case "concat": return receiver.concat(...text);
      case "slice": return receiver.slice(...numeric(text));
      case "substring": { const [a, b] = numeric(text); return b === undefined ? receiver.substring(a ?? 0) : receiver.substring(a ?? 0, b); }
      case "substr": return receiver.slice(...numeric(text));
      case "trim": return receiver.trim();
      case "trimStart": return receiver.trimStart();
      case "trimEnd": return receiver.trimEnd();
      case "toLowerCase": return receiver.toLowerCase();
      case "toUpperCase": return receiver.toUpperCase();
      case "padStart": return receiver.padStart(Number(text[0] ?? 0), text[1] ?? " ");
      case "padEnd": return receiver.padEnd(Number(text[0] ?? 0), text[1] ?? " ");
      case "repeat": return receiver.repeat(Number(text[0] ?? 0));
      case "at": return receiver.at(Number(text[0] ?? 0)) ?? "";
      case "normalize": return receiver.normalize();
      case "replace": return receiver.replace(text[0] ?? "", text[1] ?? "");
      case "replaceAll": return receiver.replaceAll(text[0] ?? "", text[1] ?? "");
      case "split": return receiver.split(text[0] ?? "").join(" ");
      case "join": return receiver.split(" ").join(text[0] ?? ",");
      default: return undefined;
    }
  } catch {
    return undefined;
  }
}

function numeric(values: string[]): [number?, number?] {
  return values.slice(0, 2).map((value) => Number(value)) as [number?, number?];
}

function fold(node: ts.Node, out: Folded, bindings: ConstantBindings): void {
  const target = unwrap(node);

  // A fully constant sub-expression collapses to its value, whatever syntax
  // produced it. Only what cannot be evaluated becomes a hole.
  const constant = constantString(target, bindings);
  if (constant !== undefined) {
    out.segments.push({ text: constant });
    return;
  }

  if (ts.isStringLiteralLike(target) || ts.isNumericLiteral(target)) {
    out.segments.push({ text: target.text });
    return;
  }

  if (ts.isBinaryExpression(target) && target.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    fold(target.left, out, bindings);
    fold(target.right, out, bindings);
    return;
  }

  if (ts.isTemplateExpression(target)) {
    out.segments.push({ text: sanitizeForScanning(target.head.text) });
    for (const span of target.templateSpans) {
      fold(span.expression, out, bindings);
      out.segments.push({ text: sanitizeForScanning(span.literal.text) });
    }
    return;
  }

  // `["https://", "host"].join("")` — a constant assembled through a call.
  if (
    ts.isCallExpression(target) &&
    ts.isPropertyAccessExpression(target.expression) &&
    target.expression.name.text === "join"
  ) {
    const receiver = unwrap(target.expression.expression);
    const separator = constantSeparator(target);
    if (ts.isArrayLiteralExpression(receiver) && separator !== undefined) {
      receiver.elements.forEach((element, index) => {
        if (index > 0) out.segments.push({ text: separator });
        fold(element, out, bindings);
      });
      return;
    }
  }

  out.segments.push({ hole: target });
  out.holes.push(target);
}

/** Is this node the outermost part of a string-building expression? */
function isFoldRoot(node: ts.Node): boolean {
  let current: ts.Node | undefined = node.parent;
  while (
    current &&
    (ts.isParenthesizedExpression(current) ||
      ts.isAsExpression(current) ||
      ts.isSatisfiesExpression(current) ||
      ts.isNonNullExpression(current))
  ) {
    current = current.parent;
  }
  if (!current) return true;
  if (ts.isBinaryExpression(current) && current.operatorToken.kind === ts.SyntaxKind.PlusToken) return false;
  if (ts.isTemplateSpan(current)) return false;
  if (ts.isArrayLiteralExpression(current) && current.parent && ts.isPropertyAccessExpression(current.parent)) {
    return current.parent.name.text !== "join";
  }
  return true;
}

/**
 * Render a folded expression two ways, because both are values the program can
 * produce and each hides a different attack:
 *
 *   - holes as sentinels: keeps `https://s3.${region}.amazonaws.com` readable as
 *     the amazonaws.com host it is, and makes `"https://" + host` visible as a
 *     scheme with an undeterminable authority;
 *   - holes as empty strings: catches a host split by an interpolation that
 *     contributes nothing, e.g. `` `https://ski${""}lls.md` ``.
 */
function renderFolded(folded: Folded, sentinels: Sentinels): string[] {
  const text = folded.segments.map((s) => ("text" in s ? s.text : "")).join("");
  const marked = folded.segments.map((s) => ("text" in s ? s.text : sentinels.hole)).join("");
  return marked === text ? [marked] : [marked, text];
}

/**
 * Every absolute URL a source file can statically produce, found by folding
 * string expressions and walking the AST — never by matching a syntactic shape.
 *
 * Failure to read the file is itself reported. A scanner that returns "clean"
 * for a file it could not parse is worse than no scanner, because it converts an
 * unknown into a certification. One stray byte used to do exactly that.
 */
export function findCodeUrlLiterals(file: string, content: string): CodeUrlFinding[] {
  const findings: CodeUrlFinding[] = [];
  const source = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, /* setParentNodes */ true);

  const diagnostics = (source as unknown as { parseDiagnostics?: { messageText?: unknown }[] }).parseDiagnostics ?? [];
  const binaryDiagnostic = diagnostics.some((d) =>
    typeof d.messageText === "string" && /binary/i.test(d.messageText),
  );
  if (binaryDiagnostic || (content.trim().length > 0 && source.statements.length === 0)) {
    return [{
      file,
      line: 1,
      kind: "unparsable",
      vendor: false,
      detail: binaryDiagnostic
        ? "TypeScript refused the file as binary; no statement was inspected"
        : "file is non-empty but parsed to zero statements; no statement was inspected",
    }];
  }

  const sentinels = pickSentinels();

  const bindings = collectConstantBindings(source);

  // The one file that declares the vendor denylist is exempt from the token
  // check only; every URL-shaped rule still applies to it.
  const skipTokenScan = file === VENDOR_DOMAIN_DECLARATION_FILE;

  const lineOf = (node: ts.Node): number =>
    source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;

  // A scheme fragment immediately followed by a computed value: `"https:/" + x`
  // or `"https:" + x`. The URL matcher needs `//` to see an authority, so these
  // renderings would otherwise be silent — which is precisely how the scheme's
  // own slashes were used to smuggle a host past the scan.
  const SCHEME_FRAGMENT_THEN_HOLE = new RegExp(`https?:/{0,2}[${sentinels.hole}${sentinels.placeholder}]`, "i");

  const record = (node: ts.Node, candidates: string[]): void => {
    const seen = new Set<string>();
    for (const candidate of candidates) {
      // Value-INDEPENDENT check, run on the FOLDED value as well as on raw
      // literals, so splitting the domain itself across literals does not help.
      for (const hit of skipTokenScan ? [] : findVendorDomainTokens(candidate)) {
        const key = `token:${hit.domain}`;
        if (seen.has(key)) continue;
        seen.add(key);
        findings.push({
          file,
          line: lineOf(node),
          kind: "vendor-domain-token",
          vendor: true,
          domain: hit.domain,
          position: classifyPosition(node),
          detail: `the vendor domain ${hit.domain} is assembled in this expression`,
        });
      }

      if (SCHEME_FRAGMENT_THEN_HOLE.test(candidate) && !candidate.includes("//")) {
        const key = "scheme-fragment";
        if (!seen.has(key)) {
          seen.add(key);
          findings.push({
            file,
            line: lineOf(node),
            kind: "undeterminable-host",
            vendor: false,
            url: stripSentinels(candidate, sentinels).slice(0, 40),
            host: "",
            position: classifyPosition(node),
            detail: "a URL scheme is concatenated with a computed value, so no host can be certified",
          });
        }
      }

      if (!/https?:/i.test(candidate)) continue;
      for (const reference of extractUrlReferences(candidate, sentinels)) {
        if (seen.has(reference.url + "|" + (reference.domain ?? ""))) continue;
        seen.add(reference.url + "|" + (reference.domain ?? ""));

        if (!reference.domain) {
          // The TLD itself is dynamic. `{…}` template syntax is legitimate in the
          // bundled AWS SDK; a host completed from code needs an annotation.
          if (reference.undeterminedBy === "placeholder" && allowsTemplateHost(file)) continue;
          if (
            reference.undeterminedBy === "hole" &&
            isAnnotatedDynamicHost(file, reference.url, node.getText(source))
          ) {
            continue;
          }
          findings.push({
            file,
            line: lineOf(node),
            kind: "undeterminable-host",
            vendor: false,
            url: reference.url,
            host: reference.markedHost,
            position: classifyPosition(node),
            detail:
              reference.undeterminedBy === "hole"
                ? "the host is completed by a computed value, so no host can be certified"
                : "the host is completed by template syntax, so no host can be certified",
          });
          continue;
        }

        if (isLoopbackHost(reference.markedHost)) continue;

        const vendor = VENDOR_CONTROLLED_DOMAINS.includes(reference.domain);
        if (!vendor && APPROVED_CODE_HOSTS.some((entry) => entry.domain === reference.domain)) continue;
        if (VENDOR_HOST_URL_EXCEPTIONS.some((entry) => entry.url === reference.url)) continue;

        findings.push({
          file,
          line: lineOf(node),
          kind: vendor ? "vendor-host" : "unapproved-host",
          vendor,
          url: reference.url,
          host: reference.markedHost,
          domain: reference.domain,
          position: classifyPosition(node),
        });
      }
    }
  };

  const visit = (node: ts.Node): void => {
    // Any expression that can produce a string is a fold candidate. Restricting
    // this to `+`, templates and `Array#join` was how `.concat`, `.slice`,
    // `.replace` and `decodeURIComponent` walked past the scan.
    const isStringBuilder =
      (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) ||
      ts.isTemplateExpression(node) ||
      ts.isTaggedTemplateExpression(node) ||
      ts.isCallExpression(node);

    if (isStringBuilder && isFoldRoot(node)) {
      const folded: Folded = { segments: [], holes: [] };
      fold(node, folded, bindings);
      if (folded.segments.some((segment) => "text" in segment)) {
        record(node, renderFolded(folded, sentinels));
        // Keep scanning inside the parts we could not fold.
        for (const hole of folded.holes) ts.forEachChild(hole, visit);
        return;
      }
    }

    if (ts.isStringLiteralLike(node)) {
      // Sanitised here too: this path used to pass RAW text, which let a literal
      // Private Use Area character forge the guard's own hole marker.
      record(node, [sanitizeForScanning(node.text)]);
    }

    ts.forEachChild(node, visit);
  };

  visit(source);

  // Second pass, value-INDEPENDENT: a vendor domain written into any literal,
  // whatever expression later assembles it. The URL passes above must
  // reconstruct the program's value to see a host, and every reconstruction is
  // a finite set of cases; this one only needs the domain to be present in the
  // bytes, which it must be for the program to reach the vendor at all.
  const tokenVisit = (node: ts.Node): void => {
    if (skipTokenScan) return;
    const literalText =
      ts.isStringLiteralLike(node) ||
      node.kind === ts.SyntaxKind.TemplateHead ||
      node.kind === ts.SyntaxKind.TemplateMiddle ||
      node.kind === ts.SyntaxKind.TemplateTail
        ? sanitizeForScanning((node as ts.LiteralLikeNode).text)
        : undefined;
    if (literalText !== undefined) {
      for (const hit of findVendorDomainTokens(literalText)) {
        findings.push({
          file,
          line: lineOf(node),
          kind: "vendor-domain-token",
          vendor: true,
          domain: hit.domain,
          position: classifyPosition(node),
          detail: `the vendor domain ${hit.domain} appears in a string literal`,
        });
      }
    }
    ts.forEachChild(node, tokenVisit);
  };
  tokenVisit(source);

  return findings;
}

/**
 * STRONG check over packed executable code.
 *
 * Every finding is a refusal to certify, not only a bad host: an unreadable or
 * unparsable code file is reported, because silence about a file nobody read is
 * indistinguishable from silence about a clean file.
 */
export function findDisallowedCodeUrls(sources: Iterable<ScanSource>): CodeUrlFinding[] {
  const findings: CodeUrlFinding[] = [];
  for (const source of sources) {
    if (!isCodeFile(source.file)) continue;
    if (source.undecodable) {
      findings.push({
        file: source.file,
        line: 1,
        kind: "undecodable",
        vendor: false,
        detail: source.undecodable,
      });
      continue;
    }
    findings.push(...findCodeUrlLiterals(source.file, source.content));
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Reading the package, and proving we actually read it.
// ---------------------------------------------------------------------------

export interface PackedFs {
  existsSync: (path: string) => boolean;
  statSync: (path: string) => { isFile: () => boolean };
  readFileSync: (path: string) => Buffer;
}

/**
 * Read every file in the published package as a scan source.
 *
 * Driven by the packer's own file list rather than by walking `src/`: the `files`
 * negation globs mean the repository and the published tarball are different
 * sets of bytes, and the tarball is what a user installs.
 *
 * Bytes that will not decode are recorded as `undecodable` rather than skipped.
 * Skipping is how a single NUL byte makes a whole file invisible to a scanner.
 */
export function readPackedSources(
  packedFiles: readonly string[],
  root: string,
  fs: PackedFs,
  joinPath: (...parts: string[]) => string,
): ScanSource[] {
  const sources: ScanSource[] = [];
  for (const file of packedFiles) {
    const absolute = joinPath(root, file);
    if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) continue;
    const buffer = fs.readFileSync(absolute);
    // Decoding is shared with the rest of the guards (`file-bytes.ts`), which
    // handle UTF-16 and strip NULs rather than skipping the file. Only genuinely
    // compiled/compressed content is set aside, and for a source file that is
    // itself reported rather than passed over.
    if (looksBinary(buffer)) {
      sources.push({ file, content: "", undecodable: "compiled or compressed binary content" });
      continue;
    }
    sources.push({ file, content: decodeForScanning(buffer) });
  }
  return sources;
}

export interface EntryPointCoverage {
  path: string;
  packed: boolean;
  read: boolean;
  certified: boolean;
}

/** Every path a consumer can `require`/`import`/execute, from package.json. */
export function declaredEntryPoints(manifest: unknown): string[] {
  const paths = new Set<string>();
  const collect = (value: unknown): void => {
    if (typeof value === "string") {
      if (value.startsWith("./") || value.startsWith("bin/") || value.startsWith("dist/")) {
        paths.add(value.replace(/^\.\//, ""));
      }
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(collect);
      return;
    }
    if (value && typeof value === "object") {
      Object.values(value as Record<string, unknown>).forEach(collect);
    }
  };
  const record = (manifest ?? {}) as Record<string, unknown>;
  collect(record.bin);
  collect(record.main);
  collect(record.exports);
  collect(record.module);
  return [...paths].filter((path) => !path.endsWith(".d.ts")).sort();
}

/**
 * Anti-vacuity, per entry point.
 *
 * A global "we scanned more than N files" is satisfiable by files that have
 * nothing to do with the code under test: on an unbuilt tree the skill corpus
 * alone cleared the old threshold while `bin/`, `dist/` and everything they are
 * built from went unscanned. Coverage has to be asserted against the specific
 * artifacts a consumer runs.
 */
export function checkEntryPointCoverage(
  manifest: unknown,
  packedFiles: readonly string[],
  scanned: ReadonlyMap<string, { certified: boolean }>,
): EntryPointCoverage[] {
  const packed = new Set(packedFiles);
  return declaredEntryPoints(manifest).map((path) => {
    const entry = scanned.get(path);
    return {
      path,
      packed: packed.has(path),
      read: entry !== undefined,
      certified: entry?.certified ?? false,
    };
  });
}

export function uncoveredEntryPoints(coverage: readonly EntryPointCoverage[]): EntryPointCoverage[] {
  return coverage.filter((entry) => !entry.packed || !entry.read || !entry.certified);
}

export function formatFindings(
  findings: ReadonlyArray<VendorHostFinding | CodeUrlFinding>,
): string {
  return findings
    .map((finding) => {
      if (!("kind" in finding)) return `  ${finding.file}: ${finding.url}`;
      const where = `${finding.file}:${finding.line}`;
      switch (finding.kind) {
        case "vendor-host":
          return `  ${where}: ${finding.url} (${finding.position}; host ${finding.domain} — VENDOR-CONTROLLED)`;
        case "unapproved-host":
          return `  ${where}: ${finding.url} (${finding.position}; host ${finding.domain} — not on APPROVED_CODE_HOSTS)`;
        case "undeterminable-host":
          return `  ${where}: ${finding.url} (${finding.position}; ${finding.detail})`;
        case "vendor-domain-token":
          return `  ${where}: ${finding.position}; ${finding.detail} — VENDOR-CONTROLLED`;
        default:
          return `  ${where}: cannot certify — ${finding.detail}`;
      }
    })
    .join("\n");
}
