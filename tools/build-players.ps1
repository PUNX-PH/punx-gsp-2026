<#
.SYNOPSIS
  Builds the Windows and Android players the packager adds a game to (Builds\player-windows, Builds\player-android\Runner.apk).
.DESCRIPTION
  Runs BuildPlayers.BuildWindows or BuildAndroid in batch mode with the matching -buildTarget (switching target mid-build is unreliable, see build-webgl.ps1).
  Needs Unity's Windows and Android build support installed and a signed-in Hub. Unity's log is Builds\build-players.log. Afterwards zip the Windows folder
  and upload both players with a players.json to the packager's bucket (packager\README.md). Exits 1 if a build fails.
#>
param(
  [ValidateSet('windows', 'android', 'both')]
  [string]$Platform = 'both'
)

$repo = Split-Path -Parent $PSScriptRoot
$unity = & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'check-env.ps1') -PrintPath
if ($LASTEXITCODE -ne 0) { exit 1 }

$project = Join-Path $repo 'unity\runner-template'
$builds = Join-Path $repo 'Builds'
$log = Join-Path $builds 'build-players.log'
New-Item -ItemType Directory -Path $builds -Force | Out-Null

$runs = @()
if ($Platform -in 'windows', 'both') { $runs += @{ target = 'StandaloneWindows64'; method = 'BuildWindows' } }
if ($Platform -in 'android', 'both') { $runs += @{ target = 'Android'; method = 'BuildAndroid' } }

foreach ($run in $runs) {
  $argLine = "-batchmode -quit -buildTarget $($run.target) -projectPath `"$project`" -executeMethod Runner.EditorTools.BuildPlayers.$($run.method) -logFile `"$log`""
  $p = Start-Process -FilePath $unity -ArgumentList $argLine -PassThru
  $null = $p.Handle
  $p.WaitForExit()
  if ($p.ExitCode -ne 0) {
    [Console]::Error.WriteLine("build-players: Unity exited with code $($p.ExitCode) for $($run.target). See $log")
    exit 1
  }
}
exit 0
