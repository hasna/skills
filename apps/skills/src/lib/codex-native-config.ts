import { isDeepStrictEqual } from "node:util";

const NUMBER_TAG = "$serde_json::private::Number";

function isRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object") return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

// Compare decimal values without rounding an arbitrary-precision native value
// into a different JS number. Equivalent exponent/trailing-zero spellings are
// allowed; overflow, underflow and precision loss are not.
function decimalIdentity(text: string): string | undefined {
  if (text.length > 4096) return undefined;
  const match = /^(-?)(0|[1-9][0-9]*)(?:\.([0-9]+))?(?:[eE]([+-]?[0-9]+))?$/.exec(text);
  if (!match || !Number.isFinite(Number(text))) return undefined;
  const fraction = match[3] ?? "";
  const digits = (match[2]! + fraction).replace(/^0+/, "");
  if (!digits) return match[1] + "0";
  const coefficient = digits.replace(/0+$/, "");
  const exponent = BigInt(match[4] ?? "0") - BigInt(fraction.length) + BigInt(digits.length - coefficient.length);
  return `${match[1]}${coefficient}e${exponent}`;
}

/** Codex config/read can expose serde_json's numeric wrapper for TOML floats.
 * Admit it only against an equal numeric value from the complete disk parse.
 * Ordinary objects, strings, native trust state and unknown fields stay exact.
 */
export function codexNativeConfigEqual(native: unknown, expected: unknown): boolean {
  if (isDeepStrictEqual(native, expected)) return true;
  if (typeof expected === "number") {
    if (!Number.isFinite(expected) || !isRecord(native)) return false;
    const keys = Object.keys(native);
    const value = (native as Record<string, unknown>)[NUMBER_TAG];
    if (keys.length !== 1 || keys[0] !== NUMBER_TAG || typeof value !== "string") return false;
    const actual = decimalIdentity(value);
    return actual !== undefined && actual === decimalIdentity(Object.is(expected, -0) ? "-0" : String(expected));
  }
  if (Array.isArray(native) || Array.isArray(expected)) {
    return Array.isArray(native) && Array.isArray(expected) && native.length === expected.length
      && native.every((value, index) => codexNativeConfigEqual(value, expected[index]));
  }
  if (!isRecord(native) || !isRecord(expected)) return false;
  const actual = native as Record<string, unknown>, wanted = expected as Record<string, unknown>;
  return Object.keys(actual).length === Object.keys(wanted).length
    && Object.keys(wanted).every(key => Object.hasOwn(actual, key) && codexNativeConfigEqual(actual[key], wanted[key]));
}
