import { expect, test } from "bun:test";
import { useDefaultTestTimeout } from "../test-preload.js";
import { inspectSchemaCensus } from "./schema-census.js";
useDefaultTestTimeout();

test("census refuses non-PostgreSQL and targetless URLs before connecting", async () => {
  for (const value of ["", "memory:", "file:fixture.db", "sqlite://fixture.db", "https://example.invalid", "postgres:", "postgresql:"]) {
    await expect(inspectSchemaCensus(value)).rejects.toMatchObject({
      name: "SchemaCensusError",
      code: "CENSUS_POSTGRES_REQUIRED",
      message: "CENSUS_POSTGRES_REQUIRED",
    });
  }
});
