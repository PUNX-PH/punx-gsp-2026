<#
.SYNOPSIS
  Runs the Unity runner template's EditMode or PlayMode tests in batch mode.
.DESCRIPTION
  Prints "<Platform>: N passed, M failed" and exits 1 if anything failed or no results were written.
  Unity's full log is Builds\<Platform>.log and the NUnit results are Builds\<Platform>.xml.
  The Editor leaves a C# compiler server running after it exits, and Start-Process -Wait would
  wait for that too, so this script waits on the Editor process only.
#>
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('EditMode', 'PlayMode')]
  [string]$Platform
)

$repo = Split-Path -Parent $PSScriptRoot
$unity = & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'check-env.ps1') -PrintPath
if ($LASTEXITCODE -ne 0) { exit 1 }

$project = Join-Path $repo 'unity\runner-template'
$builds = Join-Path $repo 'Builds'
New-Item -ItemType Directory -Path $builds -Force | Out-Null
$xml = Join-Path $builds "$Platform.xml"
$log = Join-Path $builds "$Platform.log"
Remove-Item -LiteralPath $xml -ErrorAction SilentlyContinue

$argLine = "-batchmode -nographics -projectPath `"$project`" -runTests -testPlatform $Platform -testResults `"$xml`" -logFile `"$log`""
$p = Start-Process -FilePath $unity -ArgumentList $argLine -PassThru
$null = $p.Handle   # keep the handle so ExitCode is readable after WaitForExit
$p.WaitForExit()

if (-not (Test-Path -LiteralPath $xml)) {
  [Console]::Error.WriteLine("run-tests: Unity wrote no results (exit code $($p.ExitCode)). See $log")
  exit 1
}
[xml]$doc = Get-Content -LiteralPath $xml
$run = $doc.'test-run'
$passed = [int]$run.passed
$failed = [int]$run.failed
"{0}: {1} passed, {2} failed" -f $Platform, $passed, $failed
if ($failed -gt 0 -or $passed -eq 0) { exit 1 }
exit 0
