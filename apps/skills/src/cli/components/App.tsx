import React, { useState } from "react";
import { Box, Text, useApp, useInput } from "ink";
import SelectInput from "ink-select-input";
import TextInput from "ink-text-input";
import { Header } from "./Header.js";
import { CategorySelect } from "./CategorySelect.js";
import { SkillSelect } from "./SkillSelect.js";
import { SearchView } from "./SearchView.js";
import { InstallProgress } from "./InstallProgress.js";
import { AccountView, SLASH_COMMANDS, type AccountAction } from "./AccountView.js";
import {
  getSkillsByCategory,
  SkillMeta,
  Category,
} from "../../lib/registry.js";
import { InstallResult } from "../../lib/installer.js";
import { isSkillsFleetCredentialError } from "../../lib/fleet-credentials.js";
import { requireSkillsReadAccess } from "../../lib/read-access.js";

type View = "main" | "browse" | "search" | "skills" | "installing" | "done" | "account";

/**
 * What the read gate said when the TUI opened (and after every sign-in or
 * sign-out). A signed-out TUI still renders — that is where `/login` lives —
 * but it offers no catalog: data views stay behind the same fail-closed gate
 * as every other surface.
 */
export type TuiAccess =
  | { state: "hosted"; origin: string }
  | { state: "local" }
  | { state: "signed-out"; reason: string; code?: string };

interface AppProps {
  initialSkills?: string[];
  overwrite?: boolean;
  initialAccess?: TuiAccess;
}

const ACCOUNT_ACTIONS = new Set<AccountAction>(["login", "logout", "whoami", "help"]);

export function App({ initialSkills, overwrite = false, initialAccess = { state: "local" } }: AppProps) {
  const { exit } = useApp();
  const [view, setView] = useState<View>(
    initialSkills?.length ? "installing" : "main"
  );
  const [category, setCategory] = useState<Category | null>(null);
  const [selected, setSelected] = useState<Set<string>>(
    new Set(initialSkills || [])
  );
  const [results, setResults] = useState<InstallResult[]>([]);
  const [access, setAccess] = useState<TuiAccess>(initialAccess);
  // The command bar owns typed input while it is open (null = closed).
  const [command, setCommand] = useState<string | null>(null);
  const [account, setAccount] = useState<{ action: AccountAction; argument?: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refreshAccess = () => {
    requireSkillsReadAccess()
      .then((read) => setAccess(read.mode === "hosted" ? { state: "hosted", origin: read.apiOrigin } : { state: "local" }))
      .catch((error) => setAccess(isSkillsFleetCredentialError(error)
        ? { state: "signed-out", reason: error.message, code: error.code }
        : { state: "signed-out", reason: String(error) }));
  };

  const runCommand = (line: string) => {
    setCommand(null);
    const [name = "", ...rest] = line.trim().replace(/^\//, "").split(/\s+/);
    if (name === "quit" || name === "exit") {
      exit();
      return;
    }
    if (ACCOUNT_ACTIONS.has(name as AccountAction)) {
      setNotice(null);
      setAccount({ action: name as AccountAction, ...(rest[0] ? { argument: rest[0] } : {}) });
      setView("account");
      return;
    }
    setNotice(name ? `Unknown command /${name}. Type /help for the list.` : null);
  };

  useInput((input, key) => {
    // Exactly one owner for typed input at a time: the command bar while it is
    // open, the search box while search is shown, the account view while it
    // runs. Everything else is menu navigation.
    if (command !== null) {
      if (key.escape) setCommand(null);
      return;
    }
    if (view === "search" || view === "account") return;
    if (input === "/" && (view === "main" || view === "done")) {
      setNotice(null);
      setCommand("/");
      return;
    }
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

  const signedOut = access.state === "signed-out";
  const mainMenuItems = signedOut
    ? [
      { label: "Sign in", value: "login" },
      { label: "Exit", value: "exit" },
    ]
    : [
      { label: "Browse by category", value: "browse" },
      { label: "Search skills", value: "search" },
      { label: "Exit", value: "exit" },
    ];

  const handleMainSelect = (item: { value: string }) => {
    if (item.value === "exit") {
      exit();
    } else if (item.value === "login") {
      runCommand("/login");
    } else {
      setView(item.value as View);
    }
  };

  const leaveAccount = (changed: boolean) => {
    setAccount(null);
    setView("main");
    if (changed) refreshAccess();
  };

  return (
    <Box flexDirection="column" padding={1}>
      <Header
        title="Skills"
        subtitle="Discover, pin, and run skills through the Skills MCP"
      />

      <Box marginBottom={1}>
        {access.state === "hosted" && <Text dimColor>Signed in · {access.origin}</Text>}
        {access.state === "local" && <Text dimColor>Local mode (HASNA_SKILLS_LOCAL=1)</Text>}
        {access.state === "signed-out" && (access.code === undefined || access.code === "MISSING_API_CREDENTIAL"
          ? <Text color="yellow">Not signed in. Choose Sign in, or type /login</Text>
          : <Text color="yellow">{access.reason}</Text>)}
      </Box>

      {view === "main" && (
        <Box flexDirection="column">
          <Box marginBottom={1}>
            <Text>What would you like to do?</Text>
          </Box>
          <SelectInput items={mainMenuItems} onSelect={handleMainSelect} isFocused={command === null} />
          <Box marginTop={1}>
            <Text dimColor>Type / for commands (/login, /logout, /whoami, /help) · Press q to quit</Text>
          </Box>
        </Box>
      )}

      {view === "account" && account && (
        <AccountView action={account.action} argument={account.argument} onDone={leaveAccount} />
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
          onCommand={runCommand}
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
              Pinning complete!
            </Text>
          </Box>

          {results.filter((r) => r.success).length > 0 && (
            <Box flexDirection="column" marginBottom={1}>
              <Text bold>Pinned:</Text>
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
            <Text>1. Register the MCP server</Text>
            <Text dimColor>   skills setup agents</Text>
            <Text>2. Run skills through the CLI or your agent</Text>
            <Text dimColor>   skills run image -- --prompt "..."</Text>
          </Box>

          <Box marginTop={1}>
            <Text dimColor>Press q to exit</Text>
          </Box>
        </Box>
      )}

      {command !== null && (
        <Box flexDirection="column" marginTop={1}>
          <Box>
            <Text bold>Command: </Text>
            <TextInput
              value={command}
              onChange={(value) => setCommand(value === "" ? null : value)}
              onSubmit={runCommand}
            />
          </Box>
          <Text dimColor>{SLASH_COMMANDS.map((entry) => entry.usage).join(" · ")} · Esc to cancel</Text>
        </Box>
      )}

      {notice && command === null && (
        <Box marginTop={1}>
          <Text color="yellow">{notice}</Text>
        </Box>
      )}
    </Box>
  );
}
