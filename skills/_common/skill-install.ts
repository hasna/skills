/**
 * Legacy install command boundary for bundled skill packages.
 *
 * Per-skill packages must not write into agent-native skill directories.
 * Discovery and execution go through the root Skills CLI/MCP server.
 */

interface SkillMeta {
  name: string;
  description: string;
  version: string;
  commands: string;
  requiredEnvVars?: string[];
}

export async function handleInstallCommand(meta: SkillMeta, args: string[]): Promise<boolean> {
  const command = args[0];
  const assistant = args[1];

  if (command !== "install" && command !== "uninstall") {
    return false;
  }

  if (!assistant || !["claude", "codex", "windsurf", "cursor"].includes(assistant)) {
    console.error("Direct per-skill installs are disabled.");
    console.error("Use: skills mcp --register <claude|codex|windsurf|cursor|all>");
    process.exit(1);
  }

  if (command === "install") {
    console.error(`Direct installs for ${meta.name} are disabled.`);
  } else {
    console.error(`Direct uninstalls for ${meta.name} are disabled.`);
  }
  console.error(`Use: skills mcp --register ${assistant}`);
  process.exit(1);
}
