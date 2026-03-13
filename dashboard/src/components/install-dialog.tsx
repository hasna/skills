import * as React from "react";
import { DownloadIcon, Loader2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export interface InstallOptions {
  for?: "claude" | "codex" | "gemini" | "all";
  scope?: "global" | "project";
}

interface InstallDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  skillNames: string[];
  onConfirm: (options: InstallOptions) => void;
  installing?: boolean;
}

export function InstallDialog({
  open,
  onOpenChange,
  skillNames,
  onConfirm,
  installing = false,
}: InstallDialogProps) {
  const [installType, setInstallType] = React.useState<"full" | "agent">(
    "full"
  );
  const [agent, setAgent] = React.useState<"claude" | "codex" | "gemini" | "all">("claude");
  const [scope, setScope] = React.useState<"global" | "project">("global");

  // Reset state when dialog opens
  React.useEffect(() => {
    if (open) {
      setInstallType("full");
      setAgent("claude");
      setScope("global");
    }
  }, [open]);

  function handleConfirm() {
    if (installType === "full") {
      onConfirm({});
    } else {
      onConfirm({ for: agent, scope });
    }
    onOpenChange(false);
  }

  const label =
    skillNames.length === 1
      ? skillNames[0]
      : `${skillNames.length} skills`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <DownloadIcon className="size-5" />
            Install {label}
          </DialogTitle>
          <DialogDescription>
            Choose how to install {skillNames.length === 1 ? "this skill" : "these skills"}.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Install Type */}
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Install Type</legend>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="radio"
                name="installType"
                value="full"
                checked={installType === "full"}
                onChange={() => setInstallType("full")}
                className="accent-primary"
              />
              <span>Full source install</span>
              <span className="text-xs text-muted-foreground">
                — copies to .skills/
              </span>
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="radio"
                name="installType"
                value="agent"
                checked={installType === "agent"}
                onChange={() => setInstallType("agent")}
                className="accent-primary"
              />
              <span>Agent skill (SKILL.md only)</span>
              <span className="text-xs text-muted-foreground">
                — copies to agent directory
              </span>
            </label>
          </fieldset>

          {/* Agent options - only shown when agent install is selected */}
          {installType === "agent" && (
            <>
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">Agent</legend>
                {(["claude", "codex", "gemini", "all"] as const).map((a) => (
                  <label
                    key={a}
                    className="flex items-center gap-2 text-sm cursor-pointer"
                  >
                    <input
                      type="radio"
                      name="agent"
                      value={a}
                      checked={agent === a}
                      onChange={() => setAgent(a)}
                      className="accent-primary"
                    />
                    <span className="capitalize">{a}</span>
                  </label>
                ))}
              </fieldset>

              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">Scope</legend>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="radio"
                    name="scope"
                    value="global"
                    checked={scope === "global"}
                    onChange={() => setScope("global")}
                    className="accent-primary"
                  />
                  <span>Global</span>
                  <span className="text-xs text-muted-foreground">
                    — ~/.{agent === "all" ? "{agent}" : agent}/skills/
                  </span>
                </label>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="radio"
                    name="scope"
                    value="project"
                    checked={scope === "project"}
                    onChange={() => setScope("project")}
                    className="accent-primary"
                  />
                  <span>Project</span>
                  <span className="text-xs text-muted-foreground">
                    — .{agent === "all" ? "{agent}" : agent}/skills/
                  </span>
                </label>
              </fieldset>
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleConfirm} disabled={installing}>
            {installing ? (
              <Loader2Icon className="size-3.5 animate-spin" />
            ) : (
              <DownloadIcon className="size-3.5" />
            )}
            {installing ? "Installing..." : "Install"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
