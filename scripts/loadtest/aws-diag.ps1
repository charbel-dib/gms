# What the database and the app servers did over the last hours, for the load test.
#   .\scripts\loadtest\aws-diag.ps1
# Writes loadtest-results\aws-diag.txt. Reads only: changes nothing on AWS.
param([string]$Region = "", [string]$Db = "gms-prod", [string]$Cluster = "gms-prod", [string]$Service = "app", [int]$Hours = 16)
if (-not $Region) { $Region = (aws configure get region) }
if (-not $Region) { $Region = "eu-west-3" }
$out = Join-Path $PSScriptRoot "..\..\loadtest-results\aws-diag.txt"
New-Item -ItemType Directory -Force -Path (Split-Path $out) | Out-Null
$end = (Get-Date).ToUniversalTime()
$start = $end.AddHours(-$Hours)
$fmt = "yyyy-MM-ddTHH:mm:ssZ"
$lines = @("GMS AWS diagnostics, $($end.ToString($fmt)), last $Hours hours, region $Region", "")

$lines += "== Database instance"
$lines += (aws rds describe-db-instances --region $Region --db-instance-identifier $Db --query "DBInstances[0].[DBInstanceClass,DBInstanceStatus,AllocatedStorage,StorageType,Iops,StorageThroughput,DBParameterGroups[0].DBParameterGroupName]" --output text)
$lines += ""

foreach ($m in @("CPUUtilization", "CPUCreditBalance", "CPUCreditUsage", "CPUSurplusCreditBalance", "CPUSurplusCreditsCharged", "FreeableMemory", "ReadIOPS", "WriteIOPS", "ReadThroughput", "DiskQueueDepth", "DatabaseConnections", "SwapUsage", "EBSIOBalance%", "EBSByteBalance%")) {
  $lines += "== RDS $m (UTC time, average, maximum)"
  $r = aws cloudwatch get-metric-statistics --region $Region --namespace AWS/RDS --metric-name $m `
    --dimensions Name=DBInstanceIdentifier,Value=$Db --start-time $start.ToString($fmt) --end-time $end.ToString($fmt) `
    --period 600 --statistics Average Maximum --output json | ConvertFrom-Json
  foreach ($p in ($r.Datapoints | Sort-Object Timestamp)) {
    $lines += ("{0}  {1,14:N1}  {2,14:N1}" -f ([datetime]$p.Timestamp).ToUniversalTime().ToString("MM-dd HH:mm"), $p.Average, $p.Maximum)
  }
  $lines += ""
}

$lines += "== App servers CPU and memory (ECS, average, maximum)"
foreach ($m in @("CPUUtilization", "MemoryUtilization")) {
  $lines += "-- $m"
  $r = aws cloudwatch get-metric-statistics --region $Region --namespace AWS/ECS --metric-name $m `
    --dimensions Name=ClusterName,Value=$Cluster Name=ServiceName,Value=$Service --start-time $start.ToString($fmt) --end-time $end.ToString($fmt) `
    --period 600 --statistics Average Maximum --output json | ConvertFrom-Json
  foreach ($p in ($r.Datapoints | Sort-Object Timestamp)) {
    $lines += ("{0}  {1,8:N1}  {2,8:N1}" -f ([datetime]$p.Timestamp).ToUniversalTime().ToString("MM-dd HH:mm"), $p.Average, $p.Maximum)
  }
}
$lines += ""

$lines += "== Service events (newest first)"
$lines += (aws ecs describe-services --region $Region --cluster $Cluster --services $Service --query "services[0].events[0:25].[createdAt,message]" --output text)
$lines += ""

$lines += "== Why the last app servers stopped"
$arns = aws ecs list-tasks --region $Region --cluster $Cluster --service-name $Service --desired-status STOPPED --query "taskArns[0:10]" --output text
if ($arns -and $arns -ne "None") {
  $lines += (aws ecs describe-tasks --region $Region --cluster $Cluster --tasks ($arns -split "\s+") --query "tasks[].[stoppedAt,stopCode,stoppedReason,containers[0].exitCode,containers[0].reason]" --output text)
}

$lines | Out-File -Encoding utf8 $out
Write-Host "Written: $out"
