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
  /** A query starting with "/" is a slash command, run on Enter instead of searched. */
  onCommand?: (line: string) => void;
}

export function SearchView({
  selected,
  onToggle,
  onConfirm,
  onBack,
  onCommand,
}: SearchViewProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SkillMeta[]>([]);
  const [mode, setMode] = useState<"search" | "select">("search");

  const isCommand = query.startsWith("/");

  useEffect(() => {
    if (query.startsWith("/")) {
      setResults([]);
    } else if (query.length >= 2) {
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
      label: `\u2713 Pin selected (${selected.size})`,
      value: "__confirm__",
    });
  }

  const handleSubmit = (value: string) => {
    if (value.startsWith("/")) {
      onCommand?.(value);
      setQuery("");
    } else if (results.length > 0) {
      setMode("select");
    }
  };

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
          onSubmit={handleSubmit}
          focus={mode === "search"}
          placeholder="Type to search skills, or / for commands..."
        />
      </Box>

      {isCommand && (
        <Text dimColor>Press Enter to run {query}</Text>
      )}

      {!isCommand && query.length < 2 && (
        <Text dimColor>Type at least 2 characters to search</Text>
      )}

      {!isCommand && query.length >= 2 && results.length === 0 && (
        <Text dimColor>No skills found for "{query}"</Text>
      )}

      {results.length > 0 && (
        <Box flexDirection="column">
          <Box marginBottom={1}>
            <Text dimColor>
              Found {results.length} skill(s):
            </Text>
          </Box>
          {/* Remounted on each mode change: entering the list highlights the
              first result, and an unfocused list ignores keys (j, k and digits
              are search text while the search box owns input). */}
          <SelectInput
            key={mode}
            items={items}
            onSelect={handleSelect}
            isFocused={mode === "select"}
            initialIndex={mode === "select" && results.length > 0 ? 1 : 0}
          />
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
