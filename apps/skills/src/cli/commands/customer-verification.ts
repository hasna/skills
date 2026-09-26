import { emitKeypressEvents, type Key } from "node:readline";

export class NameInputError extends Error {}

/** OTP enters through stdin, never a new command-line credential argument. */
export async function readCode(): Promise<string> {
  if (process.stdin.isTTY) throw new NameInputError("Pipe a fresh six-digit verification code when using --code-stdin.");
  let text = "";
  for await (const chunk of process.stdin) {
    text += chunk.toString();
    if (text.length > 32) throw new NameInputError("Supply only a six-digit verification code on stdin.");
  }
  const code = text.trim();
  if (!/^\d{6}$/.test(code)) throw new NameInputError("Supply only a six-digit verification code on stdin.");
  return code;
}

export function promptCode(): Promise<string | null> {
  const stdin = process.stdin, output = process.stderr;
  const wasRaw = stdin.isRaw, wasFlowing = stdin.readableFlowing;
  return new Promise(resolve => {
    let value = "", settled = false;
    const finish = (answer: string | null) => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      stdin.off("keypress", keypress); stdin.off("end", cancel); process.off("SIGINT", cancel);
      stdin.setRawMode(wasRaw); if (wasFlowing !== true) stdin.pause();
      output.write("\n");
      if (answer === null) process.exitCode = 130;
      resolve(answer);
    };
    const cancel = () => finish(null);
    const keypress = (text: string, key: Key) => {
      if ((key.ctrl && ["c", "d"].includes(key.name ?? "")) || key.name === "escape") return cancel();
      if (key.name === "return" || key.name === "enter") {
        if (value.length === 6) return finish(value);
        output.write("\nEnter all six digits: "); value = ""; return;
      }
      if (key.name === "backspace") {
        if (value) { value = value.slice(0, -1); output.write("\b \b"); }
      } else if (/^[0-9]$/.test(text) && value.length < 6) { value += text; output.write("*"); }
    };
    const timer = setTimeout(cancel, 5 * 60 * 1000);
    emitKeypressEvents(stdin); stdin.setRawMode(true);
    stdin.on("keypress", keypress); stdin.once("end", cancel); process.once("SIGINT", cancel);
    output.write("Enter the six-digit code sent to your email: "); stdin.resume();
  });
}
