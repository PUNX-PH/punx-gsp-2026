<#
.SYNOPSIS
  Copies the Unity WebGL builds into the web app as static files.
.DESCRIPTION
  Copies Builds\runner-<target> to web\public\templates\runner-<target> and replaces any older copy there.
  The per-game test content in runs\ is left out: games are served from the web app's own run routes.
  Build first with tools\build-webgl.ps1. The copies are committed; each rebuild adds about 8 MB per target to
  the repository's history, so publish only when the template changed.
.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File tools\publish-template.ps1 -Target both
#>
param(
  [ValidateSet('desktop', 'mobile', 'both')][string]$Target = 'both'
)

$repo = Split-Path -Parent $PSScriptRoot
$targets = if ($Target -eq 'both') { @('desktop', 'mobile') } else { @($Target) }

foreach ($t in $targets) {
  $source = Join-Path $repo "Builds\runner-$t"
  $destination = Join-Path $repo "web\public\templates\runner-$t"

  if (-not (Test-Path -LiteralPath (Join-Path $source 'index.html'))) {
    [Console]::Error.WriteLine("publish-template: no build at $source. Run tools\build-webgl.ps1 -Target $t first.")
    exit 1
  }

  if (Test-Path -LiteralPath $destination) { Remove-Item -LiteralPath $destination -Recurse -Force }
  New-Item -ItemType Directory -Path $destination -Force | Out-Null

  # robocopy exits 0 to 7 for success (files copied, extra files, and so on) and 8 or more for failure.
  robocopy $source $destination /E /XD runs /NFL /NDL /NJH /NJS /NP | Out-Null
  if ($LASTEXITCODE -ge 8) {
    [Console]::Error.WriteLine("publish-template: copying $source failed (robocopy exit code $LASTEXITCODE).")
    exit 1
  }

  $bytes = (Get-ChildItem -LiteralPath $destination -Recurse -File | Measure-Object Length -Sum).Sum
  "{0}: copied to {1} ({2:N0} bytes)" -f $t, $destination, $bytes
}
exit 0
