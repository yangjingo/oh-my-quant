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
$evidence = Join-Path $Root 'private-evidence-fixture'
New-Item -ItemType Directory -Path $evidence | Out-Null
Assert-ShortcutIcon (New-Link $target '' 0) $target
Assert-ShortcutIcon (New-Link $target $target 0) $target
Assert-Throws { Assert-ShortcutIcon (New-Link $target (Join-Path $Root 'different.ico') 0) $target }
Assert-Throws { Assert-ShortcutIcon (New-Link $target $target 1) $target }
Assert-Throws { Assert-ShortcutIcon (New-Link (Join-Path $Root 'different.exe') $target 0) $target }
[Console]::Error.WriteLine('WHYJ_ICON_STAGE=shortcut-checks-complete')

foreach ($small in @($false, $true)) {
  $size = if ($small) { 'small' } else { 'large' }
  $prefix = if ($small) { 'shell-icon-small' } else { 'shell-icon' }
  [Console]::Error.WriteLine("WHYJ_ICON_STAGE=$size-start")
  $expected = Get-ShellIconBitmap $Icon -Small:$small
  $overlay = $null
  $mismatch = $null
  $wrongSize = $null
  try {
    $overlay = $expected.Clone()
    $original = $overlay.GetPixel(0, $overlay.Height - 1)
    $color = if ($original.ToArgb() -eq [Drawing.Color]::Red.ToArgb()) { [Drawing.Color]::Blue } else { [Drawing.Color]::Red }
    $overlay.SetPixel(0, $overlay.Height - 1, $color)
    Assert-ShellIconMatches $overlay $expected -Shortcut
    Assert-Throws { Assert-ShellIconMatches $overlay $expected }
    Assert-RecordedShellIcon $overlay $expected $evidence $prefix 2 -Shortcut
    Assert-Throws { Assert-RecordedShellIcon $overlay $expected $evidence $prefix 2 }
    $original = $overlay.GetPixel($overlay.Width - 1, 0)
    $color = if ($original.ToArgb() -eq [Drawing.Color]::Red.ToArgb()) { [Drawing.Color]::Blue } else { [Drawing.Color]::Red }
    $overlay.SetPixel($overlay.Width - 1, 0, $color)
    Assert-Throws { Assert-ShellIconMatches $overlay $expected -Shortcut }
    Assert-Throws { Assert-RecordedShellIcon $overlay $expected $evidence $prefix 2 -Shortcut }
    $wrongSize = [Drawing.Bitmap]::new($expected.Width + 1, $expected.Height)
    Assert-Throws { Assert-ShellIconMatches $wrongSize $expected }

    $mismatch = $expected.Clone()
    $original = $mismatch.GetPixel(2, 0)
    $color = if ($original.ToArgb() -eq [Drawing.Color]::Red.ToArgb()) { [Drawing.Color]::Blue } else { [Drawing.Color]::Red }
    $mismatch.SetPixel(2, 0, $color)
    $message = $null
    try { Assert-RecordedShellIcon $mismatch $expected $evidence $prefix 0 } catch { $message = $_.Exception.Message }
    $actualArgb = $color.ToArgb().ToString('X8')
    $expectedArgb = $original.ToArgb().ToString('X8')
    if (-not $message -or -not $message.Contains("context=$prefix-0") -or
        -not $message.Contains("size=$($expected.Width)x$($expected.Height)") -or
        -not $message.Contains('pixel=(2,0)') -or -not $message.Contains("actual=0x$actualArgb") -or
        -not $message.Contains("expected=0x$expectedArgb") -or $message.Contains($Root)) {
      throw 'Mismatch diagnostic omitted bounded values or exposed the evidence path.'
    }
    $actualPath = Join-Path $evidence "$prefix-0.png"
    $referencePath = Join-Path $evidence "$prefix-reference.png"
    if (-not (Test-Path -LiteralPath $actualPath) -or -not (Test-Path -LiteralPath $referencePath)) {
      throw 'Mismatch evidence images were not both saved.'
    }
    $actualImage = [Drawing.Bitmap]::new($actualPath)
    $referenceImage = [Drawing.Bitmap]::new($referencePath)
    try {
      if ($actualImage.GetPixel(2, 0).ToArgb() -ne $color.ToArgb() -or
          $referenceImage.GetPixel(2, 0).ToArgb() -ne $original.ToArgb()) {
        throw 'Mismatch evidence images do not retain the compared pixels.'
      }
    } finally { $actualImage.Dispose(); $referenceImage.Dispose() }
    Assert-RecordedShellIcon $expected $expected $evidence $prefix 1
  } finally {
    if ($overlay) { $overlay.Dispose() }; if ($mismatch) { $mismatch.Dispose() }
    if ($wrongSize) { $wrongSize.Dispose() }; $expected.Dispose()
  }
  [Console]::Error.WriteLine("WHYJ_ICON_STAGE=$size-complete")
}
Write-Host 'PASS Unicode shortcut identity, incorrect resource/index, Shell overlay comparisons, and saved mismatch evidence'
