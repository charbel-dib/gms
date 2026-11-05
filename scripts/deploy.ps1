# Deploy GMS to AWS from Windows (PowerShell). Needs Docker Desktop running and the AWS CLI configured.
#   .\scripts\deploy.ps1                 build, push, restart the ECS service
#   .\scripts\deploy.ps1 -PushOnly       build and push only (first deployment, before terraform apply)
param(
  [string]$Region = "",
  [string]$Cluster = "gms-prod",
  [string]$Service = "app",
  [switch]$PushOnly
)
$ErrorActionPreference = "Stop"
Set-Location (Split-Path $PSScriptRoot -Parent)

# Region: -Region, else the one set with 'aws configure'
if (-not $Region) { $Region = (aws configure get region) }
if (-not $Region) { throw "No AWS region: run 'aws configure' or pass -Region eu-west-3" }
Write-Host "Region: $Region"

$account = aws sts get-caller-identity --query Account --output text
if (-not $account) { throw "AWS CLI is not configured: run 'aws configure' first." }
$registry = "$account.dkr.ecr.$Region.amazonaws.com"
$repo = "$registry/gms"
$tag = Get-Date -Format "yyyyMMdd-HHmm"

Write-Host "Logging in to $registry"
# Windows PowerShell 5 alters text piped to native programs, which breaks --password-stdin: pass it directly.
$password = (aws ecr get-login-password --region $Region).Trim()
if (-not $password) { throw "Could not get an ECR login token. Did 'terraform apply -target=aws_ecr_repository.app' run in this region?" }
$ErrorActionPreference = "Continue"   # docker prints a harmless warning on stderr
docker login --username AWS --password $password $registry
$ErrorActionPreference = "Stop"
if ($LASTEXITCODE -ne 0) { throw "docker login failed" }

Write-Host "Building $repo`:$tag"
docker build --platform linux/amd64 --build-arg APP_VERSION=$tag -t "$repo`:$tag" -t "$repo`:latest" .
if ($LASTEXITCODE -ne 0) { throw "docker build failed" }
docker push "$repo`:$tag"; if ($LASTEXITCODE -ne 0) { throw "docker push failed" }
docker push "$repo`:latest"; if ($LASTEXITCODE -ne 0) { throw "docker push failed" }

if ($PushOnly) { Write-Host "Image pushed: $tag"; exit 0 }

Write-Host "Rolling out on ECS ($Cluster/$Service)"
aws ecs update-service --region $Region --cluster $Cluster --service $Service --force-new-deployment | Out-Null
aws ecs wait services-stable --region $Region --cluster $Cluster --services $Service
Write-Host "Done: $tag is live."
