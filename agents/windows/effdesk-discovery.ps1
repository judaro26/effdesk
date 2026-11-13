# EffDesk Windows discovery agent (PowerShell 5.1+; no Microsoft subscription required).
# Read-only inventory. It does not collect passwords, browser data, processes, files, or logged-on user details.
[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$EnrollmentToken,
  [string]$ApiUrl = "https://app.effdesk.com/api/cmdb-agent"
)
$ErrorActionPreference = "Stop"
if ($ApiUrl -notmatch '^https://') { throw "ApiUrl must use HTTPS." }
$ErrorActionPreference = "Continue"
function Get-Value($scriptBlock) { try { & $scriptBlock } catch { $null } }
$computer = Get-Value { Get-CimInstance -ClassName Win32_ComputerSystem }
$bios = Get-Value { Get-CimInstance -ClassName Win32_BIOS }
$os = Get-Value { Get-CimInstance -ClassName Win32_OperatingSystem }
if (-not $computer -or -not $bios -or -not $os) { throw "Could not read required Windows hardware details. Run PowerShell locally and retry." }
$serial = ([string]$bios.SerialNumber).Trim()
if (-not $serial -or $serial -match '^(0+|Default string|To be filled by O.E.M.)$') {
  $serial = "NO-SERIAL-" + (Get-FileHash -InputStream ([IO.MemoryStream]::new([Text.Encoding]::UTF8.GetBytes($computer.Name))) -Algorithm SHA256).Hash.Substring(0,16)
}
$software = @()
$uninstallRoots = @(
 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
 'HKLM:\Software\Wow6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*',
 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*'
)
foreach ($root in $uninstallRoots) {
  try {
    Get-ItemProperty -Path $root -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName } | ForEach-Object {
      $software += [ordered]@{
        name = ([string]$_.DisplayName).Trim()
        publisher = ([string]$_.Publisher).Trim()
        version = ([string]$_.DisplayVersion).Trim()
      }
    }
  } catch {}
}
$software = @($software | Group-Object { "$($_.name.ToLowerInvariant())|$($_.version)" } | ForEach-Object { $_.Group[0] } | Select-Object -First 500)
$payload = [ordered]@{
  hostname = [string]$computer.Name
  manufacturer = [string]$computer.Manufacturer
  model = [string]$computer.Model
  serial = $serial
  os = [string]$os.Caption
  osVersion = [string]$os.Version
  software = $software
}
$json = $payload | ConvertTo-Json -Depth 5 -Compress
$headers = @{ Authorization = "Bearer $EnrollmentToken"; Accept = "application/json" }
try {
  $response = Invoke-RestMethod -Method Post -Uri $ApiUrl -Headers $headers -ContentType "application/json" -Body ([Text.Encoding]::UTF8.GetBytes($json)) -TimeoutSec 45
  Write-Output "EffDesk discovery succeeded. $($response.softwareCount) software entries reported."
} catch {
  $status = $_.Exception.Response.StatusCode.value__
  if ($status -eq 401) { throw "EffDesk rejected this enrollment token. Ask a workspace administrator to issue a new token." }
  throw "EffDesk discovery failed: $($_.Exception.Message)"
}
