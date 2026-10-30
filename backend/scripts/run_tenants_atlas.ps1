# Multi-tenant SiteVision backend against the REAL MongoDB Atlas tenant databases (development environment).
#
#   My Home  -> SiteVisionMyHome   (from  %USERPROFILE%\.sitevision-secrets\myhome_target.xml)
#   Kohinoor -> SiteVisionKohinoor (from  %USERPROFILE%\.sitevision-secrets\kohinoor_target.xml)
#
# The tenant is chosen by the SERVER from the e-mail DOMAIN at sign-in (TENANT_RESOLUTION=email):
#   @myhomeconstructions.com -> SiteVisionMyHome      @kohinoorpune.com -> SiteVisionKohinoor
# An address on any other domain is refused. After sign-in the signed token carries the tenant (the Host header and
# any client-supplied tenant id are never used). One URL serves every tenant. There is no default tenant, no local
# demo database and no fallback to the legacy `virtual_tour` database.
# Credentials are decrypted in memory (Windows DPAPI), handed to the child process through its environment only,
# and never printed, logged or written to a file.
#
# It does NOT touch the existing single-tenant backend on :8002 and is not the production cutover.
#
#   .\scripts\run_tenants_atlas.ps1            start on http://localhost:8010
#   .\scripts\run_tenants_atlas.ps1 -Stop      stop only the process this script started
#   frontend:  npm run dev:kohinoor  (http://localhost:5180)   npm run dev:myhome  (http://localhost:5181)
param(
  [int]$Port = 8010,
  [switch]$Stop
)
$ErrorActionPreference = 'Stop'
$backend = Split-Path -Parent $PSScriptRoot
$secrets = Join-Path $env:USERPROFILE '.sitevision-secrets'
$logDir = Join-Path $env:USERPROFILE '.sitevision-logs'
$pidFile = Join-Path $logDir "tenants-$Port.pid"

if ($Port -eq 8002) { throw 'Port 8002 belongs to the existing single-tenant backend.' }

if ($Stop) {
  if (-not (Test-Path $pidFile)) { Write-Host "No PID file for port $Port; nothing to stop."; return }
  $ids = (Get-Content $pidFile) -split '\s+' | Where-Object { $_ }
  foreach ($id in $ids) {
    $p = Get-CimInstance Win32_Process -Filter "ProcessId=$id" -ErrorAction SilentlyContinue
    if (-not $p) { Write-Host "PID $id already exited."; continue }
    if ($p.CommandLine -match "uvicorn app\.main:app .*--port $Port") { Stop-Process -Id $id -Force; Write-Host "Stopped PID $id" }
    else { Write-Host "PID $id is no longer this script's backend (command line differs); left alone." }
  }
  Remove-Item $pidFile -ErrorAction SilentlyContinue
  return
}

if (Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue) { throw "Port $Port is already in use." }

function Get-Secret([string]$name) {
  $f = Join-Path $secrets "$name.xml"
  if (-not (Test-Path $f)) { throw "Missing secret file $f (create it with Read-Host -AsSecureString | Export-Clixml)." }
  $ss = Import-Clixml $f
  $b = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($ss)
  try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($b) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b) }
}

New-Item -ItemType Directory -Force $logDir | Out-Null
$vars = 'MULTI_TENANT_ENABLED', 'TENANT_RESOLUTION', 'TENANT_MYHOME_MONGO_URI', 'TENANT_KOHINOOR_MONGO_URI', 'TENANT_ALLOW_SELF_REGISTRATION', 'TENANT_DEV_DEFAULT'
try {
  $env:MULTI_TENANT_ENABLED = 'true'
  $env:TENANT_RESOLUTION = 'email'
  $env:TENANT_MYHOME_MONGO_URI = Get-Secret 'myhome_target'
  $env:TENANT_KOHINOOR_MONGO_URI = Get-Secret 'kohinoor_target'
  $env:TENANT_ALLOW_SELF_REGISTRATION = 'false'
  $env:TENANT_DEV_DEFAULT = ''                       # no default tenant: the e-mail domain decides
  $p = Start-Process -FilePath (Join-Path $backend '.venv\Scripts\python.exe') `
        -ArgumentList '-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', $Port `
        -WorkingDirectory $backend -PassThru -WindowStyle Hidden `
        -RedirectStandardOutput (Join-Path $logDir "tenants-$Port.out.log") -RedirectStandardError (Join-Path $logDir "tenants-$Port.err.log")
  Start-Sleep 2
  $kids = @(Get-CimInstance Win32_Process -Filter "ParentProcessId=$($p.Id)" | ForEach-Object { $_.ProcessId })
  (@($p.Id) + $kids) -join ' ' | Set-Content $pidFile
  Write-Host "Multi-tenant backend (Atlas) started on 127.0.0.1:$Port  (PID $($p.Id))"
  Write-Host "  API: http://localhost:$Port   (e-mail @myhomeconstructions.com -> SiteVisionMyHome, @kohinoorpune.com -> SiteVisionKohinoor)"
  Write-Host "  logs    : $logDir\tenants-$Port.out.log / .err.log      stop: .\scripts\run_tenants_atlas.ps1 -Stop"
} finally {
  foreach ($v in $vars) { Remove-Item "Env:$v" -ErrorAction SilentlyContinue }
}
