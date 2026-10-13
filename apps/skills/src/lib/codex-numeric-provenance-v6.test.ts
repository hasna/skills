import { expect, test } from "bun:test";
import { codexNumericProvenance, embedCodexNumericTokens, codexIntegerToken } from "./codex-numeric-provenance-v6.js";
const capture = (text: string) => {
  const config = Bun.TOML.parse(text), tokens = codexNumericProvenance(text, config);
  return { tokens, config: embedCodexNumericTokens(config, tokens) };
};
test("V6 attributes exact numeric kind/value independently of TOML structure", () => {
  const table = capture("[outer]\nvalue = 10.50\n");
  expect(capture("outer.value = 1.05e1\n").config).toEqual(table.config);
  expect(capture("outer = {value = 10.5}\n").config).toEqual(table.config);
  expect(capture("value = 1\n").config).not.toEqual(capture("value = 1.0\n").config);
  expect(capture("value = 9007199254740991.1\n").config).not.toEqual(capture("value = 9007199254740991.2\n").config);
  expect(capture("value = -0.0\n").config).not.toEqual(capture("value = 0.0\n").config);
  expect(capture("value = -0\n").config).not.toEqual(capture("value = 0\n").config);
  expect(capture("value = 0x10\n").config).toEqual(capture("value = 16\n").config);
});
test("V6 distinguishes native integer fields, numeric keys, arrays and datetime values", () => {
  for (const field of ["mcp_servers.provider.tools.activate.output_token_limit", "tui.model_availability_nux.model"]) {
    const integer = capture(`${field} = 1\n`), float = capture(`${field} = 1.0\n`);
    expect(codexIntegerToken(integer.tokens, field.split("."))).toBe(true);
    expect(codexIntegerToken(float.tokens, field.split("."))).toBe(false);
  }
  const actualHook = capture('hooks.SessionStart = [{hooks = [{type = "command", command = "synthetic", timeout = 1}]}]\n');
  expect(codexIntegerToken(actualHook.tokens, ["hooks", "SessionStart", 0, "hooks", 0, "timeout"])).toBe(true);
  const keyed = capture('"1" = [1, 2.0]\n');
  expect(keyed.tokens.size).toBe(2);
  expect(codexIntegerToken(keyed.tokens, ["1", 0])).toBe(true);
  expect(capture("1 = [1, 2.0]\n").config).toEqual(keyed.config);
  // The pinned parser refuses this native-valid date spelling. V6 does not
  // reinterpret it as text or invent a separate TOML implementation.
  expect(() => capture("date = 1979-05-27T07:32:00Z\n")).toThrow();
});
test("V6 skips numeric lookalikes in comments and every string form", () => {
  const text = `# 1.0 123\na = "1.0"\nb = '123'\nc = """\n1.0 # 12\n"""\nd = '''\n2.0\n'''\nvalue = 3\n`;
  expect(capture(text).tokens.size).toBe(1);
  expect(() => capture('value = 1\n# __hasna_v6_numeric_attribution__\n')).toThrow();
});
test("V6 refuses nonfinite, unsafe integer and unbounded parser work", () => {
  for (const value of ["nan", "inf", "-inf", "9007199254740993"]) expect(() => capture(`value = ${value}\n`)).toThrow();
  const many = Array.from({ length: 100 }, (_, index) => `v${index} = ${index}\n`).join("") + `padding = "${"x".repeat(180000)}"\n`;
  expect(() => capture(many)).toThrow();
});
