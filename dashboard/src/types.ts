export interface SkillWithStatus {
  name: string;
  displayName: string;
  description: string;
  category: string;
  tags: string[];
  installed: boolean;
  envVars: string[];
  systemDeps: string[];
  cliCommand: string | null;
}
