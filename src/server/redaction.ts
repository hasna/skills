const SECRET_PATTERNS: RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{8,}\b/g,
  /\bsk_[A-Za-z0-9_-]{8,}\b/g,
  /\bgh[opsur]_[A-Za-z0-9_]{8,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{8,}\b/g,
  /\bnpm_[A-Za-z0-9_]{8,}\b/g,
  /\bAKIA[A-Z0-9]{12,}\b/g,
  /\bAIza[A-Za-z0-9_-]{10,}\b/g,
  /\b[A-Z0-9_]*(?:API_KEY|SECRET|TOKEN|PASSWORD|DATABASE_URL)[A-Z0-9_]*\s*[:=]\s*[^ \n\r\t]+/gi,
  /\bhttps?:\/\/[^ \n\r\t]+X-Amz-Signature=[^ \n\r\t]+/gi,
];

export function redactForClient(value: unknown): string {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return SECRET_PATTERNS.reduce((current, pattern) => current.replace(pattern, "credential"), text)
    .replace(/\s+$/g, "")
    .slice(0, 20_000);
}
