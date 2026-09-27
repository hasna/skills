import { emitKeypressEvents, type Key } from "node:readline";
import { NameInputError } from "./customer-verification.js";

/** Bounded two-line stdin protocol: fresh OTP first, acceptance token second. */
export async function readInvitationSecrets(): Promise<{ code: string; token: string }> {
  if (process.stdin.isTTY) throw new NameInputError("Pipe the six-digit code and invitation token on two separate lines with --secrets-stdin.");
  let text = "";
  for await (const chunk of process.stdin) {
    text += chunk.toString();
    if (text.length > 64) throw new NameInputError("Supply only the code and invitation token on two separate lines.");
  }
  const matched = /^(\d{6})\r?\n([A-Za-z0-9_-]{43})(?:\r?\n)?$/.exec(text);
  if (!matched) throw new NameInputError("Supply only the code and invitation token on two separate lines.");
  return { code: matched[1], token: matched[2] };
}
/** Secret remains local to this prompt, never argv, history, logs or profile state. */
export function promptInvitationToken(): Promise<string | null> { return promptInvitationProof("token"); }
export function promptInvitationRecoveryCode(): Promise<string | null> { return promptInvitationProof("code"); }
function promptInvitationProof(kind: "token" | "code"): Promise<string | null> {
  const length = kind === "token" ? 43 : 6;
  const label = kind === "token" ? "invitation token" : "recovery code";
  const character = kind === "token" ? /^[A-Za-z0-9_-]$/ : /^\d$/;
  const stdin = process.stdin, output = process.stderr, wasRaw = stdin.isRaw, wasFlowing = stdin.readableFlowing;
  return new Promise(resolve => {
    let value = "", settled = false, overflow = false;
    const finish = (answer: string | null) => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      stdin.off("keypress", keypress); stdin.off("end", cancel); process.off("SIGINT", cancel);
      stdin.setRawMode(wasRaw); if (wasFlowing !== true) stdin.pause(); output.write("\n");
      if (answer === null) process.exitCode = 130;
      resolve(answer);
    };
    const cancel = () => finish(null);
    const keypress = (text: string, key: Key) => {
      if ((key.ctrl && ["c", "d"].includes(key.name ?? "")) || key.name === "escape") return cancel();
      if (key.name === "return" || key.name === "enter") {
        if (overflow) { value = ""; overflow = false; output.write(`\nEnter exactly ${length} ${label} characters: `); return; }
        if (value.length === length) return finish(value);
        output.write(`\nEnter the complete ${label}: `); value = ""; return;
      }
      if (overflow) return;
      if (key.name === "backspace") { if (value) { value = value.slice(0, -1); output.write("\b \b"); } }
      else if (character.test(text)) {
        if (value.length === length) { overflow = true; output.write(`\nThe ${label} is too long. Press Enter to start again.`); }
        else { value += text; output.write("*"); }
      }
      else if (text && !key.ctrl && !key.meta) { overflow = true; output.write(`\nThe ${label} contains invalid characters. Press Enter to start again.`); }
    };
    const timer = setTimeout(cancel, 5 * 60 * 1000);
    emitKeypressEvents(stdin); stdin.setRawMode(true); stdin.on("keypress", keypress); stdin.once("end", cancel); process.once("SIGINT", cancel);
    output.write(kind === "token" ? "Enter the invitation token from your email: " : "Enter the six-digit recovery code from your email: "); stdin.resume();
  });
}
