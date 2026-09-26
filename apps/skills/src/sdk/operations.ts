/** Provider-neutral guest operation client. Authority and IPC belong to the embedder.
 * No credentials, endpoint discovery, provider SDK, or automatic retry is provided.
 */
export type SkillOperationJson = null | boolean | number | string | readonly SkillOperationJson[] | { readonly [key: string]: SkillOperationJson };
export const SKILL_OPERATION_LIMITS = Object.freeze({ requestBytes: 65_536, resultBytes: 1_048_576, depth: 32, nodes: 16_384, rememberedRequests: 256, rememberedBytes: 1_048_576 });
export type SkillOperationRefusal = "NOT_ALLOWED" | "APPROVAL_REQUIRED" | "BUDGET_EXHAUSTED" | "EXPIRED" | "CANCELLED" | "UNAVAILABLE" | "INVALID_INPUT";
export interface SkillOperationRequest { readonly contractVersion: 1; readonly requestId: string; readonly operation: string; readonly input: { readonly [key: string]: SkillOperationJson } }
interface OperationIdentity { readonly contractVersion: 1; readonly requestId: string }
export type SkillOperationResult = OperationIdentity & (
  | { readonly status: "not-executed" | "pending" | "unknown" }
  | { readonly status: "succeeded"; readonly output: SkillOperationJson }
  | { readonly status: "refused"; readonly code: SkillOperationRefusal }
);
/** Implementations must authenticate the captured run/attempt separately. A
 * not-executed response is authoritative proof, never a guess from transport loss. */
export interface SkillOperationTransport {
  invoke(request: SkillOperationRequest, options: { signal: AbortSignal }): Promise<unknown>;
  get(requestId: string, options: { signal: AbortSignal }): Promise<unknown>;
}
export type SkillOperationClientErrorCode = "INVALID_REQUEST" | "REQUEST_CONFLICT" | "REQUEST_CAPACITY" | "ABORTED" | "UNKNOWN_OUTCOME" | "INVALID_RESPONSE" | "INVALID_CONFIGURATION";
export class SkillOperationClientError extends Error {
  constructor(public readonly code: SkillOperationClientErrorCode, public readonly outcome: "not-invoked" | "unknown") {
    super(`Skill operation client: ${code}`); this.name = "SkillOperationClientError";
  }
}
export interface SkillOperationClient {
  invoke(request: SkillOperationRequest, options?: { signal?: AbortSignal }): Promise<SkillOperationResult>;
  get(requestId: string, options?: { signal?: AbortSignal }): Promise<SkillOperationResult>;
}
const encoder = new TextEncoder();
const refusalCodes = new Set<SkillOperationRefusal>(["NOT_ALLOWED", "APPROVAL_REQUIRED", "BUDGET_EXHAUSTED", "EXPIRED", "CANCELLED", "UNAVAILABLE", "INVALID_INPUT"]);
const requestIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
function validId(value: unknown): value is string { return typeof value === "string" && requestIdPattern.test(value); }
function record(value: unknown): value is Record<string, SkillOperationJson> { return !!value && typeof value === "object" && !Array.isArray(value); }
function exact(value: object, names: string[]) { const keys = Object.keys(value).sort(), expected = [...names].sort(); return keys.length === expected.length && keys.every((key, index) => key === expected[index]); }

/** Own a canonical JSON tree without invoking getters or toJSON. Bounds apply
 * during traversal, including serialized escaping and UTF-8, before transport. */
function snapshot(value: unknown, maximum: number): { value: SkillOperationJson; canonical: string; bytes: number } {
  let nodes = 0, bytes = 0;
  const parts: string[] = [], ancestors = new Set<object>();
  const append = (part: string) => { if (part.length > maximum - bytes) throw Error(); bytes += encoder.encode(part).byteLength; if (bytes > maximum) throw Error(); parts.push(part); };
  function visit(input: unknown, depth: number): SkillOperationJson {
    if (++nodes > SKILL_OPERATION_LIMITS.nodes || depth > SKILL_OPERATION_LIMITS.depth) throw Error();
    if (input === null || typeof input === "boolean") { append(String(input)); return input; }
    if (typeof input === "number") { if (!Number.isFinite(input)) throw Error(); append(JSON.stringify(input)); return Object.is(input, -0) ? 0 : input; }
    if (typeof input === "string") {
      if (input.length > maximum - bytes || /[\ud800-\udfff]/u.test(input)) throw Error();
      append(JSON.stringify(input)); return input;
    }
    if (!input || typeof input !== "object" || ancestors.has(input)) throw Error();
    const array = Array.isArray(input), proto = Object.getPrototypeOf(input);
    if (array ? proto !== Array.prototype : proto !== Object.prototype && proto !== null) throw Error();
    const keys = Reflect.ownKeys(input);
    if (keys.length > SKILL_OPERATION_LIMITS.nodes + 1 || keys.some(key => typeof key !== "string")) throw Error();
    ancestors.add(input);
    try {
      if (array) {
        if (input.length > SKILL_OPERATION_LIMITS.nodes || keys.length !== input.length + 1) throw Error();
        const result: SkillOperationJson[] = []; append("[");
        for (let i = 0; i < input.length; i++) {
          const descriptor = Object.getOwnPropertyDescriptor(input, String(i));
          if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) throw Error();
          if (i) append(","); result.push(visit(descriptor.value, depth + 1));
        }
        append("]"); return Object.freeze(result);
      }
      const result = Object.create(null) as Record<string, SkillOperationJson>; append("{");
      for (const [i, key] of (keys as string[]).sort().entries()) {
        const descriptor = Object.getOwnPropertyDescriptor(input, key)!;
        if (!("value" in descriptor) || !descriptor.enumerable || /[\ud800-\udfff]/u.test(key) || key.length > maximum - bytes) throw Error();
        if (i) append(","); append(JSON.stringify(key)); append(":"); result[key] = visit(descriptor.value, depth + 1);
      }
      append("}"); return Object.freeze(result);
    } finally { ancestors.delete(input); }
  }
  const owned = visit(value, 0); return { value: owned, canonical: parts.join(""), bytes };
}
function requestSnapshot(input: unknown) {
  try {
    const owned = snapshot(input, SKILL_OPERATION_LIMITS.requestBytes), value = owned.value;
    if (!record(value) || !exact(value, ["contractVersion", "requestId", "operation", "input"]) || value.contractVersion !== 1 || !validId(value.requestId)
      || typeof value.operation !== "string" || value.operation.length > 128 || !/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/.test(value.operation) || !record(value.input)) throw Error();
    return { ...owned, value: value as unknown as SkillOperationRequest };
  } catch { throw new SkillOperationClientError("INVALID_REQUEST", "not-invoked"); }
}
function resultSnapshot(input: unknown, requestId: string): SkillOperationResult {
  try {
    const value = snapshot(input, SKILL_OPERATION_LIMITS.resultBytes).value;
    if (!record(value) || value.contractVersion !== 1 || value.requestId !== requestId) throw Error();
    const fields = ["contractVersion", "requestId", "status"];
    if (value.status === "succeeded") fields.push("output");
    else if (value.status === "refused") { fields.push("code"); if (!refusalCodes.has(value.code as SkillOperationRefusal)) throw Error(); }
    else if (!["not-executed", "pending", "unknown"].includes(value.status as string)) throw Error();
    if (!exact(value, fields)) throw Error(); return value as unknown as SkillOperationResult;
  } catch { throw new SkillOperationClientError("INVALID_RESPONSE", "unknown"); }
}

/** One client belongs to one captured authority scope. Remembered identities
 * are bounded and never evicted. This is local misuse protection, not durable
 * deduplication: the server must bind request IDs and payloads atomically.
 * Each explicit call invokes transport once; uncertainty requires explicit get. */
export function createSkillOperationClient(transport: SkillOperationTransport, options: { timeoutMs?: number } = {}): SkillOperationClient {
  const timeoutMs = options.timeoutMs ?? 30_000;
  if (!transport || typeof transport.invoke !== "function" || typeof transport.get !== "function" || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000)
    throw new SkillOperationClientError("INVALID_CONFIGURATION", "not-invoked");
  const invokeTransport = transport.invoke.bind(transport), getTransport = transport.get.bind(transport);
  const identities = new Map<string, string>(); let rememberedBytes = 0;
  async function call(requestId: string, signal: AbortSignal | undefined, invoke: (signal: AbortSignal) => Promise<unknown>) {
    if (signal?.aborted) throw new SkillOperationClientError("ABORTED", "not-invoked");
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const abort = () => controller.abort();
    let onAbort: () => void = () => {};
    const interrupted = new Promise<never>((_, reject) => { onAbort = () => reject(new SkillOperationClientError("UNKNOWN_OUTCOME", "unknown")); controller.signal.addEventListener("abort", onAbort, { once: true }); });
    signal?.addEventListener("abort", abort, { once: true });
    try {
      if (signal?.aborted) throw new SkillOperationClientError("ABORTED", "not-invoked");
      timer = setTimeout(abort, timeoutMs);
      let pending: Promise<unknown>;
      try { pending = invoke(controller.signal); }
      catch { pending = Promise.reject(new SkillOperationClientError("UNKNOWN_OUTCOME", "unknown")); }
      // Always observe both promises, including when invoke aborts synchronously
      // and then throws. Throwing here would strand the rejected abort promise.
      // Copy in the first fulfillment callback, before Promise.race/await add
      // another scheduling boundary at which a shared response could change.
      const owned = Promise.resolve(pending).then(
        value => resultSnapshot(value, requestId),
        () => { throw new SkillOperationClientError("UNKNOWN_OUTCOME", "unknown"); },
      );
      const result = await Promise.race([owned, interrupted]);
      if (controller.signal.aborted) throw new SkillOperationClientError("UNKNOWN_OUTCOME", "unknown");
      return result;
    } finally { if (timer !== undefined) clearTimeout(timer); signal?.removeEventListener("abort", abort); controller.signal.removeEventListener("abort", onAbort); controller.abort(); }
  }
  return Object.freeze({
    async invoke(input: SkillOperationRequest, requestOptions: { signal?: AbortSignal } = {}) {
      if (requestOptions.signal?.aborted) throw new SkillOperationClientError("ABORTED", "not-invoked");
      const owned = requestSnapshot(input), previous = identities.get(owned.value.requestId);
      if (previous !== undefined && previous !== owned.canonical) throw new SkillOperationClientError("REQUEST_CONFLICT", "not-invoked");
      if (previous === undefined) {
        if (identities.size >= SKILL_OPERATION_LIMITS.rememberedRequests || rememberedBytes + owned.bytes > SKILL_OPERATION_LIMITS.rememberedBytes)
          throw new SkillOperationClientError("REQUEST_CAPACITY", "not-invoked");
        identities.set(owned.value.requestId, owned.canonical); rememberedBytes += owned.bytes;
      }
      return call(owned.value.requestId, requestOptions.signal, signal => invokeTransport(owned.value, { signal }));
    },
    async get(requestId: string, requestOptions: { signal?: AbortSignal } = {}) {
      if (!validId(requestId)) throw new SkillOperationClientError("INVALID_REQUEST", "not-invoked");
      return call(requestId, requestOptions.signal, signal => getTransport(requestId, { signal }));
    },
  });
}
