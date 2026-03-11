[CmdletBinding()]
param(
  [string]$Workflow = "Sync Efficiency Stats",
  [string]$Ref = "main",
  [ValidateSet("all_years", "current_year")]
  [string]$SyncScope = "all_years",
  [int]$DiscoverTimeoutSec = 60,
  [int]$WatchIntervalSec = 5
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Assert-Command {
  param([string]$Name)
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Command '$Name' not found in PATH."
  }
}

function Run-Gh {
  param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Args)
  $output = & gh @Args 2>&1
  if ($LASTEXITCODE -ne 0) {
    $msg = ($output | Out-String).Trim()
    throw "gh $($Args -join ' ') failed.`n$msg"
  }
  return $output
}

try {
  Assert-Command -Name "gh"

  & gh auth status -h github.com *> $null
  if ($LASTEXITCODE -ne 0) {
    throw "GitHub CLI is not authenticated. Run: gh auth login -h github.com -s repo,workflow"
  }

  Write-Host "Triggering workflow '$Workflow' on ref '$Ref' (sync_scope=$SyncScope)..."
  $triggerAtUtc = (Get-Date).ToUniversalTime()
  Run-Gh workflow run "$Workflow" --ref "$Ref" --field "sync_scope=$SyncScope" | Out-Null

  Write-Host "Locating newly created run..."
  $deadline = (Get-Date).AddSeconds($DiscoverTimeoutSec)
  $run = $null

  while ((Get-Date) -lt $deadline) {
    $raw = Run-Gh run list --workflow "$Workflow" --branch "$Ref" --limit 10 --json "databaseId,createdAt,status,conclusion,url"
    $runs = $raw | ConvertFrom-Json

    foreach ($candidate in $runs) {
      $createdAtUtc = [DateTime]::Parse($candidate.createdAt).ToUniversalTime()
      if ($createdAtUtc -ge $triggerAtUtc.AddSeconds(-3)) {
        $run = $candidate
        break
      }
    }

    if ($run) { break }
    Start-Sleep -Seconds 2
  }

  if (-not $run) {
    throw "Triggered but failed to find the new run within ${DiscoverTimeoutSec}s. Check: gh run list --workflow `"$Workflow`" --branch `"$Ref`""
  }

  $runId = [string]$run.databaseId
  Write-Host "Run ID: $runId"
  Write-Host "Run URL: $($run.url)"
  Write-Host "Watching run progress..."

  & gh run watch $runId --interval $WatchIntervalSec --exit-status
  $watchExit = $LASTEXITCODE

  if ($watchExit -eq 0) {
    Write-Host "Workflow completed successfully."
    exit 0
  }

  Write-Host "Workflow failed. Showing failed-step logs..."
  & gh run view $runId --log-failed
  if ($LASTEXITCODE -ne 0) {
    & gh run view $runId --log
  }
  exit 1
}
catch {
  Write-Error $_.Exception.Message
  exit 1
}
