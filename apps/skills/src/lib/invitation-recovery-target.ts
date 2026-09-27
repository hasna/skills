import { normalizeSkillsApiOrigin } from "./fleet-credentials.js";
import { captureSkillsCredentialFiles, skillsProfileCredentialFiles } from "./instance-credentials.js";
import { InvitationEmailInputError } from "./remote-invitation-recovery.js";
/** Recovery requires an explicit environment URL. Never probe credentials or Keychain to choose its target. */
export function prepareInvitationRecoveryTarget(source: Record<string, string | undefined> = process.env) {
  const env = { ...source }, names = ["HASNA_SKILLS_API_URL", "SKILLS_API_URL"] as const;
  const urls = names.map(name => env[name]?.trim()).filter((value): value is string => !!value);
  if (!urls.length) throw new InvitationEmailInputError();
  let origin: string;
  try {
    const normalized = urls.map(normalizeSkillsApiOrigin);
    if (normalized.some(value => value !== normalized[0])) throw new InvitationEmailInputError();
    origin = normalized[0];
  } catch { throw new InvitationEmailInputError(); }
  const unchangedFiles = captureSkillsCredentialFiles(skillsProfileCredentialFiles(env));
  return { origin, unchanged() {
    unchangedFiles();
    if ([...names, "HASNA_PROFILE", "HASNA_HOME", "HOME"].some(name => source[name] !== env[name])) throw new InvitationEmailInputError();
  } };
}
