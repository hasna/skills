export interface OnchainPayload {
  schema?: string;
  version?: string;
  title?: string;
  hints?: string[];
  files?: Record<string, string>;
  [key: string]: unknown;
}

export function decodeBase64Payload(base64: string): OnchainPayload {
  const trimmed = base64.trim().replace(/^["']|["']$/g, "");
  let raw: string;
  try {
    raw = Buffer.from(trimmed, "base64").toString("utf8");
  } catch {
    throw new Error("Invalid base64 input");
  }
  try {
    return JSON.parse(raw) as OnchainPayload;
  } catch {
    throw new Error("Decoded bytes are not valid JSON");
  }
}

export function decodeFileEntry(b64: string): string {
  return Buffer.from(b64, "base64").toString("utf8");
}

export function formatPayload(payload: OnchainPayload, expandFiles: boolean) {
  if (!expandFiles || !payload.files) return payload;
  const expanded: Record<string, string> = {};
  for (const [name, content] of Object.entries(payload.files)) {
    expanded[name] = decodeFileEntry(content);
  }
  return { ...payload, files: expanded };
}
