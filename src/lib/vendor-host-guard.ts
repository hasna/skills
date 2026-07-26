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
  { domain: "your-domain.com", reason: "Obvious placeholder in generated sitemap output." },

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

export interface UrlReference {
  /** The matched URL, trimmed of trailing punctuation. */
  url: string;
  /** Host component, lower-cased, port stripped, placeholders removed. */
  host: string;
  /** Offset of the match within the scanned text. */
  index: number;
  /** Offset just past the match within the scanned text. */
  end: number;
  /** Authority exactly as written, before placeholder and punctuation cleanup. */
  rawAuthority: string;
}

/**
 * Absolute URLs, including ones written as templates. A `{…}` / `${…}` group is
 * matched as a unit so that `https://s3.{partitionResult#dnsSuffix}/x` is read
 * as one URL with a templated host, rather than truncated to the fragment
 * `https://s3.` and then mistaken for a host named `s3`.
 */
const ABSOLUTE_URL = /\bhttps?:\/\/(?:\$?\{[^{}\s"'`]*\}|[^\s"'`<>()[\]{}\\|^,;])+/gi;

/**
 * Placeholders that appear inside URL templates (`https://s3.{Region}.aws…`,
 * `https://${host}/api`, `https://%s/v1`). Removing them before parsing keeps a
 * templated host from being reported as the nonsense host `s3.`.
 */
const URL_PLACEHOLDER = /\$\{[^}]*\}|\{[^}]*\}|<[^>]*>|%[sd]/g;

/**
 * Placeholders are collapsed to a single sentinel before the authority is split
 * off, because a placeholder body can itself contain `/`, `?` or `#`
 * (`{partitionResult#dnsSuffix}`) and would otherwise cut the host in half.
 */
const PLACEHOLDER_MASK = "";

function maskPlaceholders(text: string): string {
  return text.replace(URL_PLACEHOLDER, PLACEHOLDER_MASK);
}

function rawAuthorityOf(url: string): string {
  const masked = maskPlaceholders(url);
  return masked.slice(masked.indexOf("//") + 2).split(/[/?#]/)[0];
}

function hostOf(rawAuthority: string): string {
  return rawAuthority
    .split(PLACEHOLDER_MASK)
    .join("")
    .replace(/\.{2,}/g, ".")
    .replace(/^\.+|\.+$/g, "")
    .replace(/^[^@]*@/, "")
    .replace(/:.*$/, "")
    .toLowerCase();
}

function hasPlaceholder(rawAuthority: string): boolean {
  return rawAuthority.includes(PLACEHOLDER_MASK);
}

/** A final label that could plausibly be a public TLD. */
const TLD_SHAPED = /^[a-z]{2,24}$/;

/**
 * Is this host a *fragment* rather than a whole hostname? True for the pieces
 * the AWS SDK concatenates at runtime (`"https://s3." + region + ".amazonaws.com"`),
 * which arrive here as the literal `https://s3.`.
 *
 * Used only in combination with a syntactic continuation signal, so a complete
 * hostname written with a trailing dot is still reported.
 */
export function isTruncatedHost(rawAuthority: string, host: string): boolean {
  // A host ending in a bare dot or a placeholder has its tail supplied later:
  // `"https://s3." + region`, or `https://s3.{partitionResult#dnsSuffix}`.
  if (rawAuthority.endsWith(".") || rawAuthority.endsWith(PLACEHOLDER_MASK)) return true;
  const labels = host.split(".").filter(Boolean);
  if (labels.length < 2) return true;
  return !TLD_SHAPED.test(labels[labels.length - 1]);
}

/** Every absolute http(s) URL in a blob of text, with its host extracted. */
export function extractUrlReferences(text: string): UrlReference[] {
  const references: UrlReference[] = [];
  for (const match of text.matchAll(ABSOLUTE_URL)) {
    const url = match[0].replace(/[.:!?]+$/, "");
    const rawAuthority = rawAuthorityOf(match[0]);
    const host = hostOf(rawAuthority);
    if (!host) continue;
    references.push({
      url,
      host,
      rawAuthority,
      index: match.index ?? 0,
      end: (match.index ?? 0) + match[0].length,
    });
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

/**
 * WEAK backstop: known vendor domains anywhere in the shipped bytes.
 *
 * A denylist. It cannot see a vendor domain that is not on
 * `VENDOR_CONTROLLED_DOMAINS`. For executable code that gap is closed by
 * `findDisallowedCodeUrls`; for prose it is accepted, because prose cannot
 * issue a request.
 */
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

// ---------------------------------------------------------------------------
// Check 1 — AST scan of executable code.
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

export interface CodeUrlFinding {
  file: string;
  line: number;
  url: string;
  host: string;
  domain: string;
  position: UrlLiteralPosition;
  /** True when the host is one we operate — a strictly worse failure. */
  vendor: boolean;
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

/**
 * Every absolute URL that appears in a string literal in this source file,
 * found by walking the AST rather than by matching a syntactic shape.
 *
 * Walking string literals (rather than raw text) also means comments and prose
 * are ignored: what is reported is data the program can actually use.
 */
/**
 * Is this literal syntactically continued by an adjacent expression, so that a
 * host cut off at its end is completed at runtime? True for a template head or
 * middle (always followed by `${…}`) and for an operand of string concatenation.
 */
function isContinuedLiteral(node: ts.Node): boolean {
  if (node.kind === ts.SyntaxKind.TemplateHead || node.kind === ts.SyntaxKind.TemplateMiddle) {
    return true;
  }
  let child: ts.Node = node;
  let current: ts.Node | undefined = node.parent;
  while (current) {
    if (
      ts.isBinaryExpression(current) &&
      current.operatorToken.kind === ts.SyntaxKind.PlusToken &&
      current.left === child
    ) {
      return true;
    }
    if (!ts.isParenthesizedExpression(current) && !ts.isAsExpression(current)) break;
    child = current;
    current = current.parent;
  }
  return false;
}

export function findCodeUrlLiterals(file: string, content: string): CodeUrlFinding[] {
  const source = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, /* setParentNodes */ true);
  const findings: CodeUrlFinding[] = [];

  const visit = (node: ts.Node): void => {
    const isLiteral =
      ts.isStringLiteralLike(node) ||
      node.kind === ts.SyntaxKind.TemplateHead ||
      node.kind === ts.SyntaxKind.TemplateMiddle ||
      node.kind === ts.SyntaxKind.TemplateTail;
    if (isLiteral) {
      const text = (node as ts.LiteralLikeNode).text;
      if (typeof text === "string" && text.includes("//")) {
        const continued = isContinuedLiteral(node);
        for (const reference of extractUrlReferences(text)) {
          const domain = registrableDomain(reference.host);
          // A fully templated host is resolved at runtime from configuration —
          // there is no default to object to.
          if (!domain) continue;
          // A host whose remaining static part is not a whole hostname is not a
          // default either. Two ways that happens, both requiring evidence that
          // the rest of the host arrives at runtime:
          //   1. the authority embeds a placeholder — `https://s3.{dnsSuffix}/x`;
          //   2. the literal is concatenated with an expression that continues
          //      the host — `"https://s3." + region`.
          // Requiring the runtime-completion evidence means a complete hostname
          // written with a trailing dot is still reported.
          const truncated = isTruncatedHost(reference.rawAuthority, reference.host);
          if (truncated && hasPlaceholder(reference.rawAuthority)) continue;
          if (truncated && continued && reference.end === text.length) continue;
          findings.push({
            file,
            line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
            url: reference.url,
            host: reference.host,
            domain,
            position: classifyPosition(node),
            vendor: isVendorControlledHost(reference.host),
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(source);
  return findings;
}

/**
 * STRONG check: URL literals in packed executable code that are neither on an
 * approved host nor an audited exact-URL exception.
 *
 * Loopback is skipped — it names the reader's own machine, not somebody else's
 * service, and appears legitimately in scaffolding templates. Loopback as a
 * *credential* target is covered by the resolver property test, which asserts
 * an unconfigured install resolves to nothing at all.
 */
export function findDisallowedCodeUrls(sources: Iterable<ScanSource>): CodeUrlFinding[] {
  const excepted = new Set(VENDOR_HOST_URL_EXCEPTIONS.map((entry) => entry.url));
  const findings: CodeUrlFinding[] = [];
  for (const source of sources) {
    if (!isCodeFile(source.file)) continue;
    for (const finding of findCodeUrlLiterals(source.file, source.content)) {
      if (excepted.has(finding.url)) continue;
      if (isLoopbackHost(finding.host)) continue;
      if (!finding.vendor && isApprovedCodeHost(finding.host)) continue;
      findings.push(finding);
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
  findings: ReadonlyArray<VendorHostFinding | CodeUrlFinding>,
): string {
  return findings
    .map((finding) =>
      "position" in finding
        ? `  ${finding.file}:${finding.line}: ${finding.url}` +
          ` (${finding.position}; host ${finding.domain}` +
          `${finding.vendor ? " — VENDOR-CONTROLLED" : " — not on APPROVED_CODE_HOSTS"})`
        : `  ${finding.file}: ${finding.url}`,
    )
    .join("\n");
}
