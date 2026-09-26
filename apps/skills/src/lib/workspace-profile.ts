import { constants, closeSync, fstatSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, renameSync, rmSync, writeFileSync, type Stats } from "node:fs";
import { dirname, join } from "node:path";
import { getApiUrl, getAuthFilePath, getIdentityFilePath } from "./auth-store.js";
import { resolveSkillsConnection, SkillsFleetCredentialError } from "./fleet-credentials.js";
import { captureSkillsCredentialFiles, selectedSkillsProfile, skillsProfileCredentialFiles } from "./instance-credentials.js";
import { RemoteSkillsClient } from "./remote-client.js";
import { RemoteSkillsAuthClient } from "./remote-auth.js";
import { parseWorkspaceIdentity, parseWorkspaceLogin, workspaceExpectedUserId, type RemoteWorkspaceContext, type RemoteWorkspaceIdentity } from "./remote-workspace-selection.js";

type Env = Record<string, string | undefined>;
export class WorkspaceProfileError extends Error {}
const fail = (message: string): never => { throw new WorkspaceProfileError(message); };
const changed = () => fail("The selected profile changed during sign-in. No credential was saved; retry with a stable profile.");
function stat(path: string): Stats | null {
  try { return lstatSync(path); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}
function safeText(file: string): string | null {
  if (stat(file) === null) return null;
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const s = fstatSync(fd);
    if (!s.isFile() || s.size > 65536 || ![0o400, 0o600].includes(s.mode & 0o7777) || (process.getuid && s.uid !== process.getuid()))
      return fail("The selected profile must use bounded owner-only regular files.");
    return readFileSync(fd, "utf8");
  } finally { closeSync(fd); }
}
function checkIdentityMetadata(file: string, identity: RemoteWorkspaceIdentity): void {
  const text = safeText(file); if (text === null) return;
  let value: Record<string, unknown>;
  try { value = JSON.parse(text); } catch { return fail("The profile identity metadata is invalid. Sign in again before managing this workspace."); }
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail("The profile identity metadata is invalid.");
  for (const [key, expected] of Object.entries({ userId: identity.user.id, orgId: identity.organization.id })) {
    if (value[key] !== undefined && value[key] !== expected) return fail("The profile identity metadata does not match its authenticated key. Sign in again before managing this workspace.");
  }
}
async function keyIdentity(key: string, origin: string): Promise<RemoteWorkspaceIdentity> {
  const value = await new RemoteSkillsClient(key, origin).getIdentity();
  if (value.authMethod !== "api_key") return fail("The selected credential is not a workspace API key.");
  const user = value.user as { id?: unknown } | undefined;
  return parseWorkspaceIdentity(value, workspaceExpectedUserId(user?.id));
}

/** Capture actual key authority before OTP; cached identity never supplies authority. */
export function prepareProfileWorkspace(action: string, source: Env = process.env) {
  const env = { ...source }, origin = getApiUrl(action, env), profile = selectedSkillsProfile(env);
  const unchanged = captureSkillsCredentialFiles(skillsProfileCredentialFiles(env));
  return { origin, async resolve() {
    unchanged();
    if (!profile) return { origin, context: undefined, unchanged };
    const connection = await resolveSkillsConnection(env);
    if (!connection || connection.apiOrigin !== origin) return fail("The selected profile has no usable credential for this server.");
    const identity = await keyIdentity(connection.apiKey, origin);
    checkIdentityMetadata(getIdentityFilePath(env), identity);
    unchanged();
    const context: RemoteWorkspaceContext = { userId: identity.user.id, membershipId: identity.user.membershipId };
    return { origin, context, unchanged };
  } };
}
export async function captureProfileWorkspace(action: string, source: Env = process.env) {
  return prepareProfileWorkspace(action, source).resolve();
}

/** Own only the explicitly named profile; injected credentials may not hide enrollment. */
export async function prepareWorkspaceEnrollment(membershipId: string, source: Env = process.env) {
  workspaceExpectedUserId(membershipId);
  const env = { ...source }, profile = selectedSkillsProfile(env);
  if (!profile) return fail("Workspace login requires an explicit HASNA_PROFILE name.");
  if (["HASNA_SKILLS_API_KEY_OVERRIDE", "HASNA_SKILLS_API_KEY_REF", "HASNA_SKILLS_API_KEY", "SKILLS_API_KEY"].some(name => env[name]?.trim()))
    return fail("Clear injected API keys before enrolling a named workspace profile.");
  const origin = getApiUrl("Sign in to a workspace", env);
  const file = getAuthFilePath(env), identityFile = getIdentityFilePath(env);
  const paths = [...new Set([...skillsProfileCredentialFiles(env), file, identityFile])];
  const unchangedFiles = captureSkillsCredentialFiles(paths);
  const old = safeText(file), oldIdentity = safeText(identityFile);
  const managed = new Set(["HASNA_SKILLS_API_KEY", "SKILLS_API_KEY", "HASNA_SKILLS_API_URL", "SKILLS_API_URL", "HASNA_SKILLS_BOUND_API_URL"]);
  const lines = (old ?? "").split(/\r?\n/).filter(line => !managed.has(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line)?.[1] ?? ""));
  const credentialBody = (key: string) => [...lines.filter(Boolean), `HASNA_SKILLS_API_KEY=${key}`, `HASNA_SKILLS_API_URL=${origin}`, `HASNA_SKILLS_BOUND_API_URL=${origin}`, ""].join("\n");
  // Reserve the accepted maximum key size before OTP or issuance. UTF-8 bytes,
  // including preserved comments, must fit the shared credential reader.
  if (Buffer.byteLength(credentialBody("x".repeat(8192)), "utf8") > 65536)
    return fail("The selected profile has insufficient space for a bounded credential. Reduce its unrelated configuration before signing in.");
  const parents: Array<[string, Stats | null]> = [];
  for (let path = dirname(file); ; path = dirname(path)) {
    const before = stat(path);
    if (before && (!before.isDirectory() || before.isSymbolicLink())) return fail("The profile directory must not be a symbolic link.");
    parents.push([path, before]);
    if (path === dirname(path)) break;
  }
  const unchanged = () => {
    unchangedFiles();
    for (const [path, before] of parents) {
      const now = stat(path);
      if (!before ? now !== null : !now || !now.isDirectory() || before.dev !== now.dev || before.ino !== now.ino) changed();
    }
  };
  let expected: RemoteWorkspaceIdentity | undefined;
  try {
    const connection = await resolveSkillsConnection(env);
    if (connection) {
      if (connection.apiKeyTier !== "profile" || connection.apiOrigin !== origin) return fail("Workspace login must resolve only the explicitly named profile.");
      expected = await keyIdentity(connection.apiKey, origin);
      checkIdentityMetadata(identityFile, expected);
    }
  } catch (error) {
    if (!(error instanceof SkillsFleetCredentialError && error.code === "MISSING_API_CREDENTIAL" && (old === null || !/^\s*(?:export\s+)?(?:HASNA_SKILLS_API_KEY|SKILLS_API_KEY)\s*=/m.test(old)))) throw error;
  }
  unchanged();
  return { profile, origin,
    async complete(email: string, code: string) {
      unchanged();
      if (!email.includes("@") || !/^\d{6}$/.test(code)) return fail("A fresh email and six-digit verification code are required.");
      if (expected && expected.user.email.toLowerCase() !== email.toLowerCase()) return fail("This profile belongs to another account. Use a different profile or ordinary replacement login.");
      let issued = false;
      try {
        const result = await new RemoteSkillsAuthClient(origin).verifyCode(email, code);
        const login = parseWorkspaceLogin(result, expected?.user.id);
        if (result.firstLogin === true) return fail("This sign-in created a new account using the server signup policy. Finish ordinary account login before enrolling a workspace profile.");
        const session = await new RemoteSkillsClient(login.token, origin).switchWorkspace({ userId: login.userId, membershipId });
        if (session.user.email.toLowerCase() !== email.toLowerCase()) return fail("The verified account does not match the requested email.");
        if (session.user.role === "viewer") return fail("Viewer memberships cannot enroll API keys.");
        unchanged();
        // A failed/lost response may still have issued a key. Never retry automatically.
        issued = true;
        const created = await new RemoteSkillsClient(session.token, origin).createApiKey("cli");
        const verified = await keyIdentity(created.key, origin);
        if (verified.user.id !== session.user.id || verified.user.membershipId !== membershipId || verified.organization.id !== session.organization.id)
          return fail("The issued key does not match the selected workspace.");
        unchanged();
        if (!created.key.trim() || /[^\x21-\x7e]/.test(created.key) || created.key.length > 8192) return fail("The server returned an invalid API key.");
        const body = credentialBody(created.key);
        if (Buffer.byteLength(body, "utf8") > 65536) return fail("The new profile exceeds the credential reader size limit.");
        const identity = JSON.stringify({ email: verified.user.email, userId: verified.user.id, orgId: verified.organization.id, orgSlug: verified.organization.slug, apiUrl: origin, issuedBy: "sign-in" }, null, 2) + "\n";
        mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
        const temp = mkdtempSync(join(dirname(file), ".workspace-login-"));
        let identityInstalled = false;
        try {
          writeFileSync(join(temp, "credentials"), body, { mode: 0o600, flag: "wx" });
          writeFileSync(join(temp, "identity"), identity, { mode: 0o600, flag: "wx" });
          unchangedFiles();
          for (const [path, before] of parents) {
            const now = stat(path);
            if (!now || !now.isDirectory() || now.isSymbolicLink() || (before && (before.dev !== now.dev || before.ino !== now.ino))) changed();
            if (!before && now && ((now.mode & 0o077) !== 0 || (process.getuid && now.uid !== process.getuid()))) changed();
          }
          renameSync(join(temp, "identity"), identityFile); identityInstalled = true;
          renameSync(join(temp, "credentials"), file);
        } catch (error) {
          if (identityInstalled) {
            if (oldIdentity === null) rmSync(identityFile, { force: true });
            else { writeFileSync(join(temp, "restore"), oldIdentity, { mode: 0o600, flag: "wx" }); renameSync(join(temp, "restore"), identityFile); }
          }
          throw error;
        } finally { rmSync(temp, { recursive: true, force: true }); }
        return { status: "authenticated", profile, apiUrl: origin, userId: verified.user.id, email: verified.user.email,
          membershipId, organization: verified.organization.slug, organizationId: verified.organization.id, role: verified.user.role, keyCreated: true };
      } catch (error) {
        if (issued) return fail("Workspace key issuance was attempted, but enrollment could not be confirmed. Inspect the selected profile and workspace keys before retrying; do not retry automatically.");
        if (error instanceof WorkspaceProfileError) throw error;
        return fail("Unable to verify and select the workspace. Check the account, membership, selected server and fresh code. No enrollment key was requested.");
      }
    },
  };
}
