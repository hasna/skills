# Human Approval Model

skills.md lets agents request actions, but tenant policy and humans authorize
paid, sensitive, destructive, or externally visible effects.

## Approval Triggers

An approval is required when an action matches any trigger:

- Paid execution above tenant auto-approve limits.
- Checkout, Payment Link, credit purchase, subscription change, or refund.
- Connector action that writes, sends, deletes, purchases, publishes, or invites.
- Skill execution with a sensitive runtime profile.
- First run of a newly pinned paid or unmoderated skill.
- Spend limit override, quota override, or policy exception.
- Admin moderation approval, rejection, suspension, or public publish.

Read-only, free, low-risk actions can be auto-approved by policy, but the server
must still create audit events for them.

## Approval Request

CLI, MCP, web, or API clients create approval requests through the backend. They
do not mark approvals complete locally.

Required fields:

- `tenant_id`, `requested_by_user_id`, `requested_by_agent_id`.
- `action_type`: execution, billing, connector, moderation, policy_override.
- `resource_type` and `resource_id`.
- `idempotency_key`.
- `summary`: short human-readable reason.
- `risk_level`: low, medium, high, critical.
- `amount_cents`, `currency`, and `credits` when money or credits are involved.
- `expires_at`.
- `metadata`: structured action-specific context.

The API response returns `approval_id`, `status`, `approval_url`,
`expires_at`, and the pending action reference.

## Human Decision Paths

Humans can decide approvals from:

- Browser approval page.
- Email magic link.
- Authenticated dashboard notification.
- Future mobile or chat notification, if backed by the same API.

Every decision path calls the same backend endpoint. The endpoint verifies the
approver belongs to the tenant and has permission for the action.

## States

Approval status values:

- `pending`: waiting for human decision.
- `approved`: authorized and not yet consumed.
- `rejected`: explicitly denied.
- `expired`: deadline passed.
- `cancelled`: requester or system cancelled before decision.
- `consumed`: approved action has used this approval.
- `superseded`: replaced by a newer approval request.

Approvals are single-use unless a future policy explicitly creates a reusable
grant. Workers must atomically consume approval records before performing
side effects.

## Expiration

Default expiration:

- Billing and payment actions: 15 minutes.
- Connector write actions: 30 minutes.
- Skill execution approvals: 1 hour.
- Moderation decisions: 7 days.

Expired approvals cannot be consumed. Clients must request a new approval with a
new idempotency key or reuse an existing pending approval for the same key.

## Agent UX

When an agent requests approval:

- CLI prints structured JSON and a concise browser URL.
- MCP returns structured JSON with `approval_id`, `approval_url`, and
  `poll_after_ms`.
- API returns HTTP 202 for pending approval flows.
- The agent can poll approval status or subscribe to future event streams.

Agents should explain the exact action, cost, connector target, and expiration.
They should not ask users to approve vague actions.

## Billing And Idempotency

Approval and billing must be tied together:

- Billing actions require idempotency keys.
- Credits are reserved only after approval, unless policy allows pre-approval
  holds.
- Workers re-check approval status, tenant policy, and spend limits before
  running paid effects.
- Rejected, expired, or cancelled approvals must not debit credits.
- Failed executions with automatic refund policy create a ledger reversal.

## Audit Trail

Every approval creates immutable audit events:

- Requested.
- Notified.
- Viewed.
- Approved, rejected, expired, cancelled, consumed, or superseded.
- Worker consumption attempt.
- Billing ledger mutation, when applicable.

Audit events include actor, tenant, IP/user agent where available, request id,
idempotency key, old status, new status, and timestamp.

## Security Rules

- Approval URLs must be unguessable and short-lived.
- Email approval links must bind to the intended tenant and approver.
- Approval pages must show amount, skill, connector, requested actor, and
  resulting side effect.
- Critical actions require authenticated approval, not only email link access.
- Approvers cannot approve their own high-risk request unless policy allows it.
- Server state, not client claims, decides whether an approval is valid.
