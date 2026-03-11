[CmdletBinding()]
param(
  [string]$TargetPath = ".",
  [string]$ProjectName = "",
  [switch]$CreatePlanDoc = $true
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$target = Resolve-Path $TargetPath
$gitignorePath = Join-Path $target ".gitignore"
$templatePath = Join-Path $PSScriptRoot "..\templates\security\.gitignore.template"
$workflowSrc = Join-Path $PSScriptRoot "..\.github\workflows\secret-scan.yml"
$workflowDstDir = Join-Path $target ".github\workflows"
$workflowDst = Join-Path $workflowDstDir "secret-scan.yml"
$planTemplatePath = Join-Path $PSScriptRoot "..\templates\security\PROJECT_PLAN_TEMPLATE.md"
$docsDir = Join-Path $target "docs"
$planDst = Join-Path $docsDir "PROJECT_PLAN.md"

if (-not (Test-Path $templatePath)) {
  throw "Template not found: $templatePath"
}
if (-not (Test-Path $workflowSrc)) {
  throw "Workflow template not found: $workflowSrc"
}
if ($CreatePlanDoc -and -not (Test-Path $planTemplatePath)) {
  throw "Plan template not found: $planTemplatePath"
}

if (-not (Test-Path $gitignorePath)) {
  New-Item -ItemType File -Path $gitignorePath -Force | Out-Null
}

$existing = Get-Content $gitignorePath -Encoding utf8
$template = Get-Content $templatePath -Encoding utf8
$toAdd = @()
foreach ($line in $template) {
  if ([string]::IsNullOrWhiteSpace($line)) { continue }
  if ($existing -notcontains $line) { $toAdd += $line }
}

if ($toAdd.Count -gt 0) {
  Add-Content $gitignorePath -Value "`n# Added by security bootstrap" -Encoding utf8
  Add-Content $gitignorePath -Value $toAdd -Encoding utf8
}

New-Item -ItemType Directory -Path $workflowDstDir -Force | Out-Null
Copy-Item $workflowSrc $workflowDst -Force

if ($CreatePlanDoc) {
  New-Item -ItemType Directory -Path $docsDir -Force | Out-Null
  if (-not (Test-Path $planDst)) {
    $content = Get-Content $planTemplatePath -Raw -Encoding utf8
    if ($ProjectName) {
      $content = $content -replace '- 專案名稱：', "- 專案名稱：$ProjectName"
    }
    Set-Content $planDst -Value $content -Encoding utf8
  }
}

Write-Host "Security baseline applied to: $target"
Write-Host "- Updated .gitignore"
Write-Host "- Installed .github/workflows/secret-scan.yml"
if ($CreatePlanDoc) {
  Write-Host "- Ensured docs/PROJECT_PLAN.md"
}
