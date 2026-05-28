# service-invoicegenerate

Invoice generator CLI using local storage or API.

## Tech Stack

- Runtime: Bun
- Language: TypeScript
- CLI: Commander.js

## CLI

```bash
service-invoicegenerate companies create --name "Company" --vat "DE123"
service-invoicegenerate companies list
service-invoicegenerate generate --issuer <id> --client <id> -d "Services" -a 1000
service-invoicegenerate quick --from "Issuer" --to "Client" -d "Work" -a 500
service-invoicegenerate invoices list
service-invoicegenerate config show
```

## Environment

- `API_BASE_URL` - Optional API endpoint for full features

## Legacy Backend

The full Python/Docker backend is in `legacy/`. Start with:
```bash
cd legacy && docker-compose up -d
```
