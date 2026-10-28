import { expect, test } from "bun:test";
import { projectGuardedAgentConfigDiagnostic, guardedAgentConfigDiagnostic } from "./guarded-agent-config.js";

test("access metadata projects only fixed enums and safe integer syscall readings", () => {
  const known = { phase: "ORIGINAL_READ", pathRole: "ORIGINAL", predicate: "LINUX_QUERY_ERROR", attribute: "ACCESS", result: -1, errno: 5 } as const;
  expect(projectGuardedAgentConfigDiagnostic({ ...known, path: "/private/config", config: "private content", env: { PRIVATE: "withheld" }, message: "foreign detail" })).toEqual(known);
  for (const patch of [{ phase: "foreign detail" }, { pathRole: "/private/config" }, { predicate: "unverified" }]) expect(projectGuardedAgentConfigDiagnostic({ ...known, ...patch })).toBeUndefined();
  expect(projectGuardedAgentConfigDiagnostic({ ...known, result: Infinity, errno: 1.5, attribute: "/private/config" })).toEqual({ phase: "ORIGINAL_READ", pathRole: "ORIGINAL", predicate: "LINUX_QUERY_ERROR" });
  for (const value of [null, [], "foreign detail", {}, new Error("foreign detail")]) expect(projectGuardedAgentConfigDiagnostic(value)).toBeUndefined();
  expect(guardedAgentConfigDiagnostic(Object.assign(new Error("NATIVE_PATH_ACL_UNVERIFIED"), { diagnostic: known }))).toBeUndefined();
});
