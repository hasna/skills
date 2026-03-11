import * as React from "react";
import {
  ZapIcon,
  CopyIcon,
  CheckIcon,
  DownloadIcon,
  TrashIcon,
  TerminalIcon,
  KeyIcon,
  PackageIcon,
  ServerIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { SkillWithStatus } from "@/types";

const MCP_CONFIG = JSON.stringify(
  { mcpServers: { skills: { command: "skills-mcp" } } },
  null,
  2
);

interface SkillDetailDialogProps {
  skill: SkillWithStatus | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onInstall: (name: string) => void;
  onRemove: (name: string) => void;
}

export function SkillDetailDialog({
  skill,
  open,
  onOpenChange,
  onInstall,
  onRemove,
}: SkillDetailDialogProps) {
  const [docs, setDocs] = React.useState<string | null>(null);
  const [loadingDocs, setLoadingDocs] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const [copiedMcp, setCopiedMcp] = React.useState(false);
  const [agentInstalling, setAgentInstalling] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open && skill) {
      setLoadingDocs(true);
      setDocs(null);
      fetch(`/api/skills/${skill.name}/docs`)
        .then((res) => res.json())
        .then((data) => setDocs(data.content || null))
        .catch(() => setDocs(null))
        .finally(() => setLoadingDocs(false));
    }
  }, [open, skill]);

  if (!skill) return null;

  const installCmd = `skills install ${skill.name}`;

  function handleCopy() {
    navigator.clipboard.writeText(installCmd).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  function handleCopyMcp() {
    navigator.clipboard.writeText(MCP_CONFIG).then(() => {
      setCopiedMcp(true);
      setTimeout(() => setCopiedMcp(false), 2000);
    });
  }

  async function handleInstallForAgent(agent: "claude" | "codex" | "gemini") {
    setAgentInstalling(agent);
    try {
      await fetch(`/api/skills/${skill.name}/install`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ for: agent }),
      });
    } finally {
      setAgentInstalling(null);
    }
  }

  const envVarsSetSet = new Set(skill.envVarsSet ?? []);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ZapIcon className="size-5" />
            {skill.displayName}
          </DialogTitle>
          <DialogDescription>{skill.description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Category & Tags */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">Category:</span>
              <Badge variant="outline">{skill.category}</Badge>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-medium">Tags:</span>
              {skill.tags.map((tag) => (
                <Badge key={tag} variant="secondary" className="text-xs">
                  {tag}
                </Badge>
              ))}
            </div>
          </div>

          {/* Install command */}
          <div className="space-y-1.5">
            <p className="text-sm font-medium flex items-center gap-1.5">
              <TerminalIcon className="size-3.5" />
              Install Command
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 rounded border bg-muted px-3 py-2 text-xs font-mono text-muted-foreground">
                {installCmd}
              </code>
              <Button variant="outline" size="sm" onClick={handleCopy}>
                {copied ? (
                  <CheckIcon className="size-3.5 text-green-500" />
                ) : (
                  <CopyIcon className="size-3.5" />
                )}
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
          </div>

          {/* MCP Config */}
          <div className="space-y-1.5">
            <p className="text-sm font-medium flex items-center gap-1.5">
              <ServerIcon className="size-3.5" />
              MCP Configuration
            </p>
            <div className="flex items-start gap-2">
              <pre className="flex-1 rounded border bg-muted px-3 py-2 text-xs font-mono text-muted-foreground whitespace-pre">
                {MCP_CONFIG}
              </pre>
              <Button variant="outline" size="sm" onClick={handleCopyMcp} className="shrink-0">
                {copiedMcp ? (
                  <CheckIcon className="size-3.5 text-green-500" />
                ) : (
                  <CopyIcon className="size-3.5" />
                )}
                {copiedMcp ? "Copied" : "Copy"}
              </Button>
            </div>
          </div>

          {/* Install for agent */}
          <div className="space-y-1.5">
            <p className="text-sm font-medium flex items-center gap-1.5">
              <DownloadIcon className="size-3.5" />
              Install for Agent
            </p>
            <div className="flex flex-wrap gap-2">
              {(["claude", "codex", "gemini"] as const).map((agent) => (
                <Button
                  key={agent}
                  variant="outline"
                  size="sm"
                  disabled={agentInstalling === agent}
                  onClick={() => handleInstallForAgent(agent)}
                >
                  {agentInstalling === agent ? (
                    <CheckIcon className="size-3.5 animate-spin" />
                  ) : (
                    <DownloadIcon className="size-3.5" />
                  )}
                  Install for {agent.charAt(0).toUpperCase() + agent.slice(1)}
                </Button>
              ))}
            </div>
          </div>

          {/* Environment Variables */}
          {skill.envVars.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-sm font-medium flex items-center gap-1.5">
                <KeyIcon className="size-3.5" />
                Environment Variables
              </p>
              <div className="flex flex-wrap gap-1.5">
                {skill.envVars.map((v) => (
                  <Badge
                    key={v}
                    variant="outline"
                    className={`text-xs font-mono ${
                      envVarsSetSet.has(v)
                        ? "border-green-500 bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300"
                        : "border-red-400 bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300"
                    }`}
                  >
                    {envVarsSetSet.has(v) ? (
                      <CheckIcon className="size-3 mr-1 inline-block" />
                    ) : null}
                    {v}
                  </Badge>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                Green = set in environment, Red = not set
              </p>
            </div>
          )}

          {/* System Dependencies */}
          {skill.systemDeps.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-sm font-medium flex items-center gap-1.5">
                <PackageIcon className="size-3.5" />
                System Dependencies
              </p>
              <div className="flex flex-wrap gap-1.5">
                {skill.systemDeps.map((dep) => (
                  <Badge key={dep} variant="outline" className="text-xs">
                    {dep}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {/* Documentation */}
          {loadingDocs ? (
            <p className="text-sm text-muted-foreground">Loading docs...</p>
          ) : docs ? (
            <div className="space-y-1.5">
              <p className="text-sm font-medium">Documentation</p>
              <pre className="rounded border bg-muted p-3 text-xs font-mono text-muted-foreground whitespace-pre-wrap max-h-60 overflow-y-auto">
                {docs}
              </pre>
            </div>
          ) : null}
        </div>

        <DialogFooter>
          {skill.installed ? (
            <Button
              variant="destructive"
              size="sm"
              onClick={() => {
                onRemove(skill.name);
                onOpenChange(false);
              }}
            >
              <TrashIcon className="size-3.5" />
              Remove
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={() => {
                onInstall(skill.name);
                onOpenChange(false);
              }}
            >
              <DownloadIcon className="size-3.5" />
              Install
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
