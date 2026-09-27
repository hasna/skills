/** A CLI-only Skills credential selection. Other Hasna clients keep the ambient HASNA_PROFILE. */
let cliCredentialProfile: string | undefined;

export function selectCliSkillsCredentialProfile(profile: string | undefined): void {
  cliCredentialProfile = profile;
}

export function selectedCliSkillsCredentialProfile(): string | undefined {
  return cliCredentialProfile;
}
