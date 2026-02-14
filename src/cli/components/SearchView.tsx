import React, { useState, useEffect } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";
import SelectInput from "ink-select-input";
import { searchSkills, SkillMeta } from "../../lib/registry.js";

interface SearchViewProps {
  selected: Set<string>;
  onToggle: (name: string) => void;
  onConfirm: () => void;
  onBack: () => void;
}

export function SearchView({
  selected,
  onToggle,
  onConfirm,
  onBack,
}: SearchViewProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SkillMeta[]>([]);
  const [mode, setMode] = useState<"search" | "select">("search");

  useEffect(() => {
    if (query.length >= 2) {
      setResults(searchSkills(query));
    } else {
      setResults([]);
    }
  }, [query]);

  useInput((input, key) => {
    if (key.escape) {
      if (mode === "select") {
        setMode("search");
      } else {
        onBack();
      }
    }
    if (key.downArrow && mode === "search" && results.length > 0) {
      setMode("select");
    }
  });

  const items = [
    { label: "\u2190 Back", value: "__back__" },
    ...results.map((s) => ({
      label: `${selected.has(s.name) ? "[x]" : "[ ]"} ${s.displayName} - ${s.description}`,
      value: s.name,
    })),
  ];

  if (selected.size > 0) {
    items.push({ label: "", value: "__sep__" });
    items.push({
      label: `\u2713 Install selected (${selected.size})`,
      value: "__confirm__",
    });
  }

  const handleSelect = (item: { value: string }) => {
    if (item.value === "__back__") {
      onBack();
    } else if (item.value === "__confirm__") {
      onConfirm();
    } else if (item.value !== "__sep__") {
      onToggle(item.value);
    }
  };

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold>Search: </Text>
        <TextInput
          value={query}
          onChange={setQuery}
          placeholder="Type to search skills..."
        />
      </Box>

      {query.length < 2 && (
        <Text dimColor>Type at least 2 characters to search</Text>
      )}

      {query.length >= 2 && results.length === 0 && (
        <Text dimColor>No skills found for "{query}"</Text>
      )}

      {results.length > 0 && (
        <Box flexDirection="column">
          <Box marginBottom={1}>
            <Text dimColor>
              Found {results.length} skill(s):
            </Text>
          </Box>
          <SelectInput items={items} onSelect={handleSelect} />
        </Box>
      )}

      {selected.size > 0 && (
        <Box marginTop={1}>
          <Text dimColor>
            Selected: {Array.from(selected).join(", ")}
          </Text>
        </Box>
      )}
    </Box>
  );
}
