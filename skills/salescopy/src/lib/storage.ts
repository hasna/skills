import { readFileSync, writeFileSync, existsSync, readdirSync } from "fs";
import { join } from "path";
import type { Session, CopyResult, Template } from "../types/index.js";
import { getSessionsDir, getTemplatesDir, ensureDir } from "../utils/paths.js";

export function saveSession(session: Session): void {
  const sessionsDir = getSessionsDir();
  ensureDir(sessionsDir);

  const sessionPath = join(sessionsDir, `${session.id}.json`);
  writeFileSync(sessionPath, JSON.stringify(session, null, 2));
}

export function loadSession(sessionId: string): Session | null {
  const sessionPath = join(getSessionsDir(), `${sessionId}.json`);

  if (!existsSync(sessionPath)) {
    return null;
  }

  const content = readFileSync(sessionPath, "utf-8");
  return JSON.parse(content) as Session;
}

export function listSessions(): Session[] {
  const sessionsDir = getSessionsDir();

  if (!existsSync(sessionsDir)) {
    return [];
  }

  const files = readdirSync(sessionsDir).filter((f) => f.endsWith(".json"));

  return files
    .map((file) => {
      const content = readFileSync(join(sessionsDir, file), "utf-8");
      return JSON.parse(content) as Session;
    })
    .sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
}

export function deleteSession(sessionId: string): boolean {
  const sessionPath = join(getSessionsDir(), `${sessionId}.json`);

  if (!existsSync(sessionPath)) {
    return false;
  }

  const fs = require("fs");
  fs.unlinkSync(sessionPath);
  return true;
}

export function addResultToSession(
  sessionId: string,
  result: CopyResult
): Session | null {
  const session = loadSession(sessionId);
  if (!session) {
    return null;
  }

  session.results.push(result);
  session.updatedAt = new Date().toISOString();
  saveSession(session);
  return session;
}

export function createSession(
  product: { name: string; description: string }
): Session {
  const session: Session = {
    id: generateId(),
    product: {
      name: product.name,
      description: product.description,
    },
    results: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  saveSession(session);
  return session;
}

export function loadTemplates(): Template[] {
  const templatesDir = getTemplatesDir();

  if (!existsSync(templatesDir)) {
    return getDefaultTemplates();
  }

  const files = readdirSync(templatesDir).filter((f) => f.endsWith(".json"));

  if (files.length === 0) {
    return getDefaultTemplates();
  }

  return files.map((file) => {
    const content = readFileSync(join(templatesDir, file), "utf-8");
    return JSON.parse(content) as Template;
  });
}

export function saveTemplate(template: Template): void {
  const templatesDir = getTemplatesDir();
  ensureDir(templatesDir);

  const templatePath = join(templatesDir, `${template.id}.json`);
  writeFileSync(templatePath, JSON.stringify(template, null, 2));
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
}

function getDefaultTemplates(): Template[] {
  return [
    {
      id: "aida",
      name: "AIDA Formula",
      description:
        "Attention, Interest, Desire, Action - Classic copywriting formula",
      copyType: "sales-letter",
      structure: ["attention", "interest", "desire", "action"],
      prompt: `Write sales copy using the AIDA formula:
1. ATTENTION: Hook the reader with a compelling headline
2. INTEREST: Build curiosity with engaging facts
3. DESIRE: Show benefits and create emotional connection
4. ACTION: Clear call-to-action`,
    },
    {
      id: "pas",
      name: "PAS Formula",
      description: "Problem, Agitate, Solution - Great for pain point marketing",
      copyType: "sales-letter",
      structure: ["problem", "agitate", "solution"],
      prompt: `Write sales copy using the PAS formula:
1. PROBLEM: Identify the reader's pain point
2. AGITATE: Make the problem feel urgent
3. SOLUTION: Present the product as the answer`,
    },
    {
      id: "fab",
      name: "FAB Formula",
      description: "Features, Advantages, Benefits - Product-focused approach",
      copyType: "product-description",
      structure: ["features", "advantages", "benefits"],
      prompt: `Write product copy using the FAB formula:
1. FEATURES: What the product has/does
2. ADVANTAGES: Why those features matter
3. BENEFITS: How it improves the customer's life`,
    },
    {
      id: "headline-power",
      name: "Power Headlines",
      description: "Generate multiple compelling headline variations",
      copyType: "headline",
      structure: ["curiosity", "benefit", "urgency", "emotional", "how-to"],
      prompt: `Generate 5 headline variations:
1. Curiosity-driven headline
2. Benefit-focused headline
3. Urgency headline
4. Emotional headline
5. How-to headline`,
    },
    {
      id: "email-welcome",
      name: "Welcome Email Sequence",
      description: "5-email welcome sequence for new subscribers",
      copyType: "email-sequence",
      structure: [
        "welcome",
        "story",
        "value",
        "social-proof",
        "offer",
      ],
      prompt: `Create a 5-email welcome sequence:
1. Welcome & introduction
2. Your story/origin
3. Valuable content/tips
4. Social proof & testimonials
5. Special offer`,
    },
  ];
}
