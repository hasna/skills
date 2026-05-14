#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: scripts/bootstrap_data_stores.sh [--profile <profile>] [--region <region>]

Creates the private data foundation for skills.md:
- isolated VPC with two public and two private subnets
- security groups for future ECS tasks, PostgreSQL, and Redis
- RDS PostgreSQL with encryption, backups, deletion protection, and managed password
- ElastiCache Redis with private subnet group, encryption, auth token, and parameter group

Secrets are generated/stored through AWS services and are never printed.
USAGE
}

PROFILE="hasnatools"
REGION="us-east-1"
EXPECTED_ACCOUNT_ID="059898286899"

VPC_NAME="skillsmd-vpc"
VPC_CIDR="10.65.0.0/16"
PUBLIC_SUBNETS=(
  "skillsmd-public-1:us-east-1a:10.65.1.0/24"
  "skillsmd-public-2:us-east-1b:10.65.2.0/24"
)
PRIVATE_SUBNETS=(
  "skillsmd-private-1:us-east-1a:10.65.101.0/24"
  "skillsmd-private-2:us-east-1b:10.65.102.0/24"
)

ECS_SG_NAME="skillsmd-ecs-tasks"
RDS_SG_NAME="skillsmd-postgres"
REDIS_SG_NAME="skillsmd-redis"
DB_SUBNET_GROUP="skillsmd-private"
CACHE_SUBNET_GROUP="skillsmd-private"
DB_PARAMETER_GROUP="skillsmd-postgres16"
CACHE_PARAMETER_GROUP="skillsmd-redis7"
DB_IDENTIFIER="skillsmd-production-postgres"
DB_NAME="skillsmd"
DB_USERNAME="skillsmd_admin"
REDIS_REPLICATION_GROUP="skillsmd-production-redis"
REDIS_AUTH_SECRET_NAME="skillsmd/production/redis/auth-token"

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

for command in aws; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "Missing required command: $command" >&2
    exit 1
  fi
done

aws_text() {
  local value
  value="$("$@" --output text 2>/dev/null || true)"
  if [[ "$value" == "None" || "$value" == "null" ]]; then
    value=""
  fi
  printf '%s' "$value"
}

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

tag_ec2() {
  local resource_id="$1"
  local name="$2"

  aws ec2 create-tags \
    --profile "$PROFILE" \
    --region "$REGION" \
    --resources "$resource_id" \
    --tags \
      Key=Name,Value="$name" \
      Key=Service,Value=skills.md \
      Key=ManagedBy,Value=platform-skills \
      Key=Repository,Value=hasnatools/platform-skills >/dev/null
}

ensure_vpc() {
  local vpc_id

  vpc_id="$(aws_text aws ec2 describe-vpcs \
    --profile "$PROFILE" \
    --region "$REGION" \
    --filters "Name=tag:Name,Values=$VPC_NAME" \
    --query 'Vpcs[0].VpcId')"

  if [[ -z "$vpc_id" ]]; then
    vpc_id="$(aws ec2 create-vpc \
      --profile "$PROFILE" \
      --region "$REGION" \
      --cidr-block "$VPC_CIDR" \
      --query 'Vpc.VpcId' \
      --output text)"
    tag_ec2 "$vpc_id" "$VPC_NAME"
    aws ec2 modify-vpc-attribute --profile "$PROFILE" --region "$REGION" --vpc-id "$vpc_id" --enable-dns-hostnames >/dev/null
    aws ec2 modify-vpc-attribute --profile "$PROFILE" --region "$REGION" --vpc-id "$vpc_id" --enable-dns-support >/dev/null
    echo "Created VPC: $vpc_id" >&2
  else
    echo "VPC exists: $vpc_id" >&2
  fi

  printf '%s' "$vpc_id"
}

ensure_subnet() {
  local vpc_id="$1"
  local name="$2"
  local az="$3"
  local cidr="$4"
  local public_ip="$5"
  local subnet_id

  subnet_id="$(aws_text aws ec2 describe-subnets \
    --profile "$PROFILE" \
    --region "$REGION" \
    --filters "Name=vpc-id,Values=$vpc_id" "Name=tag:Name,Values=$name" \
    --query 'Subnets[0].SubnetId')"

  if [[ -z "$subnet_id" ]]; then
    subnet_id="$(aws ec2 create-subnet \
      --profile "$PROFILE" \
      --region "$REGION" \
      --vpc-id "$vpc_id" \
      --availability-zone "$az" \
      --cidr-block "$cidr" \
      --query 'Subnet.SubnetId' \
      --output text)"
    tag_ec2 "$subnet_id" "$name"
    echo "Created subnet: $name ($subnet_id)" >&2
  else
    echo "Subnet exists: $name ($subnet_id)" >&2
  fi

  aws ec2 modify-subnet-attribute \
    --profile "$PROFILE" \
    --region "$REGION" \
    --subnet-id "$subnet_id" \
    --map-public-ip-on-launch "{\"Value\":$public_ip}" >/dev/null

  printf '%s' "$subnet_id"
}

ensure_internet_gateway() {
  local vpc_id="$1"
  local igw_id

  igw_id="$(aws_text aws ec2 describe-internet-gateways \
    --profile "$PROFILE" \
    --region "$REGION" \
    --filters "Name=attachment.vpc-id,Values=$vpc_id" "Name=tag:Name,Values=skillsmd-igw" \
    --query 'InternetGateways[0].InternetGatewayId')"

  if [[ -z "$igw_id" ]]; then
    igw_id="$(aws ec2 create-internet-gateway \
      --profile "$PROFILE" \
      --region "$REGION" \
      --query 'InternetGateway.InternetGatewayId' \
      --output text)"
    tag_ec2 "$igw_id" "skillsmd-igw"
    aws ec2 attach-internet-gateway --profile "$PROFILE" --region "$REGION" --internet-gateway-id "$igw_id" --vpc-id "$vpc_id" >/dev/null
    echo "Created internet gateway: $igw_id" >&2
  else
    echo "Internet gateway exists: $igw_id" >&2
  fi

  printf '%s' "$igw_id"
}

ensure_route_table() {
  local vpc_id="$1"
  local name="$2"
  local route_table_id

  route_table_id="$(aws_text aws ec2 describe-route-tables \
    --profile "$PROFILE" \
    --region "$REGION" \
    --filters "Name=vpc-id,Values=$vpc_id" "Name=tag:Name,Values=$name" \
    --query 'RouteTables[0].RouteTableId')"

  if [[ -z "$route_table_id" ]]; then
    route_table_id="$(aws ec2 create-route-table \
      --profile "$PROFILE" \
      --region "$REGION" \
      --vpc-id "$vpc_id" \
      --query 'RouteTable.RouteTableId' \
      --output text)"
    tag_ec2 "$route_table_id" "$name"
    echo "Created route table: $name ($route_table_id)" >&2
  else
    echo "Route table exists: $name ($route_table_id)" >&2
  fi

  printf '%s' "$route_table_id"
}

ensure_route_table_association() {
  local route_table_id="$1"
  local subnet_id="$2"
  local association_id

  association_id="$(aws_text aws ec2 describe-route-tables \
    --profile "$PROFILE" \
    --region "$REGION" \
    --filters "Name=association.subnet-id,Values=$subnet_id" "Name=association.main,Values=false" \
    --query 'RouteTables[0].Associations[0].RouteTableAssociationId')"

  if [[ -z "$association_id" ]]; then
    aws ec2 associate-route-table \
      --profile "$PROFILE" \
      --region "$REGION" \
      --route-table-id "$route_table_id" \
      --subnet-id "$subnet_id" >/dev/null
  fi
}

ensure_security_group() {
  local vpc_id="$1"
  local name="$2"
  local description="$3"
  local group_id

  group_id="$(aws_text aws ec2 describe-security-groups \
    --profile "$PROFILE" \
    --region "$REGION" \
    --filters "Name=vpc-id,Values=$vpc_id" "Name=group-name,Values=$name" \
    --query 'SecurityGroups[0].GroupId')"

  if [[ -z "$group_id" ]]; then
    group_id="$(aws ec2 create-security-group \
      --profile "$PROFILE" \
      --region "$REGION" \
      --vpc-id "$vpc_id" \
      --group-name "$name" \
      --description "$description" \
      --query 'GroupId' \
      --output text)"
    tag_ec2 "$group_id" "$name"
    echo "Created security group: $name ($group_id)" >&2
  else
    echo "Security group exists: $name ($group_id)" >&2
  fi

  printf '%s' "$group_id"
}

ensure_sg_ingress() {
  local target_group_id="$1"
  local source_group_id="$2"
  local port="$3"
  local description="$4"
  local existing_count

  existing_count="$(aws ec2 describe-security-group-rules \
    --profile "$PROFILE" \
    --region "$REGION" \
    --filters \
      "Name=group-id,Values=$target_group_id" \
    --query "length(SecurityGroupRules[?IsEgress==\`false\` && IpProtocol=='tcp' && FromPort==\`$port\` && ToPort==\`$port\` && ReferencedGroupInfo.GroupId=='$source_group_id'])" \
    --output text)"

  if [[ "$existing_count" == "0" ]]; then
    aws ec2 authorize-security-group-ingress \
      --profile "$PROFILE" \
      --region "$REGION" \
      --group-id "$target_group_id" \
      --ip-permissions "IpProtocol=tcp,FromPort=$port,ToPort=$port,UserIdGroupPairs=[{GroupId=$source_group_id,Description=\"$description\"}]" >/dev/null
    echo "Added ingress rule on $target_group_id:$port from $source_group_id"
  fi
}

ensure_db_subnet_group() {
  local private_subnet_ids=("$@")

  if aws rds describe-db-subnet-groups \
    --profile "$PROFILE" \
    --region "$REGION" \
    --db-subnet-group-name "$DB_SUBNET_GROUP" >/dev/null 2>&1; then
    aws rds modify-db-subnet-group \
      --profile "$PROFILE" \
      --region "$REGION" \
      --db-subnet-group-name "$DB_SUBNET_GROUP" \
      --subnet-ids "${private_subnet_ids[@]}" >/dev/null
    echo "DB subnet group exists: $DB_SUBNET_GROUP"
  else
    aws rds create-db-subnet-group \
      --profile "$PROFILE" \
      --region "$REGION" \
      --db-subnet-group-name "$DB_SUBNET_GROUP" \
      --db-subnet-group-description "skills.md private database subnets" \
      --subnet-ids "${private_subnet_ids[@]}" \
      --tags \
        Key=Service,Value=skills.md \
        Key=ManagedBy,Value=platform-skills \
        Key=Repository,Value=hasnatools/platform-skills >/dev/null
    echo "Created DB subnet group: $DB_SUBNET_GROUP"
  fi
}

ensure_cache_subnet_group() {
  local private_subnet_ids=("$@")

  if aws elasticache describe-cache-subnet-groups \
    --profile "$PROFILE" \
    --region "$REGION" \
    --cache-subnet-group-name "$CACHE_SUBNET_GROUP" >/dev/null 2>&1; then
    modify_output="$(
      aws elasticache modify-cache-subnet-group \
        --profile "$PROFILE" \
        --region "$REGION" \
        --cache-subnet-group-name "$CACHE_SUBNET_GROUP" \
        --subnet-ids "${private_subnet_ids[@]}" 2>&1 >/dev/null || true
    )"
    if [[ -n "$modify_output" && "$modify_output" != *"No modifications were requested"* ]]; then
      echo "$modify_output" >&2
      exit 1
    fi
    echo "Cache subnet group exists: $CACHE_SUBNET_GROUP"
  else
    aws elasticache create-cache-subnet-group \
      --profile "$PROFILE" \
      --region "$REGION" \
      --cache-subnet-group-name "$CACHE_SUBNET_GROUP" \
      --cache-subnet-group-description "skills.md private cache subnets" \
      --subnet-ids "${private_subnet_ids[@]}" \
      --tags \
        Key=Service,Value=skills.md \
        Key=ManagedBy,Value=platform-skills \
        Key=Repository,Value=hasnatools/platform-skills >/dev/null
    echo "Created cache subnet group: $CACHE_SUBNET_GROUP"
  fi
}

ensure_db_parameter_group() {
  if aws rds describe-db-parameter-groups \
    --profile "$PROFILE" \
    --region "$REGION" \
    --db-parameter-group-name "$DB_PARAMETER_GROUP" >/dev/null 2>&1; then
    echo "DB parameter group exists: $DB_PARAMETER_GROUP"
  else
    aws rds create-db-parameter-group \
      --profile "$PROFILE" \
      --region "$REGION" \
      --db-parameter-group-name "$DB_PARAMETER_GROUP" \
      --db-parameter-group-family postgres16 \
      --description "skills.md PostgreSQL 16 parameters" \
      --tags \
        Key=Service,Value=skills.md \
        Key=ManagedBy,Value=platform-skills \
        Key=Repository,Value=hasnatools/platform-skills >/dev/null
    echo "Created DB parameter group: $DB_PARAMETER_GROUP"
  fi

  aws rds modify-db-parameter-group \
    --profile "$PROFILE" \
    --region "$REGION" \
    --db-parameter-group-name "$DB_PARAMETER_GROUP" \
    --parameters "ParameterName=rds.force_ssl,ParameterValue=1,ApplyMethod=pending-reboot" >/dev/null
}

ensure_cache_parameter_group() {
  if aws elasticache describe-cache-parameter-groups \
    --profile "$PROFILE" \
    --region "$REGION" \
    --cache-parameter-group-name "$CACHE_PARAMETER_GROUP" >/dev/null 2>&1; then
    echo "Cache parameter group exists: $CACHE_PARAMETER_GROUP"
  else
    aws elasticache create-cache-parameter-group \
      --profile "$PROFILE" \
      --region "$REGION" \
      --cache-parameter-group-name "$CACHE_PARAMETER_GROUP" \
      --cache-parameter-group-family redis7 \
      --description "skills.md Redis 7 parameters" \
      --tags \
        Key=Service,Value=skills.md \
        Key=ManagedBy,Value=platform-skills \
        Key=Repository,Value=hasnatools/platform-skills >/dev/null
    echo "Created cache parameter group: $CACHE_PARAMETER_GROUP"
  fi

  aws elasticache modify-cache-parameter-group \
    --profile "$PROFILE" \
    --region "$REGION" \
    --cache-parameter-group-name "$CACHE_PARAMETER_GROUP" \
    --parameter-name-values ParameterName=maxmemory-policy,ParameterValue=allkeys-lru >/dev/null
}

ensure_rds_instance() {
  local rds_sg_id="$1"

  if aws rds describe-db-instances \
    --profile "$PROFILE" \
    --region "$REGION" \
    --db-instance-identifier "$DB_IDENTIFIER" >/dev/null 2>&1; then
    echo "RDS instance exists: $DB_IDENTIFIER"
  else
    aws rds create-db-instance \
      --profile "$PROFILE" \
      --region "$REGION" \
      --db-instance-identifier "$DB_IDENTIFIER" \
      --db-name "$DB_NAME" \
      --engine postgres \
      --engine-version 16.13 \
      --db-instance-class db.t4g.micro \
      --allocated-storage 20 \
      --max-allocated-storage 100 \
      --storage-type gp3 \
      --storage-encrypted \
      --master-username "$DB_USERNAME" \
      --manage-master-user-password \
      --db-subnet-group-name "$DB_SUBNET_GROUP" \
      --vpc-security-group-ids "$rds_sg_id" \
      --db-parameter-group-name "$DB_PARAMETER_GROUP" \
      --backup-retention-period 7 \
      --preferred-backup-window 03:00-04:00 \
      --preferred-maintenance-window sun:04:00-sun:05:00 \
      --copy-tags-to-snapshot \
      --deletion-protection \
      --no-publicly-accessible \
      --enable-cloudwatch-logs-exports postgresql upgrade \
      --tags \
        Key=Service,Value=skills.md \
        Key=ManagedBy,Value=platform-skills \
        Key=Repository,Value=hasnatools/platform-skills \
        Key=Environment,Value=production >/dev/null
    echo "Created RDS instance: $DB_IDENTIFIER"
  fi

  aws rds wait db-instance-available \
    --profile "$PROFILE" \
    --region "$REGION" \
    --db-instance-identifier "$DB_IDENTIFIER"
  echo "RDS instance available: $DB_IDENTIFIER"
}

ensure_secret_value() {
  local secret_name="$1"
  local secret_value

  if aws secretsmanager describe-secret \
    --profile "$PROFILE" \
    --region "$REGION" \
    --secret-id "$secret_name" >/dev/null 2>&1; then
    echo "Secret exists: $secret_name"
  else
    secret_value="$(
      aws secretsmanager get-random-password \
        --profile "$PROFILE" \
        --region "$REGION" \
        --password-length 48 \
        --exclude-punctuation \
        --query RandomPassword \
        --output text
    )"
    aws secretsmanager create-secret \
      --profile "$PROFILE" \
      --region "$REGION" \
      --name "$secret_name" \
      --description "Redis auth token for skills.md production" \
      --secret-string "$secret_value" \
      --tags \
        Key=Service,Value=skills.md \
        Key=ManagedBy,Value=platform-skills \
        Key=Repository,Value=hasnatools/platform-skills \
        Key=Environment,Value=production >/dev/null
    echo "Created secret: $secret_name"
  fi
}

ensure_redis_replication_group() {
  local redis_sg_id="$1"
  local redis_auth_token

  ensure_secret_value "$REDIS_AUTH_SECRET_NAME"
  redis_auth_token="$(
    aws secretsmanager get-secret-value \
      --profile "$PROFILE" \
      --region "$REGION" \
      --secret-id "$REDIS_AUTH_SECRET_NAME" \
      --query SecretString \
      --output text
  )"

  if aws elasticache describe-replication-groups \
    --profile "$PROFILE" \
    --region "$REGION" \
    --replication-group-id "$REDIS_REPLICATION_GROUP" >/dev/null 2>&1; then
    echo "Redis replication group exists: $REDIS_REPLICATION_GROUP"
  else
    aws elasticache create-replication-group \
      --profile "$PROFILE" \
      --region "$REGION" \
      --replication-group-id "$REDIS_REPLICATION_GROUP" \
      --replication-group-description "skills.md production Redis" \
      --engine redis \
      --engine-version 7.1 \
      --cache-node-type cache.t4g.micro \
      --num-node-groups 1 \
      --replicas-per-node-group 0 \
      --cache-subnet-group-name "$CACHE_SUBNET_GROUP" \
      --security-group-ids "$redis_sg_id" \
      --cache-parameter-group-name "$CACHE_PARAMETER_GROUP" \
      --at-rest-encryption-enabled \
      --transit-encryption-enabled \
      --auth-token "$redis_auth_token" \
      --snapshot-retention-limit 7 \
      --snapshot-window 04:00-05:00 \
      --tags \
        Key=Service,Value=skills.md \
        Key=ManagedBy,Value=platform-skills \
        Key=Repository,Value=hasnatools/platform-skills \
        Key=Environment,Value=production >/dev/null
    echo "Created Redis replication group: $REDIS_REPLICATION_GROUP"
  fi

  aws elasticache wait replication-group-available \
    --profile "$PROFILE" \
    --region "$REGION" \
    --replication-group-id "$REDIS_REPLICATION_GROUP"
  echo "Redis replication group available: $REDIS_REPLICATION_GROUP"
}

VPC_ID="$(ensure_vpc)"
PUBLIC_SUBNET_IDS=()
PRIVATE_SUBNET_IDS=()

for entry in "${PUBLIC_SUBNETS[@]}"; do
  IFS=':' read -r name az cidr <<<"$entry"
  PUBLIC_SUBNET_IDS+=("$(ensure_subnet "$VPC_ID" "$name" "$az" "$cidr" true)")
done

for entry in "${PRIVATE_SUBNETS[@]}"; do
  IFS=':' read -r name az cidr <<<"$entry"
  PRIVATE_SUBNET_IDS+=("$(ensure_subnet "$VPC_ID" "$name" "$az" "$cidr" false)")
done

IGW_ID="$(ensure_internet_gateway "$VPC_ID")"
PUBLIC_ROUTE_TABLE_ID="$(ensure_route_table "$VPC_ID" "skillsmd-public-rt")"
PRIVATE_ROUTE_TABLE_ID="$(ensure_route_table "$VPC_ID" "skillsmd-private-rt")"

aws ec2 create-route \
  --profile "$PROFILE" \
  --region "$REGION" \
  --route-table-id "$PUBLIC_ROUTE_TABLE_ID" \
  --destination-cidr-block 0.0.0.0/0 \
  --gateway-id "$IGW_ID" >/dev/null 2>&1 || true

for subnet_id in "${PUBLIC_SUBNET_IDS[@]}"; do
  ensure_route_table_association "$PUBLIC_ROUTE_TABLE_ID" "$subnet_id"
done

for subnet_id in "${PRIVATE_SUBNET_IDS[@]}"; do
  ensure_route_table_association "$PRIVATE_ROUTE_TABLE_ID" "$subnet_id"
done

ECS_SG_ID="$(ensure_security_group "$VPC_ID" "$ECS_SG_NAME" "skills.md ECS tasks")"
RDS_SG_ID="$(ensure_security_group "$VPC_ID" "$RDS_SG_NAME" "skills.md PostgreSQL")"
REDIS_SG_ID="$(ensure_security_group "$VPC_ID" "$REDIS_SG_NAME" "skills.md Redis")"

ensure_sg_ingress "$RDS_SG_ID" "$ECS_SG_ID" 5432 "PostgreSQL from skills.md ECS tasks"
ensure_sg_ingress "$REDIS_SG_ID" "$ECS_SG_ID" 6379 "Redis from skills.md ECS tasks"

ensure_db_subnet_group "${PRIVATE_SUBNET_IDS[@]}"
ensure_cache_subnet_group "${PRIVATE_SUBNET_IDS[@]}"
ensure_db_parameter_group
ensure_cache_parameter_group
ensure_rds_instance "$RDS_SG_ID"
ensure_redis_replication_group "$REDIS_SG_ID"

aws rds describe-db-instances \
  --profile "$PROFILE" \
  --region "$REGION" \
  --db-instance-identifier "$DB_IDENTIFIER" \
  --query 'DBInstances[].{id:DBInstanceIdentifier,status:DBInstanceStatus,engine:Engine,version:EngineVersion,public:PubliclyAccessible,encrypted:StorageEncrypted,backupRetention:BackupRetentionPeriod,deletionProtection:DeletionProtection}' \
  --output table

aws elasticache describe-replication-groups \
  --profile "$PROFILE" \
  --region "$REGION" \
  --replication-group-id "$REDIS_REPLICATION_GROUP" \
  --query 'ReplicationGroups[].{id:ReplicationGroupId,status:Status,engine:Engine,transitEncryption:TransitEncryptionEnabled,atRestEncryption:AtRestEncryptionEnabled,authEnabled:AuthTokenEnabled,snapshotRetention:SnapshotRetentionLimit}' \
  --output table
