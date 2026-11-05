// Child process for linux-access-acl.test.ts: drives the real glibc probe on a
// fresh private directory for at most <rounds> rounds or <budgetMs> ms, then
// prints one JSON line. The parent kills it hard if it overruns.
import { closeSync, constants, mkdtempSync, openSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { linuxAccessAclAbsent, withGlibcAclProbe } from "./linux-access-acl.js";

const rounds = Number(process.argv[2]), budgetMs = Number(process.argv[3]);
if (!Number.isSafeInteger(rounds) || rounds < 1 || !Number.isSafeInteger(budgetMs) || budgetMs < 1) process.exit(2);
const fd = openSync(mkdtempSync(join(tmpdir(), "skills-linux-acl-")), constants.O_RDONLY | constants.O_DIRECTORY);
const started = performance.now(), seen: Record<number, number> = {};
let completed = 0, refused = 0, queries = 0;
try {
  while (completed < rounds && performance.now() - started < budgetMs) {
    // Allocate around the queries so the collector runs between them.
    const garbage = Array.from({ length: 64 }, (_, index) => `${completed}:${index}`);
    if (completed % 50 === 0) Bun.gc(false);
    const absent = withGlibcAclProbe(probe => linuxAccessAclAbsent({
      ...probe,
      errno: probe.errno && { get: () => { const value = probe.errno!.get(); seen[value] = (seen[value] ?? 0) + 1; return value; }, set: probe.errno.set },
      fgetxattr: (descriptor, attribute) => { queries++; return probe.fgetxattr(descriptor, attribute); },
    }, fd, true));
    if (!absent) refused++;
    if (garbage.length !== 64) process.exit(3);
    completed++;
  }
} finally { closeSync(fd); }
console.log(JSON.stringify({ completed, refused, queries, requeried: queries - 2 * completed, seen, elapsedMs: Math.round(performance.now() - started) }));
