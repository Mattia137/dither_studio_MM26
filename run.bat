@echo off
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js not found. Install from nodejs.org & pause & exit /b)
if not exist node_modules ( echo Installing dependencies... & call npm install )
start "" http://localhost:5173/
call npm run dev
