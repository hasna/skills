import React, { useState } from "react";
import { Box, Text } from "ink";
import SelectInput from "ink-select-input";
import { SkillMeta } from "../../lib/registry.js";

interface SkillSelectProps {
  skills: SkillMeta[];
  selected: Set<string>;
  onToggle: (name: string) => void;
  onConfirm: () => void;
  onBack: () => void;
}

export function SkillSelect({
  skills,
  selected,
  onToggle,
  onConfirm,
  onBack,
}: SkillSelectProps) {
  const items = [
    { label: "\u2190 Back to categories", value: "__back__" },
    ...skills.map((s) => ({
      label: `${selected.has(s.name) ? "[x]" : "[ ]"} ${s.displayName}`,
      value: s.name,
    })),
    { label: "", value: "__sep__" },
    {
      label: `\u2713 Install selected (${selected.size})`,
      value: "__confirm__",
    },
  ];

  const handleSelect = (item: { value: string }) => {
    if (item.value === "__back__") {
      onBack();
    } else if (item.value === "__confirm__") {
      if (selected.size > 0) {
        onConfirm();
      }
    } else if (item.value !== "__sep__") {
      onToggle(item.value);
    }
  };

  // Find the current skill for description
  const [highlightedIndex, setHighlightedIndex] = useState(1);
  const currentSkill = skills[highlightedIndex - 1];

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold>Select skills (enter to toggle, then confirm):</Text>
      </Box>

      <Box flexDirection="row">
        <Box flexDirection="column" width="50%">
          <SelectInput
            items={items}
            onSelect={handleSelect}
            onHighlight={(item) => {
              const idx = skills.findIndex((s) => s.name === item.value);
              if (idx >= 0) setHighlightedIndex(idx + 1);
            }}
          />
        </Box>

        <Box flexDirection="column" marginLeft={2} width="50%">
          {currentSkill && (
            <>
              <Text bold color="cyan">
                {currentSkill.displayName}
              </Text>
              <Text>{currentSkill.description}</Text>
              <Text dimColor>
                Tags: {currentSkill.tags.join(", ")}
              </Text>
            </>
          )}
        </Box>
      </Box>

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
