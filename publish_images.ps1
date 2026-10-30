# Build the SiteVision backend + frontend images (linux/amd64) and publish them to Amazon ECR and, optionally, Docker Hub.
#
#   .\publish_images.ps1 -Version v1                                   build only (local images, nothing pushed)
#   .\publish_images.ps1 -Version v1 -Push                             build once, push to ECR
#   .\publish_images.ps1 -Version v1 -Push -DockerHubNamespace <name>  ... and to Docker Hub as well
#
# Each image is built ONCE into the local image store; that same local image is then pushed to every registry, so ECR
# and Docker Hub receive the same digest. Tags pushed: <Version> and latest. The ECR repositories are tag-immutable
# (only "latest" may be overwritten), so a version can be published only once: an existing version is refused up front.
#
# No secrets are baked into the images (see the .dockerignore files). Registry logins are never printed:
#   - ECR: an ECR login token is too long for the Windows credential store, so the ECR push runs with a TEMPORARY Docker
#     config directory (12 hour token, deleted at the end). Your normal Docker config is not modified.
#   - Docker Hub: uses the account Docker Desktop is already signed in to (run `docker login` first if it is not).
param(
  [Parameter(Mandatory = $true)][ValidatePattern('^v\d+(\.\d+)*$')][string]$Version,
  [switch]$Push,
  [string]$DockerHubNamespace = '',
  [switch]$SkipEcr,
  [string]$Region = 'ap-south-1',
  [string]$AccountId = '196338354246',
  [string]$ViteApiBaseUrl = '/'
)
$ErrorActionPreference = 'Continue'   # native tools write progress to stderr (PS 5.1 treats that as an error); every call is checked via Invoke-Native
Set-Location $PSScriptRoot

function Invoke-Native { param([string]$What) if ($LASTEXITCODE -ne 0) { throw "$What failed (exit code $LASTEXITCODE)" } }

docker info --format '{{.ServerVersion}}' | Out-Null; Invoke-Native 'Docker is not running:'
$ecrHost = "$AccountId.dkr.ecr.$Region.amazonaws.com"
$images = @(
  @{ Name = 'sitevision-backend';  Context = './backend';  Args = @() },
  @{ Name = 'sitevision-frontend'; Context = './frontend'; Args = @('--build-arg', "VITE_API_BASE_URL=$ViteApiBaseUrl") }
)
if ($Push -and $SkipEcr -and -not $DockerHubNamespace) { throw 'Nothing to push to: remove -SkipEcr or give -DockerHubNamespace.' }

if ($Push -and -not $SkipEcr) {
  foreach ($i in $images) {
    # "tag not found" is the expected answer; PowerShell 5.1 treats native stderr as an error, so relax it for this probe.

    $existing = aws ecr describe-images --repository-name $i.Name --image-ids imageTag=$Version --region $Region --query 'imageDetails[0].imageDigest' --output text 2>$null
    $found = ($LASTEXITCODE -eq 0 -and $existing)

    if ($found) { throw "ECR $($i.Name):$Version already exists (tags are immutable). Pick a new version." }
  }
}

# 1. Build once, locally.
foreach ($i in $images) {
  $local = "$($i.Name):$Version"
  Write-Host "==> build $local (linux/amd64)"
  # --pull + --no-cache-filter runtime: start from the freshest base image and always re-run the OS patch step
  # (apk/apt upgrade) instead of reusing a cached layer, so published images carry current security patches.
  & docker buildx build --platform linux/amd64 --pull --no-cache-filter runtime @($i.Args) --load -t $local $i.Context; Invoke-Native "Build of $($i.Name)"
}
if (-not $Push) { Write-Host 'Built locally; nothing pushed (add -Push).'; return }

# 2. Push the same local images.
if ($DockerHubNamespace) {
  foreach ($i in $images) {
    foreach ($t in @($Version, 'latest')) {
      $ref = "$DockerHubNamespace/$($i.Name):$t"
      docker tag "$($i.Name):$Version" $ref; Invoke-Native 'tag'
      Write-Host "==> push $ref"
      docker push $ref; Invoke-Native "Push of $ref"
    }
  }
}
if (-not $SkipEcr) {
  $originalConfig = $env:DOCKER_CONFIG
  $tempConfig = Join-Path $env:TEMP ("sv-docker-ecr-" + [guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $tempConfig | Out-Null
  try {
    # `docker login` would hand the (too long) token to the Windows credential store and fail, so the auth entry is
    # written straight into the temporary config instead; a config that already holds auth uses Docker's file store.
    $token = (aws ecr get-login-password --region $Region | Out-String).Trim(); Invoke-Native 'aws ecr get-login-password'
    if (-not $token) { throw 'Could not get an ECR login token (check your AWS credentials).' }
    $auth = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes("AWS:$token"))
    $token = $null
    Set-Content -Path (Join-Path $tempConfig 'config.json') -Value (@{ auths = @{ $ecrHost = @{ auth = $auth } } } | ConvertTo-Json -Depth 4) -Encoding ascii
    $auth = $null
    $env:DOCKER_CONFIG = $tempConfig
    foreach ($i in $images) {
      foreach ($t in @($Version, 'latest')) {
        $ref = "$ecrHost/$($i.Name):$t"
        docker tag "$($i.Name):$Version" $ref; Invoke-Native 'tag'
        Write-Host "==> push $ref"
        docker push $ref; Invoke-Native "Push of $ref"
      }
    }
  } finally {
    $env:DOCKER_CONFIG = $originalConfig
    if (-not $originalConfig) { Remove-Item Env:DOCKER_CONFIG -ErrorAction SilentlyContinue }
    Remove-Item -Recurse -Force $tempConfig -ErrorAction SilentlyContinue
  }
}
Write-Host 'Done.'
