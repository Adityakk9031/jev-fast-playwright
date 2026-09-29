@echo off
setlocal
set "EDGE=C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
if not exist "%EDGE%" set "EDGE=C:\Program Files\Microsoft\Edge\Application\msedge.exe"
if not exist "%EDGE%" (
  echo ERROR: msedge.exe not found.
  exit /b 1
)

set "PROFILE=C:\EdgeDebugJev"
if not exist "%PROFILE%" mkdir "%PROFILE%"

echo.
echo === Stopping Chrome/Edge that may own port 9222 ===
taskkill /F /IM chrome.exe /T >nul 2>&1
taskkill /F /IM msedge.exe /T >nul 2>&1
timeout /t 3 >nul

echo.
echo === Opening VISIBLE Edge with CDP on 9222 ===
echo Profile: %PROFILE%
echo.
start "" "%EDGE%" ^
  --remote-debugging-port=9222 ^
  --user-data-dir="%PROFILE%" ^
  --no-first-run ^
  --no-default-browser-check ^
  --start-maximized ^
  about:blank

echo Waiting 5s for CDP...
timeout /t 5 >nul

echo.
echo === CDP check (must say Edg/ or Edge, NOT Chrome) ===
curl -s http://127.0.0.1:9222/json/version
echo.
echo.
curl -s http://127.0.0.1:9222/json | findstr /i "url title type" | more

echo.
echo If you see Browser containing "Edg" above, tell Antigravity:
echo   Edge ready on CDP. Use ONLY jev-fast-playwright tools. Do NOT use chrome-devtools.
echo.
pause
