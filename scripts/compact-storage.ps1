[CmdletBinding()]
param(
    [string]$Directory,
    [switch]$Restore,
    [switch]$MeasureOnly
)
$ErrorActionPreference = 'Stop'
if ([string]::IsNullOrWhiteSpace($Directory)) { $Directory = $PSScriptRoot }
function Get-ContentHash([string]$File) {
    $stream = [IO.File]::OpenRead($File)
    $sha = [Security.Cryptography.SHA256]::Create()
    try { return [BitConverter]::ToString($sha.ComputeHash($stream)) }
    finally { $stream.Dispose(); $sha.Dispose() }
}
if ($Restore -and $MeasureOnly) { throw 'Choose Restore or MeasureOnly.' }
$rootItem = Get-Item -LiteralPath $Directory
if (-not $rootItem.PSIsContainer) { throw 'A program directory is required.' }
$programRoot = $rootItem.FullName
$manifestFile = Join-Path $programRoot 'resources\app\package.json'
$executable = Join-Path $programRoot 'WhaleBalance.exe'
if (-not (Test-Path -LiteralPath $manifestFile) -or -not (Test-Path -LiteralPath $executable)) { throw 'This is not a WhaleBalance portable folder.' }
$manifest = Get-Content -LiteralPath $manifestFile -Raw | ConvertFrom-Json
if ($manifest.name -ne 'whale-balance-pet') { throw 'Unexpected application manifest.' }
if ($rootItem.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Choose a real program directory, not a linked directory.' }
$directories = @(Get-ChildItem -LiteralPath $programRoot -Directory -Recurse -Force)
if ($directories | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint }) { throw 'Linked subdirectories are not supported.' }
if (-not ('WhaleStorageSize' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
public static class WhaleStorageSize {
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern uint GetCompressedFileSizeW(string name, out uint high);
    public static ulong Bytes(string name) {
        uint high;
        uint low = GetCompressedFileSizeW(name, out high);
        if (low == UInt32.MaxValue && Marshal.GetLastWin32Error() != 0)
            throw new Win32Exception(Marshal.GetLastWin32Error());
        return ((ulong)high << 32) | low;
    }
}
'@
}
$files = @(Get-ChildItem -LiteralPath $programRoot -File -Recurse -Force)
$beforeBytes = [uint64]0
$logicalBytes = [uint64]0
$hashes = @{}
foreach ($file in $files) {
    $beforeBytes += [WhaleStorageSize]::Bytes($file.FullName)
    $logicalBytes += $file.Length
    if (-not $MeasureOnly) { $hashes[$file.FullName] = Get-ContentHash $file.FullName }
}
if (-not $MeasureOnly) {
    $driveInfo = [IO.DriveInfo]::new([IO.Path]::GetPathRoot($programRoot))
    if ($driveInfo.DriveFormat -ne 'NTFS') { throw 'LZX storage compression requires an NTFS drive. Program files are unchanged.' }
    $running = @(Get-Process -Name WhaleBalance -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $executable })
    if ($running.Count) { throw 'Exit this WhaleBalance program from its tray before changing storage compression.' }
    $action = if ($Restore) { '/U' } else { '/C' }
    Push-Location -LiteralPath $programRoot
    try {
        & "$env:SystemRoot\System32\compact.exe" $action '/EXE:LZX' "/S:$programRoot" '/A' '/Q' '*'
        if ($LASTEXITCODE -ne 0) { throw "compact.exe failed with exit code $LASTEXITCODE. No files were deleted; inspect its output before retrying." }
    } finally { Pop-Location }
}
$storedBytes = [uint64]0
$fileReport = @()
foreach ($file in $files) {
    $stored = [WhaleStorageSize]::Bytes($file.FullName)
    $storedBytes += $stored
    if (-not $MeasureOnly -and $hashes[$file.FullName] -ne (Get-ContentHash $file.FullName)) { throw "Content changed: $($file.Name)" }
    $fileReport += [pscustomobject]@{ file = $file.FullName.Substring($programRoot.Length + 1); logicalBytes = $file.Length; storedBytes = $stored }
}
$report = [pscustomobject]@{
    version = $manifest.version
    directory = $programRoot
    operation = $(if ($MeasureOnly) { 'measure' } elseif ($Restore) { 'restore' } else { 'LZX' })
    logicalBytes = $logicalBytes
    beforeStoredBytes = $beforeBytes
    storedBytes = $storedBytes
    savedBytes = $logicalBytes - $storedBytes
    contentVerified = -not $MeasureOnly
    files = $fileReport
}
$report | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath ($programRoot + '.storage.json') -Encoding UTF8
Write-Output ('Logical size: {0:N2} MiB; disk storage: {1:N2} MiB; saved: {2:N2} MiB' -f ($logicalBytes / 1MB), ($storedBytes / 1MB), (($logicalBytes - $storedBytes) / 1MB))
if (-not $MeasureOnly) { Write-Output 'SHA-256 verified: every file has identical content before and after.' }
