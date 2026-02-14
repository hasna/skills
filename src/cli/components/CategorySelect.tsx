import React from "react";
import { Box, Text } from "ink";
import SelectInput from "ink-select-input";
import { CATEGORIES, getSkillsByCategory } from "../../lib/registry.js";

interface CategorySelectProps {
  onSelect: (category: string) => void;
  onBack?: () => void;
}

export function CategorySelect({ onSelect, onBack }: CategorySelectProps) {
  const items: { label: string; value: string }[] = CATEGORIES.map((cat) => ({
    label: `${cat} (${getSkillsByCategory(cat).length})`,
    value: cat,
  }));

  // Add back option if onBack provided
  if (onBack) {
    items.unshift({ label: "\u2190 Back", value: "__back__" });
  }

  const handleSelect = (item: { value: string }) => {
    if (item.value === "__back__" && onBack) {
      onBack();
    } else {
      onSelect(item.value);
    }
  };

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold>Select a category:</Text>
      </Box>
      <SelectInput items={items} onSelect={handleSelect} />
    </Box>
  );
}
