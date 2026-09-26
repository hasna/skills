import { constants, closeSync, fsyncSync, fstatSync, lstatSync, mkdirSync, openSync, readSync, realpathSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { inspectSkillBundle, packSkillBundle } from "./skill-bundle.js";
import { verifyContentHashFromEntries } from "./skill-hash.js";
import { checkedPublicationDeclaration, checkedPublicationView, publicationSha256, publicationUuid,
  PRIVATE_PUBLICATION_MAX_BYTES, PrivatePublicationError, RemotePrivatePublicationsClient,
  type PrivatePublicationDeclaration, type PrivatePublicationView } from "./remote-private-publications.js";
import { normalizeSkillsApiOrigin } from "./fleet-credentials.js";

type Phase = "prepared" | "begin_uncertain" | "awaiting_upload" | "upload_uncertain" | "uploaded" | "finalize_uncertain" | "observed";
export interface PrivatePublicationRecovery {
  contractVersion: 1; apiOrigin: string; organizationId: string; userId: string; membershipId: string;
  skillId: string; declaration: PrivatePublicationDeclaration; phase: Phase; intent: PrivatePublicationView | null;
}
export interface PrivatePublicationResult {
  recoveryDirectory: string; skillId: string; intentId: string | null; state: string;
  versionId: string | null; committed: boolean;
  /** Null when this recovery receipt contains no directly observed server capability. Publication alone never proves execution availability. */
  executionEnabled: boolean | null; nextAction: string;
}
const fail = (): never => { throw new PrivatePublicationError("PUBLICATION_RECOVERY_INVALID", "The recovery directory is invalid or changed. Preserve it and inspect the existing intent; do not start a replacement automatically."); };
function safeDirectory(directory: string) {
  if (!isAbsolute(directory) || directory !== resolve(directory) || realpathSync(directory) !== directory) return fail();
  for (let path = directory; ; path = dirname(path)) {
    const stat = lstatSync(path); if (!stat.isDirectory() || stat.isSymbolicLink()) return fail();
    if (path === dirname(path)) break;
  }
  const own = lstatSync(directory);
  if ((own.mode & 0o077) !== 0 || (process.getuid && own.uid !== process.getuid())) return fail();
  return { dev: own.dev, ino: own.ino };
}
function unchangedDirectory(directory: string, identity: { dev: number; ino: number }) {
  const now = safeDirectory(directory); if (now.dev !== identity.dev || now.ino !== identity.ino) return fail();
}
function readOwned(directory: string, name: string, max: number): Buffer {
  const identity = safeDirectory(directory), file = join(directory, name);
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > max || stat.size < 1 || (stat.mode & 0o077) !== 0 || (process.getuid && stat.uid !== process.getuid())) return fail();
    // Read at most one byte beyond the permitted size, even if another process
    // grows the file after fstat. Never read an unbounded stream to EOF.
    const buffer = Buffer.alloc(Math.min(max, stat.size) + 1);
    let length = 0;
    while (length < buffer.length) {
      const count = readSync(fd, buffer, length, buffer.length - length, length);
      if (count === 0) break;
      length += count;
    }
    const bytes = buffer.subarray(0, length), after = fstatSync(fd);
    unchangedDirectory(directory, identity);
    if (bytes.length !== stat.size || stat.size !== after.size || stat.mtimeMs !== after.mtimeMs || stat.ctimeMs !== after.ctimeMs) return fail();
    return bytes;
  } finally { closeSync(fd); }
}
function writeOwned(directory: string, name: string, bytes: string | Uint8Array) {
  const fd = openSync(join(directory, name), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { writeFileSync(fd, bytes); fsyncSync(fd); } finally { closeSync(fd); }
}
function save(directory: string, value: PrivatePublicationRecovery) {
  const identity = safeDirectory(directory), temporary = `.receipt-${randomUUID()}.json`;
  writeOwned(directory, temporary, JSON.stringify(value) + "\n");
  unchangedDirectory(directory, identity);
  renameSync(join(directory, temporary), join(directory, "receipt.json"));
  const fd = openSync(directory, constants.O_RDONLY | constants.O_NOFOLLOW);
  try { fsyncSync(fd); } finally { closeSync(fd); }
}
function bind(client: RemotePrivatePublicationsClient, receipt: PrivatePublicationRecovery) {
  if (["apiOrigin", "organizationId", "userId", "membershipId"].some(k => client[k as keyof RemotePrivatePublicationsClient] !== receipt[k as keyof PrivatePublicationRecovery]))
    throw new PrivatePublicationError("PUBLICATION_IDENTITY_CHANGED", "The fresh session does not match the recovery directory's server, account and membership.");
}
async function locked<T>(directory: string, action: () => Promise<T>): Promise<T> {
  const identity = safeDirectory(directory), file = join(directory, "operation.lock"); let fd: number;
  try { fd = openSync(file, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600); }
  catch { throw new PrivatePublicationError("PUBLICATION_RECOVERY_BUSY", "Another operation holds this recovery directory. If it crashed, confirm that process has stopped before explicitly removing operation.lock and resuming."); }
  const lock = fstatSync(fd);
  try { writeFileSync(fd, JSON.stringify({ pid: process.pid }) + "\n"); fsyncSync(fd); return await action(); }
  finally {
    closeSync(fd); unchangedDirectory(directory, identity);
    const now = lstatSync(file); if (now.dev !== lock.dev || now.ino !== lock.ino || !now.isFile() || now.isSymbolicLink()) fail();
    unlinkSync(file);
  }
}
/** Reads only two bounded local files. The receipt never contains a token or signed URL. */
export function readPrivatePublicationRecovery(directory: string): { receipt: PrivatePublicationRecovery; bytes: Buffer } {
  try {
    const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(readOwned(directory, "receipt.json", 65536)));
    if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).sort().join(",") !== ["contractVersion", "apiOrigin", "organizationId", "userId", "membershipId", "skillId", "declaration", "phase", "intent"].sort().join(",")
      || value.contractVersion !== 1 || ![value.organizationId, value.userId, value.membershipId, value.skillId].every(publicationUuid)
      || typeof value.apiOrigin !== "string" || normalizeSkillsApiOrigin(value.apiOrigin) !== value.apiOrigin
      || !["prepared", "begin_uncertain", "awaiting_upload", "upload_uncertain", "uploaded", "finalize_uncertain", "observed"].includes(value.phase)) return fail();
    value.declaration = checkedPublicationDeclaration(value.declaration);
    if (value.intent !== null) value.intent = checkedPublicationView(value.intent, value.skillId, undefined, value.declaration);
    if (value.intent === null && !["prepared", "begin_uncertain"].includes(value.phase)) return fail();
    const bytes = readOwned(directory, "bundle.tgz", PRIVATE_PUBLICATION_MAX_BYTES);
    if (bytes.length !== value.declaration.archiveByteSize || publicationSha256(bytes) !== value.declaration.archiveSha256) return fail();
    return { receipt: value, bytes };
  } catch { return fail(); }
}
/** Snapshot and verify before the first publication request. Source files are not rewritten. */
export async function preparePrivatePublication(client: RemotePrivatePublicationsClient, sourceDirectory: string, recoveryDirectory: string,
  input: { skillId: string; expectedCurrentVersionId: string | null; idempotencyKey?: string }): Promise<PrivatePublicationRecovery> {
  if (!publicationUuid(input.skillId) || !(input.expectedCurrentVersionId === null || publicationUuid(input.expectedCurrentVersionId))
    || (input.idempotencyKey !== undefined && !publicationUuid(input.idempotencyKey))) return fail();
  const packed = packSkillBundle(sourceDirectory, { maxUnpackedBytes: 32 * 1024 * 1024 });
  const inspected = await inspectSkillBundle(packed.bytes, { limits: { compressedBytes: PRIVATE_PUBLICATION_MAX_BYTES } });
  const manifest = inspected.entries.find(entry => entry.path === "skill.json");
  if (!manifest || manifest.bytes.length > 16384 || !(await verifyContentHashFromEntries(inspected.entries)).valid)
    throw new PrivatePublicationError("PUBLICATION_BUNDLE_INVALID", "The skill must have a valid skill.json with its current content hash. Validate the skill before publishing.");
  const manifestText = new TextDecoder("utf-8", { fatal: true }).decode(manifest.bytes);
  const declaration = checkedPublicationDeclaration({ idempotencyKey: input.idempotencyKey ?? randomUUID(), version: JSON.parse(manifestText).version,
    expectedCurrentVersionId: input.expectedCurrentVersionId, manifestText, archiveSha256: inspected.sha256, archiveByteSize: packed.bytes.length });
  const receipt: PrivatePublicationRecovery = { contractVersion: 1, apiOrigin: client.apiOrigin, organizationId: client.organizationId,
    userId: client.userId, membershipId: client.membershipId, skillId: input.skillId, declaration, phase: "prepared", intent: null };
  if (!isAbsolute(recoveryDirectory) || resolve(recoveryDirectory) !== recoveryDirectory || realpathSync(dirname(recoveryDirectory)) !== dirname(recoveryDirectory)) return fail();
  mkdirSync(recoveryDirectory, { mode: 0o700 }); safeDirectory(recoveryDirectory);
  // Persist the new directory entry as well as its files before any request.
  const parent = openSync(dirname(recoveryDirectory), constants.O_RDONLY | constants.O_NOFOLLOW);
  try { fsyncSync(parent); } finally { closeSync(parent); }
  writeOwned(recoveryDirectory, "bundle.tgz", packed.bytes); save(recoveryDirectory, receipt);
  return receipt;
}
export function privatePublicationResult(directory: string, receipt: PrivatePublicationRecovery): PrivatePublicationResult {
  const state = receipt.intent?.state ?? receipt.phase, committed = state === "committed";
  const nextAction = committed ? "Published; execution requires a separate server quote and approval."
    : ["rejected", "cancelled", "expired"].includes(state) ? "This intent is terminal. Inspect the result before explicitly preparing another version."
    : state === "needs_attention" ? "Keep this intent and contact the service operator; do not create a replacement or upload again."
    : receipt.phase === "upload_uncertain" ? "Run publication resume with this recovery directory to finalize the same intent without another upload."
    : receipt.intent ? "Run publication status or resume with this recovery directory; cancel explicitly if you want to stop."
    : "Run publication resume with this recovery directory to reconcile the identical request key and declaration.";
  return { recoveryDirectory: directory, skillId: receipt.skillId, intentId: receipt.intent?.id ?? null, state,
    versionId: receipt.intent?.versionId ?? null, committed, executionEnabled: null, nextAction };
}
/** Each write-ahead phase is durable before its network mutation. A resumed
 * uncertain PUT is finalized for server verification, never uploaded again. */
export async function continuePrivatePublication(client: RemotePrivatePublicationsClient, directory: string,
  options: { confirm: true; waitMs?: number }): Promise<PrivatePublicationResult> {
  if (options.confirm !== true) throw new PrivatePublicationError("PUBLICATION_CONFIRM_REQUIRED", "Explicit upload confirmation is required.");
  if (options.waitMs !== undefined && (!Number.isSafeInteger(options.waitMs) || options.waitMs < 0 || options.waitMs > 300000)) return fail();
  return locked(directory, () => continueLocked(client, directory, options));
}
async function continueLocked(client: RemotePrivatePublicationsClient, directory: string, options: { waitMs?: number }): Promise<PrivatePublicationResult> {
  const { receipt, bytes } = readPrivatePublicationRecovery(directory); bind(client, receipt);
  if (!receipt.intent) {
    receipt.phase = "begin_uncertain"; save(directory, receipt);
    receipt.intent = await client.begin(receipt.skillId, receipt.declaration); receipt.phase = "awaiting_upload"; save(directory, receipt);
  } else {
    receipt.intent = checkedPublicationView(await client.get(receipt.skillId, receipt.intent.id), receipt.skillId, receipt.intent.id, receipt.declaration); save(directory, receipt);
  }
  if (receipt.intent.state === "awaiting_upload") {
    if (receipt.phase === "awaiting_upload") {
      receipt.phase = "upload_uncertain"; save(directory, receipt);
      try { await client.upload(receipt.skillId, receipt.intent, bytes); }
      catch (error) {
        // A refused capability/signing response precedes PUT. An uncertain PUT
        // retains the write-ahead phase and is never repeated by resume.
        if (error instanceof PrivatePublicationError && !error.uncertain) { receipt.phase = "awaiting_upload"; save(directory, receipt); }
        throw error;
      }
      receipt.phase = "uploaded"; save(directory, receipt);
    }
    receipt.phase = "finalize_uncertain"; save(directory, receipt);
    receipt.intent = checkedPublicationView(await client.finalize(receipt.skillId, receipt.intent.id), receipt.skillId, receipt.intent.id, receipt.declaration);
    receipt.phase = "observed"; save(directory, receipt);
  }
  if (options.waitMs !== undefined && options.waitMs > 0 && ["queued", "verifying"].includes(receipt.intent.state)) {
    receipt.intent = checkedPublicationView(await client.wait(receipt.skillId, receipt.intent.id, { timeoutMs: options.waitMs }), receipt.skillId, receipt.intent.id, receipt.declaration);
    receipt.phase = "observed"; save(directory, receipt);
  }
  return privatePublicationResult(directory, receipt);
}
export async function inspectPrivatePublication(client: RemotePrivatePublicationsClient, directory: string, cancel = false): Promise<PrivatePublicationResult> {
  return locked(directory, () => inspectLocked(client, directory, cancel));
}
async function inspectLocked(client: RemotePrivatePublicationsClient, directory: string, cancel: boolean): Promise<PrivatePublicationResult> {
  const { receipt } = readPrivatePublicationRecovery(directory); bind(client, receipt);
  if (receipt.intent) {
    receipt.intent = checkedPublicationView(await (cancel ? client.cancel(receipt.skillId, receipt.intent.id) : client.get(receipt.skillId, receipt.intent.id)), receipt.skillId, receipt.intent.id, receipt.declaration);
    save(directory, receipt);
  } else if (cancel) throw new PrivatePublicationError("PUBLICATION_INTENT_UNKNOWN", "Reconcile the saved begin request with publication resume before cancelling its intent.");
  return privatePublicationResult(directory, receipt);
}
