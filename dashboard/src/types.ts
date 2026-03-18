export interface SkillWithStatus {
  name: string;
  displayName: string;
  description: string;
  category: string;
  tags: string[];
  installed: boolean;
  installedAt?: string | null;
  installedVersion?: string | null;
  envVars: string[];
  envVarsSet: string[];
  systemDeps: string[];
  cliCommand: string | null;
  source?: "official" | "custom";
}
