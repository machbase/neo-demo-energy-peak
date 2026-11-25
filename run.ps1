param([Parameter(Mandatory = $true)][string]$NeoExe)
$ErrorActionPreference = 'Stop'
& $NeoExe jsh -v "/energy=$PSScriptRoot" /energy/server/app.js
exit $LASTEXITCODE
