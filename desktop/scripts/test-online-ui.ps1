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
using System.Text;
using System.Runtime.InteropServices;
public static class OnlineWindow {
  public delegate bool EnumProc(IntPtr window, IntPtr parameter);
  [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc callback, IntPtr parameter);
  [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr parent, EnumProc callback, IntPtr parameter);
  [DllImport("user32.dll")] public static extern bool IsWindowEnabled(IntPtr window);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr window, StringBuilder text, int length);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr window, StringBuilder text, int length);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr window, out Rect rect);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr window, IntPtr dc, uint flags);
  [DllImport("user32.dll")] public static extern IntPtr GetLastActivePopup(IntPtr window);
  [DllImport("user32.dll")] public static extern IntPtr GetDlgItem(IntPtr window, int id);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);
  public static IntPtr FindDialog(int process) {
    IntPtr result = IntPtr.Zero;
    EnumWindows((window, parameter) => {
      uint owner; GetWindowThreadProcessId(window, out owner);
      if (owner == process && GetDlgItem(window, 1) != IntPtr.Zero && GetDlgItem(window, 2) != IntPtr.Zero) {
        result = window; return false;
      }
      return true;
    }, IntPtr.Zero);
    return result;
  }
  public static IntPtr FindCancel(IntPtr parent) {
    IntPtr result = IntPtr.Zero;
    EnumChildWindows(parent, (window, parameter) => {
      var text = new StringBuilder(256); var name = new StringBuilder(64);
      GetWindowText(window, text, text.Capacity); GetClassName(window, name, name.Capacity);
      if (IsWindowEnabled(window) && name.ToString() == "Button" && text.ToString().Replace("&", "") == "Cancel") {
        result = window; return false;
      }
      return true;
    }, IntPtr.Zero);
    return result;
  }
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
    $painted = 0
    for ($x = 0; $x -lt $bitmap.Width; $x += 10) {
      for ($y = 0; $y -lt $bitmap.Height; $y += 10) {
        $pixel = $bitmap.GetPixel($x, $y)
        if ($pixel.R + $pixel.G + $pixel.B -gt 30) { $painted++ }
      }
    }
    if ($painted -lt 100) { throw "Installer capture is blank: $Name" }
  } finally { $graphics.Dispose(); $bitmap.Dispose() }
}
# The actual interactive wizard must paint for visual acceptance on this
# disposable CI desktop. The PowerShell/Node background helpers stay hidden.
# Only the generated fixture entry is opened; it never installs the application.
$process = Start-Process -FilePath $Installer -PassThru -WindowStyle Normal
try {
  # Locate the owned wizard by its controls, not whichever window has focus.
  Wait-For {
    if ($process.HasExited) { throw "Entry exited before its welcome page: $($process.ExitCode)" }
    [OnlineWindow]::FindDialog($process.Id) -ne [IntPtr]::Zero
  } 'welcome window'
  if (-not $process.WaitForInputIdle(10000)) { throw 'Welcome page did not become idle' }
  $window = [OnlineWindow]::FindDialog($process.Id)
  Capture-Window $window '01-welcome'
  $next = [OnlineWindow]::GetDlgItem($window, 1)
  if ($next -eq [IntPtr]::Zero) { throw 'Next button missing' }
  [OnlineWindow]::PostMessage($window, 0x111, [IntPtr]1, $next) | Out-Null
  Wait-For { (Get-Content -LiteralPath $Requested -Raw) -eq 'download started' } 'active download'
  # INetC disables the outer wizard's Cancel button and creates its own child.
  Wait-For { [OnlineWindow]::FindCancel($window) -ne [IntPtr]::Zero } 'enabled download Cancel button'
  Capture-Window $window '02-downloading'
  $cancel = [OnlineWindow]::FindCancel($window)
  [OnlineWindow]::PostMessage($cancel, 0xF5, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null
  Wait-For { $process.HasExited } 'cancelled installer exit'
  if ($process.ExitCode -ne 2) { throw "Cancel must exit 2, got $($process.ExitCode)" }
  @{ installer = $Installer; sourceRevision = (git rev-parse HEAD); environment = 'GitHub-hosted Windows';
    steps = @('capture actual welcome', 'Next', 'capture pending download', 'Cancel'); exitCode = $process.ExitCode
  } | ConvertTo-Json | Set-Content (Join-Path $evidence 'result.json')
} catch {
  if ($window -and -not $process.HasExited) {
    try { Capture-Window ([OnlineWindow]::GetLastActivePopup($window)) '03-failure' } catch { Write-Warning $_ }
  }
  throw
} finally {
  if (-not $process.HasExited) { Stop-Process -Id $process.Id }
  $process.Dispose()
}
