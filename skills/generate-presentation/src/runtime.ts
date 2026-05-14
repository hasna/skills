export const envConfig = {
  OPENAI_API_KEY: process.env.OPENAI_API_KEY || "",
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || "",
  SKILLS_OUTPUT_DIR: process.env.SKILLS_OUTPUT_DIR || ".skills",
  SKILLS_PROJECT_ROOT: process.env.SKILLS_PROJECT_ROOT || process.cwd(),
};
