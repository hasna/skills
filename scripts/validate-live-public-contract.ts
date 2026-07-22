import { readFileSync } from "node:fs";
import { join } from "node:path";
import { validateLivePublicContract } from "../src/lib/live-public-contract.js";

const [proofDir, platformSha, platformVersion, deploymentId, clientPin] = process.argv.slice(2);
if (!proofDir || !platformSha || !platformVersion || !deploymentId || !clientPin) {
  throw new Error("usage: validate-live-public-contract <proof-dir> <platform-sha> <platform-version> <deployment-id> <client-pin>");
}

const read = (name: string): unknown => JSON.parse(readFileSync(join(proofDir, `${name}.json`), "utf8"));

validateLivePublicContract({
  version: read("version"),
  health: read("health"),
  catalog: read("catalog"),
  skill: read("skill"),
  quote: read("quote"),
  releaseQuote: read("release-quote"),
  runs: read("runs"),
  usage: read("usage"),
}, {
  platformSha,
  platformVersion,
  deploymentId,
  clientPin,
});

console.log("Live public contract proof passed.");
