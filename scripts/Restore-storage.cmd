@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0compact-storage.ps1" -Restore
if errorlevel 1 echo Storage restore did not complete. See the message above.
pause
