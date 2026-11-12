@echo off
cd /d "%~dp0"
node --env-file-if-exists=.env.local open-test-tv.mjs
pause
