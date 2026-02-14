import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from "fs";
import { join } from "path";
import { getDataDir, getConfigPath, getSessionsDir, generateSessionId, getDomain } from "../utils/paths.js";
import type { Config, Session, CrawlResult } from "../types/index.js";

const DEFAULT_CONFIG: Config = {
  outputDir: getSessionsDir(),
};

export function ensureDataDir(): void {
  const dir = getDataDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

export function loadConfig(): Config {
  ensureDataDir();
  const configPath = getConfigPath();

  if (existsSync(configPath)) {
    try {
      return { ...DEFAULT_CONFIG, ...JSON.parse(readFileSync(configPath, "utf-8")) };
    } catch {
      return DEFAULT_CONFIG;
    }
  }

  return DEFAULT_CONFIG;
}

export function saveConfig(config: Partial<Config>): void {
  ensureDataDir();
  const current = loadConfig();
  writeFileSync(getConfigPath(), JSON.stringify({ ...current, ...config }, null, 2));
}

export { getConfigPath };

export function createSession(url: string): { sessionId: string; sessionDir: string } {
  const config = loadConfig();
  const sessionId = generateSessionId();
  const domain = getDomain(url);
  const sessionDir = join(config.outputDir, domain, sessionId);

  mkdirSync(sessionDir, { recursive: true });

  return { sessionId, sessionDir };
}

export function saveSession(sessionDir: string, result: CrawlResult): void {
  // Save metadata
  const metadataPath = join(sessionDir, "metadata.json");
  writeFileSync(
    metadataPath,
    JSON.stringify(
      {
        url: result.url,
        totalPages: result.totalPages,
        crawledAt: new Date().toISOString(),
      },
      null,
      2
    )
  );

  // Save each page
  for (let i = 0; i < result.pages.length; i++) {
    const page = result.pages[i];
    const pageDir = join(sessionDir, `page_${i}`);
    mkdirSync(pageDir, { recursive: true });

    if (page.markdown) {
      writeFileSync(join(pageDir, "content.md"), page.markdown);
    }
    if (page.html) {
      writeFileSync(join(pageDir, "content.html"), page.html);
    }
    writeFileSync(
      join(pageDir, "metadata.json"),
      JSON.stringify({ url: page.url, ...page.metadata }, null, 2)
    );
  }

  // Generate llms.txt
  const llmsTxt = result.pages.map((p) => p.markdown || "").join("\n\n---\n\n");
  writeFileSync(join(sessionDir, "llms.txt"), llmsTxt);
}

export function listSessions(): Session[] {
  const config = loadConfig();

  if (!existsSync(config.outputDir)) {
    return [];
  }

  const sessions: Session[] = [];
  const domains = readdirSync(config.outputDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

  for (const domain of domains) {
    const domainDir = join(config.outputDir, domain);
    const sessionDirs = readdirSync(domainDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);

    for (const sessionId of sessionDirs) {
      const metadataPath = join(domainDir, sessionId, "metadata.json");
      if (existsSync(metadataPath)) {
        try {
          const metadata = JSON.parse(readFileSync(metadataPath, "utf-8"));
          sessions.push({
            id: sessionId,
            url: metadata.url,
            createdAt: metadata.crawledAt,
            pages: metadata.totalPages,
          });
        } catch {
          // Skip invalid sessions
        }
      }
    }
  }

  // Sort by date, newest first
  sessions.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return sessions;
}
