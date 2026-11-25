param([Parameter(Mandatory = $true)][string]$NeoExe)
$ErrorActionPreference = 'Stop'
$epxInfo = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'runtime\server.json') -Raw | ConvertFrom-Json
if ($epxInfo.address -notmatch '^127\.0\.0\.1:\d{4,5}$') { throw '앱 주소가 올바르지 않습니다.' }
$epxHealth = Invoke-RestMethod -Uri "http://$($epxInfo.address)/api/health" -TimeoutSec 3
if ($epxHealth.app -ne 'Energy Peak Explorer' -or $epxHealth.pid -ne $epxInfo.pid) { throw '현재 앱 프로세스 확인에 실패했습니다. 중지하지 않았습니다.' }
$epxProcess = Get-Process -Id $epxInfo.pid
$epxExpectedExe = (Get-Item -LiteralPath $NeoExe).FullName
if ($epxProcess.Path -ne $epxExpectedExe) { throw '실행 파일이 다릅니다. 중지하지 않았습니다.' }
$epxStarted = if ($epxInfo.startedAt -is [DateTime]) { $epxInfo.startedAt.ToUniversalTime() } else { [DateTimeOffset]::Parse([string]$epxInfo.startedAt).UtcDateTime }
if ([Math]::Abs(($epxProcess.StartTime.ToUniversalTime() - $epxStarted).TotalSeconds) -gt 120) { throw '프로세스 시작 시각이 다릅니다. 중지하지 않았습니다.' }
Stop-Process -Id $epxInfo.pid
Write-Output 'Energy Peak Explorer 앱만 중지했습니다. 원본과 DB, 기존 Neo는 보존됩니다.'
