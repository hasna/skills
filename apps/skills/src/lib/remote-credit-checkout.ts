/** Caller-owned checkout identity. Reuse only for the same server, account and pack. */
export interface RemoteCreditCheckoutOptions { idempotencyKey?: string }
export interface RemoteCreditCheckout { url: string; requestIdempotencyKey: string }
export const creditCheckoutKeyPattern = /^[A-Za-z0-9._:-]{8,255}$/;
export function creditCheckoutRequestKey(value: unknown): string {
  if (value === undefined) return crypto.randomUUID();
  if (typeof value !== "string" || !creditCheckoutKeyPattern.test(value)) throw new Error("Checkout idempotency key must be 8-255 URL-safe characters");
  return value;
}
export const creditCheckoutMessages = {
  CREDIT_CHECKOUT_UNCONFIRMED: "Checkout creation could not be confirmed. Keep the request idempotency key, inspect billing, and use the same key for an explicit retry on the same server, account and pack. No automatic retry was made.",
  CREDIT_CHECKOUT_IN_PROGRESS: "This checkout is still being created. Wait before explicitly retrying the same server, account and pack with the same request idempotency key. No automatic retry was made.",
  CREDIT_CHECKOUT_EXPIRED: "This checkout has expired. Inspect billing before deliberately starting a new purchase with a new request idempotency key. Do not retry this checkout automatically.",
  CREDIT_CHECKOUT_FULFILLED: "This checkout is already fulfilled. Inspect the account balance; do not create another checkout to recover this purchase.",
} as const;
export type RemoteCreditCheckoutErrorCode = keyof typeof creditCheckoutMessages;
/** Only recognized server states become typed outcomes; never retain server text. */
export function creditCheckoutFailure(value: unknown, status: number, key: string): { code: RemoteCreditCheckoutErrorCode; retryAfterSeconds?: number } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { code: "CREDIT_CHECKOUT_UNCONFIRMED" };
  const row = value as Record<string, unknown>;
  if (row.requestIdempotencyKey !== undefined && row.requestIdempotencyKey !== key) return { code: "CREDIT_CHECKOUT_UNCONFIRMED" };
  const code = status === 409 && row.error === "credit checkout in_progress" ? "CREDIT_CHECKOUT_IN_PROGRESS"
    : status === 409 && row.error === "credit checkout expired" && row.requestIdempotencyKey === key ? "CREDIT_CHECKOUT_EXPIRED"
    : status === 409 && row.error === "credit checkout fulfilled" && row.requestIdempotencyKey === key ? "CREDIT_CHECKOUT_FULFILLED"
    : "CREDIT_CHECKOUT_UNCONFIRMED";
  const delay = row.retryAfterSeconds;
  return { code, ...(code === "CREDIT_CHECKOUT_IN_PROGRESS" || status === 503 && row.error === "credit checkout creation unresolved"
    ? typeof delay === "number" && Number.isSafeInteger(delay) && delay > 0 && delay <= 3600 ? { retryAfterSeconds: delay } : {} : {}) };
}
