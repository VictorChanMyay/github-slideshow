@echo off
cd /d "%~dp0"
node tools\backup.js %*
pause
