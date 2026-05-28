#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: scripts/test_database_migrations.sh [--keep-db] [database_name]

Creates a temporary local PostgreSQL database, applies every SQL migration in
the drizzle/ directory in order, verifies the expected platform tables exist,
and drops the database unless --keep-db is passed.

Connection options are inherited from standard PostgreSQL environment variables
such as PGHOST, PGPORT, PGUSER, and PGPASSWORD.
USAGE
}

KEEP_DB=0
DB_NAME=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --help|-h)
      usage
      exit 0
      ;;
    --keep-db)
      KEEP_DB=1
      shift
      ;;
    *)
      if [[ -n "$DB_NAME" ]]; then
        echo "Unexpected argument: $1" >&2
        usage >&2
        exit 2
      fi
      DB_NAME="$1"
      shift
      ;;
  esac
done

if [[ -z "$DB_NAME" ]]; then
  DB_NAME="platform_skills_migration_test_$(date +%s)_$$"
fi

for command in createdb dropdb psql; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "Missing required command: $command" >&2
    exit 1
  fi
done

MIGRATIONS_DIR="drizzle"
if [[ ! -d "$MIGRATIONS_DIR" ]]; then
  echo "Missing migrations directory: $MIGRATIONS_DIR" >&2
  exit 1
fi

shopt -s nullglob
MIGRATIONS=("$MIGRATIONS_DIR"/*.sql)
shopt -u nullglob

if [[ ${#MIGRATIONS[@]} -eq 0 ]]; then
  echo "No SQL migrations found in $MIGRATIONS_DIR" >&2
  exit 1
fi

EXPECTED_TABLES=(
  agent_mcp_registrations
  approval_decisions
  approval_events
  approval_requests
  billing_customers
  credit_balances
  credit_transactions
  invoices
  organizations
  payment_events
  pin_events
  run_artifacts
  run_events
  run_logs
  run_steps
  skill_aliases
  skill_artifacts
  skill_entitlements
  skill_pins
  skill_runs
  skill_sources
  skill_versions
  skills
  subscriptions
)

RLS_PROTECTED_TABLES=(
  agent_mcp_registrations
  approval_decisions
  approval_events
  approval_requests
  billing_customers
  credit_balances
  credit_transactions
  invoices
  organizations
  payment_events
  pin_events
  run_artifacts
  run_events
  run_logs
  run_steps
  sessions
  skill_entitlements
  skill_pins
  skill_runs
  api_keys
  users
  subscriptions
)

cleanup() {
  if [[ "$KEEP_DB" -eq 0 ]]; then
    dropdb --if-exists "$DB_NAME" >/dev/null 2>&1 || true
  else
    echo "Kept database: $DB_NAME"
  fi
}
trap cleanup EXIT

createdb "$DB_NAME"

for migration in "${MIGRATIONS[@]}"; do
  psql -d "$DB_NAME" -v ON_ERROR_STOP=1 -f "$migration" >/dev/null
done

EXPECTED_SQL_LIST=""
for table in "${EXPECTED_TABLES[@]}"; do
  if [[ -n "$EXPECTED_SQL_LIST" ]]; then
    EXPECTED_SQL_LIST+=","
  fi
  EXPECTED_SQL_LIST+="'$table'"
done

actual_count="$(
  psql -d "$DB_NAME" -v ON_ERROR_STOP=1 -Atc \
    "select count(*) from information_schema.tables where table_schema = 'public' and table_name in ($EXPECTED_SQL_LIST);"
)"

expected_count="${#EXPECTED_TABLES[@]}"
if [[ "$actual_count" != "$expected_count" ]]; then
  echo "Expected $expected_count platform tables, found $actual_count" >&2
  psql -d "$DB_NAME" -v ON_ERROR_STOP=1 -Atc \
    "select table_name from information_schema.tables where table_schema = 'public' order by table_name;" >&2
  exit 1
fi

RLS_SQL_LIST=""
for table in "${RLS_PROTECTED_TABLES[@]}"; do
  if [[ -n "$RLS_SQL_LIST" ]]; then
    RLS_SQL_LIST+=","
  fi
  RLS_SQL_LIST+="'$table'"
done

rls_count="$(
  psql -d "$DB_NAME" -v ON_ERROR_STOP=1 -Atc \
    "select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity = true and c.relname in ($RLS_SQL_LIST);"
)"

rls_expected_count="${#RLS_PROTECTED_TABLES[@]}"
if [[ "$rls_count" != "$rls_expected_count" ]]; then
  echo "Expected RLS on $rls_expected_count platform tables, found $rls_count" >&2
  psql -d "$DB_NAME" -v ON_ERROR_STOP=1 -Atc \
    "select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and c.relname in ($RLS_SQL_LIST) and c.relrowsecurity = false order by c.relname;" >&2
  exit 1
fi

forced_rls_count="$(
  psql -d "$DB_NAME" -v ON_ERROR_STOP=1 -Atc \
    "select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and c.relforcerowsecurity = true and c.relname in ($RLS_SQL_LIST);"
)"

if [[ "$forced_rls_count" != "$rls_expected_count" ]]; then
  echo "Expected forced RLS on $rls_expected_count platform tables, found $forced_rls_count" >&2
  psql -d "$DB_NAME" -v ON_ERROR_STOP=1 -Atc \
    "select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and c.relname in ($RLS_SQL_LIST) and c.relforcerowsecurity = false order by c.relname;" >&2
  exit 1
fi

policy_count="$(
  psql -d "$DB_NAME" -v ON_ERROR_STOP=1 -Atc \
    "select count(*) from pg_policies where schemaname = 'public' and policyname = 'org_isolation' and tablename in ($RLS_SQL_LIST);"
)"

if [[ "$policy_count" != "$rls_expected_count" ]]; then
  echo "Expected org_isolation RLS policies on $rls_expected_count platform tables, found $policy_count" >&2
  psql -d "$DB_NAME" -v ON_ERROR_STOP=1 -Atc \
    "select unnest(array[$RLS_SQL_LIST]) except select tablename from pg_policies where schemaname = 'public' and policyname = 'org_isolation' and tablename in ($RLS_SQL_LIST) order by 1;" >&2
  exit 1
fi

echo "Applied ${#MIGRATIONS[@]} migrations to $DB_NAME and verified $actual_count tables plus $rls_count forced RLS policies."
