# LOCAL DEMO ONLY (not production): run a SEPARATE backend in multi-tenant mode against the loopback demo
# MongoDB (sitevision-local-demo-mongo, 127.0.0.1:27997). It does not touch, stop or reconfigure the normal
# backend on :8002, never uses the production Atlas databases, and holds no secrets.
#
#   .\scripts\run_local_tenant_demo.ps1 -Tenant kohinoor        # API on http://localhost:8003
#   (second terminal)  cd ..\frontend; $env:VITE_API_BASE_URL='http://localhost:8003'; $env:VITE_TENANT='kohinoor'; npx vite --port 5180
#   open http://localhost:5180/login  and sign in with a demo account (passwords: the restricted LOCAL-DEMO file
#   under %USERPROFILE%\.sitevision-secrets)
param(
  [ValidateSet('kohinoor', 'myhome')] [string]$Tenant = 'kohinoor',
  [int]$Port = 8003,
  [string]$DemoMongo = 'mongodb://127.0.0.1:27997'
)
$ErrorActionPreference = 'Stop'
if (([Uri]$DemoMongo).Host -notin @('127.0.0.1', 'localhost')) { throw 'Local demo mode only talks to a loopback MongoDB.' }
if ($Port -eq 8002) { throw 'Port 8002 belongs to the normal backend.' }
if (Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue) { throw "Port $Port is already in use." }

$backend = Split-Path -Parent $PSScriptRoot
$env:MULTI_TENANT_ENABLED = 'true'
$env:TENANT_MYHOME_MONGO_URI = $DemoMongo
$env:TENANT_KOHINOOR_MONGO_URI = $DemoMongo
$env:TENANT_DEV_DEFAULT = $Tenant          # localhost -> this tenant (development only; ignored in production)
$env:TENANT_ALLOW_SELF_REGISTRATION = 'false'
try {
  $p = Start-Process -FilePath (Join-Path $backend '.venv\Scripts\python.exe') `
        -ArgumentList '-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', $Port `
        -WorkingDirectory $backend -PassThru -WindowStyle Hidden
  Write-Host "Local demo API ($Tenant) started: http://localhost:$Port  (PID $($p.Id)). Stop it with: Stop-Process -Id $($p.Id)"
} finally {
  foreach ($v in 'MULTI_TENANT_ENABLED','TENANT_MYHOME_MONGO_URI','TENANT_KOHINOOR_MONGO_URI','TENANT_DEV_DEFAULT','TENANT_ALLOW_SELF_REGISTRATION') { Remove-Item "Env:$v" -ErrorAction SilentlyContinue }
}
