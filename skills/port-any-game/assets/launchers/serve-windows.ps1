# Windows launcher server: serves .\dist on 127.0.0.1 with System.Net.HttpListener. No plugin code, no Node needed.
# Reads launch.json {port} and headers.json [{pattern, headers}] beside it. Set PAG_NO_OPEN=1 to skip opening the browser.
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$dist = [IO.Path]::GetFullPath((Join-Path $here 'dist'))
$port = [int](Get-Content -Raw (Join-Path $here 'launch.json') | ConvertFrom-Json).port
$rules = @()
foreach ($r in @(Get-Content -Raw (Join-Path $here 'headers.json') | ConvertFrom-Json)) {
  $rules += , @{ re = '^' + (($r.pattern -split '\*' | ForEach-Object { [regex]::Escape($_) }) -join '.*') + '$'; headers = $r.headers }
}
$mime = @{
  '.html' = 'text/html; charset=utf-8'; '.js' = 'text/javascript; charset=utf-8'; '.mjs' = 'text/javascript; charset=utf-8'
  '.css' = 'text/css; charset=utf-8'; '.json' = 'application/json; charset=utf-8'; '.wasm' = 'application/wasm'
  '.png' = 'image/png'; '.jpg' = 'image/jpeg'; '.jpeg' = 'image/jpeg'; '.gif' = 'image/gif'; '.svg' = 'image/svg+xml'
  '.webp' = 'image/webp'; '.mp3' = 'audio/mpeg'; '.ogg' = 'audio/ogg'; '.wav' = 'audio/wav'; '.mp4' = 'video/mp4'
  '.webm' = 'video/webm'; '.swf' = 'application/x-shockwave-flash'; '.zip' = 'application/zip'
  '.jsdos' = 'application/zip'; '.txt' = 'text/plain; charset=utf-8'
}
$url = "http://127.0.0.1:$port/"
function Open-Browser { if ($env:PAG_NO_OPEN -ne '1') { Start-Process $url } }

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add($url)
try { $listener.Start() }
catch {
  Write-Host "Port $port is in use; assuming this game is already running. Opening $url"
  Open-Browser
  exit 0
}
Write-Host "Playing at $url  (close this window to stop)"
Open-Browser

# Returns the file path, or an int HTTP status on failure.
function Resolve-Request([string]$rawPath) {
  $cur = $dist
  foreach ($s in $rawPath.Split('/')) {
    if ($s -eq '' -or $s -eq '.') { continue }
    try { $d = [Uri]::UnescapeDataString($s) } catch { return 400 }
    if ($d -eq '..' -or $d.Contains([string][char]0) -or $d.Contains('\') -or $d.Contains(':')) { return 400 }
    $cur = Join-Path $cur $d
  }
  try { $full = [IO.Path]::GetFullPath($cur) } catch { return 400 }
  if ($full -ne $dist -and -not $full.StartsWith($dist + '\', [StringComparison]::OrdinalIgnoreCase)) { return 400 }
  if (Test-Path -LiteralPath $full -PathType Container) { $full = Join-Path $full 'index.html' }
  if (-not (Test-Path -LiteralPath $full -PathType Leaf)) { return 404 }
  return $full
}

# ponytail: one request at a time; fine for a single local player, switch to GetContextAsync if loading feels slow.
while ($listener.IsListening) {
  $ctx = $listener.GetContext()
  $req = $ctx.Request; $res = $ctx.Response
  try {
    $pathname = $req.Url.AbsolutePath
    foreach ($r in $rules) {
      if ($pathname -match $r.re) { foreach ($p in $r.headers.PSObject.Properties) { $res.Headers.Set($p.Name, [string]$p.Value) } }
    }
    $res.Headers.Set('X-Robots-Tag', 'noindex, nofollow')
    if ($req.HttpMethod -ne 'GET' -and $req.HttpMethod -ne 'HEAD') { $res.Headers.Set('Allow', 'GET, HEAD'); $res.StatusCode = 405; continue }
    $f = Resolve-Request $pathname
    if ($f -is [int]) { $res.StatusCode = $f; continue }
    $size = (Get-Item -LiteralPath $f).Length
    $ext = [IO.Path]::GetExtension($f).ToLowerInvariant()
    $res.ContentType = if ($mime.ContainsKey($ext)) { $mime[$ext] } else { 'application/octet-stream' }
    $res.Headers.Set('Accept-Ranges', 'bytes')
    $start = 0L; $end = $size - 1
    $rm = [regex]::Match([string]$req.Headers['Range'], '^bytes=(\d*)-(\d*)$')
    if ($rm.Success -and ($rm.Groups[1].Value -or $rm.Groups[2].Value) -and -not ($rm.Groups[1].Value -and $rm.Groups[2].Value -and [long]$rm.Groups[2].Value -lt [long]$rm.Groups[1].Value)) {
      if ($rm.Groups[1].Value) { $start = [long]$rm.Groups[1].Value; if ($rm.Groups[2].Value) { $end = [Math]::Min([long]$rm.Groups[2].Value, $end) } }
      else { $start = [Math]::Max(0L, $size - [long]$rm.Groups[2].Value) }
      if ($start -ge $size -or $start -gt $end) { $res.Headers.Set('Content-Range', "bytes */$size"); $res.StatusCode = 416; continue }
      $res.StatusCode = 206; $res.Headers.Set('Content-Range', "bytes $start-$end/$size")
    }
    $len = if ($size) { $end - $start + 1 } else { 0 }
    $res.ContentLength64 = $len
    if ($req.HttpMethod -eq 'GET' -and $len -gt 0) {
      $fs = [IO.File]::OpenRead($f)
      try {
        $fs.Seek($start, 'Begin') | Out-Null
        $buf = New-Object byte[] 65536
        $left = $len
        while ($left -gt 0) {
          $n = $fs.Read($buf, 0, [int][Math]::Min($buf.Length, $left))
          if ($n -le 0) { break }
          $res.OutputStream.Write($buf, 0, $n); $left -= $n
        }
      } finally { $fs.Dispose() }
    }
  } catch { try { if (-not $res.HeadersSent) { $res.StatusCode = 400 } } catch { } } # client abort, or a request we could not parse
  finally { try { $res.Close() } catch { } }
}
