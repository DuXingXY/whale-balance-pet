@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0compact-storage.ps1"
if errorlevel 1 echo Storage optimization did not complete. See the message above.
pause
