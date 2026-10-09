import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { stageKernelLockAssets } from "../src/lib/kernel-lock-assets.js";

const root = resolve(import.meta.dir, "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const expectedVersion = pkg.dependencies?.["@hasna/contracts"];
if (typeof expectedVersion !== "string" || !/^\d+\.\d+\.\d+$/.test(expectedVersion)) {
  throw new Error("Kernel lock build requires an exact Contracts dependency pin");
}
const digest = stageKernelLockAssets(fileURLToPath(import.meta.resolve("@hasna/contracts/kernel-lock")), root, expectedVersion);
console.log(`Bundled kernel lock native assets verified: ${digest}`);
