import { normalizeSkillsApiOrigin, skillsApiRequestUrl } from "./fleet-credentials.js";
import { readBoundedResponse } from "./remote-files.js";

export type RequestInvitationEmailChallenge = Readonly<{ invitationId: string; token: string; challengeId: string; confirm: true }>;
export type AcceptInvitationEmailChallenge = RequestInvitationEmailChallenge & Readonly<{ code: string }>;
export type RemoteInvitationEmailChallenge = { challengeId: string; message: string; expiresIn: 600 };
export type RemoteInvitationEmailAcceptance = { organizationId: string; membershipId: string; accepted: true; changed: true; signInRequired: true };
export class InvitationEmailInputError extends Error {
  readonly code = "INVITATION_EMAIL_INPUT_INVALID";
  constructor() { super("Use an explicit Skills API URL, exact invitation and retained challenge IDs, secret input, and deliberate confirmation."); this.name = "InvitationEmailInputError"; }
}
const refusals = {
  INVALID_REQUEST: [400, "Invitation recovery parameters were refused."],
  ORIGIN_REQUIRED: [403, "Invitation recovery requires the configured site origin."],
  INVITATION_PROOF_UNAVAILABLE: [401, "Invitation proof is unavailable. Sign in or explicitly request another recovery code."],
  RATE_LIMITED: [429, "Invitation verification is rate limited. Wait before another deliberate action."],
  INVITATION_BUSY: [503, "Invitation is busy. Sign in to check membership before another deliberate action."],
  INVITATION_DELIVERY_UNAVAILABLE: [503, "Invitation recovery is unavailable on this service."],
} as const;
export type RemoteInvitationEmailErrorCode = keyof typeof refusals;
export class RemoteInvitationEmailError extends Error {
  readonly status: number;
  constructor(readonly code: RemoteInvitationEmailErrorCode) { super(refusals[code][1]); this.name = "RemoteInvitationEmailError"; this.status = refusals[code][0]; }
}
export class RemoteInvitationEmailUnconfirmedError extends Error {
  readonly code = "INVITATION_EMAIL_UNCONFIRMED";
  constructor(readonly action: "challenge" | "accept") {
    super(action === "challenge"
      ? "The recovery challenge outcome is unconfirmed. Retain the same invitation, challenge ID and server. Check your inbox; never rotate the challenge or retry automatically. No delivery is confirmed."
      : "Invitation acceptance is unconfirmed. Use fresh ordinary sign-in to inspect available memberships. Do not retry acceptance automatically; explicitly request another recovery code only if needed. Saved credentials are unchanged.");
    this.name = "RemoteInvitationEmailUnconfirmedError";
  }
}
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const uuid = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v);
export function invitationEmailIds(invitationId: unknown, challengeId: unknown) {
  if (!uuid(invitationId) || !uuid(challengeId)) throw new InvitationEmailInputError();
  return { invitationId, challengeId };
}
export function invitationEmailInput<A extends "challenge" | "accept">(action: A, input: A extends "accept" ? AcceptInvitationEmailChallenge : RequestInvitationEmailChallenge) {
  const keys = ["invitationId", "token", "challengeId", "confirm", ...(action === "accept" ? ["code"] : [])];
  if (!record(input) || Object.keys(input).length !== keys.length || keys.some(key => !Object.hasOwn(input, key))) throw new InvitationEmailInputError();
  const value: Record<string, unknown> = { ...input };
  const ids = invitationEmailIds(value.invitationId, value.challengeId);
  if (value.confirm !== true || typeof value.token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(value.token)
    || (action === "accept" && (typeof value.code !== "string" || !/^\d{6}$/.test(value.code)))) throw new InvitationEmailInputError();
  return { ...ids, token: value.token, confirm: true as const, ...(action === "accept" ? { code: value.code as string } : {}) };
}
/** Explicit anonymous protocol: no auth resolver, headers, session creation or persistence. */
export async function requestInvitationEmail<A extends "challenge" | "accept">(origin: string, action: A,
  input: A extends "accept" ? AcceptInvitationEmailChallenge : RequestInvitationEmailChallenge): Promise<A extends "accept" ? RemoteInvitationEmailAcceptance : RemoteInvitationEmailChallenge> {
  const value = invitationEmailInput(action, input);
  let target: string;
  try { target = normalizeSkillsApiOrigin(origin); } catch { throw new InvitationEmailInputError(); }
  const body = JSON.stringify({ invitationId: value.invitationId, token: value.token, challengeId: value.challengeId, ...(action === "accept" ? { code: value.code } : {}) });
  try {
    const response = await fetch(skillsApiRequestUrl(target, `/api/v1/account/invitations/email-${action}`), {
      method: "POST", headers: { "Content-Type": "application/json" }, body,
      credentials: "omit", redirect: "error", cache: "no-store", referrerPolicy: "no-referrer", signal: AbortSignal.timeout(15_000),
    });
    const parsed: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await readBoundedResponse(response, 4096)));
    if (!response.ok && record(parsed) && typeof parsed.code === "string" && Object.hasOwn(refusals, parsed.code)) {
      const code = parsed.code as RemoteInvitationEmailErrorCode;
      if (response.status === refusals[code][0]) throw new RemoteInvitationEmailError(code);
    }
    if (!record(parsed)) throw new RemoteInvitationEmailUnconfirmedError(action);
    if (action === "challenge" && response.status === 202 && parsed.challengeId === value.challengeId && parsed.expiresIn === 600
      && typeof parsed.message === "string" && parsed.message.length <= 256) {
      return { challengeId: value.challengeId, message: "If this invitation is eligible, a verification code will arrive. Delivery is not confirmed.", expiresIn: 600 } as A extends "accept" ? RemoteInvitationEmailAcceptance : RemoteInvitationEmailChallenge;
    }
    if (action === "accept" && response.status === 200 && uuid(parsed.organizationId) && uuid(parsed.membershipId)
      && parsed.accepted === true && parsed.changed === true && parsed.signInRequired === true) {
      return { organizationId: parsed.organizationId, membershipId: parsed.membershipId, accepted: true, changed: true, signInRequired: true } as A extends "accept" ? RemoteInvitationEmailAcceptance : RemoteInvitationEmailChallenge;
    }
  } catch (error) { if (error instanceof RemoteInvitationEmailError) throw error; }
  throw new RemoteInvitationEmailUnconfirmedError(action);
}
export function invitationEmailCustomerError(error: unknown) {
  if (error instanceof InvitationEmailInputError || error instanceof RemoteInvitationEmailError || error instanceof RemoteInvitationEmailUnconfirmedError) return { code: error.code, error: error.message };
  return { code: "INVITATION_EMAIL_UNAVAILABLE", error: "Unable to prepare this recovery action. Check the explicit server and stable profile. No credential was saved." };
}
