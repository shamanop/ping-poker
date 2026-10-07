# kills only Chrome processes that were started with our profile dir (E:\bricklord-test\coldcall-fb5) and deletes our scheduled tasks
param([string]$Tag = '')
$pat = if ($Tag) { 'coldcall-fb5\\runs\\' + [regex]::Escape($Tag) + '\\profile' } else { 'coldcall-fb5' }
Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | Where-Object { $_.CommandLine -match $pat } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue; Write-Output ("killed chrome " + $_.ProcessId) }
schtasks /Query /FO CSV /NH 2>$null | ForEach-Object { if ($_ -match '"\\(coldcall-fb5-[^"]+)"') { schtasks /Delete /F /TN $Matches[1] | Out-Null; Write-Output ("deleted task " + $Matches[1]) } }
