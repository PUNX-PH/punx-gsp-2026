<#
.SYNOPSIS
  Serves a folder over HTTP for testing a Unity WebGL build. Needs neither Node nor Python.
.DESCRIPTION
  Sends the right MIME types for .wasm, .js, .json, .glb and Unity's data files. By default it listens
  on localhost only. -Lan listens on every network interface so a phone on the same Wi-Fi can connect;
  that needs an administrator shell, and Windows may ask to allow the firewall.
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File tools\serve.ps1 -Root Builds\runner-desktop
#>
param(
  [Parameter(Mandatory = $true)][string]$Root,
  [int]$Port = 8080,
  [switch]$Lan
)

$rootPath = (Resolve-Path -LiteralPath $Root).Path.TrimEnd('\')
$mime = @{
  '.html' = 'text/html'; '.js' = 'application/javascript'; '.wasm' = 'application/wasm'
  '.json' = 'application/json'; '.glb' = 'model/gltf-binary'; '.css' = 'text/css'
  '.png' = 'image/png'; '.jpg' = 'image/jpeg'; '.ico' = 'image/x-icon'; '.txt' = 'text/plain'
  '.data' = 'application/octet-stream'; '.br' = 'application/octet-stream'
  '.gz' = 'application/octet-stream'; '.unityweb' = 'application/octet-stream'
}

$prefix = if ($Lan) { "http://+:$Port/" } else { "http://localhost:$Port/" }
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add($prefix)
try {
  $listener.Start()
} catch {
  [Console]::Error.WriteLine("serve: could not listen on $prefix ($($_.Exception.Message)). -Lan needs an administrator shell.")
  exit 1
}
"Serving $rootPath at $prefix (Ctrl+C to stop)"

while ($listener.IsListening) {
  $context = $listener.GetContext()
  try {
    $relative = [Uri]::UnescapeDataString($context.Request.Url.AbsolutePath).TrimStart('/')
    if ($relative -eq '') { $relative = 'index.html' }
    $full = [IO.Path]::GetFullPath((Join-Path $rootPath $relative))

    # Refuse anything that resolves outside the served folder (.. segments).
    if (-not $full.StartsWith($rootPath + '\', [StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path -LiteralPath $full -PathType Leaf)) {
      $context.Response.StatusCode = 404
      "$(Get-Date -Format HH:mm:ss.fff) 404 $($context.Request.Url.AbsolutePath)"
    } else {
      $info = Get-Item -LiteralPath $full
      # Unity's Brotli builds name files *.wasm.unityweb, *.data.unityweb and so on. Say they are Brotli so the
      # browser decompresses them natively (much faster than Unity's JavaScript fallback), and take the MIME
      # type from the extension underneath.
      $name = $info.Name.ToLowerInvariant()
      $brotli = $name.EndsWith('.unityweb') -or $name.EndsWith('.br')
      $extension = if ($brotli) { [IO.Path]::GetExtension([IO.Path]::GetFileNameWithoutExtension($name)) } else { $info.Extension.ToLowerInvariant() }
      $type = $mime[$extension]
      if (-not $type) { $type = 'application/octet-stream' }
      if ($brotli) { $context.Response.Headers.Add('Content-Encoding', 'br') }
      # Unity's loader keeps big files in the browser's cache and uses ETag / Last-Modified to notice a rebuild.
      # Without them a rebuilt file at the same URL is served from a stale cache.
      $etag = '"{0:x}-{1:x}"' -f $info.Length, $info.LastWriteTimeUtc.Ticks
      $context.Response.ContentType = $type
      # Per-run content (runs/...) changes between runs: never cache or revalidate it, or Unity's web requests can be
      # left waiting on a 304 with no body.
      $perRun = $relative -like 'runs/*'
      if ($perRun) {
        $context.Response.Headers.Add('Cache-Control', 'no-store')
      } else {
        $context.Response.Headers.Add('Cache-Control', 'no-cache')
        $context.Response.Headers.Add('ETag', $etag)
        $context.Response.Headers.Add('Last-Modified', $info.LastWriteTimeUtc.ToString('R'))
      }
      if (-not $perRun -and $context.Request.Headers['If-None-Match'] -eq $etag) {
        $context.Response.StatusCode = 304
        "$(Get-Date -Format HH:mm:ss.fff) 304 $($context.Request.Url.AbsolutePath)"
      } else {
        $context.Response.ContentLength64 = $info.Length
        if ($context.Request.HttpMethod -ne 'HEAD') {
          $bytes = [IO.File]::ReadAllBytes($full)
          $context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
        }
        "$(Get-Date -Format HH:mm:ss.fff) 200 $($context.Request.HttpMethod) $($context.Request.Url.AbsolutePath) ($($info.Length) bytes)"
      }
    }
  } catch {
    "error $($context.Request.Url.AbsolutePath): $($_.Exception.Message)"
  } finally {
    $context.Response.Close()
  }
}
