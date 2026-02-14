import React, { useState } from "react";
import { Box, Text, useApp, useInput } from "ink";
import SelectInput from "ink-select-input";
import { Header } from "./Header.js";
import { CategorySelect } from "./CategorySelect.js";
import { SkillSelect } from "./SkillSelect.js";
import { SearchView } from "./SearchView.js";
import { InstallProgress } from "./InstallProgress.js";
import {
  getSkillsByCategory,
  SkillMeta,
  Category,
} from "../../lib/registry.js";
import { InstallResult } from "../../lib/installer.js";

type View = "main" | "browse" | "search" | "skills" | "installing" | "done";

interface AppProps {
  initialSkills?: string[];
  overwrite?: boolean;
}

export function App({ initialSkills, overwrite = false }: AppProps) {
  const { exit } = useApp();
  const [view, setView] = useState<View>(
    initialSkills?.length ? "installing" : "main"
  );
  const [category, setCategory] = useState<Category | null>(null);
  const [selected, setSelected] = useState<Set<string>>(
    new Set(initialSkills || [])
  );
  const [results, setResults] = useState<InstallResult[]>([]);

  useInput((input, key) => {
    if (key.escape) {
      if (view === "main") {
        exit();
      }
    }
    if (input === "q") {
      exit();
    }
  });

  const handleToggle = (name: string) => {
    const newSelected = new Set(selected);
    if (newSelected.has(name)) {
      newSelected.delete(name);
    } else {
      newSelected.add(name);
    }
    setSelected(newSelected);
  };

  const handleConfirm = () => {
    if (selected.size > 0) {
      setView("installing");
    }
  };

  const handleComplete = (installResults: InstallResult[]) => {
    setResults(installResults);
    setView("done");
  };

  const mainMenuItems = [
    { label: "Browse by category", value: "browse" },
    { label: "Search skills", value: "search" },
    { label: "Exit", value: "exit" },
  ];

  const handleMainSelect = (item: { value: string }) => {
    if (item.value === "exit") {
      exit();
    } else {
      setView(item.value as View);
    }
  };

  return (
    <Box flexDirection="column" padding={1}>
      <Header
        title="Skills"
        subtitle="Install AI agent skills for your project"
      />

      {view === "main" && (
        <Box flexDirection="column">
          <Box marginBottom={1}>
            <Text>What would you like to do?</Text>
          </Box>
          <SelectInput items={mainMenuItems} onSelect={handleMainSelect} />
          <Box marginTop={1}>
            <Text dimColor>Press q to quit</Text>
          </Box>
        </Box>
      )}

      {view === "browse" && !category && (
        <CategorySelect
          onSelect={(cat) => {
            setCategory(cat as Category);
            setView("skills");
          }}
          onBack={() => setView("main")}
        />
      )}

      {view === "skills" && category && (
        <SkillSelect
          skills={getSkillsByCategory(category)}
          selected={selected}
          onToggle={handleToggle}
          onConfirm={handleConfirm}
          onBack={() => {
            setCategory(null);
            setView("browse");
          }}
        />
      )}

      {view === "search" && (
        <SearchView
          selected={selected}
          onToggle={handleToggle}
          onConfirm={handleConfirm}
          onBack={() => setView("main")}
        />
      )}

      {view === "installing" && (
        <InstallProgress
          skills={Array.from(selected)}
          overwrite={overwrite}
          onComplete={handleComplete}
        />
      )}

      {view === "done" && (
        <Box flexDirection="column">
          <Box marginBottom={1}>
            <Text bold color="green">
              Installation complete!
            </Text>
          </Box>

          {results.filter((r) => r.success).length > 0 && (
            <Box flexDirection="column" marginBottom={1}>
              <Text bold>Installed:</Text>
              {results
                .filter((r) => r.success)
                .map((r) => (
                  <Text key={r.skill} color="green">
                    {"\u2713"} {r.skill}
                  </Text>
                ))}
            </Box>
          )}

          {results.filter((r) => !r.success).length > 0 && (
            <Box flexDirection="column" marginBottom={1}>
              <Text bold color="red">
                Failed:
              </Text>
              {results
                .filter((r) => !r.success)
                .map((r) => (
                  <Text key={r.skill} color="red">
                    {"\u2717"} {r.skill}: {r.error}
                  </Text>
                ))}
            </Box>
          )}

          <Box marginTop={1} flexDirection="column">
            <Text bold>Next steps:</Text>
            <Text>1. Import from .skills/</Text>
            <Text dimColor>   import {"{"} image {"}"} from './.skills'</Text>
            <Text>2. Configure your API keys</Text>
            <Text>3. Start building!</Text>
          </Box>

          <Box marginTop={1}>
            <Text dimColor>Press q to exit</Text>
          </Box>
        </Box>
      )}
    </Box>
  );
}
