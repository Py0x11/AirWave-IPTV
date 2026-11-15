const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const url = require('url');

// Hide web security for development, remove in production
process.env['ELECTRON_DISABLE_SECURITY_WARNINGS'] = 'true';

let mainWindow = null;
let loadingTimeout = null;

// Netflix-style loading overlay CSS
const loadingCSS = `
  /* Netflix-style loading overlay */
  #loader {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: #000;
    z-index: 9999;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    transition: opacity 0.5s ease-out;
  }

  #loader.hidden {
    opacity: 0;
    pointer-events: none;
  }

  .netflix-logo {
    width: 200px;
    height: 80px;
    background: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 80"><rect width="200" height="80" fill="%23e50914"/><path d="M25 15h50l25 35h25l-25 35h-50l-25-35h25l25-35z" fill="%23fff"/></svg>') no-repeat center/contain;
    animation: pulse 2s ease-in-out infinite;
  }

  @keyframes pulse {
    0%, 100% { transform: scale(1); }
    50% { transform: scale(1.05); }
  }

  .title {
    margin-top: 30px;
    font-size: 28px;
    font-weight: 300;
    color: #e50914;
    letter-spacing: 8px;
    text-transform: uppercase;
    opacity: 0;
    animation: fadeIn 1s ease-out 1.5s forwards;
  }

  @keyframes fadeIn {
    to { opacity: 1; }
  }

  .subtitle {
    margin-top: 10px;
    font-size: 14px;
    color: #808080;
    opacity: 0;
    animation: fadeIn 0.5s ease-out 2.5s forwards;
  }
`;

function createWindow() {
  // Create the browser window.
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 720,
    minWidth: 1024,
    minHeight: 720,
    backgroundColor: '#000',
    webPreferences: {
      // nodeIntegration: true, // Security: false
      contextIsolation: true,
      // Enable remote if needed
      // enableRemoteModule: true,
    },
    show: false, // We'll show after loading
  });

  // Set the HTML content with loading screen
  mainWindow.webContents.on('did-frame-finish-load', () => {
    // Add loading screen CSS and HTML after the window loads
    mainWindow.webContents.insertCSS(loadingCSS);
    mainWindow.webContents.executeJavaScript(`
      // Add loading screen to body
      const loader = document.createElement('div');
      loader.id = 'loader';
      loader.innerHTML = \`
        <div class="netflix-logo"></div>
        <div class="title">AirWave TV Beta</div>
        <div class="subtitle">Loading channels & streams...</div>
      \`;
      document.body.style.margin = '0';
      document.body.style.overflow = 'hidden';
      document.body.prepend(loader);
    `);
  });

  // Load the remote URL
  mainWindow.loadURL(url.format({
    pathname: path.join(__dirname, 'public', 'index.html'),
    protocol: 'file:',
    slashes: true
  }));

  // Remove loading screen after content is ready
  setTimeout(() => {
    try {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.executeJavaScript(`
          const loader = document.getElementById('loader');
          if (loader) {
            loader.classList.add('hidden');
            setTimeout(() => { if (loader && loader.parentNode) loader.parentNode.removeChild(loader); }, 500);
          }
        `);
      }
    } catch (e) {}
  }, 3000);
}

// When app is ready, create the window
app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Quit when all windows are closed, except on macOS
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});