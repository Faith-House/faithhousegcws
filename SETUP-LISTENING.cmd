@echo off
cd /d "%~dp0"
node setup-wakeword.mjs
if errorlevel 1 pause
