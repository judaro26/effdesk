# EffDesk Windows discovery agent (PowerShell 5.1+; no Microsoft subscription required).
# Read-only inventory. It does not collect passwords, browser data, processes, files, or logged-on user details.
[CmdletBinding()]
param(
  [string]$EnrollmentToken,
  [string]$TokenFile,
  [switch]$InstallScheduledTask,
  [string]$ApiUrl = "https://app.effdesk.com/api/cmdb-agent"
)
$ErrorActionPreference = "Stop"
if ($ApiUrl -notmatch '^https://') { throw "ApiUrl must use HTTPS." }
if ($TokenFile) {
  if (-not (Test-Path -LiteralPath $TokenFile)) { throw "The protected enrollment-token file was not found." }
  $secureToken = ConvertTo-SecureString (Get-Content -LiteralPath $TokenFile -Raw)
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureToken)
  try { $EnrollmentToken = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}
if ($InstallScheduledTask) {
  if (-not $EnrollmentToken) { throw "Provide -EnrollmentToken when installing the scheduled task." }
  $installDir = Join-Path $env:LOCALAPPDATA "EffDesk"
  New-Item -ItemType Directory -Path $installDir -Force | Out-Null
  $installedScript = Join-Path $installDir "effdesk-discovery.ps1"
  $protectedToken = Join-Path $installDir "enrollment.dat"
  Copy-Item -LiteralPath $PSCommandPath -Destination $installedScript -Force
  (ConvertTo-SecureString $EnrollmentToken -AsPlainText -Force | ConvertFrom-SecureString) | Set-Content -LiteralPath $protectedToken -NoNewline
  $taskAction = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$installedScript`" -TokenFile `"$protectedToken`" -ApiUrl `"$ApiUrl`""
  $taskTrigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(2) -RepetitionInterval (New-TimeSpan -Hours 6) -RepetitionDuration (New-TimeSpan -Days 3650)
  $taskPrincipal = New-ScheduledTaskPrincipal -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
  Register-ScheduledTask -TaskName "EffDesk Windows Discovery" -Action $taskAction -Trigger $taskTrigger -Principal $taskPrincipal -Description "Read-only hardware and installed-software inventory for EffDesk." -Force | Out-Null
  Write-Output "EffDesk discovery scheduled every 6 hours for the current Windows user. The token is protected with Windows DPAPI."
  exit 0
}
if (-not $EnrollmentToken) { throw "Provide -EnrollmentToken or -TokenFile." }
$ErrorActionPreference = "Continue"
function Get-Value($scriptBlock) { try { & $scriptBlock } catch { $null } }
$computer = Get-Value { Get-CimInstance -ClassName Win32_ComputerSystem }
$bios = Get-Value { Get-CimInstance -ClassName Win32_BIOS }
$os = Get-Value { Get-CimInstance -ClassName Win32_OperatingSystem }
if (-not $computer -or -not $bios -or -not $os) { throw "Could not read required Windows hardware details. Run PowerShell locally and retry." }
$serial = ([string]$bios.SerialNumber).Trim()
if (-not $serial -or $serial -match '^(0+|Default string|To be filled by O.E.M.)$') {
  $serial = "NO-SERIAL-" + ([string]$computer.Name).ToUpperInvariant()
}
$software = @()
$softwareComplete = $true
$uninstallRoots = @(
 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
 'HKLM:\Software\Wow6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*',
 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*'
)
foreach ($root in $uninstallRoots) {
  try {
    if (Test-Path -Path $root) { Get-ItemProperty -Path $root -ErrorAction Stop | Where-Object { $_.DisplayName } | ForEach-Object {
      $software += [ordered]@{
        name = ([string]$_.DisplayName).Trim()
        publisher = ([string]$_.Publisher).Trim()
        version = ([string]$_.DisplayVersion).Trim()
      }
    } }
  } catch { $softwareComplete = $false }
}
$groupedSoftware = @($software | Group-Object { "$($_.name.ToLowerInvariant())|$($_.version)" } | ForEach-Object { $_.Group[0] })
if ($groupedSoftware.Count -gt 500) { $softwareComplete = $false }
$software = @($groupedSoftware | Select-Object -First 500)
$payload = [ordered]@{
  hostname = [string]$computer.Name
  manufacturer = [string]$computer.Manufacturer
  model = [string]$computer.Model
  serial = $serial
  os = [string]$os.Caption
  osVersion = [string]$os.Version
  software = $software
  softwareComplete = $softwareComplete
}
$json = $payload | ConvertTo-Json -Depth 5 -Compress
$headers = @{ Authorization = "Bearer $EnrollmentToken"; Accept = "application/json" }
try {
  $response = Invoke-RestMethod -Method Post -Uri $ApiUrl -Headers $headers -ContentType "application/json; charset=utf-8" -Body $json -TimeoutSec 45
  Write-Output "EffDesk discovery succeeded. $($response.softwareCount) software entries reported."
} catch {
  $status = $_.Exception.Response.StatusCode.value__
  if ($status -eq 401) { throw "EffDesk rejected this enrollment token. Ask a workspace administrator to issue a new token." }
  throw "EffDesk discovery failed: $($_.Exception.Message)"
}
