import { createHash } from "node:crypto";

export const MAX_REMOTE_FILE_BYTES = 64 * 1024 * 1024;
export interface RemoteInputFile { name: string; bytes: Uint8Array; contentType?: string }
export interface RemoteInputFileDescriptor { name: string; sizeBytes: number; sha256: string; contentType: string }

export function describeRemoteFiles(files: RemoteInputFile[]): RemoteInputFileDescriptor[] {
  if (files.length > 10) throw new Error("At most 10 input files are supported");
  const names = new Set<string>();
  let total = 0;
  return files.map(file => {
    // Preserve the API's exact basename (including Unicode and punctuation).
    // A server may impose a narrower filesystem-byte bound before admission.
    if (typeof file.name !== "string" || file.name.length === 0 || file.name.length > 255
      || /[/\\\x00-\x1f\x7f]/.test(file.name) || /[\ud800-\udfff]/u.test(file.name)
      || file.name === "." || file.name === ".." || names.has(file.name)) throw new Error("Input file names must be unique safe basenames");
    names.add(file.name);
    total += file.bytes.byteLength;
    if (file.bytes.byteLength > 20 * 1024 * 1024 || total > 50 * 1024 * 1024) throw new Error("Input files exceed the supported size limit");
    return { name: file.name, sizeBytes: file.bytes.byteLength, sha256: sha256(file.bytes), contentType: file.contentType ?? "application/octet-stream" };
  });
}

export function sha256(bytes: Uint8Array): string { return createHash("sha256").update(bytes).digest("hex"); }

export async function readBoundedResponse(response: Response, maximum: number): Promise<Uint8Array> {
  if (!Number.isSafeInteger(maximum) || maximum < 0 || maximum > MAX_REMOTE_FILE_BYTES) throw new Error("Invalid artifact size limit");
  const length = response.headers.get("content-length");
  if (length && (!/^\d+$/.test(length) || Number(length) > maximum)) {
    await response.body?.cancel();
    throw new Error("Artifact exceeds its declared size limit");
  }
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > maximum) throw new Error("Artifact exceeds its declared size limit");
      chunks.push(next.value);
    }
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

/** Small inline inputs for agent transports; larger files belong in the CLI/SDK. */
export function decodeRemoteFiles(files: Array<{ name: string; base64: string; contentType?: string }>): RemoteInputFile[] {
  let total = 0;
  const decoded = files.map(file => {
    if (file.base64.length > 1_398_104 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(file.base64)) throw new Error("Invalid inline input encoding");
    const bytes = Buffer.from(file.base64, "base64");
    total += bytes.byteLength;
    if (total > 1024 * 1024 || bytes.toString("base64") !== file.base64) throw new Error("Inline inputs must total at most 1 MiB");
    return { name: file.name, bytes, contentType: file.contentType };
  });
  describeRemoteFiles(decoded);
  return decoded;
}
