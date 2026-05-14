# AWS Deployment Target

`skills.md` deploys from `hasnatools/platform-skills` into the active
`hasna-tools` AWS account.

## Account

| Purpose | Account name | Account ID | Status |
| --- | --- | --- | --- |
| Deployment target | `hasna-tools` | `059898286899` | ACTIVE |

This was verified on 2026-05-09 with:

```bash
aws organizations list-accounts --profile hasna
```

Do not use these retired accounts for `skills.md` GitHub Actions deployment:

| Account name | Account ID | Status |
| --- | --- | --- |
| `hasnastudio` | `923625121869` | SUSPENDED |
| `hasnatools` | `322983839734` | SUSPENDED |

## Local Credential Profile

The local `hasnatools` AWS profile was refreshed on 2026-05-09 to assume:

```text
arn:aws:iam::059898286899:role/OrganizationAccountAccessRole
```

It uses `source_profile = hasna`, has no static `hasnatools` credential stanza
in `~/.aws/credentials`, and verifies with:

```bash
aws sts get-caller-identity --profile hasnatools
aws iam list-open-id-connect-providers --profile hasnatools
aws ecr describe-repositories --profile hasnatools --region us-east-1
```

## GitHub OIDC Roles

The platform follows the `platform-alumia` pattern of GitHub Actions assuming
AWS roles through GitHub OIDC, but uses only PR previews and production.
There is no dev or staging deployment environment.

Expected roles in account `059898286899`:

| Deployment mode | Role name | Trust subject |
| --- | --- | --- |
| PR preview | `tool-skillsmd-github-actions-preview` | `repo:hasnatools/platform-skills:pull_request` |
| Production | `tool-skillsmd-github-actions-production` | `repo:hasnatools/platform-skills:environment:production` |

Both roles must trust:

- OIDC provider: `https://token.actions.githubusercontent.com`
- Audience: `sts.amazonaws.com`
- Repository: `hasnatools/platform-skills`

Production workflows must also enforce either `refs/tags/v*` for release tags
or `refs/heads/main` for an explicit manual dispatch before assuming the
production role. Preview workflows must only assume the preview role from pull
request preview deployments.

The machine-readable contract lives in `deploy/aws-targets.json`; deployment
workflows and Terraform should consume or mirror that file.
