# service-timesheetgenerate

A robust timesheet generator microservice for tracking employee hours, vacations, holidays, and generating reports. Designed for accounting firm submissions.

## Features

- **Multi-company support**: Track timesheets for multiple companies
- **Employee management**: Track employees with different statuses (active, maternity leave, etc.)
- **Holiday tracking**: Manage public holidays per company/country
- **Vacation management**: Track employee vacations and time off
- **Automatic generation**: Generate time entries automatically based on schedules
- **Export options**: Export to CSV or JSON format
- **Storage options**: Save locally or to AWS S3
- **Deduplication**: Prevents duplicate entries
- **API + CLI**: Both REST API and command-line interface

## AWS Resources

All AWS resources use a naming convention based on your project name, e.g. `prod-service-timesheetgenerate`

- **RDS**: PostgreSQL database
- **S3**: Timesheet exports bucket
- **EC2**: Application server (optional)

## Installation

```bash
# Install dependencies
bun install

# Set up environment
cp .env.example .env
# Edit .env with your database credentials

# Run migrations
bun run db:migrate

# Seed with sample data (optional)
bun run db:seed
```

## Usage

### Start the API Server

```bash
# Development (with hot reload)
bun run dev

# Production
bun run start
```

### CLI Commands

```bash
# Setup
bun run cli setup

# Company management
bun run cli company list
bun run cli company add -n "Acme Corp"

# Employee management
bun run cli employee list -c 1
bun run cli employee add -c 1 -n "John Doe" -s active -h 8
bun run cli employee update -i 1 -s on_leave_maternity

# Holiday management
bun run cli holiday add -c 1 -n "Christmas Day" -d 2025-12-25

# Vacation management
bun run cli vacation add -e 1 -s 2025-07-01 -n 2025-07-15 -t vacation

# Job management (scheduled entries)
bun run cli job list
bun run cli job add -e 1 -n "Daily Work" -h 8 --auto-monthly

# Generate time entries
bun run cli generate -c 1 -s 2025-12-01 -e 2025-12-31

# Preview timesheet
bun run cli preview -c 1 -s 2025-12-01 -e 2025-12-31 -f csv

# Export timesheet
bun run cli export create -c 1 -s 2025-12-01 -e 2025-12-31 -f csv --storage local
bun run cli export monthly -c 1 -y 2025 -m 12 -f csv --storage s3
bun run cli export list
```

### Run Scheduled Jobs

```bash
# Daily entries for today
bun run job:run daily

# Generate full month entries
bun run job:run monthly

# Auto-export for companies with auto-export enabled
bun run job:run export

# Run all jobs
bun run job:run all
```

## API Endpoints

### Companies
- `GET /api/companies` - List all companies
- `POST /api/companies` - Create a company
- `GET /api/companies/:id` - Get a company

### Employees
- `GET /api/employees?company_id=1` - List employees
- `POST /api/employees` - Create an employee
- `GET /api/employees/:id` - Get an employee
- `PATCH /api/employees/:id` - Update an employee

### Holidays
- `GET /api/holidays?company_id=1&start_date=2025-01-01&end_date=2025-12-31` - List holidays
- `POST /api/holidays` - Create a holiday

### Vacations
- `GET /api/vacations?employee_id=1&start_date=2025-01-01&end_date=2025-12-31` - List vacations
- `POST /api/vacations` - Create a vacation

### Time Entries
- `GET /api/time-entries?employee_id=1&start_date=2025-01-01&end_date=2025-12-31` - List time entries
- `POST /api/generate` - Generate time entries

### Timesheet
- `GET /api/timesheet?company_id=1&start_date=2025-01-01&end_date=2025-12-31&format=csv` - Get timesheet

### Exports
- `GET /api/exports` - List exports
- `POST /api/exports` - Create an export

### Jobs
- `GET /api/jobs` - List jobs
- `POST /api/jobs` - Create a job
- `PATCH /api/jobs/:id` - Update a job
- `DELETE /api/jobs/:id` - Delete a job

## CSV Output Format

The generated CSV matches the required format:

```csv
employee,employee_status,daily_hours,total_hours,2025-12-01,2025-12-02,...
Andrei Hasna,active,8,160,holiday: National Day,8,8,8,8,weekend,weekend,...
Diana Hasna,on_leave_maternity,8,0,holiday: National Day,0,0,0,0,weekend,weekend,...
```

Entry values:
- `8` (or any number): Hours worked
- `0`: No hours (for employees on leave)
- `weekend`: Weekend day
- `holiday: <name>`: Public holiday
- `vacation`: On vacation

## Employee Statuses

- `active`: Regular active employee
- `inactive`: Inactive employee
- `on_leave_maternity`: On maternity leave
- `on_leave_paternity`: On paternity leave
- `on_leave_sick`: On extended sick leave
- `terminated`: Employment terminated

## Local Storage

Exports are saved to `~/.service-timesheetgenerate/exports/` by default.

## Environment Variables

```bash
# Database
DB_HOST=localhost
DB_PORT=5432
DB_NAME=timesheetgenerate_db
DB_USER=postgres
DB_PASSWORD=postgres

# Or use connection string
DATABASE_URL=postgres://...

# Server
PORT=3000

# API authentication
API_KEY=your-api-key

# AWS (for S3 exports)
AWS_REGION=us-east-1
S3_BUCKET=your-s3-bucket-name
```

## Project Structure

```
.
├── bin/
│   └── cli.ts              # CLI entry point
├── src/
│   ├── lib/
│   │   ├── config.ts       # Configuration management
│   │   ├── export.ts       # Export functionality
│   │   ├── s3.ts           # S3 operations
│   │   ├── service-dir.ts  # Service directory management
│   │   └── timesheet.ts    # Core timesheet logic
│   ├── types/
│   │   └── index.ts        # TypeScript types
│   ├── jobs/
│   │   └── runner.ts       # Job scheduler
│   ├── db/
│   │   └── index.ts        # Database connection
│   └── server/
│       └── index.ts        # HTTP server
├── scripts/
│   ├── migrate.ts          # Database migrations
│   └── seed.ts             # Database seeding
├── .env.example            # Environment template
├── package.json            # Package configuration
├── tsconfig.json           # TypeScript config
└── README.md               # Documentation
```

## License

MIT

## Author

Hasna
