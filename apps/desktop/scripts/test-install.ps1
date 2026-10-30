param([string]$InstallerPath, [string]$FailureInstallerPath)
$ErrorActionPreference = 'Stop'
# Installs the real appId: run only on a disposable hosted CI account.
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted') {
  throw 'Installer acceptance requires a disposable GitHub-hosted Windows runner.'
}
$desktopRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$repoRoot = Split-Path (Split-Path $desktopRoot)
. (Join-Path $desktopRoot 'scripts/shell-icons.ps1')
$version = (Get-Content (Join-Path $desktopRoot 'package.json') | ConvertFrom-Json).version
if (-not $InstallerPath) { $InstallerPath = Join-Path $repoRoot "release/WhyJ-Quant-Setup-$version-win-x64.exe" }
$installer = (Resolve-Path -LiteralPath $InstallerPath).Path
$installDir = Join-Path $env:RUNNER_TEMP '安装 验收\WhyJ Quant'
$exe = Join-Path $installDir 'WhyJ Quant.exe'
$uninstallRoot = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall'
function Get-InstalledApp {
  if (-not (Test-Path -LiteralPath $uninstallRoot)) { return @() }
  @(Get-ChildItem $uninstallRoot | Get-ItemProperty | Where-Object { $_.DisplayName -match '^WhyJ Quant(?: \d.*)?$' })
}
if ((Get-InstalledApp).Count -ne 0 -or (Test-Path -LiteralPath $installDir)) {
  throw 'Expected a clean account without an existing WhyJ Quant installation.'
}
if ([IO.Path]::GetPathRoot($installDir) -eq [IO.Path]::GetPathRoot($env:SystemRoot)) {
  throw 'Acceptance must install on a non-system drive.'
}
$dataDir = Join-Path $env:APPDATA 'WhyJ Quant\workspace\.ohquant'
New-Item -ItemType Directory -Path $dataDir -Force | Out-Null
$sentinel = Join-Path $dataDir 'installer-acceptance.txt'
$marker = [Guid]::NewGuid().ToString()
Set-Content -LiteralPath $sentinel -Value $marker -NoNewline
function Assert-InstalledApp {
  if (-not (Test-Path -LiteralPath $exe)) {
    Get-InstalledApp | Select-Object DisplayName, DisplayVersion, InstallLocation | ConvertTo-Json | Write-Host
    throw "Installed executable missing: $exe"
  }
  if ((Get-InstalledApp).Count -ne 1) { throw 'Per-user uninstall registration missing or duplicated.' }
  if ((Get-InstalledApp)[0].DisplayVersion -ne $version) { throw 'Registered version does not match the installer.' }
  if ((Get-Content -LiteralPath $sentinel -Raw) -ne $marker) { throw 'Research data changed during installation.' }
  # WScript.Shell.TargetPath replaces non-ANSI characters with '?'. Use the
  # Unicode-aware Windows shell link object to inspect Chinese destinations.
  $shell = New-Object -ComObject Shell.Application
  foreach ($folder in @([Environment]::GetFolderPath('DesktopDirectory'), [Environment]::GetFolderPath('Programs'))) {
    $link = Join-Path $folder 'WhyJ Quant.lnk'
    if (-not (Test-Path -LiteralPath $link)) { throw "Shortcut missing: $link" }
    $shortcut = $shell.Namespace($folder).ParseName('WhyJ Quant.lnk').GetLink
    Assert-ShortcutIcon $shortcut $exe
  }
}
function Install-App([string[]]$InstallerArguments) {
  $process = Start-Process -FilePath $installer -ArgumentList $InstallerArguments -PassThru -Wait -WindowStyle Hidden
  if ($process.ExitCode -ne 0) { throw "Installer failed: $($process.ExitCode)" }
  Assert-InstalledApp
}
# NSIS requires /D last, with no quotes around its value, including spaces.
Install-App @('/S', '/currentuser', "/D=$installDir")
Write-Host 'PASS first install: non-system drive, Unicode/spaces, per-user shortcuts, data retained'
# No /D: the installer must recover the previous folder from its own registry.
Install-App @('/S', '/currentuser')
Write-Host 'PASS reinstall: selected directory and existing research data retained'
if ($FailureInstallerPath) {
  $before = (Get-FileHash -LiteralPath $exe -Algorithm SHA256).Hash
  $failure = Start-Process -FilePath $FailureInstallerPath -ArgumentList '/S' -PassThru -Wait -WindowStyle Hidden
  if ($failure.ExitCode -ne 2) { throw "Expected online checksum failure exit 2, got $($failure.ExitCode)" }
  Assert-InstalledApp
  if ((Get-FileHash -LiteralPath $exe -Algorithm SHA256).Hash -ne $before) { throw 'Failed download changed the installed executable.' }
  Write-Host 'PASS rejected online download: installed executable, registration, shortcuts and research data retained'
}
& node (Join-Path $desktopRoot 'scripts/check-package.mjs') $installDir
if ($LASTEXITCODE -ne 0) { throw 'Installed payload and Python runtime checks failed' }
$env:WHYJ_SMOKE_EXE = $exe
$evidence = Join-Path $repoRoot 'output/playwright/desktop'
New-Item -ItemType Directory -Path $evidence -Force | Out-Null
# Compare actual installed Shell icons with the single authored resource.
# Shortcut arrows are a Windows overlay; Assert-ShortcutIcon verifies their
# underlying executable resource before allowing that overlay in the image.
$iconPaths = @(
  @{ Path = $exe; Shortcut = $false },
  @{ Path = $installer; Shortcut = $false },
  @{ Path = (Join-Path ([Environment]::GetFolderPath('DesktopDirectory')) 'WhyJ Quant.lnk'); Shortcut = $true },
  @{ Path = (Join-Path ([Environment]::GetFolderPath('Programs')) 'WhyJ Quant.lnk'); Shortcut = $true }
)
$fullInstaller = Join-Path $repoRoot "release/WhyJ-Quant-Setup-$version-win-x64.exe"
if (Test-Path -LiteralPath $fullInstaller) { $iconPaths += @{ Path = $fullInstaller; Shortcut = $false } }
foreach ($small in @($false, $true)) {
  $reference = Get-ShellIconBitmap (Join-Path $desktopRoot 'assets/app-icon.ico') -Small:$small
  try {
    for ($index = 0; $index -lt $iconPaths.Count; $index++) {
      $entry = $iconPaths[$index]
      $bitmap = Get-ShellIconBitmap $entry.Path -Small:$small
      try {
        $prefix = if ($small) { 'shell-icon-small' } else { 'shell-icon' }
        $bitmap.Save((Join-Path $evidence "$prefix-$index.png"), [Drawing.Imaging.ImageFormat]::Png)
        Assert-ShellIconMatches $bitmap $reference -Shortcut:($entry.Shortcut)
      } finally { $bitmap.Dispose() }
    }
  } finally { $reference.Dispose() }
}
Write-Host 'PASS executable, installer and both shortcut icons match the shared brand resource at large and small Shell sizes; captures saved for review'
Push-Location $repoRoot
try {
  bun run --cwd apps/desktop test:smoke
  if ($LASTEXITCODE) { throw "Installed application smoke failed: $LASTEXITCODE" }
  @{ version = $version; installDir = $installDir; dataDir = $dataDir;
    checks = @('unicode-spaces-non-system-drive', 'per-user-shortcuts', 'reinstall-location', 'data-retention')
  } | ConvertTo-Json | Set-Content output/playwright/desktop/installer-result.json
} finally { Pop-Location }
