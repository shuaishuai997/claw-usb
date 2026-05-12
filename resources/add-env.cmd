@echo off
setlocal enabledelayedexpansion

set "SCRIPT_DIR=%~dp0"
if "!SCRIPT_DIR:~-1!"=="\" set "SCRIPT_DIR=!SCRIPT_DIR:~0,-1!"

echo ========================================
echo   OpenClaw Desktop - Add to PATH
echo ========================================
echo.

for /f "tokens=2*" %%A in ('reg query "HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment" /v Path 2^>nul') do set "SYS_PATH=%%B"

echo !SYS_PATH! | find /i "!SCRIPT_DIR!" >nul 2>&1
if !errorlevel! equ 0 (
    echo [Skip] Already in PATH: !SCRIPT_DIR!
    goto done
)

reg add "HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment" /v Path /t REG_EXPAND_SZ /d "!SYS_PATH!;!SCRIPT_DIR!" /f >nul 2>&1
if !errorlevel! equ 0 (
    echo [Success] Added to PATH: !SCRIPT_DIR!
) else (
    echo [Failed] Please run as Administrator
)

:done
echo.
echo ========================================
echo   Done! Please restart your terminal
echo ========================================
echo.
pause
