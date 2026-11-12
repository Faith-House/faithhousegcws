@echo off
cd /d "%~dp0"
where uv >nul 2>&1
if errorlevel 1 (
  echo Install uv from https://docs.astral.sh/uv/ then run this again.
  pause
  exit /b 1
)
uv venv --python 3.12 .pocket-venv
if errorlevel 1 exit /b 1
uv pip install --python .pocket-venv\Scripts\python.exe --index https://download.pytorch.org/whl/cpu pocket-tts==4.0.1 torch==2.9.1+cpu
if errorlevel 1 exit /b 1
.pocket-venv\Scripts\python.exe setup-pocket-voice.py
if errorlevel 1 pause
