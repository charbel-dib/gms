#!/usr/bin/env bash
# Manual deploy from your computer (needs Docker + AWS CLI logged in):
#   ./scripts/deploy.sh            builds, pushes :latest and a dated tag, restarts the ECS service
set -euo pipefail
REGION="${AWS_REGION:-eu-central-1}"
CLUSTER="${ECS_CLUSTER:-gms-prod}"
SERVICE="${ECS_SERVICE:-app}"
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
REPO="$ACCOUNT.dkr.ecr.$REGION.amazonaws.com/gms"
TAG=$(date +%Y%m%d-%H%M)

aws ecr get-login-password --region "$REGION" | docker login --username AWS --password-stdin "$ACCOUNT.dkr.ecr.$REGION.amazonaws.com"
docker build --platform linux/amd64 --build-arg APP_VERSION="$TAG" -t "$REPO:$TAG" -t "$REPO:latest" .
docker push "$REPO:$TAG"
docker push "$REPO:latest"
aws ecs update-service --region "$REGION" --cluster "$CLUSTER" --service "$SERVICE" --force-new-deployment > /dev/null
echo "Deploying $TAG… waiting for the service to become stable"
aws ecs wait services-stable --region "$REGION" --cluster "$CLUSTER" --services "$SERVICE"
echo "Done: $TAG is live."
