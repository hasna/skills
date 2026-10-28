import { afterEach, expect, mock, spyOn, test } from "bun:test";
import { HttpProfileClient } from "./profile-client.js";
import { SkillSelectionError } from "./selection-cache.js";

const origin = "http://127.0.0.1:1";
const client = () => new HttpProfileClient("synthetic-test-token", origin);
afterEach(() => mock.restore());

function response(body: ReadableStream<Uint8Array>) {
  return new Response(body, { headers: { "Content-Type": "application/json" } });
}
function serve(create: (signal: AbortSignal) => Response) {
  return spyOn(globalThis, "fetch").mockImplementation(Object.assign(async (url: URL | RequestInfo, init?: RequestInit) => {
    expect(new URL(String(url)).origin).toBe(origin);
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    return create(init!.signal!);
  }, { preconnect: () => {} }));
}
async function rejection(promise: Promise<unknown>): Promise<Error> {
  try { await promise; } catch (error) { return error as Error; }
  throw new Error("Expected the operation to reject");
}
function unavailable(error: Error, cause: string) {
  expect(error).toBeInstanceOf(SkillSelectionError);
  expect((error as SkillSelectionError).code).toBe("SKILLS_API_UNAVAILABLE");
  expect(error.cause).toBeInstanceOf(DOMException);
  expect((error.cause as DOMException).name).toBe(cause);
  expect((error.cause as DOMException).message).toBe("The Skills API request was cut short");
  expect(error.message).not.toContain("synthetic private detail");
}

test("a deadline after response headers preserves the request's timeout cause", async () => {
  const timeout = new AbortController();
  spyOn(AbortSignal, "timeout").mockImplementation(ms => {
    expect(ms).toBe(15_000);
    return timeout.signal;
  });
  serve(signal => response(new ReadableStream({ start(controller) {
    controller.enqueue(new TextEncoder().encode('{"capabilities":'));
    // Fetch may expose AbortError on its body even when the deadline is TimeoutError.
    signal.addEventListener("abort", () => controller.error(new DOMException("synthetic private detail", "AbortError")), { once: true });
    queueMicrotask(() => timeout.abort(new DOMException("synthetic private detail", "TimeoutError")));
  } })));
  unavailable(await rejection(client().supportsPinRenewal()), "TimeoutError");
});

for (const name of ["AbortError", "TimeoutError"]) {
  test(`a body ${name} without an external signal is a sanitized transport interruption`, async () => {
    serve(() => response(new ReadableStream({ start(controller) {
      controller.error(new DOMException("synthetic private detail", name));
    } })));
    unavailable(await rejection(client().supportsPinRenewal()), name);
  });
}

test("an external cancellation after headers preserves its sanitized cause", async () => {
  const external = new AbortController();
  serve(() => response(new ReadableStream({ start() {
    queueMicrotask(() => external.abort(new DOMException("synthetic private detail", "AbortError")));
  } })));
  unavailable(await rejection(new HttpProfileClient("synthetic-test-token", origin, external.signal).supportsPinRenewal()), "AbortError");
});

test("concurrent response reads keep separate request signals", async () => {
  const first = new AbortController(), second = new AbortController();
  let requests = 0;
  spyOn(AbortSignal, "timeout").mockImplementation(() => requests++ === 0 ? first.signal : second.signal);
  let firstBody!: ReadableStreamDefaultController<Uint8Array>;
  let secondBody!: ReadableStreamDefaultController<Uint8Array>;
  serve(signal => response(new ReadableStream({ start(controller) {
    if (signal === first.signal) firstBody = controller;
    else secondBody = controller;
    signal.addEventListener("abort", () => controller.error(new DOMException("synthetic private detail", "AbortError")), { once: true });
  } })));
  const shared = client();
  const failed = rejection(shared.supportsPinRenewal());
  const succeeded = shared.supportsPinRenewal();
  expect(firstBody).toBeDefined();
  expect(secondBody).toBeDefined();
  first.abort(new DOMException("synthetic private detail", "TimeoutError"));
  secondBody.enqueue(new TextEncoder().encode('{"capabilities":["skills.session-pin-renewal"]}'));
  secondBody.close();
  unavailable(await failed, "TimeoutError");
  expect(await succeeded).toBe(true);
});

for (const [label, make] of [
  ["malformed JSON", () => new Response('{"capabilities":')],
  ["invalid shape", () => Response.json({ capabilities: "skills.session-pin-renewal" })],
  ["oversized body", () => new Response("{}", { headers: { "Content-Length": "999999999" } })],
] as const) {
  test(`${label} still fails validation, without being labelled a timeout`, async () => {
    serve(() => make());
    const error = await rejection(client().supportsPinRenewal());
    expect(error.message).toBe("The Skills API returned an invalid profile response");
    expect(error).not.toBeInstanceOf(SkillSelectionError);
    expect(error.cause).toBeUndefined();
  });
}

test("HTTP authentication and unavailable responses retain their existing codes", async () => {
  for (const [status, code] of [[401, "SKILLS_API_UNAUTHORIZED"], [403, "SKILLS_API_FORBIDDEN"], [503, "SKILLS_API_UNAVAILABLE"]] as const) {
    const fetch = serve(() => new Response("synthetic private detail", { status }));
    const error = await rejection(client().supportsPinRenewal()) as SkillSelectionError;
    expect(error.code).toBe(code);
    expect(error.message).toBe(`Skills API request failed (HTTP ${status})`);
    expect(error.cause).toBeUndefined();
    fetch.mockRestore();
  }
});

test("a valid response still resolves normally", async () => {
  serve(() => Response.json({ capabilities: ["skills.session-pin-renewal"] }));
  expect(await client().supportsPinRenewal()).toBe(true);
});
