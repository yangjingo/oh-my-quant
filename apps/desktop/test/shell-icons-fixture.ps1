param([string]$Root, [string]$Icon)
$ErrorActionPreference = 'Stop'
[Console]::Error.WriteLine('WHYJ_ICON_STAGE=start')
. (Join-Path $PSScriptRoot '../scripts/shell-icons.ps1')
[Console]::Error.WriteLine('WHYJ_ICON_STAGE=helper-loaded')

function New-Link([string]$Target, [string]$IconPath, [int]$Index) {
  $link = [pscustomobject]@{ Path = $Target; IconPath = $IconPath; IconIndex = $Index }
  $link | Add-Member -MemberType ScriptMethod -Name GetIconLocation -Value {
    param([ref]$path)
    $path.Value = $this.IconPath
    return $this.IconIndex
  }
  return $link
}
function Assert-Throws([scriptblock]$Action) {
  $failed = $false
  try { & $Action } catch { $failed = $true }
  if (-not $failed) { throw 'Expected an icon verification failure.' }
}

$target = Join-Path $Root '安装 验收/WhyJ Quant.exe'
Assert-ShortcutIcon (New-Link $target '' 0) $target
Assert-ShortcutIcon (New-Link $target $target 0) $target
Assert-Throws { Assert-ShortcutIcon (New-Link $target (Join-Path $Root 'different.ico') 0) $target }
Assert-Throws { Assert-ShortcutIcon (New-Link $target $target 1) $target }
Assert-Throws { Assert-ShortcutIcon (New-Link (Join-Path $Root 'different.exe') $target 0) $target }
[Console]::Error.WriteLine('WHYJ_ICON_STAGE=shortcut-checks-complete')

foreach ($small in @($false, $true)) {
  $size = if ($small) { 'small' } else { 'large' }
  [Console]::Error.WriteLine("WHYJ_ICON_STAGE=$size-start")
  $expected = Get-ShellIconBitmap $Icon -Small:$small
  $overlay = $null
  try {
    $overlay = $expected.Clone()
    $original = $overlay.GetPixel(0, $overlay.Height - 1)
    $color = if ($original.ToArgb() -eq [Drawing.Color]::Red.ToArgb()) { [Drawing.Color]::Blue } else { [Drawing.Color]::Red }
    $overlay.SetPixel(0, $overlay.Height - 1, $color)
    Assert-ShellIconMatches $overlay $expected -Shortcut
    Assert-Throws { Assert-ShellIconMatches $overlay $expected }
    $original = $overlay.GetPixel($overlay.Width - 1, 0)
    $color = if ($original.ToArgb() -eq [Drawing.Color]::Red.ToArgb()) { [Drawing.Color]::Blue } else { [Drawing.Color]::Red }
    $overlay.SetPixel($overlay.Width - 1, 0, $color)
    Assert-Throws { Assert-ShellIconMatches $overlay $expected -Shortcut }
  } finally { if ($overlay) { $overlay.Dispose() }; $expected.Dispose() }
  [Console]::Error.WriteLine("WHYJ_ICON_STAGE=$size-complete")
}
Write-Host 'PASS Unicode shortcut identity, incorrect resource/index, and Shell overlay comparisons'
