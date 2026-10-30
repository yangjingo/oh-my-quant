# Verify the resource selected by the actual Windows shortcut. A shortcut may
# use the target's default icon or an explicit resource in that same executable.
function Assert-ShortcutIcon($Link, [string]$Executable) {
  $expected = [IO.Path]::GetFullPath($Executable)
  if (-not [StringComparer]::OrdinalIgnoreCase.Equals([IO.Path]::GetFullPath($Link.Path), $expected)) {
    throw 'Shortcut target does not match the installed executable.'
  }
  $iconPath = ''
  $iconIndex = $Link.GetIconLocation([ref]$iconPath)
  if (-not $iconPath) { $iconPath = $Link.Path }
  $iconPath = [Environment]::ExpandEnvironmentVariables($iconPath)
  if ($iconIndex -ne 0 -or -not [IO.Path]::IsPathFullyQualified($iconPath) -or
      -not [StringComparer]::OrdinalIgnoreCase.Equals([IO.Path]::GetFullPath($iconPath), $expected)) {
    throw 'Shortcut icon must use the installed executable icon at index zero.'
  }
}

Add-Type -AssemblyName System.Drawing
if (-not ('WhyJShellIcon' -as [type])) {
  Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class WhyJShellIcon {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct Info {
    public IntPtr Icon; public int Index; public uint Attributes;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)] public string DisplayName;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 80)] public string TypeName;
  }
  [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
  public static extern IntPtr SHGetFileInfo(string path, uint attributes, out Info info, uint size, uint flags);
  [DllImport("user32.dll")] public static extern bool DestroyIcon(IntPtr icon);
}
'@
}

function Get-ShellIconBitmap([string]$Path, [switch]$Small) {
  $info = New-Object WhyJShellIcon+Info
  $flags = if ($Small) { 0x101 } else { 0x100 } # SHGFI_ICON, optionally SHGFI_SMALLICON
  $result = [WhyJShellIcon]::SHGetFileInfo($Path, 0, [ref]$info, [Runtime.InteropServices.Marshal]::SizeOf($info), $flags)
  if ($result -eq [IntPtr]::Zero -or $info.Icon -eq [IntPtr]::Zero) { throw "Shell icon unavailable: $Path" }
  try {
    $icon = [Drawing.Icon]::FromHandle($info.Icon)
    try { return $icon.ToBitmap() } finally { $icon.Dispose() }
  } finally { [WhyJShellIcon]::DestroyIcon($info.Icon) | Out-Null }
}

function Assert-ShellIconMatches([Drawing.Bitmap]$Actual, [Drawing.Bitmap]$Expected, [switch]$Shortcut) {
  if ($Actual.Width -ne $Expected.Width -or $Actual.Height -ne $Expected.Height) { throw 'Shell icon dimensions differ.' }
  $overlayWidth = [int][Math]::Ceiling($Actual.Width / 2)
  $overlayHeight = [int][Math]::Ceiling($Actual.Height / 2)
  for ($y = 0; $y -lt $Actual.Height; $y++) {
    for ($x = 0; $x -lt $Actual.Width; $x++) {
      # Windows adds a link arrow. Its lower-left area is verified separately
      # through the shortcut's exact icon resource and preserved screenshots.
      if ($Shortcut -and $x -lt $overlayWidth -and $y -ge ($Actual.Height - $overlayHeight)) { continue }
      if ($Actual.GetPixel($x, $y).ToArgb() -ne $Expected.GetPixel($x, $y).ToArgb()) {
        throw "Shell icon differs from the shared brand resource at ($x,$y)."
      }
    }
  }
}
