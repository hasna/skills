import {
  VENDOR_CONTROLLED_DOMAINS,
  VENDOR_DOMAIN_DECLARATION_FILE,
  VENDOR_HOST_URL_EXCEPTIONS,
  registrableDomain,
} from "./vendor-host-policy.js";

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

export interface Sentinels {
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

export function stripSentinels(text: string, sentinels: Sentinels): string {
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
 * Find known vendor domains even when they do not appear in a complete URL.
 */
export function findVendorDomainTokens(text: string): { domain: string; index: number }[] {
  let scannable = sanitizeProseForScanning(text).toLowerCase();
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
