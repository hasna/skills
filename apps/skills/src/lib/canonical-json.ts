import { createHash } from "node:crypto";

/** Bounded canonical JSON for portable integrity checks, not an authority token.
 * Object keys use JavaScript code-unit order. Values that JSON would silently
 * drop or transform are refused, including accessors and sparse array slots. */
export function canonicalJson(value: unknown, maximumBytes = 2 * 1024 * 1024): string {
  return canonicalJsonAtDepth(value, maximumBytes, 64);
}

/** Internal parser bound: response wrappers consume depth independently of the
 * immutable payload. The public canonical helpers retain their 64-level bound. */
export function canonicalJsonAtDepth(value: unknown, maximumBytes: number, maximumDepth: number): string {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1 || maximumBytes > 64 * 1024 * 1024)
    throw new Error("Invalid canonical JSON bound");
  if (!Number.isSafeInteger(maximumDepth) || maximumDepth < 1 || maximumDepth > 128)
    throw new Error("Invalid canonical JSON depth bound");
  let bytes = 0;
  const active = new Set<object>();
  const piece = (text: string) => {
    bytes += Buffer.byteLength(text);
    if (bytes > maximumBytes) throw new Error("Canonical JSON exceeds its bound");
    return text;
  };
  const visit = (v: unknown, depth: number): string => {
    if (depth > maximumDepth) throw new Error("Canonical JSON exceeds its depth bound");
    if (v === null || typeof v === "string" || typeof v === "boolean" || typeof v === "number" && Number.isFinite(v))
      return piece(JSON.stringify(v));
    if (!v || typeof v !== "object" || active.has(v)) throw new Error("Canonical JSON requires finite JSON values");
    if (!Array.isArray(v) && Object.getPrototypeOf(v) !== Object.prototype) throw new Error("Canonical JSON requires plain objects");
    active.add(v);
    try {
      const descriptors = Object.getOwnPropertyDescriptors(v);
      if (Object.getOwnPropertySymbols(v).length || Object.values(descriptors).some(d => d.get || d.set))
        throw new Error("Canonical JSON refuses transformed values");
      if (Array.isArray(v)) {
        if (Object.keys(v).length !== v.length || Object.keys(v).some((key, i) => key !== String(i)))
          throw new Error("Canonical JSON requires dense arrays");
        return piece("[") + v.map((item, i) => (i ? piece(",") : "") + visit(item, depth + 1)).join("") + piece("]");
      }
      return piece("{") + Object.keys(v).sort().map((key, i) =>
        (i ? piece(",") : "") + piece(JSON.stringify(key) + ":") + visit(descriptors[key]!.value, depth + 1)).join("") + piece("}");
    } finally { active.delete(v); }
  };
  return visit(value, 0);
}

export function canonicalJsonSha256(value: unknown, maximumBytes?: number): string {
  return createHash("sha256").update(canonicalJson(value, maximumBytes)).digest("hex");
}
