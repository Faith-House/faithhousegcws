@echo off
cd /d "%~dp0"
node setup-phone.mjs
if errorlevel 1 pause
