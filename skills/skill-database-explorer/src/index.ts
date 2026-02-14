#!/usr/bin/env bun
import postgres from "postgres";

const args = process.argv.slice(2);

if (args.includes("-h") || args.includes("--help")) {
  console.log(`
skill-database-explorer - Explore PostgreSQL databases with read-only queries

Usage:
  skills run database-explorer -- connection=<url> action=<action> [options]

Options:
  -h, --help           Show this help message
  connection=<url>     PostgreSQL connection string (required)
  action=<action>      Action to perform: list-tables | describe-table | query
  table=<name>         Table name (for describe-table action)
  sql=<query>          SQL query (for query action, read-only only)

Actions:
  list-tables          List all tables in the public schema
  describe-table       Show columns for a specific table
  query                Execute a read-only SQL query (SELECT/WITH/VALUES only)

Examples:
  skills run database-explorer -- connection=postgres://user:pass@host/db action=list-tables
  skills run database-explorer -- connection=postgres://user:pass@host/db action=describe-table table=users
  skills run database-explorer -- connection=postgres://user:pass@host/db action=query sql="SELECT * FROM users LIMIT 10"
`);
  process.exit(0);
}

const connectionArg = args.find(a => a.startsWith("connection="))?.split("=")[1];
const actionArg = args.find(a => a.startsWith("action="))?.split("=")[1];
const tableArg = args.find(a => a.startsWith("table="))?.split("=")[1];
const sqlArg = args.find(a => a.startsWith("sql="))?.split("=")[1];

if (!connectionArg) {
  console.error("Error: connection string is required (connection=postgres://...)");
  process.exit(1);
}

const sql = postgres(connectionArg);

async function main() {
  try {
    switch (actionArg) {
      case "list-tables":
        const tables = await sql`
          SELECT table_name 
          FROM information_schema.tables 
          WHERE table_schema = 'public'
        `;
        console.log(JSON.stringify(tables, null, 2));
        break;

      case "describe-table":
        if (!tableArg) {
          console.error("Error: table is required for describe-table");
          process.exit(1);
        }
        const columns = await sql`
          SELECT column_name, data_type, is_nullable
          FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = ${tableArg}
        `;
        console.log(JSON.stringify(columns, null, 2));
        break;

      case "query":
        if (!sqlArg) {
          console.error("Error: sql is required for query");
          process.exit(1);
        }
        // Basic safety check for read-only
        if (!/^\s*(SELECT|WITH|VALUES)/i.test(sqlArg)) {
          console.error("Error: Only read-only queries (SELECT, WITH, VALUES) are allowed.");
          process.exit(1);
        }
        const result = await sql.unsafe(sqlArg);
        console.log(JSON.stringify(result, null, 2));
        break;

      default:
        console.log("Usage: skills run database-explorer -- connection=... action=<list-tables|describe-table|query> [table=...] [sql=...]");
    }
  } catch (error: any) {
    console.error("Database Error:", error.message);
    process.exit(1);
  } finally {
    await sql.end();
  }
}

main();
