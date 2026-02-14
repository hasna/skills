import postgres from "postgres";

const config = {
  host: process.env.DB_HOST || "localhost",
  port: parseInt(process.env.DB_PORT || "5432"),
  database: process.env.DB_NAME || "serviceconsolelog",
  username: process.env.DB_USER || "postgres",
  password: process.env.DB_PASSWORD || "",
};

// Connection options based on environment
const isProduction = process.env.DB_HOST?.includes("rds.amazonaws.com");

export const sql = postgres({
  host: config.host,
  port: config.port,
  database: config.database,
  username: config.username,
  password: config.password,
  ssl: isProduction ? "require" : false,
  max: 10,
  idle_timeout: 20,
  connect_timeout: 10,
});

export function getDb() {
  return sql;
}

export async function testConnection(): Promise<boolean> {
  try {
    await sql`SELECT 1`;
    return true;
  } catch (error) {
    console.error("Database connection failed:", error);
    return false;
  }
}

export async function closeConnection(): Promise<void> {
  await sql.end();
}

export { sql as db };
