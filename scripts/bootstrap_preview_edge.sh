#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: scripts/bootstrap_preview_edge.sh [--profile <profile>] [--region <region>]

Creates or updates the shared PR preview edge for skills.md:
- public ALB in the skillsmd VPC
- ALB security group and ECS ingress on port 3505
- HTTP listener, and HTTPS listener when ACM certificate validation succeeds
- optional Cloudflare DNS records for ACM validation, preview.skills.md, and *.preview.skills.md

Cloudflare can be supplied with either CLOUDFLARE_API_TOKEN or the pair
CLOUDFLARE_EMAIL/CLOUDFLARE_API_KEY. Values are never printed.
USAGE
}

PROFILE="hasnatools"
REGION="us-east-1"
EXPECTED_ACCOUNT_ID="059898286899"
VPC_NAME="skillsmd-vpc"
PUBLIC_SUBNET_NAMES=(skillsmd-public-1 skillsmd-public-2)
ECS_SG_NAME="skillsmd-ecs-tasks"
ALB_SG_NAME="skillsmd-preview-alb"
ALB_NAME="skillsmd-preview"
CERT_DOMAIN="*.preview.skills.md"
PREVIEW_ROOT_RECORD="preview.skills.md"
WILDCARD_RECORD="*.preview.skills.md"
CF_ZONE_NAME="skills.md"

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

for command in aws jq curl mktemp; do
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

aws_text() {
  local value
  value="$("$@" --output text 2>/dev/null || true)"
  if [[ "$value" == "None" || "$value" == "null" ]]; then
    value=""
  fi
  printf '%s' "$value"
}

cf_headers() {
  if [[ -n "${CLOUDFLARE_API_TOKEN:-}" ]]; then
    printf '%s\n' -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN"
  elif [[ -n "${CLOUDFLARE_EMAIL:-}" && -n "${CLOUDFLARE_API_KEY:-}" ]]; then
    printf '%s\n' -H "X-Auth-Email: $CLOUDFLARE_EMAIL" -H "X-Auth-Key: $CLOUDFLARE_API_KEY"
  fi
}

cf_available() {
  [[ -n "${CLOUDFLARE_API_TOKEN:-}" || ( -n "${CLOUDFLARE_EMAIL:-}" && -n "${CLOUDFLARE_API_KEY:-}" ) ]]
}

cf_request() {
  local method="$1"
  local path="$2"
  local data_file="${3:-}"
  local args=(-fsS -X "$method")
  mapfile -t headers < <(cf_headers)
  args+=("${headers[@]}")
  args+=(-H "Content-Type: application/json")
  if [[ -n "$data_file" ]]; then
    args+=(--data "@$data_file")
  fi
  curl "${args[@]}" "https://api.cloudflare.com/client/v4/$path"
}

cf_zone_id() {
  cf_request GET "zones?name=$CF_ZONE_NAME" | jq -r '.result[0].id // empty'
}

cf_upsert_cname() {
  local zone_id="$1"
  local record_name="${2%.}"
  local record_content="${3%.}"
  local proxied="${4:-false}"
  local existing_id
  local payload

  payload="$(mktemp)"
  jq -n \
    --arg type CNAME \
    --arg name "$record_name" \
    --arg content "$record_content" \
    --argjson proxied "$proxied" \
    '{type:$type,name:$name,content:$content,ttl:60,proxied:$proxied}' >"$payload"

  existing_id="$(cf_request GET "zones/$zone_id/dns_records?type=CNAME&name=$record_name" | jq -r '.result[0].id // empty')"
  if [[ -n "$existing_id" ]]; then
    cf_request PUT "zones/$zone_id/dns_records/$existing_id" "$payload" >/dev/null
    echo "Updated Cloudflare CNAME: $record_name"
  else
    cf_request POST "zones/$zone_id/dns_records" "$payload" >/dev/null
    echo "Created Cloudflare CNAME: $record_name"
  fi

  rm -f "$payload"
}

vpc_id="$(aws_text aws ec2 describe-vpcs \
  --profile "$PROFILE" \
  --region "$REGION" \
  --filters "Name=tag:Name,Values=$VPC_NAME" \
  --query 'Vpcs[0].VpcId')"
if [[ -z "$vpc_id" ]]; then
  echo "VPC not found: $VPC_NAME" >&2
  exit 1
fi

subnet_ids=()
for subnet_name in "${PUBLIC_SUBNET_NAMES[@]}"; do
  subnet_id="$(aws_text aws ec2 describe-subnets \
    --profile "$PROFILE" \
    --region "$REGION" \
    --filters "Name=vpc-id,Values=$vpc_id" "Name=tag:Name,Values=$subnet_name" \
    --query 'Subnets[0].SubnetId')"
  if [[ -z "$subnet_id" ]]; then
    echo "Public subnet not found: $subnet_name" >&2
    exit 1
  fi
  subnet_ids+=("$subnet_id")
done

ecs_sg_id="$(aws_text aws ec2 describe-security-groups \
  --profile "$PROFILE" \
  --region "$REGION" \
  --filters "Name=vpc-id,Values=$vpc_id" "Name=group-name,Values=$ECS_SG_NAME" \
  --query 'SecurityGroups[0].GroupId')"
if [[ -z "$ecs_sg_id" ]]; then
  echo "ECS security group not found: $ECS_SG_NAME" >&2
  exit 1
fi

alb_sg_id="$(aws_text aws ec2 describe-security-groups \
  --profile "$PROFILE" \
  --region "$REGION" \
  --filters "Name=vpc-id,Values=$vpc_id" "Name=group-name,Values=$ALB_SG_NAME" \
  --query 'SecurityGroups[0].GroupId')"
if [[ -z "$alb_sg_id" ]]; then
  alb_sg_id="$(aws ec2 create-security-group \
    --profile "$PROFILE" \
    --region "$REGION" \
    --group-name "$ALB_SG_NAME" \
    --description "skills.md preview ALB" \
    --vpc-id "$vpc_id" \
    --query GroupId \
    --output text)"
  aws ec2 create-tags \
    --profile "$PROFILE" \
    --region "$REGION" \
    --resources "$alb_sg_id" \
    --tags Key=Name,Value="$ALB_SG_NAME" Key=Service,Value=skills.md Key=ManagedBy,Value=platform-skills >/dev/null
  echo "Created ALB security group: $alb_sg_id"
else
  echo "ALB security group exists: $alb_sg_id"
fi

for port in 80 443; do
  aws ec2 authorize-security-group-ingress \
    --profile "$PROFILE" \
    --region "$REGION" \
    --group-id "$alb_sg_id" \
    --ip-permissions "IpProtocol=tcp,FromPort=$port,ToPort=$port,IpRanges=[{CidrIp=0.0.0.0/0,Description=Public preview traffic}]" >/dev/null 2>&1 || true
done

aws ec2 authorize-security-group-ingress \
  --profile "$PROFILE" \
  --region "$REGION" \
  --group-id "$ecs_sg_id" \
  --ip-permissions "IpProtocol=tcp,FromPort=3505,ToPort=3505,UserIdGroupPairs=[{GroupId=$alb_sg_id,Description=Preview ALB to ECS tasks}]" >/dev/null 2>&1 || true

alb_arn="$(aws_text aws elbv2 describe-load-balancers \
  --profile "$PROFILE" \
  --region "$REGION" \
  --names "$ALB_NAME" \
  --query 'LoadBalancers[0].LoadBalancerArn')"
if [[ -z "$alb_arn" ]]; then
  alb_arn="$(aws elbv2 create-load-balancer \
    --profile "$PROFILE" \
    --region "$REGION" \
    --name "$ALB_NAME" \
    --type application \
    --scheme internet-facing \
    --ip-address-type ipv4 \
    --security-groups "$alb_sg_id" \
    --subnets "${subnet_ids[@]}" \
    --tags Key=Service,Value=skills.md Key=ManagedBy,Value=platform-skills Key=Repository,Value=hasnatools/platform-skills \
    --query 'LoadBalancers[0].LoadBalancerArn' \
    --output text)"
  echo "Created ALB: $ALB_NAME"
else
  echo "ALB exists: $ALB_NAME"
fi

alb_dns_name="$(aws elbv2 describe-load-balancers \
  --profile "$PROFILE" \
  --region "$REGION" \
  --load-balancer-arns "$alb_arn" \
  --query 'LoadBalancers[0].DNSName' \
  --output text)"

http_listener_arn="$(aws_text aws elbv2 describe-listeners \
  --profile "$PROFILE" \
  --region "$REGION" \
  --load-balancer-arn "$alb_arn" \
  --query 'Listeners[?Port==`80`].ListenerArn | [0]')"
if [[ -z "$http_listener_arn" ]]; then
  http_listener_arn="$(aws elbv2 create-listener \
    --profile "$PROFILE" \
    --region "$REGION" \
    --load-balancer-arn "$alb_arn" \
    --protocol HTTP \
    --port 80 \
    --default-actions 'Type=fixed-response,FixedResponseConfig={StatusCode=404,ContentType=text/plain,MessageBody=preview-not-found}' \
    --query 'Listeners[0].ListenerArn' \
    --output text)"
  echo "Created HTTP listener"
else
  echo "HTTP listener exists"
fi

cert_arn=""
mapfile -t candidate_cert_arns < <(aws acm list-certificates \
  --profile "$PROFILE" \
  --region "$REGION" \
  --certificate-statuses ISSUED PENDING_VALIDATION \
  --query "CertificateSummaryList[?DomainName=='$CERT_DOMAIN'].CertificateArn" \
  --output text | tr '\t' '\n')
for candidate_cert_arn in "${candidate_cert_arns[@]}"; do
  if [[ -z "$candidate_cert_arn" ]]; then
    continue
  fi
  cert_covers_hosts="$(aws acm describe-certificate \
    --profile "$PROFILE" \
    --region "$REGION" \
    --certificate-arn "$candidate_cert_arn" \
    --query "contains(Certificate.SubjectAlternativeNames, '$CERT_DOMAIN') && contains(Certificate.SubjectAlternativeNames, '$PREVIEW_ROOT_RECORD')" \
    --output text)"
  if [[ "$cert_covers_hosts" == "True" ]]; then
    cert_arn="$candidate_cert_arn"
    break
  fi
done
if [[ -z "$cert_arn" ]]; then
  cert_arn="$(aws acm request-certificate \
    --profile "$PROFILE" \
    --region "$REGION" \
    --domain-name "$CERT_DOMAIN" \
    --subject-alternative-names "$PREVIEW_ROOT_RECORD" \
    --validation-method DNS \
    --idempotency-token skillsmdpreviewroot \
    --tags Key=Service,Value=skills.md Key=ManagedBy,Value=platform-skills Key=Repository,Value=hasnatools/platform-skills \
    --query CertificateArn \
    --output text)"
  echo "Requested ACM certificate: $CERT_DOMAIN, $PREVIEW_ROOT_RECORD"
else
  echo "ACM certificate exists: $CERT_DOMAIN, $PREVIEW_ROOT_RECORD"
fi

if cf_available; then
  zone_id="$(cf_zone_id)"
  if [[ -z "$zone_id" ]]; then
    echo "Cloudflare zone not found: $CF_ZONE_NAME" >&2
    exit 1
  fi

  for _ in $(seq 1 30); do
    validation_json="$(aws acm describe-certificate \
      --profile "$PROFILE" \
      --region "$REGION" \
      --certificate-arn "$cert_arn" \
      --query 'Certificate.DomainValidationOptions[].ResourceRecord' \
      --output json)"
    if jq -e 'length > 0 and all(.[]; (.Name // "") != "" and (.Value // "") != "")' <<<"$validation_json" >/dev/null; then
      while IFS=$'\t' read -r validation_name validation_value; do
        cf_upsert_cname "$zone_id" "$validation_name" "$validation_value" false
      done < <(jq -r '.[] | [.Name, .Value] | @tsv' <<<"$validation_json" | sort -u)
      break
    fi
    sleep 5
  done

  cf_upsert_cname "$zone_id" "$PREVIEW_ROOT_RECORD" "$alb_dns_name" false
  cf_upsert_cname "$zone_id" "$WILDCARD_RECORD" "$alb_dns_name" false
  aws acm wait certificate-validated \
    --profile "$PROFILE" \
    --region "$REGION" \
    --certificate-arn "$cert_arn" || true
else
  echo "Cloudflare credentials not provided; skipping DNS and ACM validation record updates."
fi

cert_status="$(aws acm describe-certificate \
  --profile "$PROFILE" \
  --region "$REGION" \
  --certificate-arn "$cert_arn" \
  --query 'Certificate.Status' \
  --output text)"

https_listener_arn=""
if [[ "$cert_status" == "ISSUED" ]]; then
  https_listener_arn="$(aws_text aws elbv2 describe-listeners \
    --profile "$PROFILE" \
    --region "$REGION" \
    --load-balancer-arn "$alb_arn" \
    --query 'Listeners[?Port==`443`].ListenerArn | [0]')"
  if [[ -z "$https_listener_arn" ]]; then
    https_listener_arn="$(aws elbv2 create-listener \
      --profile "$PROFILE" \
      --region "$REGION" \
      --load-balancer-arn "$alb_arn" \
      --protocol HTTPS \
      --port 443 \
      --certificates "CertificateArn=$cert_arn" \
      --ssl-policy ELBSecurityPolicy-TLS13-1-2-2021-06 \
      --default-actions 'Type=fixed-response,FixedResponseConfig={StatusCode=404,ContentType=text/plain,MessageBody=preview-not-found}' \
      --query 'Listeners[0].ListenerArn' \
      --output text)"
    echo "Created HTTPS listener"
  else
    current_listener_cert_arn="$(aws elbv2 describe-listeners \
      --profile "$PROFILE" \
      --region "$REGION" \
      --listener-arns "$https_listener_arn" \
      --query 'Listeners[0].Certificates[0].CertificateArn' \
      --output text)"
    if [[ "$current_listener_cert_arn" != "$cert_arn" ]]; then
      aws elbv2 modify-listener \
        --profile "$PROFILE" \
        --region "$REGION" \
        --listener-arn "$https_listener_arn" \
        --certificates "CertificateArn=$cert_arn" >/dev/null
      echo "Updated HTTPS listener certificate"
    else
      echo "HTTPS listener exists"
    fi
  fi
else
  echo "ACM certificate is $cert_status; HTTPS listener will be created after validation."
fi

jq -n \
  --arg albArn "$alb_arn" \
  --arg albDnsName "$alb_dns_name" \
  --arg httpListenerArn "$http_listener_arn" \
  --arg httpsListenerArn "$https_listener_arn" \
  --arg certArn "$cert_arn" \
  --arg certStatus "$cert_status" \
  --arg rootHost "$PREVIEW_ROOT_RECORD" \
  --arg wildcardHost "$WILDCARD_RECORD" \
  '{albArn:$albArn,albDnsName:$albDnsName,httpListenerArn:$httpListenerArn,httpsListenerArn:$httpsListenerArn,certArn:$certArn,certStatus:$certStatus,rootHost:$rootHost,wildcardHost:$wildcardHost}'
