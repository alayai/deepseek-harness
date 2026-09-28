@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"

echo Stopping processes listening on 127.0.0.1:3080...
set "SEEN=,"
set "KILLED="
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /R /C:":3080 " ^| findstr /I /C:"LISTENING"') do (
  if not "%%P"=="0" (
    echo !SEEN! | findstr /C:",%%P," >nul
    if errorlevel 1 (
      echo   taskkill /F /T /PID %%P
      taskkill /F /T /PID %%P
      set "SEEN=!SEEN!%%P,"
      set "KILLED=1"
    )
  )
)
if not defined KILLED echo   port 3080 is free

echo Starting pnpm dsh web...
pnpm dsh web
endlocal
