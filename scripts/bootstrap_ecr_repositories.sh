#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: scripts/bootstrap_ecr_repositories.sh [--profile <profile>] [--region <region>]

Creates or updates the ECR repositories used by skills.md deployments.

The current deployment model uses one immutable repository per deployable
artifact. PR preview and production images are separated by tag prefixes,
not by dev/staging repositories.
USAGE
}

PROFILE="hasnatools"
REGION="us-east-1"
EXPECTED_ACCOUNT_ID="059898286899"
REPOSITORIES=(
  tool-skillsmd-web
  tool-skillsmd-workers
)

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

actual_account_id="$(
  aws sts get-caller-identity \
    --profile "$PROFILE" \
    --query Account \
    --output text
)"

if [[ "$actual_account_id" != "$EXPECTED_ACCOUNT_ID" ]]; then
  echo "Refusing to modify AWS account $actual_account_id; expected $EXPECTED_ACCOUNT_ID." >&2
  exit 1
fi

LIFECYCLE_POLICY="$(mktemp)"
cleanup() {
  rm -f "$LIFECYCLE_POLICY"
}
trap cleanup EXIT

cat >"$LIFECYCLE_POLICY" <<'JSON'
{
  "rules": [
    {
      "rulePriority": 1,
      "description": "Expire untagged images after 7 days",
      "selection": {
        "tagStatus": "untagged",
        "countType": "sinceImagePushed",
        "countUnit": "days",
        "countNumber": 7
      },
      "action": {
        "type": "expire"
      }
    },
    {
      "rulePriority": 2,
      "description": "Expire PR preview images after 14 days",
      "selection": {
        "tagStatus": "tagged",
        "tagPrefixList": ["pr-"],
        "countType": "sinceImagePushed",
        "countUnit": "days",
        "countNumber": 14
      },
      "action": {
        "type": "expire"
      }
    },
    {
      "rulePriority": 3,
      "description": "Keep the latest 100 production images",
      "selection": {
        "tagStatus": "tagged",
        "tagPrefixList": ["production-"],
        "countType": "imageCountMoreThan",
        "countNumber": 100
      },
      "action": {
        "type": "expire"
      }
    }
  ]
}
JSON

for repository in "${REPOSITORIES[@]}"; do
  if aws ecr describe-repositories \
    --profile "$PROFILE" \
    --region "$REGION" \
    --repository-names "$repository" >/dev/null 2>&1; then
    echo "Repository exists: $repository"
  else
    aws ecr create-repository \
      --profile "$PROFILE" \
      --region "$REGION" \
      --repository-name "$repository" \
      --image-tag-mutability IMMUTABLE \
      --image-scanning-configuration scanOnPush=true \
      --encryption-configuration encryptionType=AES256 \
      --tags \
        Key=Service,Value=skills.md \
        Key=ManagedBy,Value=platform-skills \
        Key=Repository,Value=hasnatools/platform-skills >/dev/null
    echo "Created repository: $repository"
  fi

  aws ecr put-image-tag-mutability \
    --profile "$PROFILE" \
    --region "$REGION" \
    --repository-name "$repository" \
    --image-tag-mutability IMMUTABLE >/dev/null

  aws ecr put-image-scanning-configuration \
    --profile "$PROFILE" \
    --region "$REGION" \
    --repository-name "$repository" \
    --image-scanning-configuration scanOnPush=true >/dev/null

  aws ecr put-lifecycle-policy \
    --profile "$PROFILE" \
    --region "$REGION" \
    --repository-name "$repository" \
    --lifecycle-policy-text "file://$LIFECYCLE_POLICY" >/dev/null

  echo "Configured repository: $repository"
done

aws ecr describe-repositories \
  --profile "$PROFILE" \
  --region "$REGION" \
  --repository-names "${REPOSITORIES[@]}" \
  --query 'repositories[].{name:repositoryName,mutability:imageTagMutability,scanOnPush:imageScanningConfiguration.scanOnPush,encryption:encryptionConfiguration.encryptionType}' \
  --output table
