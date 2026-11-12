@echo off
rem Dev launcher: runs the launcher in development mode with hot reload
set PATH=C:\Users\user\tools\node-v22.21.1-win-x64;%PATH%
cd /d "%~dp0"
call npx electron-vite dev
