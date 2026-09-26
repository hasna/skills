import { resolve } from "node:path";
import { verifyProducerDependencies } from "../src/lib/release-dependencies";

console.log(JSON.stringify(verifyProducerDependencies(resolve(process.argv[2] ?? process.cwd())), null, 2));
