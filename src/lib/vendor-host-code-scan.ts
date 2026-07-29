import ts from "typescript";
import {
  APPROVED_CODE_HOSTS,
  VENDOR_CONTROLLED_DOMAINS,
  VENDOR_DOMAIN_DECLARATION_FILE,
  VENDOR_HOST_URL_EXCEPTIONS,
  allowsTemplateHost,
  isAnnotatedDynamicHost,
  isLoopbackHost,
} from "./vendor-host-policy.js";
import {
  extractUrlReferences,
  findVendorDomainTokens,
  pickSentinels,
  sanitizeForScanning,
  stripSentinels,
  type ScanSource,
} from "./vendor-host-url.js";
import {
  collectConstantBindings,
  fold,
  isFoldRoot,
  renderFolded,
  type Folded,
} from "./vendor-host-folding.js";

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
