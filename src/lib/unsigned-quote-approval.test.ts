import { describe, expect, test } from "bun:test";
import {
  createUnsignedQuoteApprovalBinding,
  createUnsignedQuoteApprovalFingerprint,
  isUnsignedQuoteApprovalFingerprint,
} from "./unsigned-quote-approval.js";

const creditQuote = {
  tier: "premium",
  creditUnit: "run",
  credits: 7,
  formattedCredits: "7 credits/run",
  estimated: false,
  quoteDependsOnInput: false,
  quoteRequired: false,
  description: "Test quote.",
};

describe("unsigned quote approval fingerprint", () => {
  test("is deterministic across object-key order while binding request and approval fields", () => {
    const first = createUnsignedQuoteApprovalFingerprint({
      skill: "logo-design",
      operation: "run",
      input: { prompt: "mark", options: { format: "svg", count: 1 } },
      args: ["--format", "svg"],
      remoteQuote: {
        skill: "logo-design",
        operation: "run",
        constraints: { region: "eu", maxOutputs: 1 },
        creditQuote,
      },
    });
    const reordered = createUnsignedQuoteApprovalFingerprint({
      skill: "logo-design",
      operation: "run",
      input: { options: { count: 1, format: "svg" }, prompt: "mark" },
      args: ["--format", "svg"],
      remoteQuote: {
        creditQuote: { ...creditQuote },
        constraints: { maxOutputs: 1, region: "eu" },
        operation: "run",
        skill: "logo-design",
      },
    });

    expect(first).toBe(reordered);
    expect(isUnsignedQuoteApprovalFingerprint(first)).toBe(true);
  });

  test("changes for every approval-relevant request or quote field", () => {
    const base = {
      skill: "logo-design",
      operation: "run" as const,
      input: { prompt: "mark" },
      args: ["--format", "svg"],
      remoteQuote: {
        skill: "logo-design",
        operation: "run",
        constraints: { maxOutputs: 1 },
        expiresAt: "2026-07-22T12:00:00.000Z",
        creditQuote,
      },
    };
    const fingerprint = createUnsignedQuoteApprovalFingerprint(base);
    const mutations = [
      { ...base, input: { prompt: "different" } },
      { ...base, args: ["--format", "png"] },
      { ...base, remoteQuote: { ...base.remoteQuote, constraints: { maxOutputs: 2 } } },
      { ...base, remoteQuote: { ...base.remoteQuote, expiresAt: "2026-07-22T13:00:00.000Z" } },
      {
        ...base,
        remoteQuote: {
          ...base.remoteQuote,
          creditQuote: { ...creditQuote, creditUnit: "image", formattedCredits: "7 credits/image" },
        },
      },
    ];

    for (const mutation of mutations) {
      expect(createUnsignedQuoteApprovalFingerprint(mutation)).not.toBe(fingerprint);
    }
  });

  test("rejects a quote that names a different skill or operation", () => {
    expect(() => createUnsignedQuoteApprovalBinding({
      skill: "logo-design",
      operation: "run",
      input: {},
      args: [],
      remoteQuote: { skill: "image", creditQuote },
    })).toThrow("does not match requested skill");
    expect(() => createUnsignedQuoteApprovalBinding({
      skill: "logo-design",
      operation: "run",
      input: {},
      args: [],
      remoteQuote: { operation: "batch", creditQuote },
    })).toThrow("does not match requested operation");
  });
});
