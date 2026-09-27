/** Client-owned copy only. Server error strings and details are never displayed. */
export const quoteUnavailableMessages = Object.freeze({
  HOSTED_PROVIDER_UNAVAILABLE: "Hosted execution is temporarily unavailable on this Skills instance.",
  HOSTED_CONNECTORS_UNAVAILABLE: "Hosted connector execution is unavailable on this Skills instance.",
  SKILL_IMPLEMENTATION_UNAVAILABLE: "This skill has no hosted execution implementation.",
  HOSTED_PRICING_UNAVAILABLE: "Hosted execution is unavailable while this skill's pricing is reviewed.",
  RUNTIME_ALLOWLIST_REQUIRED: "Hosted execution is unavailable until this Skills instance enables its skill catalog.",
  RUNTIME_SKILL_NOT_ALLOWED: "This skill is not enabled for hosted execution on this Skills instance.",
});
export type RemoteQuoteUnavailableCode = keyof typeof quoteUnavailableMessages;

/** Read one small error body, bounded even when a peer sends headers then stalls. */
export async function readQuoteUnavailableCode(response: Response): Promise<RemoteQuoteUnavailableCode | null> {
  const maximum = 16 * 1024;
  const length = response.headers.get("content-length");
  if (response.status !== 503 || response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json"
    || (length !== null && (!/^\d+$/.test(length) || Number(length) > maximum))) {
    void response.body?.cancel().catch(() => {});
    return null;
  }
  const reader = response.body?.getReader();
  if (!reader) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let deadlineExceeded = false;
  const expired = Symbol("quote body deadline");
  const deadline = new Promise<typeof expired>(resolve => {
    timer = setTimeout(() => { deadlineExceeded = true; resolve(expired); void reader.cancel().catch(() => {}); }, 1_500);
  });
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await Promise.race([reader.read(), deadline]);
      if (next === expired || deadlineExceeded) return null;
      if (next.done) break;
      size += next.value.byteLength;
      if (size > maximum) return null;
      chunks.push(next.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const code = (value as { code?: unknown }).code;
    return typeof code === "string" && Object.hasOwn(quoteUnavailableMessages, code) ? code as RemoteQuoteUnavailableCode : null;
  } catch { return null; }
  finally {
    clearTimeout(timer);
    // Do not await a peer-controlled stream's cancellation promise. Cancel the
    // reader immediately, release its lock, and preserve the bounded refusal.
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
