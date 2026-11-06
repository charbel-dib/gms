# Put GMS on pause between demos: stops the app servers and the database. Nothing is deleted.
#   .\scripts\pause.ps1
# Resume with .\scripts\resume.ps1 (about 10 minutes).
param([string]$Region = "", [string]$Cluster = "gms-prod", [string]$Service = "app", [string]$Db = "gms-prod")
$ErrorActionPreference = "Stop"
if (-not $Region) { $Region = (aws configure get region) }
$resource = "service/$Cluster/$Service"

Write-Host "Stopping the app servers (ECS -> 0 tasks)"
# autoscaling would otherwise start them again
aws application-autoscaling register-scalable-target --region $Region --service-namespace ecs --scalable-dimension ecs:service:DesiredCount --resource-id $resource --min-capacity 0 --max-capacity 0 | Out-Null
aws ecs update-service --region $Region --cluster $Cluster --service $Service --desired-count 0 | Out-Null

Write-Host "Stopping the database (RDS)"
$status = aws rds describe-db-instances --region $Region --db-instance-identifier $Db --query "DBInstances[0].DBInstanceStatus" --output text
if ($status -eq "available") {
  aws rds stop-db-instance --region $Region --db-instance-identifier $Db | Out-Null
  Write-Host "Database stopping (takes a few minutes)."
} else {
  Write-Host "Database is '$status', not stopping it now. Run this script again in a few minutes if it is 'starting'."
}
Write-Host ""
Write-Host "Paused. Data is kept. Note: AWS restarts a stopped database automatically after 7 days;"
Write-Host "run this script again if your break lasts longer."
