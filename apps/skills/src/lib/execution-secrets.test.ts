import { expect, test } from "bun:test";
import { defaultSecretsClientFactory, resolveSelectedSecrets, type SelectedSecretBindings, type SelectedSecretsClient } from "./execution-secrets.js";
import { useDefaultTestTimeout } from "../test-preload.js";
useDefaultTestTimeout();

// SH-00058. @hasna/secrets is an optional dependency that only an install with
// access to it receives; the default client factory loads it lazily.
const client: SelectedSecretsClient = { baseUrl: "https://vault.example.test/v1", getSecret: async ({ key }) => ({ key, value: `value-of-${key}` }) };
const bindings = (names: Record<string, string>): SelectedSecretBindings => ({
  schema: "hasna.skills-secret-bindings.v1",
  selection: { authority: "https://skills.example.test/api/v1", workspaceId: "workspace", profileId: "profile", profileRevision: "revision", slug: "skill", version: "1.0.0", bundleDigest: "sha256:digest" },
  consumer: { stationId: "station", workspaceDirectory: "/workspace" },
  secretsAuthority: client.baseUrl, bindings: names,
});
const missing = () => Promise.reject(Object.assign(new Error("Cannot find package '@hasna/secrets'"), { code: "ERR_MODULE_NOT_FOUND" }));

test("with @hasna/secrets present, the factory builds the client from the loaded SDK", async () => {
  let loads = 0;
  const factory = await defaultSecretsClientFactory(async () => { loads += 1; return { createSecretsClientFromEnv: () => client }; });
  expect(loads).toBe(1);
  expect(factory()).toBe(client);
});

test("with @hasna/secrets absent, the factory refuses terminally and says to install it with access", async () => {
  const refusal = defaultSecretsClientFactory(missing);
  await expect(refusal).rejects.toMatchObject({ code: "LOCAL_SECRET_UNAVAILABLE" });
  await expect(defaultSecretsClientFactory(missing)).rejects.toThrow("Install @hasna/secrets with access to it");
});

let installed = false;
try { Bun.resolveSync("@hasna/secrets/sdk", import.meta.dir); installed = true; } catch { /* absent: an install without access to it */ }
test.skipIf(!installed)("the default load finds the installed @hasna/secrets where it is installed", async () => {
  const factory = await defaultSecretsClientFactory();
  expect(typeof factory).toBe("function");
});

test("no bindings resolve to nothing, and an injected client is used as given", async () => {
  expect(await resolveSelectedSecrets(bindings({}))).toEqual({});
  expect(await resolveSelectedSecrets(bindings({ TOKEN: "app/token" }), () => client)).toEqual({ TOKEN: "value-of-app/token" });
});
