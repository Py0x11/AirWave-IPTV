@echo off
:: ==========================================
:: AirWave TV Beta - Windows Launcher
:: Netflix-Style Loading Screen + IPTV Streamer
:: ==========================================

title AirWave TV Beta
mode con cols=120 lines=30
color 0E

:: ==========================================
:: Step 1: Show Netflix-Style Loading Screen
:: ==========================================
echo.
echo ==========================================
echo  Starting AirWave TV Beta Loading...
echo ==========================================
echo.

:: Create the HTA loading screen
echo Creating loading screen...
type nul > "%TEMP%\airwave_loader.hta"
type <<'HTAEOF' >> "%TEMP%\airwave_loader.hta"
<hta:application
    id="AirWaveLoader"
    applicationname="AirWave TV Beta"
    border="dialog"
    caption="AirWave TV Beta"
    icon "%~dp0public/assets/logos/netflix-mod-red.png"
    sysmenu="no"
    thin="yes"
    maximizebutton="no"
    minimizebutton="no"
    windowstate="normal"
/>

<html>
<head>
<style>
    body {
        background: #000;
        margin: 0;
        padding: 0;
        font-family: "Segoe UI", "Helvetica Neue", Helvetica, Arial, sans-serif;
        color: #fff;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        height: 100%;
        width: 100%;
        overflow: hidden;
    }
    .netflix-logo {
        width: 220px;
        height: 90px;
        background: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 200 80'><rect width='200' height='80' fill='%23e50914'/><path d='M25 15h50l25 35h25l-25 35h-50l-25-35h25l25-35z' fill='%23fff'/></svg>") no-repeat center/contain;
        margin-bottom: 30px;
        animation: pulse 2s ease-in-out infinite;
    }
    @keyframes pulse {
        0%, 100% { transform: scale(1); }
        50% { transform: scale(1.05); }
    }
    .title {
        font-size: 28px;
        font-weight: 300;
        letter-spacing: 8px;
        text-transform: uppercase;
        color: #e50914;
        margin-bottom: 10px;
    }
    .subtitle {
        font-size: 14px;
        color: #808080;
        letter-spacing: 4px;
    }
    .progress {
        width: 300px;
        height: 4px;
        background: #333;
        margin-top: 20px;
        overflow: hidden;
        border-radius: 2px;
    }
    .progress-bar {
        width: 0%;
        height: 100%;
        background: #e50914;
        transition: width 0.3s ease;
    }
</style>
</head>
<body>
    <div class="netflix-logo"></div>
    <div class="title">AirWave TV Beta</div>
    <div class="subtitle">Initializing channels & streams...</div>
    <div class="progress">
        <div class="progress-bar" id="progressBar"></div>
    </div>

    <script>
        // Simulate loading progress
        const bar = document.getElementById('progressBar');
        let width = 0;
        const interval = setInterval(() => {
            width += Math.random() * 15;
            if (width >= 100) {
                width = 100;
                clearInterval(interval);
                setTimeout(() => { window.close(); }, 500);
            }
            bar.style.width = width + '%';
        }, 100);

        // Check if server is ready
        const checkServer = setInterval(() => {
            try {
                const xhr = new XMLHttpRequest();
                xhr.open('GET', 'http://localhost:8585/api/status', false);
                xhr.send();
                if (xhr.status === 200) {
                    clearInterval(interval);
                    clearInterval(checkServer);
                    setTimeout(() => { window.close(); }, 500);
                }
            } catch (e) {}
        }, 500);

        // Max wait time
        setTimeout(() => {
            clearInterval(interval);
            clearInterval(checkServer);
            window.close();
        }, 15000);
    </script>
</body>
</html>
HTAEOF

:: Launch the HTA loading screen
echo Launching loading screen...
start "" "%TEMP%\airwave_loader.hta"

:: Wait for loading screen to initialize
ping -n 3 localhost > nul 2>&1

:: ==========================================
:: Step 2: Start the AirWave TV Server
:: ==========================================
echo.
echo Starting AirWave TV Server...
cd /d "%~dp0"
node server.js > NUL 2>&1

:: Wait for server to start
echo Waiting for server to initialize...
ping -n 6 localhost > nul 2>&1

:: ==========================================
:: Step 3: Open the Application
:: ==========================================
echo.
echo opening AirWave TV Beta in your browser...
start "" "http://localhost:8585"

echo.
echo ==========================================
echo  AirWave TV Beta is now running!
echo  - Loading screen: Netflix-style with AirWave TV Beta title
echo  - Server: Running on http://localhost:8585
echo  - Channels: 9522 | Streams: 14494
echo  - Hero Banner: CartoonNetworkAsia.sg (instant Continue Watching)
echo  - Live TV list: Replaces old Top 10 banner
echo  - Logo: netflix-mod-red.png (Lovely Hearts variant)
echo ==========================================
echo.

:: Keep this window open for reference
timeout /t 60 /nobreak > nul