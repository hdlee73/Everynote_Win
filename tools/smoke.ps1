# CI smoke test: launch the published exe with a sample PDF, wait for the page, run host-protocol checks through the
# WebView2 DevTools port, take a screenshot and report everything as workflow annotations.
param(
  [Parameter(Mandatory)][string]$Exe,
  [Parameter(Mandatory)][string]$Pdf,
  [string]$Out = 'smoke',
  [string]$Docx = ''
)
$ErrorActionPreference = 'Continue'
New-Item -ItemType Directory -Force -Path $Out | Out-Null
function Esc([string]$s) { $s -replace '%','%25' -replace "`r",'%0D' -replace "`n",'%0A' }
$fail = $false

$data = Join-Path ([IO.Path]::GetTempPath()) 'pdfnote-smoke-data'
Remove-Item -Recurse -Force $data -ErrorAction SilentlyContinue
$env:PDFNOTE_DATA = $data
$env:PDFNOTE_LIBRARY = Join-Path $data 'library'
$env:PDFNOTE_DEBUG_PORT = '9333'
$pdfFull = (Resolve-Path $Pdf).Path

$p = Start-Process -FilePath $Exe -ArgumentList "`"$pdfFull`"" -PassThru
$page = $null
for ($i = 0; $i -lt 90; $i++) {
  Start-Sleep -Seconds 1
  if ($p.HasExited) { break }
  try {
    $list = Invoke-RestMethod -Uri 'http://127.0.0.1:9333/json/list' -TimeoutSec 2
    $lastList = ($list | ForEach-Object { "$($_.type) $($_.url)" }) -join ' ; '
    $page = $list | Where-Object { $_.type -eq 'page' -and $_.url -like 'https://app.pdfnote.local/*' } | Select-Object -First 1
    if ($page) { break }
  } catch { $lastErr = $_.Exception.Message }
}
if ($p.HasExited) {
  Write-Host "::error title=smoke::APP EXITED with code $($p.ExitCode)"; $fail = $true
} else {
  $p.Refresh()
  Write-Host "::notice title=smoke::APP RUNNING title='$($p.MainWindowTitle)' ws=$([int]($p.WorkingSet64/1MB))MB private=$([int]($p.PrivateMemorySize64/1MB))MB responding=$($p.Responding) page=$($page.url)"
  if (-not $page) { Write-Host "::error title=smoke::no page from https://app.pdfnote.local reached (WebResourceRequested serving failed?) targets=[$lastList] err=[$lastErr]"; $fail = $true }
}

function Cdp([string]$ws, [string]$expr, [int]$timeoutSec = 120) {
  $c = [System.Net.WebSockets.ClientWebSocket]::new()
  $none = [Threading.CancellationToken]::None
  $c.ConnectAsync([uri]$ws, $none).Wait()
  $msg = @{ id = 1; method = 'Runtime.evaluate'; params = @{ expression = $expr; awaitPromise = $true; returnByValue = $true } } | ConvertTo-Json -Depth 6 -Compress
  $bytes = [Text.Encoding]::UTF8.GetBytes($msg)
  $c.SendAsync([ArraySegment[byte]]::new($bytes), [System.Net.WebSockets.WebSocketMessageType]::Text, $true, $none).Wait()
  $buf = New-Object byte[] 65536
  $sb = [Text.StringBuilder]::new()
  while ($true) {
    $t = $c.ReceiveAsync([ArraySegment[byte]]::new($buf), $none)
    if (-not $t.Wait($timeoutSec * 1000)) { return $null }
    $r = $t.Result
    [void]$sb.Append([Text.Encoding]::UTF8.GetString($buf, 0, $r.Count))
    if ($r.EndOfMessage) {
      $o = $sb.ToString() | ConvertFrom-Json
      if ($o.id -eq 1) { $c.Dispose(); return $o }
      [void]$sb.Clear()
    }
  }
}

if ($page) {
  Start-Sleep -Seconds 6   # let the UI settle
  $js = Get-Content -Raw (Join-Path $PSScriptRoot 'smoke-host.js')
  if ($Docx) { $js = "window.__SMOKE_DOCX__ = " + ($Docx | ConvertTo-Json) + ";`n" + $js }
  $res = Cdp $page.webSocketDebuggerUrl $js
  if (-not $res) { Write-Host "::error title=smoke-host::no answer from page (timeout)"; $fail = $true }
  elseif ($res.result.exceptionDetails) { Write-Host "::error title=smoke-host::$(Esc ($res.result.exceptionDetails | ConvertTo-Json -Depth 5 -Compress))"; $fail = $true }
  else {
    $o = $res.result.result.value | ConvertFrom-Json
    $bad = @(); $good = @()
    foreach ($k in $o.checks.PSObject.Properties) { if ($k.Value -eq $true) { $good += $k.Name } elseif ($k.Value -eq 'skip') { $good += "$($k.Name)(skipped)" } else { $bad += "$($k.Name)=$($o.info.$($k.Name))" } }
    Write-Host "::notice title=smoke-host-ok::$(Esc ($good -join ', '))"
    if ($bad.Count) { Write-Host "::error title=smoke-host-FAILED::$(Esc ($bad -join ' ; '))"; $fail = $true }
    foreach ($k in 'app','engines','ocr','office','title','text','hasApp','exception') { if ($o.info.$k) { Write-Host "::notice title=smoke-info-$k::$(Esc ([string]$o.info.$k))" } }
  }
}

Add-Type -AssemblyName System.Windows.Forms, System.Drawing
$b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($b.Location, [System.Drawing.Point]::Empty, $b.Size)
$bmp.Save("$Out\screenshot.png")
$small = New-Object System.Drawing.Bitmap $bmp, 64, 36
$set = New-Object System.Collections.Generic.HashSet[int]
for ($x = 0; $x -lt 64; $x++) { for ($y = 0; $y -lt 36; $y++) { [void]$set.Add($small.GetPixel($x, $y).ToArgb()) } }
Write-Host "::notice title=smoke-screen::distinct colors in 64x36 thumbnail: $($set.Count) screen=$($b.Width)x$($b.Height)"

$log = Join-Path $data 'log.txt'
if (Test-Path $log) {
  $txt = Get-Content $log -Raw; if ($txt.Length -gt 3500) { $txt = $txt.Substring(0, 3500) }
  $lvl = if ($txt -match 'exception|failed|Unhandled') { 'warning' } else { 'notice' }
  Write-Host "::${lvl} title=smoke-applog::$(Esc $txt)"
} else { Write-Host "::notice title=smoke-applog::no app log" }
if (-not $p.HasExited) { Stop-Process -Id $p.Id -Force }
Copy-Item $log "$Out\log.txt" -ErrorAction SilentlyContinue
if ($fail) { exit 1 }
