export interface PromptSection {
  title: string;
  content?: string;
  items?: string[];
}

export interface AgentJsonData {
  description?: string;
  tools?: string[];
  model?: "sonnet" | "opus" | "haiku" | "inherit";
  permissionMode?: "default" | "acceptEdits" | "bypassPermissions" | "plan" | "ignore";
  skills?: string[];
  sections?: PromptSection[];
}

export interface AgentData {
  id: string;
  slug: string;
  name: string;
  description: string;
  tools: string[];
  model: string;
  permissionMode: string;
  skills: string[];
  prompt: string;
  created: string;
  updated: string;
  isGlobal: boolean;
  jsonData?: AgentJsonData;
}

export interface AgentTemplate {
  name: string;
  description: string;
  tools: string[];
  model: string;
  prompt: string;
}


export interface GeneratedAgent {
  name: string;
  slug: string;
  description: string;
  tools: string[];
  model: string;
  prompt: string;
}

export interface AIGenerationResult {
  agents: GeneratedAgent[];
  reasoning: string;
}
