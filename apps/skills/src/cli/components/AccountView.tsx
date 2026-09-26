import React, { useEffect, useRef, useState } from "react";
import { Box, Text, useInput } from "ink";
import Spinner from "ink-spinner";
import { gatewaySignInRefusal, resolveSkillsSignInOrigin } from "../../lib/fleet-credentials.js";
import {
  openVerificationPage,
  persistSignIn,
  pollDeviceAuthorization,
  pollDeviceToken,
  readSignedInAccount,
  signOut,
  startDeviceAuthorization,
} from "../../lib/sign-in.js";
import { getEnvironmentProfile } from "../profile-selection.js";

/** The TUI's account commands: `/login [url]`, `/logout`, `/whoami`, `/help`. */
export type AccountAction = "login" | "logout" | "whoami" | "help";

export const SLASH_COMMANDS: ReadonlyArray<{ usage: string; description: string }> = [
  { usage: "/login [url]", description: "Sign in in your browser (default server, or the URL you name)" },
  { usage: "/logout", description: "Sign out this profile (revokes a key that /login minted)" },
  { usage: "/whoami", description: "Show the signed-in account" },
  { usage: "/help", description: "List these commands" },
  { usage: "/quit", description: "Leave the browser" },
];

interface AccountViewProps {
  action: AccountAction;
  /** `/login <url>`: sign in to this server instead of the default. */
  argument?: string;
  /** Leave the view; `changed` is true when the stored credential changed. */
  onDone: (changed: boolean) => void;
}

type Phase =
  | { kind: "working"; label: string }
  | { kind: "waiting"; userCode: string; url: string; origin: string }
  | { kind: "done"; lines: Array<{ text: string; tone?: "good" | "bad" | "dim" }>; changed: boolean };

const TITLES: Record<AccountAction, string> = { login: "Sign in", logout: "Sign out", whoami: "Account", help: "Commands" };

function failureLines(error: unknown): Phase {
  const message = error instanceof Error ? error.message : String(error);
  return { kind: "done", lines: [{ text: message, tone: "bad" }], changed: false };
}

export function AccountView({ action, argument, onDone }: AccountViewProps) {
  const [phase, setPhase] = useState<Phase>(
    action === "help"
      ? { kind: "done", lines: SLASH_COMMANDS.map((command) => ({ text: `${command.usage.padEnd(14)} ${command.description}` })), changed: false }
      : { kind: "working", label: action === "login" ? "Starting sign-in…" : action === "logout" ? "Signing out…" : "Checking account…" },
  );
  const cancel = useRef<AbortController | null>(null);

  useEffect(() => {
    if (action === "help") return;
    const controller = new AbortController();
    cancel.current = controller;
    const update = (next: Phase) => { if (!controller.signal.aborted) setPhase(next); };

    const run = async (): Promise<void> => {
      if (action === "whoami") {
        const account = await readSignedInAccount();
        if (!account.signedIn) {
          update({ kind: "done", changed: false, lines: [{ text: "Not signed in.", tone: "bad" }, { text: account.reason, tone: "dim" }, { text: "Type /login to sign in." }] });
          return;
        }
        update({
          kind: "done",
          changed: false,
          lines: [
            { text: account.email ? `Signed in as ${account.email}` : "Signed in", tone: "good" },
            ...(account.organization ? [{ text: `Organization: ${account.organization}` }] : []),
            { text: `Server: ${account.apiOrigin}`, tone: "dim" as const },
            { text: `Credential: ${account.source}`, tone: "dim" as const },
            ...(account.error ? [{ text: account.error, tone: "bad" as const }] : []),
          ],
        });
        return;
      }

      if (action === "logout") {
        // Same core and rule as `skills logout` (global-cli-logout-semantics).
        const result = await signOut({ environmentProfile: getEnvironmentProfile() });
        update({
          kind: "done",
          changed: true,
          lines: [
            { text: result.signedOut ? "Signed out." : "Not fully signed out.", tone: result.signedOut ? "good" : "bad" },
            ...result.notes.map((text) => ({ text, tone: "dim" as const })),
            ...result.reasons.map((reason) => ({ text: reason.message, tone: "bad" as const })),
          ],
        });
        return;
      }

      const target = resolveSkillsSignInOrigin(process.env, {}, argument);
      const refusal = gatewaySignInRefusal(target);
      if (refusal) throw refusal;
      const start = await startDeviceAuthorization(target.origin);
      if (controller.signal.aborted) return;
      const url = start.verificationUriComplete || start.verificationUri;
      update({ kind: "waiting", userCode: start.userCode, url, origin: target.origin });
      openVerificationPage(url, target.origin);
      const outcome = await pollDeviceAuthorization({
        poll: () => pollDeviceToken(target.origin, start.deviceCode),
        intervalSeconds: start.interval,
        deadline: Date.now() + start.expiresIn * 1000,
        signal: controller.signal,
      });
      if (outcome.status === "authorized") {
        await persistSignIn(outcome.result, target.origin);
        const email = outcome.result.user?.email;
        update({
          kind: "done",
          changed: true,
          lines: [
            { text: email ? `Signed in as ${email}` : "Signed in", tone: "good" },
            { text: `Server: ${target.origin}`, tone: "dim" },
            { text: "Register Skills with your agents from a shell: skills setup agents", tone: "dim" },
          ],
        });
        return;
      }
      const ended = {
        expired: "The sign-in code expired before it was approved. Type /login to start again.",
        invalid: "The server no longer recognises this sign-in code. Type /login to start again.",
        denied: "Sign-in was denied in the browser.",
        timeout: "Sign-in timed out. Type /login to start again.",
        cancelled: "Sign-in cancelled.",
      }[outcome.status];
      update({ kind: "done", changed: false, lines: [{ text: ended, tone: "bad" }] });
    };

    run().catch((error) => update(failureLines(error)));
    return () => controller.abort();
  }, [action, argument]);

  useInput((_input, key) => {
    if (!key.return && !key.escape) return;
    if (phase.kind === "done") {
      onDone(phase.changed);
      return;
    }
    // Escape abandons a sign-in or a lookup, and Enter also leaves a read-only
    // lookup. A sign-out is never interrupted: it is already changing state.
    if (action === "logout") return;
    if (key.escape || action === "whoami") {
      cancel.current?.abort();
      // A sign-in abandoned at the last moment may still have stored its key,
      // so the caller re-reads access rather than trusting "nothing changed".
      onDone(action === "login");
    }
  });

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold>{TITLES[action]}</Text>
      </Box>

      {phase.kind === "working" && (
        <Text>
          <Spinner type="dots" /> {phase.label}
        </Text>
      )}

      {phase.kind === "waiting" && (
        <Box flexDirection="column">
          <Text>Approve this sign-in in your browser.</Text>
          <Text>
            <Text dimColor>Code: </Text>
            <Text bold>{phase.userCode}</Text>
          </Text>
          <Text>
            <Text dimColor>URL:  </Text>
            {phase.url}
          </Text>
          <Box marginTop={1}>
            <Text>
              <Spinner type="dots" /> Waiting for approval… <Text dimColor>(Esc to cancel)</Text>
            </Text>
          </Box>
        </Box>
      )}

      {phase.kind === "done" && (
        <Box flexDirection="column">
          {phase.lines.map((line, index) => (
            <Text key={index} color={line.tone === "good" ? "green" : line.tone === "bad" ? "red" : undefined} dimColor={line.tone === "dim"}>
              {line.text}
            </Text>
          ))}
          <Box marginTop={1}>
            <Text dimColor>Press Enter to go back</Text>
          </Box>
        </Box>
      )}
    </Box>
  );
}
