$ErrorActionPreference = 'Stop'
# Installs the real appId: run only on a disposable hosted CI account.
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted') {
  throw 'Installer acceptance requires a disposable GitHub-hosted Windows runner.'
}
$desktopRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$repoRoot = Split-Path $desktopRoot
$version = (Get-Content (Join-Path $desktopRoot 'package.json') | ConvertFrom-Json).version
$installer = (Resolve-Path (Join-Path $repoRoot "release/WhyJ-Quant-Setup-$version-win-x64.exe")).Path
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
function Install-App([string[]]$InstallerArguments) {
  $process = Start-Process -FilePath $installer -ArgumentList $InstallerArguments -PassThru -Wait -WindowStyle Hidden
  if ($process.ExitCode -ne 0) { throw "Installer failed: $($process.ExitCode)" }
  if (-not (Test-Path -LiteralPath $exe)) { throw "Installed executable missing: $exe" }
  if ((Get-InstalledApp).Count -ne 1) { throw 'Per-user uninstall registration missing or duplicated.' }
  if ((Get-InstalledApp)[0].DisplayVersion -ne $version) { throw 'Registered version does not match the installer.' }
  if ((Get-Content -LiteralPath $sentinel -Raw) -ne $marker) { throw 'Research data changed during installation.' }
  # WScript.Shell.TargetPath replaces non-ANSI characters with '?'. Use the
  # Unicode-aware Windows shell link object to inspect Chinese destinations.
  $shell = New-Object -ComObject Shell.Application
  foreach ($folder in @([Environment]::GetFolderPath('DesktopDirectory'), [Environment]::GetFolderPath('Programs'))) {
    $link = Join-Path $folder 'WhyJ Quant.lnk'
    if (-not (Test-Path -LiteralPath $link)) { throw "Shortcut missing: $link" }
    $target = $shell.Namespace($folder).ParseName('WhyJ Quant.lnk').GetLink.Path
    if ($target -ne $exe) { throw "Shortcut target mismatch: $link -> $target (expected $exe)" }
  }
}
# NSIS requires /D last, with no quotes around its value, including spaces.
Install-App @('/S', '/currentuser', "/D=$installDir")
Write-Host 'PASS first install: non-system drive, Unicode/spaces, per-user shortcuts, data retained'
# No /D: the installer must recover the previous folder from its own registry.
Install-App @('/S', '/currentuser')
Write-Host 'PASS reinstall: selected directory and existing research data retained'
$env:WHYJ_SMOKE_EXE = $exe
$evidence = Join-Path $repoRoot 'output/playwright/desktop'
New-Item -ItemType Directory -Path $evidence -Force | Out-Null
# Read each actual file through the Unicode Shell API, without USEFILEATTRIBUTES
# (which asks for a generic file-type icon rather than the installed resource).
Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class InstalledIcon {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct Info {
    public IntPtr Icon;
    public int Index;
    public uint Attributes;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)] public string DisplayName;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 80)] public string TypeName;
  }
  [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
  public static extern IntPtr SHGetFileInfo(string path, uint attributes, out Info info, uint size, uint flags);
  [DllImport("user32.dll")] public static extern bool DestroyIcon(IntPtr icon);
}
'@
$iconPaths = @($exe, $installer,
  (Join-Path ([Environment]::GetFolderPath('DesktopDirectory')) 'WhyJ Quant.lnk'),
  (Join-Path ([Environment]::GetFolderPath('Programs')) 'WhyJ Quant.lnk'))
for ($index = 0; $index -lt $iconPaths.Count; $index++) {
  $info = New-Object InstalledIcon+Info
  $result = [InstalledIcon]::SHGetFileInfo($iconPaths[$index], 0, [ref]$info, [Runtime.InteropServices.Marshal]::SizeOf($info), 0x100)
  if ($result -eq [IntPtr]::Zero -or $info.Icon -eq [IntPtr]::Zero) { throw "Shell icon unavailable: $($iconPaths[$index])" }
  try {
    $icon = [Drawing.Icon]::FromHandle($info.Icon)
    $bitmap = $icon.ToBitmap()
    try {
      $bitmap.Save((Join-Path $evidence "shell-icon-$index.png"), [Drawing.Imaging.ImageFormat]::Png)
      $goldPixels = 0
      for ($x = 0; $x -lt $bitmap.Width; $x++) {
        for ($y = 0; $y -lt $bitmap.Height; $y++) {
          $pixel = $bitmap.GetPixel($x, $y)
          if ($pixel.A -gt 200 -and [Math]::Abs([int]$pixel.R - 201) -lt 15 -and [Math]::Abs([int]$pixel.G - 154) -lt 15 -and [Math]::Abs([int]$pixel.B - 46) -lt 15) { $goldPixels++ }
        }
      }
      if ($goldPixels -lt 5) { throw "Expected JQ gold pixels, not a generic Shell icon: $($iconPaths[$index])" }
    } finally { $bitmap.Dispose(); $icon.Dispose() }
  } finally { [InstalledIcon]::DestroyIcon($info.Icon) | Out-Null }
}
Write-Host 'PASS installed executable, installer and both shortcut icons contain the JQ brand; captures saved for review'
Push-Location $repoRoot
try {
  bun run --cwd desktop test:smoke
  if ($LASTEXITCODE) { throw "Installed application smoke failed: $LASTEXITCODE" }
  @{ version = $version; installDir = $installDir; dataDir = $dataDir;
    checks = @('unicode-spaces-non-system-drive', 'per-user-shortcuts', 'reinstall-location', 'data-retention')
  } | ConvertTo-Json | Set-Content output/playwright/desktop/installer-result.json
} finally { Pop-Location }
