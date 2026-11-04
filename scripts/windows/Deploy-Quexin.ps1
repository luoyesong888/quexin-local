[CmdletBinding()]
param(
    [ValidateSet('Check','Plan','Install','Start','Status','Stop','Verify','Doctor')]
    [string]$Action = 'Check',
    [ValidatePattern('^[A-Za-z0-9_. -]+$')]
    [string]$Distribution = 'Ubuntu',
    [string]$InstallDirectory = '',
    [string]$BundleDirectory = $PSScriptRoot
)
$ErrorActionPreference = 'Stop'
$wsl = Get-Command wsl.exe -ErrorAction SilentlyContinue
if (-not $wsl) {
    throw 'WSL is not installed. Read DEPLOY_WINDOWS_WSL.md. This package requires Windows + WSL2, not native Windows Node.js.'
}
$rows = & $wsl.Source --list --verbose
if ($LASTEXITCODE -ne 0) { throw 'Cannot query WSL distributions. Complete WSL setup first.' }
$cleanRows = $rows | ForEach-Object { ([string]$_).Replace("`0", '') }
$pattern = '^\s*\*?\s*' + [regex]::Escape($Distribution) + '\s+.+\s+2\s*$'
if (-not ($cleanRows | Where-Object { $_ -match $pattern })) {
    throw "The selected distribution '$Distribution' must exist and use WSL version 2. Run: wsl --list --verbose"
}
$bundle = (Resolve-Path -LiteralPath $BundleDirectory).Path
$bridge = Join-Path $PSScriptRoot 'windows-entry.sh'
if (-not (Test-Path -LiteralPath $bridge -PathType Leaf)) { throw 'windows-entry.sh is missing. Extract the whole package.' }
$bundleLinux = & $wsl.Source --distribution $Distribution --exec wslpath -a $bundle
if ($LASTEXITCODE -ne 0) { throw 'Cannot convert the package path for WSL.' }
$bridgeLinux = & $wsl.Source --distribution $Distribution --exec wslpath -a $bridge
if ($LASTEXITCODE -ne 0) { throw 'Cannot convert the bootstrap path for WSL.' }
$bundleLinux = ($bundleLinux | Out-String).Trim()
$bridgeLinux = ($bridgeLinux | Out-String).Trim()
# Arguments are passed individually. Never interpolate them into bash -c code.
& $wsl.Source --distribution $Distribution --exec bash $bridgeLinux ($Action.ToLowerInvariant()) $bundleLinux $InstallDirectory
$result = $LASTEXITCODE
if ($result -ne 0) { exit $result }
if ($Action -in @('Install','Start','Verify')) {
    Write-Host 'Open the local URL printed above in your Windows browser. Keep the WSL distribution running.'
}
