import type { Command } from "commander";
import { constants, closeSync, fstatSync, lstatSync, openSync, readSync } from "node:fs";
import { createInterface } from "node:readline";
import { executeRecurringSurface, recurringSurfaceOperations, type RecurringSurfaceAction } from "../../lib/recurring-surface.js";
import { RecurringCustomerError, recurringCustomerError } from "../../lib/recurring-customer.js";
import { RecurringInputError, type RecurringPreview } from "../../lib/remote-recurring.js";
import { NameInputError, promptCode, readCode } from "./customer-verification.js";
import { writeCliOutput } from "../output.js";

const acceptance = "authorize-recurring-credit-use";
type Options = { json?: boolean; userId?: string; membershipId?: string; request?: string; limit?: string; cursor?: string;
  acceptedTerms?: string; idempotencyKey?: string; recoveryDir?: string; email?: string; codeStdin?: boolean; confirm?: boolean; acceptance?: string };
const jsonText = (value: unknown) => JSON.stringify(value, null, 2).replace(/[\u007f-\u009f\u2028\u2029]/g, c => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
function readRequest(path: string): unknown {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = fstatSync(fd);
    if (!before.isFile() || before.size > 1_048_576 || before.size < 1) throw new RecurringInputError();
    const bytes = Buffer.alloc(before.size + 1); let length = 0;
    while (length < bytes.length) { const n = readSync(fd, bytes, length, bytes.length - length, length); if (!n) break; length += n; }
    const after = fstatSync(fd), current = lstatSync(path);
    if (length !== before.size || after.size !== before.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs
      || current.dev !== before.dev || current.ino !== before.ino || !current.isFile() || current.isSymbolicLink()) throw new RecurringInputError();
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, length)));
  } catch { throw new RecurringInputError(); }
  finally { closeSync(fd); }
}
async function acceptAtTerminal(draft: RecurringPreview): Promise<boolean> {
  await new Promise<void>((resolve, reject) => process.stderr.write(`${jsonText(draft)}\nThis grants an additional recurring budget. Each occurrence reprices within the approved ceilings. Revocation prevents new authority; an already-authorized attempt may finish, and cancellation is separate.\n`, error => error ? reject(error) : resolve()));
  return new Promise(resolve => {
    const rl = createInterface({ input: process.stdin, output: process.stderr }); let settled = false;
    const finish = (accepted: boolean) => { if (settled) return; settled = true; clearTimeout(timer); rl.close(); if (!accepted) process.exitCode = 130; resolve(accepted); };
    const timer = setTimeout(() => finish(false), 5 * 60 * 1000);
    rl.once("SIGINT", () => finish(false)); rl.once("close", () => finish(false));
    rl.question(`Type ${acceptance} to approve these exact terms: `, value => finish(value === acceptance));
  });
}
function input(action: RecurringSurfaceAction, id: string | undefined, options: Options): Record<string, unknown> {
  const value: Record<string, unknown> = {};
  if (options.userId !== undefined) value.userId = options.userId;
  if (options.membershipId !== undefined) value.membershipId = options.membershipId;
  if (action === "preview") value.request = readRequest(options.request!);
  if (["draft", "activate", "verification"].includes(action)) value.draftId = id;
  if (["get", "revoke", "occurrences"].includes(action)) value.consentId = id;
  if (action === "list" || action === "occurrences") {
    if (options.limit !== undefined) {
      if (!/^[1-9]\d{0,2}$/.test(options.limit)) throw new RecurringInputError();
      value.limit = Number(options.limit);
    }
    if (options.cursor !== undefined) value.cursor = options.cursor;
  }
  if (options.recoveryDir !== undefined) value.recoveryDirectory = options.recoveryDir;
  if (options.email !== undefined) value.email = options.email;
  if (options.confirm !== undefined) value.confirm = options.confirm;
  if (action === "activate") value.approval = { contractVersion: 1, acceptedTermsSha256: options.acceptedTerms, idempotencyKey: options.idempotencyKey, acceptance };
  return value;
}
export function registerRecurringCommands(parent: Command) {
  const group = parent.command("recurring").description("Preview, explicitly authorize, inspect and revoke hosted recurring consent; requires a compatible configured server");
  for (const operation of recurringSurfaceOperations) {
    // Do not replace the parent's shared Commander output configuration: argument
    // errors must not echo a misplaced OTP or alter unrelated commands.
    const command = group.createCommand(operation.cli).description(operation.title).allowExcessArguments(false)
      .configureOutput({ writeErr: () => { process.stderr.write("Recurring arguments were refused. Use documented fields and supply verification codes only through masked input or --code-stdin.\n"); } })
      .option("--json", "Output the complete validated result as JSON")
      .option("--user-id <uuid>", "Observed user ID; together with membership ID restricts current authority")
      .option("--membership-id <uuid>", "Exact observed membership ID; required for approval without an enrolled profile");
    group.addCommand(command);
    const action = operation.action;
    if (["draft", "activate", "verification"].includes(action)) command.argument("<draft-id>");
    if (["get", "revoke", "occurrences"].includes(action)) command.argument("<consent-id>");
    if (action === "preview") command.requiredOption("--request <file>", "Bounded JSON file containing every explicit RecurringRequest field; no defaults are inferred");
    if (action === "list" || action === "occurrences") command.option("--limit <count>", "Page size 1–100; server default 20").option("--cursor <cursor>", "Exact nextCursor from the preceding page");
    if (operation.recovery) command.requiredOption("--recovery-dir <directory>", "New canonical private directory for activate/revoke; original directory for recover");
    if (action === "activate") command.requiredOption("--accepted-terms <sha256>", "Original server terms hash from preview/draft")
      .requiredOption("--idempotency-key <key>", "Original caller-owned key (16–128 letters, digits, underscore or hyphen); never replace after uncertainty")
      .option("--acceptance <literal>", `For noninteractive approval, exactly ${acceptance}`);
    if (action === "activate" || action === "verification") command.requiredOption("--email <email>", "Account email for fresh verification");
    if (action === "recover") command.option("--email <email>", "Account email when explicitly replaying an unconfirmed activation");
    if (action === "activate" || action === "recover") command.option("--code-stdin", "Read a previously requested six-digit verification code from stdin; never argv");
    if (["activate", "revoke", "verification"].includes(action)) command.requiredOption("--confirm", "Explicitly approve this action; activation also requires exact terms and fresh human authority");
    if (action === "recover") command.option("--confirm", "Explicitly reconcile the original mutation; otherwise only inspect it");
    command.action(async () => {
      const options = command.opts<Options>(), tty = !options.json && Boolean(process.stdin.isTTY && process.stderr.isTTY);
      try {
        if (options.acceptance !== undefined && options.acceptance !== acceptance) throw new RecurringInputError();
        if (action === "activate" && !tty && (options.acceptance !== acceptance || !options.codeStdin)) throw new RecurringInputError();
        if (action === "recover" && options.codeStdin && !options.confirm) throw new RecurringInputError();
        const result = await executeRecurringSurface(action, input(action, command.args[0], options), process.env, {
          accept: async draft => tty ? acceptAtTerminal(draft) : true,
          verification: async (_email, requestCode) => {
            if (options.codeStdin) {
              try { return await readCode(); }
              catch (error) {
                if (error instanceof NameInputError) throw new RecurringCustomerError("RECURRING_VERIFICATION_INPUT_INVALID",
                  "Supply a fresh six-digit verification code through stdin. No recurring activation was submitted.");
                throw error;
              }
            }
            if (!tty) throw new RecurringInputError();
            await requestCode(); return promptCode();
          },
        });
        await writeCliOutput(jsonText(result));
        if (result && typeof result === "object" && "outcomeUnknown" in result && result.outcomeUnknown) process.exitCode = 2;
      } catch (error) {
        const failure = recurringCustomerError(error);
        if (options.json) await writeCliOutput(jsonText({ ...failure, ...(options.recoveryDir ? { recoveryDirectory: options.recoveryDir } : {}) }));
        else console.error(failure.error);
        process.exitCode = failure.outcomeUnknown ? 2 : 1;
      }
    });
  }
}
