import { expect, test } from "bun:test";
import { skillsApiUrlEnvironment, skillsShellArgument } from "./credential-profile-command.js";
import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();

for (const value of ["o'connor@example.invalid", "http://127.0.0.1:9/branch;printf-injected", "a$(printf injected)", "a b\"c'd"]) {
  test("copied shell arguments round-trip without expansion: " + JSON.stringify(value), () => {
    const result = Bun.spawnSync(["/bin/sh", "-c", `printf '%s' ${skillsShellArgument(value)}`],
      { env: { PATH: "/usr/bin:/bin" }, stdout: "pipe", stderr: "pipe" });
    expect(result.exitCode).toBe(0);
    expect(new TextDecoder().decode(result.stdout)).toBe(value);
    expect(result.stderr.length).toBe(0);
  });
}

test("a copied URL override keeps both supported aliases literal", () => {
  const origin = "http://127.0.0.1:9/branch;printf-injected";
  const command = `${skillsApiUrlEnvironment(origin)} /bin/sh -c 'printf "%s\\n%s" "$HASNA_SKILLS_API_URL" "$SKILLS_API_URL"'`;
  const result = Bun.spawnSync(["/bin/sh", "-c", command], { env: { PATH: "/usr/bin:/bin" }, stdout: "pipe", stderr: "pipe" });
  expect(result.exitCode).toBe(0);
  expect(new TextDecoder().decode(result.stdout)).toBe(`${origin}\n${origin}`);
  expect(result.stderr.length).toBe(0);
});
