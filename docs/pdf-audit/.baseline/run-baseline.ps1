$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
Set-Location $root
$out = 'docs/pdf-audit/.baseline'

function Step($name, $cmd) {
  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  $log = Join-Path $out "$name.log"
  Write-Output "[baseline] starting $name : $cmd"
  cmd /c "$cmd" *> $log
  $code = $LASTEXITCODE
  $sw.Stop()
  $result = [pscustomobject]@{ step = $name; command = $cmd; exit = $code; seconds = [math]::Round($sw.Elapsed.TotalSeconds, 1); log = $log }
  $result | ConvertTo-Json -Compress | Add-Content (Join-Path $out 'results.jsonl')
  Write-Output "[baseline] $name exit=$code seconds=$($result.seconds)"
}

Step 'typecheck' 'pnpm typecheck'
Step 'test' 'pnpm test'
Step 'build' 'pnpm build'
Step 'bundle' 'pnpm test:bundle'
Write-Output '[baseline] done'
