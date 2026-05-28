import * as fs from "fs";
import * as path from "path";

import type { AIGenerationResult } from "./types";

// AI-powered agent generation
async function gatherProjectContext(projectRoot: string): Promise<string> {
  const contextParts: string[] = [];
  const maxFileSize = 50000; // 50KB max per file

  // Key files to read for project understanding
  const keyFiles = [
    "package.json",
    "README.md",
    "CLAUDE.md",
    ".claude/settings.json",
    "tsconfig.json",
    "pyproject.toml",
    "Cargo.toml",
    "go.mod",
  ];

  for (const file of keyFiles) {
    const filePath = path.join(projectRoot, file);
    if (fs.existsSync(filePath)) {
      try {
        const stat = fs.statSync(filePath);
        if (stat.size < maxFileSize) {
          const content = fs.readFileSync(filePath, "utf-8");
          contextParts.push(`### ${file}\n\`\`\`\n${content}\n\`\`\``);
        }
      } catch (e) {
        // Skip unreadable files
      }
    }
  }

  // Get directory structure (limited depth)
  const structure = getDirectoryStructure(projectRoot, 3);
  contextParts.push(`### Directory Structure\n\`\`\`\n${structure}\n\`\`\``);

  // Sample some source files
  const srcDirs = ["src", "lib", "app", "pages", "components"];
  let sampleFiles = 0;
  const maxSamples = 5;

  for (const dir of srcDirs) {
    const dirPath = path.join(projectRoot, dir);
    if (fs.existsSync(dirPath) && sampleFiles < maxSamples) {
      const files = fs.readdirSync(dirPath).filter((f) =>
        f.endsWith(".ts") || f.endsWith(".tsx") || f.endsWith(".js") ||
        f.endsWith(".py") || f.endsWith(".go") || f.endsWith(".rs")
      ).slice(0, maxSamples - sampleFiles);

      for (const file of files) {
        const filePath = path.join(dirPath, file);
        try {
          const stat = fs.statSync(filePath);
          if (stat.isFile() && stat.size < maxFileSize) {
            const content = fs.readFileSync(filePath, "utf-8");
            // Only include first 100 lines
            const preview = content.split("\n").slice(0, 100).join("\n");
            contextParts.push(`### ${dir}/${file} (preview)\n\`\`\`\n${preview}\n\`\`\``);
            sampleFiles++;
          }
        } catch (e) {
          // Skip unreadable files
        }
      }
    }
  }

  return contextParts.join("\n\n");
}

function getDirectoryStructure(dir: string, maxDepth: number, currentDepth = 0, prefix = ""): string {
  if (currentDepth >= maxDepth) return "";

  const items: string[] = [];
  const ignoreDirs = ["node_modules", ".git", "dist", "build", ".next", "__pycache__", "target", "vendor"];

  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const filtered = entries.filter((e) => !ignoreDirs.includes(e.name) && !e.name.startsWith("."));

    for (let i = 0; i < filtered.length && i < 20; i++) {
      const entry = filtered[i];
      const isLast = i === filtered.length - 1 || i === 19;
      const connector = isLast ? "└── " : "├── ";
      const nextPrefix = prefix + (isLast ? "    " : "│   ");

      items.push(`${prefix}${connector}${entry.name}${entry.isDirectory() ? "/" : ""}`);

      if (entry.isDirectory()) {
        const subStructure = getDirectoryStructure(
          path.join(dir, entry.name),
          maxDepth,
          currentDepth + 1,
          nextPrefix
        );
        if (subStructure) items.push(subStructure);
      }
    }

    if (filtered.length > 20) {
      items.push(`${prefix}└── ... (${filtered.length - 20} more items)`);
    }
  } catch (e) {
    // Skip unreadable directories
  }

  return items.join("\n");
}

export async function generateAgentsWithAI(userPrompt: string, projectRoot: string): Promise<AIGenerationResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY environment variable is required for AI generation.\n" +
      "Set it with: export ANTHROPIC_API_KEY=your_key"
    );
  }

  console.log("Gathering project context...");
  const projectContext = await gatherProjectContext(projectRoot);

  console.log("Analyzing project with AI...");

  const systemPrompt = `You are an expert at creating Claude Code agents. You analyze projects and create specialized AI agents that help developers work more efficiently.

When creating agents, follow these principles:
1. Each agent should have a clear, focused purpose
2. Agent descriptions should explain WHEN to use the agent (proactively)
3. Tools should be limited to what's necessary
4. Prompts should be detailed and actionable
5. Agents should follow best practices for their domain

Available tools for agents:
- Read: Read files
- Edit: Edit files
- Write: Write new files
- Bash: Run shell commands
- Grep: Search file contents
- Glob: Find files by pattern
- WebFetch: Fetch web content
- WebSearch: Search the web
- Task: Delegate to sub-agents
- LSP: Language server features
- NotebookEdit: Edit Jupyter notebooks

Available models: sonnet (balanced), opus (most capable), haiku (fast), inherit (parent model)`;

  const userMessage = `Analyze this project and create appropriate Claude Code agents based on the user's request.

User request: "${userPrompt}"

Project context:
${projectContext}

Create agents that would be most useful for this specific project. Consider:
- The project's tech stack and languages
- Common development workflows
- Potential pain points the user might face
- Best practices for the domain

Respond with JSON in this exact format:
{
  "agents": [
    {
      "name": "Agent Name",
      "slug": "agent-slug",
      "description": "When to use this agent - written as: Use proactively when...",
      "tools": ["Read", "Edit", "Bash"],
      "model": "inherit",
      "prompt": "Detailed multi-line system prompt for the agent..."
    }
  ],
  "reasoning": "Brief explanation of why you chose these agents"
}

Create between 2-5 agents that would be most valuable for this project.`;

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 8192,
        temperature: 0.7,
        messages: [
          { role: "user", content: userMessage }
        ],
        system: systemPrompt,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API request failed: ${response.status} - ${errorText}`);
    }

    const data = await response.json() as any;
    const content = data.content?.[0]?.text || "";

    // Extract JSON from response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("Failed to parse AI response - no JSON found");
    }

    const result = JSON.parse(jsonMatch[0]) as AIGenerationResult;
    return result;
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`AI generation failed: ${error.message}`);
    }
    throw error;
  }
}
