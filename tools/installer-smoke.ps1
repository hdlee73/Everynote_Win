# CI test of the Inno Setup installer: silent per-user install, verify files / shortcuts / Apps & features entry / "Open with" registration,
# start the installed app, silent uninstall (user data kept), second round with /PURGEDATA. Results are reported as workflow annotations.
param(
  [Parameter(Mandatory)][string]$Setup,
  [string]$Out = 'installer-smoke'
)
$ErrorActionPreference = 'Continue'
New-Item -ItemType Directory -Force -Path $Out | Out-Null
$Out = (Resolve-Path $Out).Path   # absolute: installer/uninstaller processes may have another working directory
function Esc([string]$s) { $s -replace '%','%25' -replace "`r",'%0D' -replace "`n",'%0A' }
$script:fail = $false
function Check([string]$name, [bool]$cond, [string]$extra = '') {
  if ($cond) { Write-Host "::notice title=installer-ok::$name" }
  else { Write-Host "::error title=installer-FAILED::$name $(Esc $extra)"; $script:fail = $true }
}

$appId = '{3D6B1F4E-8A27-4C59-B0E3-5F9A2C7D1E84}_is1'
$uninstKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\$appId"
$installDir = Join-Path $env:LOCALAPPDATA 'Programs\Everynote'
$exe = Join-Path $installDir 'Everynote.exe'
$startLnk = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Everynote.lnk'
$deskLnk = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Everynote.lnk'
$dataDir = Join-Path $env:LOCALAPPDATA 'PDFNote'
$marker = Join-Path $dataDir 'installer-smoke-marker.txt'

function Wait-Until([scriptblock]$cond, [int]$sec = 60) { for ($i = 0; $i -lt $sec * 2; $i++) { if (& $cond) { return $true }; Start-Sleep -Milliseconds 500 }; return $false }

function Dump-Log([string]$log, [string]$label) {
  if (Test-Path $log) { $t = (Get-Content $log -Tail 30) -join "`n"; Write-Host "::warning title=inno-log-$label::$(Esc $t)" } else { Write-Host "::warning title=inno-log-$label::no log at $log" }
}
function Install([string]$log) {
  $p = Start-Process -FilePath $Setup -ArgumentList @('/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/CURRENTUSER', '/TASKS="desktopicon,associate"', "/LOG=`"$log`"") -PassThru -Wait
  return $p.ExitCode
}
function Uninstall([string]$log, [string[]]$extra = @()) {
  $un = Join-Path $installDir 'unins000.exe'
  if (-not (Test-Path $un)) { return -1 }
  $p = Start-Process -FilePath $un -ArgumentList (@('/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', "/LOG=`"$log`"") + $extra) -PassThru -Wait
  [void](Wait-Until { -not (Test-Path $exe) } 60)
  if ($p.ExitCode -ne 0) {
    Dump-Log $log 'uninstall'
    Write-Host "::warning title=inno-dir::$(Esc ((Get-ChildItem $installDir -ErrorAction SilentlyContinue | ForEach-Object { "$($_.Name) $($_.Length)" }) -join '; '))"
    try { $ev = Get-WinEvent -FilterHashtable @{ LogName = 'Application'; StartTime = (Get-Date).AddMinutes(-3) } -MaxEvents 6 -ErrorAction Stop | ForEach-Object { "$($_.ProviderName): $($_.Message.Substring(0, [Math]::Min(300, $_.Message.Length)))" }; Write-Host "::warning title=inno-events::$(Esc ($ev -join ' || '))" } catch { }
  }
  return $p.ExitCode
}

# ------------------------------------------------------------------ round 1: install, verify, run, uninstall keeping data
New-Item -ItemType Directory -Force -Path $dataDir | Out-Null
Set-Content -Path $marker -Value 'keep me'
$code = Install (Join-Path $Out 'install1.log')
Check 'install exit code 0' ($code -eq 0) "exit=$code"
Check 'installed Everynote.exe' (Test-Path $exe) $installDir
if (Test-Path $exe) { $vi = (Get-Item $exe).VersionInfo; Check 'exe product name' ($vi.ProductName -eq 'Everynote') "$($vi.ProductName) / $($vi.FileDescription)"; Write-Host "::notice title=installer-info::exe version $($vi.ProductVersion) size $([int]((Get-Item $exe).Length/1MB)) MB" }
Check 'Start menu shortcut' (Test-Path $startLnk) $startLnk
Check 'desktop shortcut' (Test-Path $deskLnk) $deskLnk
if (Test-Path $startLnk) {
  $sh = (New-Object -ComObject WScript.Shell).CreateShortcut($startLnk)
  Check 'shortcut target' ($sh.TargetPath -eq $exe) $sh.TargetPath
}
$u = Get-ItemProperty $uninstKey -ErrorAction SilentlyContinue
Check 'Apps & features entry' ($null -ne $u -and $u.DisplayName -like 'Everynote*') ($u | Out-String)
if ($u) {
  Check 'uninstall string + icon + publisher' ($u.UninstallString -and $u.DisplayIcon -and $u.Publisher -eq 'hdlee73') ($u | Out-String)
  Write-Host "::notice title=installer-info::DisplayName=$($u.DisplayName) DisplayVersion=$($u.DisplayVersion)"
}
Check 'ProgId registered' (Test-Path 'HKCU:\Software\Classes\Everynote.Document\shell\open\command')
$ow = Get-Item 'HKCU:\Software\Classes\.pdf\OpenWithProgids' -ErrorAction SilentlyContinue
Check 'Open-with entry for .pdf' ($null -ne $ow -and ($ow.GetValueNames() -contains 'Everynote.Document'))
$uc = (Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\.pdf\UserChoice' -ErrorAction SilentlyContinue).ProgId
Check 'default app for .pdf not hijacked' ($uc -ne 'Everynote.Document') $uc

if (Test-Path $exe) {
  $env:PDFNOTE_DATA = Join-Path ([IO.Path]::GetTempPath()) 'everynote-installed-data'
  $p = Start-Process -FilePath $exe -PassThru
  Start-Sleep -Seconds 12
  $p.Refresh()
  Check 'installed app keeps running' (-not $p.HasExited) "exit=$($p.ExitCode)"
  if (-not $p.HasExited) { Write-Host "::notice title=installer-info::window title '$($p.MainWindowTitle)'"; Check 'window title Everynote' ($p.MainWindowTitle -like '*Everynote*' -or $p.MainWindowTitle -ne '') $p.MainWindowTitle }
  Remove-Item Env:PDFNOTE_DATA -ErrorAction SilentlyContinue
  # leave it running on purpose: the uninstaller must close the running instance
}
$code = Uninstall (Join-Path $Out 'uninstall1.log')
Check 'uninstall exit code 0' ($code -eq 0) "exit=$code"
Check 'app files removed' (-not (Test-Path $exe)) $installDir
Check 'Start menu shortcut removed' (-not (Test-Path $startLnk))
Check 'desktop shortcut removed' (-not (Test-Path $deskLnk))
Check 'Apps & features entry removed' (-not (Test-Path $uninstKey))
Check 'ProgId removed' (-not (Test-Path 'HKCU:\Software\Classes\Everynote.Document'))
Check 'user data kept by default' (Test-Path $marker) $marker
Check 'no Everynote process left' (-not (Get-Process -Name Everynote -ErrorAction SilentlyContinue))

# ------------------------------------------------------------------ round 2: reinstall without tasks, uninstall with /PURGEDATA
$p2 = Start-Process -FilePath $Setup -ArgumentList @('/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/CURRENTUSER', '/TASKS=""', "/LOG=`"$(Join-Path $Out 'install2.log')`"") -PassThru -Wait
Check 'reinstall (no optional tasks)' ($p2.ExitCode -eq 0 -and (Test-Path $exe)) "exit=$($p2.ExitCode)"
Check 'no desktop shortcut without the task' (-not (Test-Path $deskLnk))
Check 'no file association without the task' (-not (Test-Path 'HKCU:\Software\Classes\Everynote.Document'))
$code = Uninstall (Join-Path $Out 'uninstall2.log') @('/PURGEDATA')
Check 'uninstall /PURGEDATA exit code 0' ($code -eq 0) "exit=$code"
Check 'user data deleted with /PURGEDATA' (-not (Test-Path $dataDir)) $dataDir

if ($script:fail) { exit 1 }
Write-Host "::notice title=installer-smoke::all installer checks passed"
