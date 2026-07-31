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

export function allowsTemplateHost(file: string): boolean {
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
    file: "skills/brand-assets/src/cli.ts",
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
export function isAnnotatedDynamicHost(file: string, url: string, expressionText: string): boolean {
  const path = urlPath(url);
  return DYNAMIC_HOST_SITES.some(
    (entry) => entry.file === file && entry.path === path && expressionText.includes(entry.expr),
  );
}

/**
 * The policy module must name the vendor domains it declares. Exclude only this
 * file from the value-independent token check; URL-shaped checks still apply.
 */
export const VENDOR_DOMAIN_DECLARATION_FILE = "src/lib/vendor-host-policy.ts";
