import { selectedSkillsProfile } from "./instance-credentials.js";
import { clientTransportEnvKeys } from "@hasna/contracts/client";

const urlKeys = clientTransportEnvKeys("skills").apiUrlKeys;
function shellArgument(value: string): string {
  return /^[A-Za-z0-9._:/-]+$/.test(value) ? value : `'${value.replace(/'/g, "'\\''")}'`;
}

/** Set every supported URL alias consistently for this invocation only. */
export function skillsApiUrlEnvironment(origin: string): string {
  return urlKeys.map(name => `${name}=${shellArgument(origin)}`).join(" ");
}

/** Keep copied CLI commands on the credential profile selected by CLI or environment. */
export function skillsProfileCommand(command: string, env: Record<string, string | undefined> = process.env, origin?: string): string {
  const profile = selectedSkillsProfile(env);
  const prefix = origin && urlKeys.some(name => env[name]?.trim()) ? `${skillsApiUrlEnvironment(origin)} ` : "";
  return `${prefix}skills${profile ? ` --profile ${profile}` : ""} ${command}`;
}
