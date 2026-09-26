#!/usr/bin/env bun
/** Run against a separately installed archive; this script does not install or publish. */
import assert from "node:assert/strict";
import { readFileSync, realpathSync } from "node:fs";
import { isAbsolute, join, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const consumer = process.argv[2];
assert(consumer && isAbsolute(consumer), "Pass the absolute, isolated installed-consumer directory");
const root = realpathSync(join(consumer, "node_modules/@hasna/skills"));
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
assert.equal(pkg.name, "@hasna/skills");
const entry = realpathSync(fileURLToPath(import.meta.resolve("@hasna/skills/sdk", pathToFileURL(join(consumer, "package.json")).href)));
assert(entry.startsWith(root + sep), "SDK must resolve inside the selected installed package");
const originalFetch = globalThis.fetch, posts: Array<{ packId: string; idempotencyKey: string }> = [];
const key = "installed-checkout-0001", lossKey = "installed-checkout-0002";
let mode: "sequence" | "loss" | "recovered" = "sequence", reads = 0;
globalThis.fetch = (async (input: any, init?: RequestInit) => {
  assert.equal(String(input), "https://installed-checkout.example.test/api/v1/billing/credits");
  assert.equal(init?.redirect, "error"); assert.equal(init?.credentials, "omit");
  if (init?.method !== "POST") { reads++; return Response.json([{ id: "credits_100", credits: 100 }]); }
  const body = JSON.parse(String(init.body)); posts.push(body);
  if (mode === "loss") throw Error("untrusted-network-message");
  if (mode === "recovered") return Response.json({ url: "https://checkout.example.test/session" });
  return Response.json(posts.length === 1 ? { error: "credit checkout creation unresolved", requestIdempotencyKey: key, retryAfterSeconds: 30, detail: "untrusted-provider-message" }
    : posts.length === 2 ? { error: "credit checkout in_progress", requestIdempotencyKey: key }
    : { url: "https://checkout.example.test/session", requestIdempotencyKey: key }, { status: posts.length === 1 ? 503 : posts.length === 2 ? 409 : 200 });
}) as typeof fetch;
try {
  const { RemoteSkillsClient, RemoteCreditCheckoutError } = await import(pathToFileURL(entry).href);
  assert.equal(typeof RemoteCreditCheckoutError, "function");
  const client = new RemoteSkillsClient("inert-fixture-key", "https://installed-checkout.example.test");
  for (let n = 1; n <= 2; n++) {
    await assert.rejects(client.createCreditCheckout("credits_100", { idempotencyKey: key }), (error: any) => {
      assert(error instanceof RemoteCreditCheckoutError);
      assert.equal(error.requestIdempotencyKey, key); assert.equal(error.status, n === 1 ? 503 : 409);
      assert.equal(error.code, n === 1 ? "CREDIT_CHECKOUT_UNCONFIRMED" : "CREDIT_CHECKOUT_IN_PROGRESS");
      assert(!JSON.stringify(error).includes("untrusted-provider-message"));
      return true;
    });
    assert.equal(posts.length, n, "client retried without a caller invocation");
  }
  assert.deepEqual(await client.createCreditCheckout("credits_100", { idempotencyKey: key }), { url: "https://checkout.example.test/session", requestIdempotencyKey: key });
  mode = "loss";
  await assert.rejects(client.createCreditCheckout("credits_100", { idempotencyKey: lossKey }), (error: any) => {
    assert(error instanceof RemoteCreditCheckoutError); assert.equal(error.status, 0); assert.equal(error.requestIdempotencyKey, lossKey);
    assert(!JSON.stringify(error).includes("untrusted-network-message")); return true;
  });
  assert.equal(posts.length, 4);
  mode = "recovered";
  assert.equal((await client.createCreditCheckout("credits_100", { idempotencyKey: lossKey })).requestIdempotencyKey, lossKey);
  assert.deepEqual(posts, [key, key, key, lossKey, lossKey].map(idempotencyKey => ({ packId: "credits_100", idempotencyKey })));
  assert.equal(reads, 5);
  console.log(JSON.stringify({ installedCheckoutConsumer: true, sdkVersion: pkg.version, explicitAttempts: 5, checkoutPosts: 5, autoRetries: 0, transportLossRecovered: true, liveRequests: 0 }));
} finally { globalThis.fetch = originalFetch; }
