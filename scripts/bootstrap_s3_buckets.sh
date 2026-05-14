#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: scripts/bootstrap_s3_buckets.sh [--profile <profile>] [--region <region>]

Creates or updates the private S3 buckets used by skills.md:
- assets bucket for skill icons, generated media, and public-facing assets served through signed/CDN access
- exports bucket for execution exports, logs, downloads, and generated artifacts

Buckets are private, encrypted, versioned, lifecycle-managed, and have public
access blocked. This script does not make buckets public.
USAGE
}

PROFILE="hasnatools"
REGION="us-east-1"
EXPECTED_ACCOUNT_ID="059898286899"
ASSETS_BUCKET="skillsmd-059898286899-assets"
EXPORTS_BUCKET="skillsmd-059898286899-exports"

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

PUBLIC_ACCESS_BLOCK="$(mktemp)"
ENCRYPTION_CONFIG="$(mktemp)"
ASSETS_LIFECYCLE="$(mktemp)"
EXPORTS_LIFECYCLE="$(mktemp)"
ASSETS_CORS="$(mktemp)"
EXPORTS_CORS="$(mktemp)"

cleanup() {
  rm -f "$PUBLIC_ACCESS_BLOCK" "$ENCRYPTION_CONFIG" "$ASSETS_LIFECYCLE" "$EXPORTS_LIFECYCLE" "$ASSETS_CORS" "$EXPORTS_CORS"
}
trap cleanup EXIT

cat >"$PUBLIC_ACCESS_BLOCK" <<'JSON'
{
  "BlockPublicAcls": true,
  "IgnorePublicAcls": true,
  "BlockPublicPolicy": true,
  "RestrictPublicBuckets": true
}
JSON

cat >"$ENCRYPTION_CONFIG" <<'JSON'
{
  "Rules": [
    {
      "ApplyServerSideEncryptionByDefault": {
        "SSEAlgorithm": "AES256"
      },
      "BucketKeyEnabled": true
    }
  ]
}
JSON

cat >"$ASSETS_LIFECYCLE" <<'JSON'
{
  "Rules": [
    {
      "ID": "abort-incomplete-multipart-uploads",
      "Status": "Enabled",
      "Filter": {},
      "AbortIncompleteMultipartUpload": {
        "DaysAfterInitiation": 7
      }
    },
    {
      "ID": "expire-noncurrent-asset-versions",
      "Status": "Enabled",
      "Filter": {},
      "NoncurrentVersionExpiration": {
        "NoncurrentDays": 90
      }
    }
  ]
}
JSON

cat >"$EXPORTS_LIFECYCLE" <<'JSON'
{
  "Rules": [
    {
      "ID": "abort-incomplete-multipart-uploads",
      "Status": "Enabled",
      "Filter": {},
      "AbortIncompleteMultipartUpload": {
        "DaysAfterInitiation": 7
      }
    },
    {
      "ID": "expire-execution-exports",
      "Status": "Enabled",
      "Filter": {
        "Prefix": "executions/"
      },
      "Expiration": {
        "Days": 90
      },
      "NoncurrentVersionExpiration": {
        "NoncurrentDays": 30
      }
    },
    {
      "ID": "retain-audit-logs-one-year",
      "Status": "Enabled",
      "Filter": {
        "Prefix": "logs/"
      },
      "Expiration": {
        "Days": 365
      }
    }
  ]
}
JSON

cat >"$ASSETS_CORS" <<'JSON'
{
  "CORSRules": [
    {
      "AllowedHeaders": ["*"],
      "AllowedMethods": ["GET", "HEAD", "PUT"],
      "AllowedOrigins": ["https://skills.md", "https://*.preview.skills.md"],
      "ExposeHeaders": ["ETag"],
      "MaxAgeSeconds": 3000
    }
  ]
}
JSON

cat >"$EXPORTS_CORS" <<'JSON'
{
  "CORSRules": [
    {
      "AllowedHeaders": ["*"],
      "AllowedMethods": ["GET", "HEAD", "PUT"],
      "AllowedOrigins": ["https://skills.md", "https://*.preview.skills.md"],
      "ExposeHeaders": ["ETag", "Content-Disposition"],
      "MaxAgeSeconds": 3000
    }
  ]
}
JSON

create_bucket_if_missing() {
  local bucket="$1"

  if aws s3api head-bucket --profile "$PROFILE" --bucket "$bucket" >/dev/null 2>&1; then
    echo "Bucket exists: $bucket"
  else
    if [[ "$REGION" == "us-east-1" ]]; then
      aws s3api create-bucket \
        --profile "$PROFILE" \
        --bucket "$bucket" >/dev/null
    else
      aws s3api create-bucket \
        --profile "$PROFILE" \
        --bucket "$bucket" \
        --create-bucket-configuration "LocationConstraint=$REGION" >/dev/null
    fi
    echo "Created bucket: $bucket"
  fi
}

configure_bucket() {
  local bucket="$1"
  local lifecycle_file="$2"
  local cors_file="$3"

  aws s3api put-public-access-block \
    --profile "$PROFILE" \
    --bucket "$bucket" \
    --public-access-block-configuration "file://$PUBLIC_ACCESS_BLOCK" >/dev/null

  aws s3api put-bucket-ownership-controls \
    --profile "$PROFILE" \
    --bucket "$bucket" \
    --ownership-controls 'Rules=[{ObjectOwnership=BucketOwnerEnforced}]' >/dev/null

  aws s3api put-bucket-encryption \
    --profile "$PROFILE" \
    --bucket "$bucket" \
    --server-side-encryption-configuration "file://$ENCRYPTION_CONFIG" >/dev/null

  aws s3api put-bucket-versioning \
    --profile "$PROFILE" \
    --bucket "$bucket" \
    --versioning-configuration Status=Enabled >/dev/null

  aws s3api put-bucket-lifecycle-configuration \
    --profile "$PROFILE" \
    --bucket "$bucket" \
    --lifecycle-configuration "file://$lifecycle_file" >/dev/null

  aws s3api put-bucket-cors \
    --profile "$PROFILE" \
    --bucket "$bucket" \
    --cors-configuration "file://$cors_file" >/dev/null

  aws s3api put-bucket-tagging \
    --profile "$PROFILE" \
    --bucket "$bucket" \
    --tagging 'TagSet=[{Key=Service,Value=skills.md},{Key=ManagedBy,Value=platform-skills},{Key=Repository,Value=hasnatools/platform-skills}]' >/dev/null

  echo "Configured bucket: $bucket"
}

create_bucket_if_missing "$ASSETS_BUCKET"
create_bucket_if_missing "$EXPORTS_BUCKET"
configure_bucket "$ASSETS_BUCKET" "$ASSETS_LIFECYCLE" "$ASSETS_CORS"
configure_bucket "$EXPORTS_BUCKET" "$EXPORTS_LIFECYCLE" "$EXPORTS_CORS"

for bucket in "$ASSETS_BUCKET" "$EXPORTS_BUCKET"; do
  aws s3api get-public-access-block \
    --profile "$PROFILE" \
    --bucket "$bucket" \
    --query "{bucket:'$bucket',publicAccessBlock:PublicAccessBlockConfiguration}" \
    --output json

  aws s3api get-bucket-encryption \
    --profile "$PROFILE" \
    --bucket "$bucket" \
    --query "{bucket:'$bucket',encryption:ServerSideEncryptionConfiguration.Rules[0].ApplyServerSideEncryptionByDefault.SSEAlgorithm,bucketKey:ServerSideEncryptionConfiguration.Rules[0].BucketKeyEnabled}" \
    --output json

  aws s3api get-bucket-versioning \
    --profile "$PROFILE" \
    --bucket "$bucket" \
    --query "{bucket:'$bucket',versioning:Status}" \
    --output json
done
