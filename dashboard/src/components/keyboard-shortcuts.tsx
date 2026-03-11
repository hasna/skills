import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface KeyboardShortcut {
  key: string;
  description: string;
}

const SHORTCUTS: KeyboardShortcut[] = [
  { key: "/", description: "Focus search input" },
  { key: "j", description: "Move selection down" },
  { key: "k", description: "Move selection up" },
  { key: "Enter", description: "Open detail dialog for selected skill" },
  { key: "Escape", description: "Close open dialog" },
  { key: "?", description: "Toggle this help overlay" },
];

interface KeyboardShortcutsProps {
  rowCount: number;
  selectedIndex: number;
  onSelectedIndexChange: (index: number) => void;
  onEnter: () => void;
  searchInputRef: React.RefObject<HTMLInputElement | null>;
}

export function KeyboardShortcuts({
  rowCount,
  selectedIndex,
  onSelectedIndexChange,
  onEnter,
  searchInputRef,
}: KeyboardShortcutsProps) {
  const [helpOpen, setHelpOpen] = React.useState(false);

  React.useEffect(() => {
    function isTypingInInput(e: KeyboardEvent): boolean {
      const target = e.target as HTMLElement;
      return (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT" ||
        target.isContentEditable
      );
    }

    function handleKeyDown(e: KeyboardEvent) {
      // ? toggles help regardless of focus (unless in input)
      if (e.key === "?" && !isTypingInInput(e)) {
        e.preventDefault();
        setHelpOpen((prev) => !prev);
        return;
      }

      // / focuses search input — fires even if help is open
      if (e.key === "/" && !isTypingInInput(e)) {
        e.preventDefault();
        searchInputRef.current?.focus();
        return;
      }

      // Navigation shortcuts — skip when typing in an input
      if (isTypingInInput(e)) return;

      if (e.key === "j") {
        e.preventDefault();
        onSelectedIndexChange(Math.min(selectedIndex + 1, rowCount - 1));
      } else if (e.key === "k") {
        e.preventDefault();
        onSelectedIndexChange(Math.max(selectedIndex - 1, 0));
      } else if (e.key === "Enter") {
        if (selectedIndex >= 0 && rowCount > 0) {
          e.preventDefault();
          onEnter();
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [rowCount, selectedIndex, onSelectedIndexChange, onEnter, searchInputRef]);

  return (
    <Dialog open={helpOpen} onOpenChange={setHelpOpen}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Keyboard Shortcuts</DialogTitle>
        </DialogHeader>
        <div className="divide-y">
          {SHORTCUTS.map(({ key, description }) => (
            <div
              key={key}
              className="flex items-center justify-between py-2.5 text-sm"
            >
              <span className="text-muted-foreground">{description}</span>
              <kbd className="rounded border bg-muted px-2 py-0.5 font-mono text-xs">
                {key}
              </kbd>
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground pt-1">
          Shortcuts are disabled while typing in an input field.
        </p>
      </DialogContent>
    </Dialog>
  );
}
