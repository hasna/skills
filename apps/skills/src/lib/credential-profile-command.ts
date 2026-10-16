import { selectedSkillsProfile } from "./instance-credentials.js";

/** Keep copied CLI commands on the credential profile selected by CLI or environment. */
export function skillsProfileCommand(command: string, env: Record<string, string | undefined> = process.env): string {
  const profile = selectedSkillsProfile(env);
  return `skills${profile ? ` --profile ${profile}` : ""} ${command}`;
}
