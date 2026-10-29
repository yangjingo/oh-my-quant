param([Parameter(Mandatory=$true)][string]$BunExecutable, [Parameter(Mandatory=$true)][string]$EntryPoint)
$ErrorActionPreference = 'Stop'
# ShellExecute does not pass Bun Shell's inheritable pipe handles into the Host.
# Keep this actual Process handle until the parent authenticates readiness.
if ($EntryPoint.Contains('"')) { throw 'Invalid Host entry path' }
$hostChild = Start-Process -FilePath $BunExecutable -ArgumentList ('"' + $EntryPoint + '"') -WindowStyle Hidden -PassThru
$stopRequested = $false
try {
    [Console]::Out.WriteLine($hostChild.Id)
    [Console]::Out.Flush()
    $command = [Console]::In.ReadLine()
    $stopRequested = $command -eq 'kill'
} finally {
    # EOF is a lost launcher, not permission to kill a Host that may have
    # published readiness. The Host has its own bounded initialization timer.
    if ($stopRequested -and -not $hostChild.HasExited) {
        $hostChild.Kill()
        $hostChild.WaitForExit(2000) | Out-Null
    }
    $hostChild.Dispose()
}
