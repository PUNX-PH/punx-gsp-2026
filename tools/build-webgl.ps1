<#
.SYNOPSIS
  Builds the Unity runner template for WebGL (desktop and mobile) and prints Builds\size-report.json.
.DESCRIPTION
  Runs BuildScript.BuildWebGL in batch mode with -buildTarget WebGL so the Editor starts on WebGL: switching target mid-build left level0 corrupted and Shader Graph materials pink. Unity's log is Builds\build.log. Exits 1 if the build
  fails or a build is over budget. Waits on the Editor process only (see run-tests.ps1).
#>
param(
  [ValidateSet('both', 'desktop', 'mobile', 'desktop-dev')]
  [string]$Target = 'both'
)

$method = @{ both = 'BuildWebGL'; desktop = 'BuildDesktop'; mobile = 'BuildMobile'; 'desktop-dev' = 'BuildDesktopDevelopment' }[$Target]
$repo = Split-Path -Parent $PSScriptRoot
$unity = & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'check-env.ps1') -PrintPath
if ($LASTEXITCODE -ne 0) { exit 1 }

$project = Join-Path $repo 'unity\runner-template'
$builds = Join-Path $repo 'Builds'
$log = Join-Path $builds 'build.log'
New-Item -ItemType Directory -Path $builds -Force | Out-Null

$argLine = "-batchmode -quit -buildTarget WebGL -projectPath `"$project`" -executeMethod Runner.EditorTools.BuildScript.$method -logFile `"$log`""
$p = Start-Process -FilePath $unity -ArgumentList $argLine -PassThru
$null = $p.Handle
$p.WaitForExit()

$report = Join-Path $builds 'size-report.json'
if (Test-Path -LiteralPath $report) { "size report: " + (Get-Content -LiteralPath $report -Raw).Trim() }
if ($p.ExitCode -ne 0) {
  [Console]::Error.WriteLine("build-webgl: Unity exited with code $($p.ExitCode). See $log")
  exit 1
}
exit 0
