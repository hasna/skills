import React, { useState, useEffect } from "react";
import { Box, Text } from "ink";
import Spinner from "ink-spinner";
import { installSkill, InstallResult } from "../../lib/installer.js";

interface InstallProgressProps {
  skills: string[];
  overwrite?: boolean;
  onComplete: (results: InstallResult[]) => void;
}

export function InstallProgress({
  skills,
  overwrite = false,
  onComplete,
}: InstallProgressProps) {
  const [results, setResults] = useState<InstallResult[]>([]);
  const [current, setCurrent] = useState(0);
  const [installing, setInstalling] = useState(true);

  useEffect(() => {
    const install = async () => {
      const newResults: InstallResult[] = [];

      for (let i = 0; i < skills.length; i++) {
        setCurrent(i);
        // Small delay for visual feedback
        await new Promise((r) => setTimeout(r, 100));

        const result = installSkill(skills[i], { overwrite });
        newResults.push(result);
        setResults([...newResults]);
      }

      setInstalling(false);
      onComplete(newResults);
    };

    install();
  }, [skills, overwrite]);

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold>
          {installing
            ? `Installing skills (${current + 1}/${skills.length})...`
            : "Installation complete!"}
        </Text>
      </Box>

      {skills.map((name, i) => {
        const result = results[i];
        const isCurrent = i === current && installing;

        return (
          <Box key={name}>
            {isCurrent && !result && (
              <Text color="cyan">
                <Spinner type="dots" /> {name}
              </Text>
            )}
            {result?.success && (
              <Text color="green">{"\u2713"} {name}</Text>
            )}
            {result && !result.success && (
              <Text color="red">
                {"\u2717"} {name} - {result.error}
              </Text>
            )}
            {!isCurrent && !result && (
              <Text dimColor>{"\u25CB"} {name}</Text>
            )}
          </Box>
        );
      })}

      {!installing && (
        <Box marginTop={1} flexDirection="column">
          <Text>
            <Text color="green">
              {results.filter((r) => r.success).length} installed
            </Text>
            {results.some((r) => !r.success) && (
              <Text color="red">
                , {results.filter((r) => !r.success).length} failed
              </Text>
            )}
          </Text>
          <Text dimColor>
            Skills installed to .skills/
          </Text>
        </Box>
      )}
    </Box>
  );
}
