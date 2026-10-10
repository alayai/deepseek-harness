@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"

echo Stopping processes listening on port 3080...
set "SEEN=,"
set "KILLED="
for /f "tokens=1,2,5" %%A in ('netstat -ano -p tcp ^| findstr /I "LISTENING"') do (
  set "ADDR=%%B"
  set "PID=%%C"
  if "!ADDR:~-5!"==":3080" if not "!PID!"=="0" if not "!PID!"=="4" (
    echo !SEEN! | findstr /C:",!PID!," >nul
    if errorlevel 1 (
      echo   taskkill /F /T /PID !PID!
      taskkill /F /T /PID !PID!
      set "SEEN=!SEEN!!PID!,"
      set "KILLED=1"
    )
  )
)

if defined KILLED (
  echo Waiting for port 3080 to be released...
  for /l %%I in (1,1,20) do (
    set "BUSY="
    for /f "tokens=2" %%B in ('netstat -ano -p tcp ^| findstr /I "LISTENING"') do (
      set "ADDR=%%B"
      if "!ADDR:~-5!"==":3080" set "BUSY=1"
    )
    if not defined BUSY goto :port_free
    ping -n 2 127.0.0.1 >nul
  )
  echo Port 3080 is still occupied.
  exit /b 1
)

:port_free
if not defined KILLED echo   port 3080 is free

echo Starting pnpm dsh web...
pnpm dsh web
endlocal
