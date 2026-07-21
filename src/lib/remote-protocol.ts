import pkg from "../../package.json" with { type: "json" };

export const SKILLS_CLIENT_VERSION = pkg.version;
export const SKILLS_RUN_AUTHORIZATION_CAPABILITY = "signed-quote-v1" as const;

export function addSkillsProtocolHeaders(headers: Headers = new Headers()): Headers {
  headers.set("X-Skills-Client-Version", SKILLS_CLIENT_VERSION);
  headers.set("X-Skills-Run-Authorization", SKILLS_RUN_AUTHORIZATION_CAPABILITY);
  return headers;
}
