import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  validateLivePublicContract,
  type LivePublicContractProof,
} from "./live-public-contract";

const fixturePath = join(import.meta.dir, "fixtures/live-public-contract-proof.v1.json");
const expectation = {
  platformSha: "0123456789abcdef0123456789abcdef01234567",
  platformVersion: "0.1.46",
  deploymentId: "deploy_fixture_20260722_001",
  clientPin: "0.2.0",
};

describe("live public contract promotion proof", () => {
  test("accepts the live-shaped nested catalog, detail, quote, run, and usage fixture", () => {
    expect(() => validateLivePublicContract(fixture(), expectation)).not.toThrow();
  });

  test("requires a non-vacuous provider-free one-credit run and linked usage proof", () => {
    for (const field of ["runs", "usage"] as const) {
      const empty = fixture();
      empty[field] = field === "runs" ? { runs: [] } : { transactions: [] };
      expect(() => validateLivePublicContract(empty, expectation)).toThrow(
        field === "runs" ? "live promotion run proof is missing" : "live promotion usage proof is missing",
      );
    }

    const wrongRun = fixture();
    const run = (wrongRun.runs as { runs: Array<Record<string, unknown>> }).runs[0]!;
    run.creditsUsed = 2;
    expect(() => validateLivePublicContract(wrongRun, expectation)).toThrow(
      "live provider-free promotion run proof is missing",
    );

    const unlinkedUsage = fixture();
    const usage = (unlinkedUsage.usage as { transactions: Array<Record<string, unknown>> }).transactions[0]!;
    usage.runId = "run_unlinked";
    expect(() => validateLivePublicContract(unlinkedUsage, expectation)).toThrow(
      "live provider-free promotion usage proof is missing",
    );

    const malformedUsage = fixture();
    const malformed = (malformedUsage.usage as { transactions: Array<Record<string, unknown>> }).transactions[0]!;
    malformed.transactionType = "provider_debit";
    expect(() => validateLivePublicContract(malformedUsage, expectation)).toThrow(
      "usage[0].transactionType is invalid",
    );
  });

  test("rejects arbitrary endpoint prose and nested unsupported metadata", () => {
    const hostileDescription = fixture();
    (hostileDescription.catalog as Array<Record<string, unknown>>)[0]!.description = "GPT4o routed by Claude3Opus";
    expect(() => validateLivePublicContract(hostileDescription, expectation)).toThrow(
      "catalog[0].description must use canonical customer metadata",
    );

    const hostileNestedKey = fixture();
    const quote = (hostileNestedKey.quote as { quote: Record<string, unknown> }).quote;
    const requirement = (quote.connectorRequirements as Array<Record<string, unknown>>)[0]!;
    requirement.providerRoute = "Gemini2.5";
    expect(() => validateLivePublicContract(hostileNestedKey, expectation)).toThrow(
      "quote.connectorRequirements[0] exposes an unsupported key: providerRoute",
    );

    const invalidKnownEnum = fixture();
    (invalidKnownEnum.catalog as Array<Record<string, unknown>>)[0]!.billingMode = "provider_metered";
    expect(() => validateLivePublicContract(invalidKnownEnum, expectation)).toThrow(
      "catalog[0].billingMode is invalid",
    );

    const invalidNestedValue = fixture();
    const invalidQuote = (invalidNestedValue.quote as { quote: Record<string, unknown> }).quote;
    const invalidRequirement = (invalidQuote.connectorRequirements as Array<Record<string, unknown>>)[0]!;
    invalidRequirement.scopes = ["GPT4o:read"];
    expect(() => validateLivePublicContract(invalidNestedValue, expectation)).toThrow(
      "quote.connectorRequirements[0] is incomplete or invalid",
    );

    const incompleteRequirement = fixture();
    const incompleteQuote = (incompleteRequirement.quote as { quote: Record<string, unknown> }).quote;
    incompleteQuote.connectorRequirements = [{ connector: "linear" }];
    expect(() => validateLivePublicContract(incompleteRequirement, expectation)).toThrow(
      "quote.connectorRequirements[0].scopes is required",
    );

    const contradictoryPreflight = fixture();
    const contradictoryQuote = (contradictoryPreflight.quote as { quote: Record<string, unknown> }).quote;
    const preflight = (contradictoryQuote.connectorPreflight as Array<Record<string, unknown>>)[0]!;
    preflight.status = "ready";
    preflight.connected = false;
    preflight.requiresAuth = false;
    preflight.reason = null;
    expect(() => validateLivePublicContract(contradictoryPreflight, expectation)).toThrow(
      "quote.connectorPreflight[0].missingScopes must be empty when status is ready",
    );

    const contradictoryAvailability = fixture();
    const availabilityQuote = (contradictoryAvailability.quote as { quote: Record<string, unknown> }).quote;
    availabilityQuote.availability = { status: "available", code: "AUTH_REQUIRED" };
    expect(() => validateLivePublicContract(contradictoryAvailability, expectation)).toThrow(
      "quote.availability.code is inconsistent with available status",
    );

    const contradictoryQuoteCode = fixture();
    const codedQuote = (contradictoryQuoteCode.quote as { quote: Record<string, unknown> }).quote;
    codedQuote.code = "AUTH_REQUIRED";
    expect(() => validateLivePublicContract(contradictoryQuoteCode, expectation)).toThrow(
      "quote success must not include error, detail, or code",
    );

    const quoteWithFailureText = fixture();
    const successfulQuote = (quoteWithFailureText.quote as { quote: Record<string, unknown> }).quote;
    successfulQuote.error = "The Skills service could not provide a quote.";
    expect(() => validateLivePublicContract(quoteWithFailureText, expectation)).toThrow(
      "quote success must not include error, detail, or code",
    );

    const quoteWithMismatchedConnectors = fixture();
    const mismatchedQuote = (quoteWithMismatchedConnectors.quote as { quote: Record<string, unknown> }).quote;
    const mismatchedPreflight = (mismatchedQuote.connectorPreflight as Array<Record<string, unknown>>)[0]!;
    mismatchedPreflight.operations = ["issues.list"];
    expect(() => validateLivePublicContract(quoteWithMismatchedConnectors, expectation)).toThrow(
      "quote connector requirements and preflight do not match",
    );

    const quoteWithContradictoryCredits = fixture();
    const contradictoryCredits = (quoteWithContradictoryCredits.quote as { quote: Record<string, unknown> }).quote;
    (contradictoryCredits.creditQuote as Record<string, unknown>).formattedCredits = "1 credit/image";
    expect(() => validateLivePublicContract(quoteWithContradictoryCredits, expectation)).toThrow(
      "formattedCredits does not match",
    );

    const quoteWithEmptyMissingScopes = fixture();
    const emptyScopesQuote = (quoteWithEmptyMissingScopes.quote as { quote: Record<string, unknown> }).quote;
    const emptyScopesPreflight = (emptyScopesQuote.connectorPreflight as Array<Record<string, unknown>>)[0]!;
    emptyScopesPreflight.status = "insufficient_scope";
    emptyScopesPreflight.missingScopes = [];
    emptyScopesPreflight.reason = "Connector account is missing required scopes.";
    expect(() => validateLivePublicContract(quoteWithEmptyMissingScopes, expectation)).toThrow(
      "missingScopes must identify at least one required scope",
    );

    const malformedToolDependencies = fixture();
    const malformedDependencyQuote = (malformedToolDependencies.quote as { quote: Record<string, unknown> }).quote;
    malformedDependencyQuote.toolDependencies = {};
    expect(() => validateLivePublicContract(malformedToolDependencies, expectation)).toThrow(
      "quote.toolDependencies does not match the package-owned dependency taxonomy",
    );

    const arbitraryRunMessage = fixture();
    const run = (arbitraryRunMessage.runs as { runs: Array<Record<string, unknown>> }).runs[0]!;
    run.status = "failed";
    run.errorMessage = "Claude3Opus route failed";
    expect(() => validateLivePublicContract(arbitraryRunMessage, expectation)).toThrow(
      "runs[0] must use the canonical public run contract",
    );
  });

  test("requires canonical usage descriptions derived from typed credit activity", () => {
    const legitimate = fixture();
    const legitimateUsage = (legitimate.usage as { transactions: Array<Record<string, unknown>> }).transactions[0]!;
    legitimateUsage.description = "Build route lists for financial modeling";
    expect(() => validateLivePublicContract(legitimate, expectation)).toThrow(
      "usage[0].description must use the public credit activity taxonomy",
    );

    const hostile = fixture();
    const hostileUsage = (hostile.usage as { transactions: Array<Record<string, unknown>> }).transactions[0]!;
    hostileUsage.description = "Executed with Replicate and DeepSeek";
    expect(() => validateLivePublicContract(hostile, expectation)).toThrow(
      "usage[0].description must use the public credit activity taxonomy",
    );
  });

  test("binds promotion proof to the exact live commit, platform version, and client pin", () => {
    const wrongSha = fixture();
    (wrongSha.health as Record<string, unknown>).commitSha = "f".repeat(40);
    expect(() => validateLivePublicContract(wrongSha, expectation)).toThrow("live health commit SHA mismatch");

    const wrongDeployment = fixture();
    (wrongDeployment.health as Record<string, unknown>).deploymentId = "deploy_other_20260722_002";
    expect(() => validateLivePublicContract(wrongDeployment, expectation)).toThrow("live health deployment ID mismatch");

    const wrongRunDeployment = fixture();
    const proofRun = (wrongRunDeployment.runs as { runs: Array<Record<string, unknown>> }).runs[0]!;
    (proofRun.releaseIdentity as Record<string, unknown>).deploymentId = "deploy_other_20260722_002";
    expect(() => validateLivePublicContract(wrongRunDeployment, expectation)).toThrow(
      "live provider-free promotion run proof is missing",
    );

    const providerMetadata = fixture();
    const providerProofRun = (providerMetadata.runs as { runs: Array<Record<string, unknown>> }).runs[0]!;
    (providerProofRun.releaseIdentity as Record<string, unknown>).providerDeploymentArn = "private-provider-arn";
    expect(() => validateLivePublicContract(providerMetadata, expectation)).toThrow(
      "runs[0].releaseIdentity exposes an unsupported key",
    );

    const wrongPin = fixture();
    const detail = (wrongPin.skill as { skill: Record<string, unknown> }).skill;
    detail.currentVersion = "0.1.58";
    expect(() => validateLivePublicContract(wrongPin, expectation)).toThrow(
      "live detail client pin mismatch",
    );
  });
});

function fixture(): LivePublicContractProof {
  return JSON.parse(readFileSync(fixturePath, "utf8")) as LivePublicContractProof;
}
