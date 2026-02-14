#!/usr/bin/env bun
import { createTables, dropTables } from "../src/db/schema";
import { getDb, closeConnection } from "../src/db/index";

async function main() {
  const args = process.argv.slice(2);

  if (args.includes("--drop")) {
    console.log("Dropping tables...");
    await dropTables();
    console.log("✓ Tables dropped");
  }

  console.log("Creating tables...");
  getDb();
  await createTables();
  console.log("✓ Tables created");

  await closeConnection();
  console.log("✓ Migration complete");
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
