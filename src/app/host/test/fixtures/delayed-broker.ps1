param([Parameter(Mandatory=$true)][string]$BunExecutable, [Parameter(Mandatory=$true)][string]$EntryPoint)
Start-Sleep -Milliseconds 2600
& (Join-Path $PSScriptRoot '../../windows-launch.ps1') -BunExecutable $BunExecutable -EntryPoint $EntryPoint
[IO.File]::WriteAllText((Join-Path $env:OHQUANT_DIR 'broker-done'), 'done')
