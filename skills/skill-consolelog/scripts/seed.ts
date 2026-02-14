#!/usr/bin/env bun
import { createTables } from "../src/db/schema";
import { getDb, closeConnection } from "../src/db/index";
import { createApp, createPage } from "../src/db/queries";

// Ensure tables exist
getDb();
createTables();

console.log("Seeding database...\n");

try {
  // Create a sample app
  const app = createApp({
    name: "sample-app",
    port: 3000,
    base_url: "http://localhost:3000",
    description: "Sample application for testing",
  });
  console.log(`✓ Created app: ${app.name} (ID: ${app.id})`);

  // Add sample pages
  const pages = [
    { path: "/", name: "Home" },
    { path: "/dashboard", name: "Dashboard" },
    { path: "/settings", name: "Settings" },
  ];

  for (const pageData of pages) {
    const page = createPage({
      app_id: app.id,
      path: pageData.path,
      name: pageData.name,
    });
    console.log(`  ✓ Added page: ${page.path}`);
  }

  console.log("\n✓ Seed complete");
} catch (error) {
  const err = error as Error;
  if (err.message.includes("UNIQUE constraint")) {
    console.log("⚠ Sample data already exists");
  } else {
    console.error("✗ Error:", err.message);
  }
}

closeConnection();
