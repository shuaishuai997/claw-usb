<#
.SYNOPSIS
Adds OpenClaw Desktop to system PATH.

.DESCRIPTION
This script adds the OpenClaw Desktop installation directory to the system PATH environment variable.
Requires Administrator privileges.
#>

$ScriptDir = Split-Path $MyInvocation.MyCommand.Definition -Parent
$ScriptDir = $ScriptDir.TrimEnd('\')

Write-Host "========================================"
Write-Host "  OpenClaw Desktop - Add to PATH"
Write-Host "========================================"
Write-Host ""

# Check if running as Administrator
$currentPrincipal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
$isAdmin = $currentPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin) {
    Write-Host "[Error] Administrator privileges required" -ForegroundColor Red
    Write-Host "        Please run PowerShell as Administrator" -ForegroundColor Red
    Write-Host ""
    Write-Host "========================================"
    pause
    exit 1
}

$machinePath = [Environment]::GetEnvironmentVariable("Path", "Machine")

# Check if path already exists in PATH (exact match)
$pathExists = $machinePath -split ';' | Where-Object { $_.Trim() -eq $ScriptDir }

if ($pathExists) {
    Write-Host "[Skip] Already in PATH: $ScriptDir" -ForegroundColor Yellow
} else {
    try {
        # Ensure PATH doesn't end with semicolon
        $machinePath = $machinePath.TrimEnd(';')
        [Environment]::SetEnvironmentVariable("Path", "$machinePath;$ScriptDir", "Machine")
        Write-Host "[Success] Added to PATH: $ScriptDir" -ForegroundColor Green
    } catch {
        Write-Host "[Failed] Error: $_" -ForegroundColor Red
    }
}

Write-Host ""
Write-Host "========================================"
Write-Host "  Done! Please restart your terminal"
Write-Host "========================================"
Write-Host ""
pause