import ts from "typescript";
import { sanitizeForScanning, type Sentinels } from "./vendor-host-url.js";

// ---------------------------------------------------------------------------
// Constant folding.
//
// `"https://" + "vendor.invalid/api/v1"` is a compile-time constant that no
// per-literal scan can see: the first fragment holds only a scheme, the second
// holds no "//" at all. Folding the expression before extraction is the only
// honest way to read what the program will actually use.
// ---------------------------------------------------------------------------

type FoldSegment = { text: string } | { hole: ts.Node };

export interface Folded {
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
 * Module-local constant bindings, so `const H = "vendor.invalid"` used by name is
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

export function collectConstantBindings(source: ts.SourceFile): ConstantBindings {
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
 * not see, so `"https://".concat("vendor.invalid/api/v1")` and
 * `"_https://vendor.invalid/x".slice(1)` shipped clean. The method set below is still
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
    return parts.some((part) => part === undefined) ? undefined : parts.join("\0");
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
      case "split": return receiver.split(text[0] ?? "").join("\0");
      case "join": return receiver.split("\0").join(text[0] ?? ",");
      default: return undefined;
    }
  } catch {
    return undefined;
  }
}

function numeric(values: string[]): [number?, number?] {
  return values.slice(0, 2).map((value) => Number(value)) as [number?, number?];
}

export function fold(node: ts.Node, out: Folded, bindings: ConstantBindings): void {
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
export function isFoldRoot(node: ts.Node): boolean {
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
export function renderFolded(folded: Folded, sentinels: Sentinels): string[] {
  const text = folded.segments.map((s) => ("text" in s ? s.text : "")).join("");
  const marked = folded.segments.map((s) => ("text" in s ? s.text : sentinels.hole)).join("");
  return marked === text ? [marked] : [marked, text];
}
