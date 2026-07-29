---
name: domainpurchase
description: Public contract for domain purchase workflows through hosted or external registrar connectors.
---

# Domain Purchase

This public skill describes domain purchase and management workflows for agents.
The OSS package intentionally does not ship registrar purchasing logic, remote
server proxy code, or cloud secret-store integration.

## Usage

```bash
skills run domainpurchase --help
```

For production domain purchase workflows, route execution through a hosted or
external connector that owns registrar credentials, audit logs, payment
approval, and account-specific policy.

## Boundary

- Local package: skill metadata, docs, and a CLI stub.
- Hosted or external connector: registrar API calls, credentials, approvals,
  purchase records, and billing-sensitive workflows.

Provider credentials and cloud secret names must not be stored in this OSS
skill package.
