param([Parameter(Mandatory)][string]$Installer, [Parameter(Mandatory)][string]$Requested)
$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted') {
  throw 'Interactive acceptance requires a disposable GitHub-hosted Windows runner.'
}
$evidence = Join-Path $PSScriptRoot '../../output/desktop-online/ui'
New-Item -ItemType Directory -Path $evidence -Force | Out-Null
Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class OnlineWindow {
  [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr window, out Rect rect);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr window, IntPtr dc, uint flags);
  [DllImport("user32.dll")] public static extern IntPtr GetDlgItem(IntPtr window, int id);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);
}
'@
function Wait-For([scriptblock]$Condition, [string]$Description) {
  $deadline = (Get-Date).AddSeconds(20)
  do {
    if (& $Condition) { return }
    Start-Sleep -Milliseconds 200
  } while ((Get-Date) -lt $deadline)
  throw "Timed out: $Description"
}
function Capture-Window([IntPtr]$Window, [string]$Name) {
  $rect = New-Object OnlineWindow+Rect
  if (-not [OnlineWindow]::GetWindowRect($Window, [ref]$rect)) { throw 'Cannot read installer window bounds' }
  $bitmap = New-Object Drawing.Bitmap(($rect.Right - $rect.Left), ($rect.Bottom - $rect.Top))
  $graphics = [Drawing.Graphics]::FromImage($bitmap)
  try {
    $dc = $graphics.GetHdc()
    try {
      if (-not [OnlineWindow]::PrintWindow($Window, $dc, 0)) { throw 'Cannot capture the actual installer window' }
    } finally { $graphics.ReleaseHdc($dc) }
    $bitmap.Save((Join-Path $evidence "$Name.png"), [Drawing.Imaging.ImageFormat]::Png)
  } finally { $graphics.Dispose(); $bitmap.Dispose() }
}
# Only the generated test entry on a disposable account; never launch the application payload.
$process = Start-Process -FilePath $Installer -PassThru -WindowStyle Hidden
try {
  Wait-For { $process.Refresh(); $process.MainWindowHandle -ne [IntPtr]::Zero } 'welcome window'
  $window = $process.MainWindowHandle
  Capture-Window $window '01-welcome'
  $next = [OnlineWindow]::GetDlgItem($window, 1)
  if ($next -eq [IntPtr]::Zero) { throw 'Next button missing' }
  [OnlineWindow]::PostMessage($window, 0x111, [IntPtr]1, $next) | Out-Null
  Wait-For { (Get-Content -LiteralPath $Requested -Raw) -eq 'download started' } 'active download'
  Capture-Window $window '02-downloading'
  $cancel = [OnlineWindow]::GetDlgItem($window, 2)
  if ($cancel -eq [IntPtr]::Zero) { throw 'Cancel button missing' }
  [OnlineWindow]::PostMessage($window, 0x111, [IntPtr]2, $cancel) | Out-Null
  Wait-For { $process.HasExited } 'cancelled installer exit'
  if ($process.ExitCode -ne 2) { throw "Cancel must exit 2, got $($process.ExitCode)" }
  @{ installer = $Installer; sourceRevision = (git rev-parse HEAD); environment = 'GitHub-hosted Windows';
    steps = @('capture actual welcome', 'Next', 'capture pending download', 'Cancel'); exitCode = $process.ExitCode
  } | ConvertTo-Json | Set-Content (Join-Path $evidence 'result.json')
} finally {
  if (-not $process.HasExited) { Stop-Process -Id $process.Id }
  $process.Dispose()
}
