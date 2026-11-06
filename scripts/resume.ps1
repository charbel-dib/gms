# Restart GMS after a pause: starts the database, then the app servers.
#   .\scripts\resume.ps1            (1 server, enough for demos)
#   .\scripts\resume.ps1 -Count 2   (2 servers, for real clients)
param([string]$Region = "", [int]$Count = 1, [string]$Cluster = "gms-prod", [string]$Service = "app", [string]$Db = "gms-prod")
$ErrorActionPreference = "Stop"
if (-not $Region) { $Region = (aws configure get region) }
$resource = "service/$Cluster/$Service"

$status = aws rds describe-db-instances --region $Region --db-instance-identifier $Db --query "DBInstances[0].DBInstanceStatus" --output text
if ($status -eq "stopped") {
  Write-Host "Starting the database..."
  aws rds start-db-instance --region $Region --db-instance-identifier $Db | Out-Null
} elseif ($status -eq "stopping") {
  Write-Host "The database is still stopping; waiting for it before restarting it..."
  aws rds wait db-instance-stopped --region $Region --db-instance-identifier $Db
  aws rds start-db-instance --region $Region --db-instance-identifier $Db | Out-Null
}
Write-Host "Waiting for the database to be available (5-10 minutes)..."
aws rds wait db-instance-available --region $Region --db-instance-identifier $Db

Write-Host "Starting $Count app server(s)..."
aws application-autoscaling register-scalable-target --region $Region --service-namespace ecs --scalable-dimension ecs:service:DesiredCount --resource-id $resource --min-capacity $Count --max-capacity ([Math]::Max($Count, 4)) | Out-Null
aws ecs update-service --region $Region --cluster $Cluster --service $Service --desired-count $Count | Out-Null
aws ecs wait services-stable --region $Region --cluster $Cluster --services $Service

Push-Location (Join-Path $PSScriptRoot "..\infra\terraform")
$url = terraform output -raw app_url 2>$null
Pop-Location
Write-Host ""
Write-Host "GMS is back online: $url"
