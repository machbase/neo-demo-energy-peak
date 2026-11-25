param([Parameter(Mandatory = $true)][string]$NeoExe)
$ErrorActionPreference = 'Stop'
$epxRoot = Split-Path -Parent $PSScriptRoot
$epxSource = Join-Path $epxRoot 'data\household_power_consumption.txt'
$epxProfile = Join-Path $epxRoot 'reports\source-profile.json'
if (-not (Test-Path -LiteralPath $epxProfile)) { throw '먼저 python scripts/profile.py를 실행하세요.' }
$epxExpected = Get-Content -LiteralPath $epxProfile -Raw | ConvertFrom-Json
$epxHash = (Get-FileHash -LiteralPath $epxSource -Algorithm SHA256).Hash.ToLowerInvariant()
if ($epxHash -ne $epxExpected.sha256) { throw '원본 해시가 품질 조사 결과와 다릅니다. 적재하지 않았습니다.' }
& $NeoExe jsh -v "/energy=$epxRoot" /energy/scripts/import.js $epxHash
if ($LASTEXITCODE -ne 0) { throw "적재 또는 검증 실패(exit $LASTEXITCODE). 자동 재입력하지 말고 runtime/import.json을 확인하세요." }
