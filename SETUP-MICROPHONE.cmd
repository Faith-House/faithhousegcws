@echo off
cd /d "%~dp0"
node setup-recognition.mjs
if errorlevel 1 pause
