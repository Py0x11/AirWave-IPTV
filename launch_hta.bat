@echo off
:: ==========================================
:: AirWave TV Beta - Standalone Windows HTA Application
:: No Electron, no ICU errors, minimal size
:: ==========================================

title AirWave TV Beta - Standalone App
mode con cols=120 lines=33
color 0E

echo.
echo ==========================================
echo  Starting AirWave TV Beta Application...
echo ==========================================
echo.

:: ==========================================
:: Step 1: Verify server is running
:: ==========================================
echo Checking AirWave TV Server...
curl -s -o /dev/null -w "%%{http_code}" http://localhost:8585/api/status > %TEMP%\server_status.txt 2>&1
set /p statuscode=< %TEMP%\server_status.txt

if "%statuscode%" NEQ "200" (
    echo.
    echo ==========================================
    echo  ERROR: AirWave TV Server not responding!
    echo  Please ensure the server is running:
    echo   http://localhost:8585
    echo ==========================================
    echo.
    timeout /t 5 /nobreak > nul
    exit /b 1
)

echo.
echo Server status: OK
echo.

:: ==========================================
:: Step 2: Launch HTA Application
:: ==========================================
echo.
echo Launching AirWave TV Beta Application...
echo (This will open as a standalone Windows app, not a browser)
echo.

:: Use mshta.exe to run the HTA application
:: The HTA runs as a native Windows app without browser chrome
set HTA_FILE=%~dp0airwave.hta

if not exist "%HTA_FILE%" (
    echo.
    echo ERROR: HTA application file not found: %HTA_FILE%
    echo.
    echo Looking for alternatives...
    dir /b "%~dp0*.html" 2>nul
    timeout /t 3 /nobreak > nul
    exit /b 1
)

:: Launch the HTA application
:: /offline flag prevents attempting to download homepage
mshta.exe "about:hta" --new-window "%HTA_FILE%" 2>nul

:: Wait for app to initialize
ping -n 4 localhost > nul 2>&1

echo.
echo ==========================================
echo  AirWave TV Beta Application is running!
echo ==========================================
echo.
echo  Controls:
echo   - Drag the top bar to move the window
echo   - Double-click logo to minimize
echo   - Esc key to close/minimize
echo.
echo  Application Features:
echo   • 9522 channels | 14494 streams
echo   • CartoonNetworkAsia.sg hero banner
echo   • Live TV list (replaces old Top 10)
echo   • Search early-exit fix
echo   • Netflix logo variant (netflix-mod-red.png)
echo   • FFmpeg media decoding support
echo.
echo ==========================================
echo  Close this batch window to close the application.
echo ==========================================
echo.

:: Keep the batch window alive to keep the app running
:: The app runs independently once launched
timeout /t 60 /nobreak > nul