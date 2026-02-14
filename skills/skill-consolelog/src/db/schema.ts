import { sql } from "./index";

export async function createTables(): Promise<void> {
  // Apps table
  await sql`
    CREATE TABLE IF NOT EXISTS apps (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      port INTEGER NOT NULL,
      base_url TEXT NOT NULL,
      description TEXT,
      active BOOLEAN DEFAULT true,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `;

  // Pages table
  await sql`
    CREATE TABLE IF NOT EXISTS pages (
      id SERIAL PRIMARY KEY,
      app_id INTEGER NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
      path TEXT NOT NULL,
      name TEXT,
      wait_for TEXT,
      timeout INTEGER DEFAULT 30000,
      active BOOLEAN DEFAULT true,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(app_id, path)
    )
  `;

  // Scans table
  await sql`
    CREATE TABLE IF NOT EXISTS scans (
      id SERIAL PRIMARY KEY,
      app_id INTEGER NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
      started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      completed_at TIMESTAMP,
      status TEXT DEFAULT 'running',
      pages_scanned INTEGER DEFAULT 0,
      errors_found INTEGER DEFAULT 0
    )
  `;

  // Console logs table
  await sql`
    CREATE TABLE IF NOT EXISTS console_logs (
      id SERIAL PRIMARY KEY,
      scan_id INTEGER NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
      page_id INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
      level TEXT NOT NULL,
      message TEXT NOT NULL,
      source_url TEXT,
      line_number INTEGER,
      column_number INTEGER,
      stack_trace TEXT,
      timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `;

  // Screenshots table
  await sql`
    CREATE TABLE IF NOT EXISTS screenshots (
      id SERIAL PRIMARY KEY,
      scan_id INTEGER NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
      page_id INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
      filename TEXT NOT NULL,
      filepath TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `;

  // Create indexes
  await sql`CREATE INDEX IF NOT EXISTS idx_console_logs_scan ON console_logs(scan_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_console_logs_level ON console_logs(level)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_console_logs_timestamp ON console_logs(timestamp DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_scans_app_id ON scans(app_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_pages_app_id ON pages(app_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_screenshots_scan_id ON screenshots(scan_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_screenshots_page_id ON screenshots(page_id)`;

  console.log("Database tables created successfully");
}

export async function dropTables(): Promise<void> {
  await sql`DROP TABLE IF EXISTS screenshots CASCADE`;
  await sql`DROP TABLE IF EXISTS console_logs CASCADE`;
  await sql`DROP TABLE IF EXISTS scans CASCADE`;
  await sql`DROP TABLE IF EXISTS pages CASCADE`;
  await sql`DROP TABLE IF EXISTS apps CASCADE`;
  console.log("Database tables dropped");
}
