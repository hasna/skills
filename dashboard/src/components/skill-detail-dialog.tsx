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

          {/* Environment Variables */}
          {skill.envVars.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-sm font-medium flex items-center gap-1.5">
                <KeyIcon className="size-3.5" />
                Environment Variables
              </p>
              <div className="space-y-1">
                {skill.envVars.map((v) => (
                  <code
                    key={v}
                    className="block rounded border bg-muted px-2 py-1 text-xs font-mono text-muted-foreground"
                  >
                    {v}
                  </code>
                ))}
              </div>
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
