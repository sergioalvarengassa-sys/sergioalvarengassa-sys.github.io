@echo off
cd /d "%~dp0"
where node.exe >nul 2>nul
if errorlevel 1 (
  echo Instale o Node.js para abrir a previa local. Consulte o arquivo LEIA-ME.md.
  pause
  exit /b 1
)
node preview.mjs --open
pause
