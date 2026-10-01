<#
.SYNOPSIS
  Checks that this machine can build the Unity runner template.
.DESCRIPTION
  Finds the newest Unity 6 editor (6000.*) installed by Unity Hub, requires its WebGL module,
  and refuses to run from inside OneDrive (Unity's Library folder breaks OneDrive sync).
  -PrintPath prints only the full path of Unity.exe, for use by other scripts.
  Problems are written to stderr and the exit code is 1.
#>
param(
  [switch]$PrintPath,
  [switch]$AllowOneDrive
)

$problems = New-Object System.Collections.Generic.List[string]
$repo = Split-Path -Parent $PSScriptRoot

if (-not $AllowOneDrive -and $repo -match 'OneDrive') {
  $problems.Add("The repository is inside OneDrive ($repo). Move it out (for example to C:\dev\GameStudioPlatform) or pass -AllowOneDrive.")
}

$editorRoot = 'C:\Program Files\Unity\Hub\Editor'
$unity = $null
$version = $null
if (Test-Path -LiteralPath $editorRoot) {
  $found = Get-ChildItem -LiteralPath $editorRoot -Directory |
    Where-Object { $_.Name -like '6000.*' -and (Test-Path -LiteralPath (Join-Path $_.FullName 'Editor\Unity.exe')) } |
    Sort-Object { [version]($_.Name -replace '[a-zA-Z].*$', '') } -Descending
  if ($found) {
    $best = $found | Select-Object -First 1
    $version = $best.Name
    $unity = Join-Path $best.FullName 'Editor\Unity.exe'
  }
}

if (-not $unity) {
  $problems.Add("No Unity 6 editor (6000.*) found under $editorRoot. Install the LTS editor from Unity Hub.")
} elseif (-not (Test-Path -LiteralPath (Join-Path (Split-Path -Parent $unity) 'Data\PlaybackEngines\WebGLSupport'))) {
  $problems.Add("Unity $version has no WebGL Build Support module. Add it in Unity Hub (Installs, then Add modules).")
}

if ($problems.Count -gt 0) {
  foreach ($p in $problems) { [Console]::Error.WriteLine("check-env: $p") }
  exit 1
}

if ($PrintPath) { $unity } else { "OK Unity $version with WebGL at $unity" }
exit 0
