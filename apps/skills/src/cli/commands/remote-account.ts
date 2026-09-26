import type { Command } from "commander";
import { createRemoteSkillsClient, RemoteCapabilityUnavailableError, RemoteQuoteUnavailableError, RemoteCreditCheckoutError } from "../../lib/remote-client.js";

/** These commands expose the configured server's account contract, without local prices. */
export function registerRemoteAccount(parent: Command) {
  parent.command("capabilities").option("--json", "Output as JSON", false)
    .description("Inspect the selected server's supported API contract")
    .action((options: { json: boolean }) => execute(options, client => client.getCapabilities()));
  parent.command("quote").argument("<skill>").argument("[args...]")
    .allowUnknownOption(true).passThroughOptions(true)
    .option("--json", "Output the server quote as JSON", false)
    .description("Quote a skill on the configured server without submitting it")
    .action((skill: string, args: string[], options: { json: boolean }) => execute(options, async client => client.quoteRun(skill, {}, args)));

  const billing = parent.command("billing").description("Inspect the configured server's billing account");
  billing.command("status").option("--json", "Output as JSON", false)
    .action((options: { json: boolean }) => execute(options, client => client.getBillingStatus()));
  billing.command("usage").option("--json", "Output as JSON", false)
    .action((options: { json: boolean }) => execute(options, client => client.getUsage()));
  billing.command("invoices").option("--json", "Output as JSON", false)
    .action((options: { json: boolean }) => execute(options, client => client.listInvoices()));
  billing.command("checkout").option("--json", "Output as JSON", false)
    .description("Create an external subscription checkout link")
    .action((options: { json: boolean }) => execute(options, client => client.createBillingCheckout()));
  billing.command("portal").option("--json", "Output as JSON", false)
    .description("Create an external customer billing portal link")
    .action((options: { json: boolean }) => execute(options, client => client.createBillingPortal()));

  const credits = parent.command("credits").description("Inspect and purchase credits from the configured server");
  credits.command("packs").option("--json", "Output as JSON", false)
    .action((options: { json: boolean }) => execute(options, client => client.listCreditPacks()));
  credits.command("buy").argument("<pack-id>", "An ID returned by credits packs")
    .option("--json", "Output as JSON", false)
    .option("--idempotency-key <key>", "Retain and reuse this request key for explicit checkout recovery")
    .description("Create an external checkout link; payment is confirmed in the browser. No automatic retries.")
    .action((packId: string, options: { json: boolean; idempotencyKey?: string }) => execute(options, client => client.createCreditCheckout(packId, { idempotencyKey: options.idempotencyKey })));
}

export async function execute(options: { json: boolean }, action: (client: NonNullable<Awaited<ReturnType<typeof createRemoteSkillsClient>>>) => Promise<unknown>) {
  try {
    const client = await createRemoteSkillsClient();
    if (!client) throw new Error("Configure a Skills server with skills setup --api-url <url>, then skills auth login");
    const result = await action(client);
    // Structured output is also readable at a terminal; it never invokes a returned URL or command.
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    const message = error instanceof Error ? error.message : "The Skills server request failed";
    if (error instanceof RemoteCreditCheckoutError) {
      const result = { error: error.message, code: error.code, status: error.status,
        requestIdempotencyKey: error.requestIdempotencyKey,
        ...(error.retryAfterSeconds === undefined ? {} : { retryAfterSeconds: error.retryAfterSeconds }) };
      if (options.json) console.log(JSON.stringify(result));
      else console.error(`${error.message}\nRequest key: ${error.requestIdempotencyKey}` +
        (error.code === "CREDIT_CHECKOUT_UNCONFIRMED" || error.code === "CREDIT_CHECKOUT_IN_PROGRESS"
          ? "\nFor explicit recovery, pass this key with --idempotency-key. Keep the same server, account and pack." : ""));
      process.exitCode = 1;
      return;
    }
    if (options.json) console.log(JSON.stringify({ error: message,
      ...(error instanceof RemoteCapabilityUnavailableError || error instanceof RemoteQuoteUnavailableError ? { code: error.code, status: error.status } : {}),
    }));
    else console.error(message);
    process.exitCode = 1;
  }
}
