@echo off
REM ============================================================
REM  KryoK Encryption Tool for Synced
REM  Usage: encrypt-kryok.bat <path-to-kryok.exe>
REM ============================================================
echo.
echo  ⚡ KryoK Encrypt Tool
echo  ─────────────────────
echo.

if "%1"=="" (
    echo  [!] Usage: drag your kryok.exe onto this file
    echo  [!] Or run: encrypt-kryok.bat C:\path\to\kryok.exe
    echo.
    pause
    exit /b 1
)

if not exist "%1" (
    echo  [✗] File not found: %1
    pause
    exit /b 1
)

echo  [*] Encrypting: %1
echo.

node "%~dp0encrypt.js" "%1" "%~dp0..\assets\kryok.bin"

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo  [✗] Encryption failed!
    pause
    exit /b 1
)

echo.
echo  [✓] Done! Encrypted binary saved to: %~dp0..\assets\kryok.bin
echo  [✓] Now rebuild Synced with: npm run electron:build
echo.
pause
