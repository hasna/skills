#!/usr/bin/env bun

import { sql, testConnection, closeConnection } from '../src/db';

console.log('Running database migrations...');

const connected = await testConnection();
if (!connected) {
  console.error('Failed to connect to database');
  process.exit(1);
}

console.log('Database connected\n');

try {
  console.log('Creating tables...');
  await sql`
    CREATE TABLE IF NOT EXISTS items (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      description TEXT,
      metadata JSONB DEFAULT '{}',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `;

  console.log('Creating indexes...');
  await sql`CREATE INDEX IF NOT EXISTS idx_items_name ON items(name)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_items_created_at ON items(created_at DESC)`;

  console.log('Creating triggers...');
  await sql`
    CREATE OR REPLACE FUNCTION update_updated_at_column()
    RETURNS TRIGGER AS $$
    BEGIN
      NEW.updated_at = CURRENT_TIMESTAMP;
      RETURN NEW;
    END;
    $$ language 'plpgsql'
  `;

  await sql`DROP TRIGGER IF EXISTS update_items_updated_at ON items`;
  await sql`
    CREATE TRIGGER update_items_updated_at
    BEFORE UPDATE ON items
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column()
  `;

  console.log('\nMigrations completed successfully');
} catch (error) {
  console.error('\nMigration failed:', error);
  process.exit(1);
} finally {
  await closeConnection();
}
