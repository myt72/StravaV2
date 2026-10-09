@echo off
cd /d "%~dp0"

if not exist node_modules (
  echo Installing dependencies...
  call npm install
  if errorlevel 1 goto :fail
)

echo Building the dashboard...
call npm run build
if errorlevel 1 goto :fail

node server.js
if errorlevel 1 goto :fail
exit /b 0

:fail
echo.
echo Something went wrong. See the messages above.
pause
exit /b 1
