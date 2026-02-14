# service-invoicegenerate

Invoice generator CLI with local storage and API support.

## Features

- Generate invoices with local or API storage
- Manage companies (issuers and clients)
- List and view invoices
- Export invoices as JSON
- Download PDFs (requires API service)
- Quick invoice generation with auto-company creation

## Installation

```bash
bun install -g @hasnaxyz/service-invoicegenerate
```

## CLI

```bash
# Create companies
service-invoicegenerate companies create --name "My Company" --vat "DE123456789"
service-invoicegenerate companies create --name "Client Co" --email "client@example.com"
service-invoicegenerate companies list

# Generate invoices
service-invoicegenerate generate --issuer <id> --client <id> -d "Consulting Services" -a 5000
service-invoicegenerate generate --issuer <id> --client <id> -d "Project Work" -a 10000 --vat 19

# Quick invoice (auto-creates companies)
service-invoicegenerate quick --from "My Company" --to "Client Co" -d "Services" -a 1000

# Manage invoices
service-invoicegenerate invoices list
service-invoicegenerate invoices show INV-2024-0001
service-invoicegenerate invoices export INV-2024-0001 -o invoice.json

# Configuration
service-invoicegenerate config show
service-invoicegenerate config set defaultCurrency USD
service-invoicegenerate config test
```

## Storage Modes

### Local Mode (Default)
- Companies and invoices stored in `./data/` folder
- No external services required
- Perfect for simple invoice tracking

### API Mode (--api flag)
- Connects to running invoice generator API
- Full PDF generation support
- Database-backed storage

Start the API service:
```bash
cd legacy && docker-compose up -d
```

## Environment

- `API_BASE_URL` - API endpoint (default: http://localhost:8007/api/v1)
- `API_TIMEOUT` - Request timeout in ms (default: 30000)

## License

MIT License - Copyright (c) 2024 Hasna
