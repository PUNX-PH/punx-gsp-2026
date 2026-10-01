<#
.SYNOPSIS
  Writes the sample content used by the Unity tests and the browser checks.
.DESCRIPTION
  Three untextured box GLBs (hero, obstacle, coin) and settings.json go to
  unity\runner-template\Assets\StreamingAssets\sample\. sample-broken\ holds the same settings and a
  zero-byte hero.glb, to test the "a role file is corrupt" path. settings.json is copied from
  fixtures\settings\valid.json, the single source for the schema example.
#>
$ErrorActionPreference = 'Stop'
[Threading.Thread]::CurrentThread.CurrentCulture = [Globalization.CultureInfo]::InvariantCulture

$repo = Split-Path -Parent $PSScriptRoot
$streaming = Join-Path $repo 'unity\runner-template\Assets\StreamingAssets'
$sample = Join-Path $streaming 'sample'
$broken = Join-Path $streaming 'sample-broken'
New-Item -ItemType Directory -Path $sample, $broken -Force | Out-Null

function ConvertTo-LinearChannel([double]$c) {
  if ($c -le 0.04045) { return $c / 12.92 }
  return [math]::Pow(($c + 0.055) / 1.055, 2.4)
}

# glTF's baseColorFactor is linear; the colours in the settings are sRGB hex.
function ConvertTo-LinearColor([string]$hex) {
  1..5 | Where-Object { $_ % 2 -eq 1 } | ForEach-Object {
    ConvertTo-LinearChannel ([Convert]::ToInt32($hex.Substring($_, 2), 16) / 255.0)
  }
}

function Write-BoxGlb([string]$path, [double[]]$half, [string]$hexColor) {
  # Each face: outward normal n and axes u, v with u x v = n, so triangles wind counter-clockwise from outside.
  $faces = @(
    @{ n = @(1, 0, 0);  u = @(0, 1, 0); v = @(0, 0, 1) },
    @{ n = @(-1, 0, 0); u = @(0, 0, 1); v = @(0, 1, 0) },
    @{ n = @(0, 1, 0);  u = @(0, 0, 1); v = @(1, 0, 0) },
    @{ n = @(0, -1, 0); u = @(1, 0, 0); v = @(0, 0, 1) },
    @{ n = @(0, 0, 1);  u = @(1, 0, 0); v = @(0, 1, 0) },
    @{ n = @(0, 0, -1); u = @(0, 1, 0); v = @(1, 0, 0) }
  )
  $corners = @(@(-1, -1), @(1, -1), @(1, 1), @(-1, 1))
  $positions = New-Object System.Collections.Generic.List[single]
  $normals = New-Object System.Collections.Generic.List[single]
  $indices = New-Object System.Collections.Generic.List[uint16]
  $faceIndex = 0
  foreach ($f in $faces) {
    foreach ($c in $corners) {
      foreach ($a in 0..2) {
        $positions.Add([single](($f.n[$a] + $c[0] * $f.u[$a] + $c[1] * $f.v[$a]) * $half[$a]))
        $normals.Add([single]$f.n[$a])
      }
    }
    $b = $faceIndex * 4
    foreach ($i in @(0, 1, 2, 0, 2, 3)) { $indices.Add([uint16]($b + $i)) }
    $faceIndex++
  }

  $binStream = New-Object System.IO.MemoryStream
  $bw = New-Object System.IO.BinaryWriter($binStream)
  foreach ($v in $positions) { $bw.Write([single]$v) }
  foreach ($v in $normals) { $bw.Write([single]$v) }
  foreach ($v in $indices) { $bw.Write([uint16]$v) }
  $bw.Flush()
  $bin = $binStream.ToArray()   # 288 + 288 + 72 = 648 bytes, already a multiple of 4

  $rgb = @(ConvertTo-LinearColor $hexColor)
  $json = [ordered]@{
    asset       = [ordered]@{ version = '2.0'; generator = 'tools/make-sample.ps1' }
    scene       = 0
    scenes      = @([ordered]@{ nodes = @(0) })
    nodes       = @([ordered]@{ mesh = 0 })
    meshes      = @([ordered]@{ primitives = @([ordered]@{ attributes = [ordered]@{ POSITION = 0; NORMAL = 1 }; indices = 2; material = 0 }) })
    materials   = @([ordered]@{ pbrMetallicRoughness = [ordered]@{ baseColorFactor = @($rgb[0], $rgb[1], $rgb[2], 1.0); metallicFactor = 0.0; roughnessFactor = 1.0 } })
    accessors   = @(
      [ordered]@{ bufferView = 0; componentType = 5126; count = 24; type = 'VEC3'; min = @(-$half[0], -$half[1], -$half[2]); max = @($half[0], $half[1], $half[2]) },
      [ordered]@{ bufferView = 1; componentType = 5126; count = 24; type = 'VEC3' },
      [ordered]@{ bufferView = 2; componentType = 5123; count = 36; type = 'SCALAR' }
    )
    bufferViews = @(
      [ordered]@{ buffer = 0; byteOffset = 0;   byteLength = 288; target = 34962 },
      [ordered]@{ buffer = 0; byteOffset = 288; byteLength = 288; target = 34962 },
      [ordered]@{ buffer = 0; byteOffset = 576; byteLength = 72;  target = 34963 }
    )
    buffers     = @([ordered]@{ byteLength = $bin.Length })
  } | ConvertTo-Json -Depth 10 -Compress

  $jsonBytes = [Text.Encoding]::ASCII.GetBytes($json)
  $pad = (4 - ($jsonBytes.Length % 4)) % 4
  $jsonPadded = New-Object byte[] ($jsonBytes.Length + $pad)
  [Array]::Copy($jsonBytes, $jsonPadded, $jsonBytes.Length)
  for ($i = $jsonBytes.Length; $i -lt $jsonPadded.Length; $i++) { $jsonPadded[$i] = 0x20 }

  $out = New-Object System.IO.MemoryStream
  $w = New-Object System.IO.BinaryWriter($out)
  $w.Write([uint32]0x46546C67)   # 'glTF'
  $w.Write([uint32]2)
  $w.Write([uint32](12 + 8 + $jsonPadded.Length + 8 + $bin.Length))
  $w.Write([uint32]$jsonPadded.Length); $w.Write([uint32]0x4E4F534A); $w.Write($jsonPadded)   # 'JSON'
  $w.Write([uint32]$bin.Length);        $w.Write([uint32]0x004E4942); $w.Write($bin)           # 'BIN'
  $w.Flush()
  [IO.File]::WriteAllBytes($path, $out.ToArray())
}

Write-BoxGlb (Join-Path $sample 'hero.glb')     @(0.5, 0.5, 0.5)    '#3a86ff'
Write-BoxGlb (Join-Path $sample 'obstacle.glb') @(0.5, 0.5, 0.5)    '#ff595e'
Write-BoxGlb (Join-Path $sample 'coin.glb')     @(0.25, 0.25, 0.25) '#ffd166'
Copy-Item (Join-Path $repo 'fixtures\settings\valid.json') (Join-Path $sample 'settings.json') -Force

Copy-Item (Join-Path $repo 'fixtures\settings\valid.json') (Join-Path $broken 'settings.json') -Force
[IO.File]::WriteAllBytes((Join-Path $broken 'hero.glb'), [byte[]]@())
Copy-Item (Join-Path $sample 'obstacle.glb') (Join-Path $broken 'obstacle.glb') -Force
Copy-Item (Join-Path $sample 'coin.glb') (Join-Path $broken 'coin.glb') -Force

Get-ChildItem $sample, $broken -File | ForEach-Object { '{0,-14} {1,-22} {2,6} bytes' -f $_.Directory.Name, $_.Name, $_.Length }
