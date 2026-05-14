#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: scripts/bootstrap_github_oidc_roles.sh [--profile <profile>] [--region <region>]

Creates or updates GitHub Actions OIDC roles for skills.md:
- tool-skillsmd-github-actions-preview for pull_request preview deployments
- tool-skillsmd-github-actions-production for tag-gated production deployments

The preview role is limited to preview cluster/service, ECR push, preview ALB
rules/target groups, per-preview secrets, and ECS PassRole.
USAGE
}

PROFILE="hasnatools"
REGION="us-east-1"
EXPECTED_ACCOUNT_ID="059898286899"
OIDC_URL="https://token.actions.githubusercontent.com"
OIDC_HOST="token.actions.githubusercontent.com"
AUDIENCE="sts.amazonaws.com"
REPOSITORY="hasnatools/platform-skills"
PREVIEW_ROLE="tool-skillsmd-github-actions-preview"
PRODUCTION_ROLE="tool-skillsmd-github-actions-production"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --help|-h)
      usage
      exit 0
      ;;
    --profile)
      PROFILE="${2:-}"
      shift 2
      ;;
    --region)
      REGION="${2:-}"
      shift 2
      ;;
    *)
      echo "Unexpected argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [[ -z "$PROFILE" || -z "$REGION" ]]; then
  echo "Profile and region must not be empty." >&2
  exit 2
fi

for command in aws mktemp; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "Missing required command: $command" >&2
    exit 1
  fi
done

actual_account_id="$(aws sts get-caller-identity --profile "$PROFILE" --query Account --output text)"
if [[ "$actual_account_id" != "$EXPECTED_ACCOUNT_ID" ]]; then
  echo "Refusing to modify AWS account $actual_account_id; expected $EXPECTED_ACCOUNT_ID." >&2
  exit 1
fi

WORK_DIR="$(mktemp -d)"
cleanup() {
  rm -rf "$WORK_DIR"
}
trap cleanup EXIT

ensure_oidc_provider() {
  local provider_arn="arn:aws:iam::$EXPECTED_ACCOUNT_ID:oidc-provider/$OIDC_HOST"

  if aws iam get-open-id-connect-provider \
    --profile "$PROFILE" \
    --open-id-connect-provider-arn "$provider_arn" >/dev/null 2>&1; then
    echo "OIDC provider exists: $OIDC_HOST" >&2
  else
    aws iam create-open-id-connect-provider \
      --profile "$PROFILE" \
      --url "$OIDC_URL" \
      --client-id-list "$AUDIENCE" \
      --thumbprint-list 6938fd4d98bab03faadb97b34396831e3780aea1 >/dev/null
    echo "Created OIDC provider: $OIDC_HOST" >&2
  fi

  printf '%s' "$provider_arn"
}

write_preview_trust_policy() {
  local output_file="$1"
  local provider_arn="$2"

  cat >"$output_file" <<JSON
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "$provider_arn"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "$OIDC_HOST:aud": "$AUDIENCE"
        },
        "StringLike": {
          "$OIDC_HOST:sub": [
            "repo:$REPOSITORY:pull_request",
            "repo:$REPOSITORY:ref:refs/heads/main"
          ]
        }
      }
    }
  ]
}
JSON
}

write_production_trust_policy() {
  local output_file="$1"
  local provider_arn="$2"

  cat >"$output_file" <<JSON
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "$provider_arn"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "$OIDC_HOST:aud": "$AUDIENCE"
        },
        "StringLike": {
          "$OIDC_HOST:sub": "repo:$REPOSITORY:environment:production",
          "$OIDC_HOST:ref": [
            "refs/tags/v*",
            "refs/heads/main"
          ]
        }
      }
    }
  ]
}
JSON
}

write_preview_policy() {
  local output_file="$1"

  cat >"$output_file" <<JSON
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ReadAccountAndNetwork",
      "Effect": "Allow",
      "Action": [
        "sts:GetCallerIdentity",
        "ec2:DescribeSecurityGroups",
        "ec2:DescribeSubnets",
        "ec2:DescribeVpcs",
        "ecr:GetAuthorizationToken",
        "ecs:DescribeClusters",
        "ecs:DescribeServices",
        "ecs:DescribeTaskDefinition",
        "ecs:DescribeTasks",
        "ecs:ListTaskDefinitions",
        "elasticloadbalancing:DescribeListeners",
        "elasticloadbalancing:DescribeLoadBalancers",
        "elasticloadbalancing:DescribeRules",
        "elasticloadbalancing:DescribeTargetGroups",
        "logs:DescribeLogGroups",
        "secretsmanager:ListSecrets"
      ],
      "Resource": "*"
    },
    {
      "Sid": "PushPreviewImages",
      "Effect": "Allow",
      "Action": [
        "ecr:BatchCheckLayerAvailability",
        "ecr:BatchGetImage",
        "ecr:CompleteLayerUpload",
        "ecr:DescribeImages",
        "ecr:DescribeRepositories",
        "ecr:GetDownloadUrlForLayer",
        "ecr:InitiateLayerUpload",
        "ecr:PutImage",
        "ecr:UploadLayerPart"
      ],
      "Resource": [
        "arn:aws:ecr:$REGION:$EXPECTED_ACCOUNT_ID:repository/tool-skillsmd-web",
        "arn:aws:ecr:$REGION:$EXPECTED_ACCOUNT_ID:repository/tool-skillsmd-workers"
      ]
    },
    {
      "Sid": "ManagePreviewEcs",
      "Effect": "Allow",
      "Action": [
        "ecs:CreateService",
        "ecs:DeleteService",
        "ecs:DeregisterTaskDefinition",
        "ecs:RegisterTaskDefinition",
        "ecs:RunTask",
        "ecs:TagResource",
        "ecs:UpdateService",
        "ecs:ListTasks",
        "ecs:StopTask"
      ],
      "Resource": "*"
    },
    {
      "Sid": "ManagePreviewAlbRules",
      "Effect": "Allow",
      "Action": [
        "elasticloadbalancing:CreateRule",
        "elasticloadbalancing:CreateTargetGroup",
        "elasticloadbalancing:DeleteRule",
        "elasticloadbalancing:DeleteTargetGroup",
        "elasticloadbalancing:ModifyRule",
        "elasticloadbalancing:ModifyTargetGroup",
        "elasticloadbalancing:AddTags"
      ],
      "Resource": "*"
    },
    {
      "Sid": "ManagePreviewSecrets",
      "Effect": "Allow",
      "Action": [
        "secretsmanager:CreateSecret",
        "secretsmanager:DeleteSecret",
        "secretsmanager:DescribeSecret",
        "secretsmanager:GetSecretValue",
        "secretsmanager:PutSecretValue",
        "secretsmanager:TagResource"
      ],
      "Resource": "arn:aws:secretsmanager:$REGION:$EXPECTED_ACCOUNT_ID:secret:skillsmd/preview*"
    },
    {
      "Sid": "PassSkillsMdEcsRoles",
      "Effect": "Allow",
      "Action": [
        "iam:GetRole",
        "iam:PassRole"
      ],
      "Resource": [
        "arn:aws:iam::$EXPECTED_ACCOUNT_ID:role/tool-skillsmd-ecs-task-execution",
        "arn:aws:iam::$EXPECTED_ACCOUNT_ID:role/tool-skillsmd-ecs-task"
      ]
    }
  ]
}
JSON
}

write_production_policy() {
  local output_file="$1"

  cat >"$output_file" <<JSON
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ProductionDeployScaffold",
      "Effect": "Allow",
      "Action": [
        "sts:GetCallerIdentity",
        "ecr:GetAuthorizationToken",
        "ecr:BatchCheckLayerAvailability",
        "ecr:BatchGetImage",
        "ecr:CompleteLayerUpload",
        "ecr:DescribeImages",
        "ecr:DescribeRepositories",
        "ecr:GetDownloadUrlForLayer",
        "ecr:InitiateLayerUpload",
        "ecr:PutImage",
        "ecr:UploadLayerPart",
        "ec2:DescribeSecurityGroups",
        "ec2:DescribeSubnets",
        "ec2:DescribeVpcs",
        "elasticloadbalancing:CreateRule",
        "elasticloadbalancing:CreateTargetGroup",
        "elasticloadbalancing:DescribeListeners",
        "elasticloadbalancing:DescribeLoadBalancers",
        "elasticloadbalancing:DescribeRules",
        "elasticloadbalancing:DescribeTargetGroups",
        "elasticloadbalancing:ModifyRule",
        "ecs:DescribeClusters",
        "ecs:DescribeServices",
        "ecs:DescribeTaskDefinition",
        "ecs:DescribeTasks",
        "ecs:ListTaskDefinitions",
        "ecs:ListTasks",
        "ecs:CreateService",
        "ecs:UpdateService",
        "ecs:RegisterTaskDefinition",
        "ecs:RunTask",
        "ecs:StopTask",
        "ecs:TagResource",
        "iam:GetRole",
        "iam:PassRole",
        "secretsmanager:DescribeSecret",
        "secretsmanager:GetSecretValue"
      ],
      "Resource": "*"
    },
    {
      "Sid": "ReadProductionS3BucketConfiguration",
      "Effect": "Allow",
      "Action": [
        "s3:GetBucketPublicAccessBlock",
        "s3:GetBucketVersioning",
        "s3:GetEncryptionConfiguration"
      ],
      "Resource": [
        "arn:aws:s3:::skillsmd-$EXPECTED_ACCOUNT_ID-assets",
        "arn:aws:s3:::skillsmd-$EXPECTED_ACCOUNT_ID-exports"
      ]
    }
  ]
}
JSON
}

ensure_role() {
  local role_name="$1"
  local trust_policy="$2"
  local inline_policy="$3"

  if aws iam get-role --profile "$PROFILE" --role-name "$role_name" >/dev/null 2>&1; then
    aws iam update-assume-role-policy \
      --profile "$PROFILE" \
      --role-name "$role_name" \
      --policy-document "file://$trust_policy" >/dev/null
    echo "Updated role trust policy: $role_name"
  else
    aws iam create-role \
      --profile "$PROFILE" \
      --role-name "$role_name" \
      --assume-role-policy-document "file://$trust_policy" \
      --tags Key=Service,Value=skills.md Key=ManagedBy,Value=platform-skills Key=Repository,Value="$REPOSITORY" >/dev/null
    echo "Created role: $role_name"
  fi

  aws iam put-role-policy \
    --profile "$PROFILE" \
    --role-name "$role_name" \
    --policy-name skillsmd-github-actions-deploy \
    --policy-document "file://$inline_policy" >/dev/null
  echo "Updated inline deploy policy: $role_name"
}

provider_arn="$(ensure_oidc_provider)"

preview_trust="$WORK_DIR/preview-trust.json"
preview_policy="$WORK_DIR/preview-policy.json"
production_trust="$WORK_DIR/production-trust.json"
production_policy="$WORK_DIR/production-policy.json"

write_preview_trust_policy "$preview_trust" "$provider_arn"
write_preview_policy "$preview_policy"
ensure_role "$PREVIEW_ROLE" "$preview_trust" "$preview_policy"

write_production_trust_policy "$production_trust" "$provider_arn"
write_production_policy "$production_policy"
ensure_role "$PRODUCTION_ROLE" "$production_trust" "$production_policy"

aws iam get-role \
  --profile "$PROFILE" \
  --role-name "$PREVIEW_ROLE" \
  --query 'Role.{roleName:RoleName,arn:Arn}' \
  --output table

aws iam get-role \
  --profile "$PROFILE" \
  --role-name "$PRODUCTION_ROLE" \
  --query 'Role.{roleName:RoleName,arn:Arn}' \
  --output table
