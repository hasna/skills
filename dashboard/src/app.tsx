import * as React from "react";
import { RefreshCwIcon } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { StatsCards } from "@/components/stats-cards";
import { SkillsTable } from "@/components/skills-table";
import { SkillDetailDialog } from "@/components/skill-detail-dialog";
import { Button } from "@/components/ui/button";
import type { SkillWithStatus } from "@/types";

export function App() {
  const [skills, setSkills] = React.useState<SkillWithStatus[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [selected, setSelected] = React.useState<SkillWithStatus | null>(null);
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [toast, setToast] = React.useState<{
    message: string;
    type: "success" | "error";
  } | null>(null);

  const loadSkills = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/skills");
      const data = await res.json();
      setSkills(data);
    } catch {
      showToast("Failed to load skills", "error");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    loadSkills();
  }, [loadSkills]);

  function showToast(message: string, type: "success" | "error") {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  }

  function handleViewDetails(skill: SkillWithStatus) {
    setSelected(skill);
    setDialogOpen(true);
  }

  async function handleInstall(name: string) {
    try {
      const res = await fetch(`/api/skills/${name}/install`, { method: "POST" });
      const data = await res.json();
      if (data.success) {
        showToast(`Installed ${name}`, "success");
        loadSkills();
      } else {
        showToast(data.error || `Failed to install ${name}`, "error");
      }
    } catch {
      showToast(`Failed to install ${name}`, "error");
    }
  }

  async function handleRemove(name: string) {
    try {
      const res = await fetch(`/api/skills/${name}/remove`, { method: "POST" });
      const data = await res.json();
      if (data.success) {
        showToast(`Removed ${name}`, "success");
        loadSkills();
      } else {
        showToast(data.error || `Failed to remove ${name}`, "error");
      }
    } catch {
      showToast(`Failed to remove ${name}`, "error");
    }
  }

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="border-b">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
          <div className="flex items-center gap-3">
            <img
              src="/logo.jpg"
              alt="Hasna"
              className="h-7 w-auto rounded"
            />
            <h1 className="text-base font-semibold">
              Hasna{" "}
              <span className="font-normal text-muted-foreground">
                Skills
              </span>
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={loadSkills}
              disabled={loading}
            >
              <RefreshCwIcon
                className={`size-3.5 ${loading ? "animate-spin" : ""}`}
              />
              Reload
            </Button>
            <ThemeToggle />
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="mx-auto max-w-6xl space-y-6 px-6 py-6">
        <StatsCards skills={skills} />
        <SkillsTable
          data={skills}
          onViewDetails={handleViewDetails}
          onInstall={handleInstall}
          onRemove={handleRemove}
        />
      </main>

      {/* Detail Dialog */}
      <SkillDetailDialog
        skill={selected}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onInstall={handleInstall}
        onRemove={handleRemove}
      />

      {/* Toast */}
      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-50 rounded-lg border px-4 py-3 text-sm shadow-lg transition-all ${
            toast.type === "success"
              ? "border-green-200 bg-green-50 text-green-800 dark:border-green-900 dark:bg-green-950 dark:text-green-200"
              : "border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
          }`}
        >
          {toast.message}
        </div>
      )}
    </div>
  );
}
