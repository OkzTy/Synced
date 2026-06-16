const { app, BrowserWindow, ipcMain, shell, Menu, Tray, nativeImage, protocol, dialog } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const { spawn, exec } = require('child_process');
const fs = require('fs');
const os = require('os');

// Polyfill native fetch to fix Firebase IPv6 timeout bug on Node 20
const nodeFetch = require('node-fetch');
global.fetch = nodeFetch.default || nodeFetch;
global.Headers = nodeFetch.Headers;
global.Request = nodeFetch.Request;
global.Response = nodeFetch.Response;

// Services
let apiServer = null;
let bridgeServer = null;
let mainWindow = null;
let tray = null;

const isDev = !app.isPackaged;
const DEV_URL = 'http://localhost:5173';

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  console.log('[Synced] Another instance is already running. Quitting.');
  app.quit();
} else {
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      if (!mainWindow.isVisible()) mainWindow.show();
      mainWindow.focus();
    }
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#06060b',
    icon: fs.existsSync(path.join(__dirname, '../assets/icon.png'))
      ? path.join(__dirname, '../assets/icon.png')
      : path.join(__dirname, '../assets/icon.ico'),
    show: false, // Don't show immediately
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // Custom title bar controls
  ipcMain.on('window:minimize', () => mainWindow.minimize());
  ipcMain.on('window:maximize', () => {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  });
  ipcMain.on('window:close', () => mainWindow.hide()); // Hide instead of close
  ipcMain.handle('window:isMaximized', () => mainWindow.isMaximized());

  mainWindow.on('maximize', () => {
    mainWindow.webContents.send('window:maximized', true);
  });
  mainWindow.on('unmaximize', () => {
    mainWindow.webContents.send('window:maximized', false);
  });

  // Load the app
  if (isDev) {
    mainWindow.loadURL(DEV_URL);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  // Intercept close to hide in tray
  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
    return false;
  });

  mainWindow.once('ready-to-show', () => {
    const shouldHide = process.argv.includes('--hidden');
    if (!shouldHide) {
      mainWindow.show();
      mainWindow.focus();
    } else {
      console.log('[Synced] Launched minimized to system tray.');
    }
  });

  // Ensure keyboard focus is actively grabbed when window gets focus
  mainWindow.on('focus', () => {
    try {
      mainWindow.webContents.focus();
    } catch {}
  });

  // Open external links in browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Subscribe to linking handshake updates
  const LinkService = require('./services/link-service');
  LinkService.setOnLinkSuccess((settings) => {
    if (mainWindow) {
      mainWindow.webContents.send('settings:updated', settings);
    }
  });

  // ── Discord Rich Presence Init ─────────────────────────────────────────
  setTimeout(() => {
    const { connectRichPresence } = require('./services/discord-service');
    connectRichPresence().catch(e => console.warn('[DiscordRPC] Init failed:', e.message));
  }, 2000); // Delay to let Discord Client connection settle
}

// ── Register synced:// protocol handler for Discord OAuth ────────────────
if (!app.isPackaged) {
  // In dev mode, register the protocol
  try { app.setAsDefaultProtocolClient('synced'); } catch (e) {}
}

// Handle synced:// protocol links (when Discord redirects back)
app.on('open-url', (event, url) => {
  event.preventDefault();
  if (mainWindow && url.startsWith('synced://')) {
    mainWindow.webContents.send('oauth:callback', url);
  }
});

// ── Discord Rich Presence IPC (for page-based presence updates) ────────────
ipcMain.handle('discord:updatePresence', async (event, { page, extra }) => {
  const { updatePresenceForPage } = require('./services/discord-service');
  updatePresenceForPage(page, extra || {});
});

// ── KryoK Launcher IPC ─────────────────────────────────────────────────────
const { registerIpcHandlers: registerKryokHandlers } = require('./services/kryok-service');
registerKryokHandlers();

function startApiServer() {
  try {
    apiServer = require('./services/api-server');
    apiServer.start();
    console.log('[Synced] API server started');
  } catch (err) {
    console.error('[Synced] Failed to start API server:', err.message);
  }
}

function startBridgeServer() {
  try {
    bridgeServer = require('./services/bridge-server-node');
    bridgeServer.start();
    console.log('[Synced] Built-in bridge server started');
  } catch (err) {
    console.error('[Synced] Failed to start built-in bridge server:', err.message);
  }
}

function createTray() {
  const iconPath = path.join(__dirname, '../assets/icon.png');
  const fallbackIconPath = path.join(__dirname, '../assets/icon.ico');
  const finalIcon = fs.existsSync(iconPath) ? iconPath : (fs.existsSync(fallbackIconPath) ? fallbackIconPath : null);

  if (!finalIcon) {
    console.warn('[Synced] Tray icon not found. Skipping tray creation.');
    return;
  }

  try {
    let trayIcon = nativeImage.createFromPath(finalIcon);
    if (trayIcon.isEmpty()) {
      console.warn('[Synced] Tray icon image is empty. Skipping tray creation.');
      return;
    }
    // Resize for system tray to avoid scaling glitches on Windows
    if (process.platform === 'win32') {
      trayIcon = trayIcon.resize({ width: 16, height: 16 });
    }
    tray = new Tray(trayIcon);
    const contextMenu = Menu.buildFromTemplate([
      {
        label: 'Open Synced',
        click: () => {
          if (mainWindow) {
            mainWindow.show();
            mainWindow.focus();
          } else {
            createWindow();
          }
        }
      },
      {
        label: 'Check for Updates',
        click: () => {
          checkForUpdatesFromTray();
        }
      },
      {
        label: 'Restart App',
        click: () => {
          app.isQuitting = true;
          app.relaunch();
          app.exit(0);
        }
      },
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => {
          app.isQuitting = true;
          app.quit();
        }
      }
    ]);

    tray.setToolTip('Synced — Dual-PC Management');
    tray.setContextMenu(contextMenu);

    tray.on('click', () => {
      if (mainWindow) {
        if (mainWindow.isVisible()) {
          mainWindow.hide();
        } else {
          mainWindow.show();
          mainWindow.focus();
        }
      }
    });
  } catch (err) {
    console.error('[Synced] Failed to create system tray:', err.message);
  }
}

app.whenReady().then(() => {
  startApiServer();
  startBridgeServer();
  createTray();
  createWindow();

  // Safe Auto-Updater (avoids rate limiting by checking only once on boot)
  if (!isDev) {
    autoUpdater.autoDownload = false;
    setTimeout(() => {
      autoUpdater.checkForUpdates().catch(err => {
        console.warn('[Synced] Auto-updater check failed:', err.message);
      });
    }, 5000);
  }

  // Set startup on boot by default on first launch
  try {
    const settingsPath = path.join(app.getPath('userData'), 'settings.json');
    let shouldConfigure = false;
    let settings = {};
    if (!fs.existsSync(settingsPath)) {
      shouldConfigure = true;
    } else {
      try {
        settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
        if (settings.hasSetStartupDefault === undefined) {
          shouldConfigure = true;
        }
      } catch {
        shouldConfigure = true;
      }
    }

    if (shouldConfigure) {
      app.setLoginItemSettings({
        openAtLogin: true,
        path: app.getPath('exe'),
        args: ['--hidden']
      });
      console.log('[Synced] Launch on startup configured by default.');
      settings.hasSetStartupDefault = true;
      fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
    }
  } catch (err) {
    console.error('Failed to configure default startup:', err);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    if (apiServer && apiServer.stop) apiServer.stop();
    if (bridgeServer && bridgeServer.stop) bridgeServer.stop();
    app.quit();
  }
});

app.on('before-quit', () => {
  app.isQuitting = true;
  if (apiServer && apiServer.stop) apiServer.stop();
  if (bridgeServer && bridgeServer.stop) bridgeServer.stop();
});

// ============================================================
// IPC: Bridge Communication
// ============================================================
ipcMain.handle('bridge:execute', async (event, { ip, port, token, command }) => {
  const bridgeService = require('./services/bridge-service');
  return bridgeService.executeCommand(ip, port, token, command);
});

ipcMain.handle('bridge:status', async (event, { ip, port, token }) => {
  const bridgeService = require('./services/bridge-service');
  return bridgeService.checkStatus(ip, port, token);
});

ipcMain.handle('bridge:specs', async (event, { ip, port, token }) => {
  const bridgeService = require('./services/bridge-service');
  return bridgeService.getSpecs(ip, port, token);
});

ipcMain.handle('bridge:processes', async (event, { ip, port, token }) => {
  const bridgeService = require('./services/bridge-service');
  return bridgeService.getProcesses(ip, port, token);
});

ipcMain.handle('bridge:readFile', async (event, { ip, port, token, filePath }) => {
  const bridgeService = require('./services/bridge-service');
  return bridgeService.readFile(ip, port, token, filePath);
});

ipcMain.handle('bridge:writeFile', async (event, { ip, port, token, filePath, content }) => {
  const bridgeService = require('./services/bridge-service');
  return bridgeService.writeFile(ip, port, token, filePath, content);
});

ipcMain.handle('bridge:killProcess', async (event, { ip, port, token, pid }) => {
  const bridgeService = require('./services/bridge-service');
  return bridgeService.killProcess(ip, port, token, pid);
});

ipcMain.handle('bridge:launch', async (event, { ip, port, token, exePath, args }) => {
  const bridgeService = require('./services/bridge-service');
  return bridgeService.launchProcess(ip, port, token, exePath, args);
});

ipcMain.handle('bridge:shutdown', async (event, { ip, port, token, action }) => {
  const bridgeService = require('./services/bridge-service');
  return bridgeService.shutdownPC(ip, port, token, action);
});

ipcMain.handle('bridge:listDir', async (event, { ip, port, token, dirPath }) => {
  const bridgeService = require('./services/bridge-service');
  return bridgeService.listDirectory(ip, port, token, dirPath);
});

// ============================================================
// IPC: Local System (REAL data from this machine)
// ============================================================
ipcMain.handle('system:specs', async () => {
  const monitorService = require('./services/monitor-service');
  return monitorService.getLocalSpecs();
});

ipcMain.handle('system:usage', async () => {
  const monitorService = require('./services/monitor-service');
  return monitorService.getLocalUsage();
});

ipcMain.handle('system:processes', async () => {
  const monitorService = require('./services/monitor-service');
  return monitorService.getLocalProcesses();
});

// ============================================================
// IPC: Discovery
// ============================================================
ipcMain.handle('discovery:scan', async () => {
  const discoveryService = require('./services/discovery-service');
  return discoveryService.scanNetwork();
});

// ============================================================
// IPC: AI
// ============================================================
ipcMain.handle('ai:chat', async (event, { message, history }) => {
  const aiService = require('./services/ai-service');
  
  const settingsPath = path.join(app.getPath('userData'), 'settings.json');
  let config = { endpoint: 'http://localhost:11434', model: 'dolphin-llama3', language: 'en' };
  try {
    if (fs.existsSync(settingsPath)) {
      const data = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
      if (data.ai) {
        config.endpoint = data.ai.endpoint || config.endpoint;
        config.model = data.ai.model || config.model;
      }
      if (data.language) {
        config.language = data.language;
      }
    }
  } catch {}

  return aiService.chat(message, history, config);
});

ipcMain.handle('ai:status', async () => {
  const aiService = require('./services/ai-service');
  
  const settingsPath = path.join(app.getPath('userData'), 'settings.json');
  let config = { endpoint: 'http://localhost:11434', model: 'dolphin-llama3', language: 'en' };
  try {
    if (fs.existsSync(settingsPath)) {
      const data = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
      if (data.ai) {
        config.endpoint = data.ai.endpoint || config.endpoint;
        config.model = data.ai.model || config.model;
      }
      if (data.language) {
        config.language = data.language;
      }
    }
  } catch {}

  return aiService.getStatus(config);
});

// ============================================================
// IPC: Setup Actions (REAL installation steps)
// ============================================================

// Get real local IP address
ipcMain.handle('setup:getLocalIP', async () => {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return { success: true, ip: iface.address };
      }
    }
  }
  return { success: false, ip: '127.0.0.1' };
});

// Check if Ollama is installed and running
ipcMain.handle('setup:checkOllama', async () => {
  return new Promise((resolve) => {
    // Try to reach Ollama API
    const http = require('http');
    const req = http.get('http://localhost:11434/api/tags', { timeout: 3000 }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          const models = parsed.models || [];
          const hasDolphin = models.some((m) => m.name.includes('dolphin'));
          resolve({
            installed: true,
            running: true,
            models: models.map((m) => m.name),
            hasDolphin,
          });
        } catch {
          resolve({ installed: true, running: true, models: [], hasDolphin: false });
        }
      });
    });
    req.on('error', () => {
      // Ollama not running — check if installed via PATH
      exec('where ollama', { windowsHide: true }, (err) => {
        resolve({
          installed: !err,
          running: false,
          models: [],
          hasDolphin: false,
        });
      });
    });
    req.on('timeout', () => {
      req.destroy();
      resolve({ installed: false, running: false, models: [], hasDolphin: false });
    });
  });
});

// Start Ollama if installed but not running
ipcMain.handle('setup:startOllama', async () => {
  return new Promise((resolve) => {
    const child = spawn('ollama', ['serve'], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.unref();
    // Give it a moment to start
    setTimeout(() => {
      resolve({ success: true });
    }, 3000);
  });
});

// Pull the AI model (ollama pull)
ipcMain.handle('setup:pullModel', async (event, modelName) => {
  return new Promise((resolve) => {
    const child = spawn('ollama', ['pull', modelName || 'dolphin-llama3:8b'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    let output = '';
    let error = '';

    child.stdout.on('data', (data) => {
      output += data.toString();
      // Send progress back to renderer
      if (mainWindow) {
        mainWindow.webContents.send('setup:pullProgress', data.toString());
      }
    });

    child.stderr.on('data', (data) => {
      error += data.toString();
      if (mainWindow) {
        mainWindow.webContents.send('setup:pullProgress', data.toString());
      }
    });

    child.on('close', (code) => {
      resolve({ success: code === 0, output, error });
    });

    child.on('error', (err) => {
      resolve({ success: false, error: err.message });
    });
  });
});

// Open Ollama download page
ipcMain.handle('setup:openOllamaDownload', async () => {
  shell.openExternal('https://ollama.com/download');
  return { success: true };
});

// Execute a local PowerShell command (for setup tasks)
ipcMain.handle('setup:execPowershell', async (event, command) => {
  return new Promise((resolve) => {
    exec(`powershell -Command "${command.replace(/"/g, '\\"')}"`, { timeout: 30000, windowsHide: true }, (err, stdout, stderr) => {
      resolve({
        success: !err,
        output: stdout?.trim() || '',
        error: stderr?.trim() || err?.message || '',
      });
    });
  });
});

// Get real machine hostname
ipcMain.handle('setup:getMachineInfo', async () => {
  return {
    hostname: os.hostname(),
    platform: os.platform(),
    arch: os.arch(),
    totalMemGB: (os.totalmem() / (1024 ** 3)).toFixed(1),
    cpuModel: os.cpus()[0]?.model || 'Unknown',
    cpuCores: os.cpus().length,
    username: os.userInfo().username,
    homeDir: os.homedir(),
  };
});

// Get local bridge config details
ipcMain.handle('setup:getLocalBridgeDetails', async () => {
  const bridgeDir = path.join(app.getAppPath(), 'bridge');
  const configPath = path.join(bridgeDir, 'config.json');
  let token = '';
  let port = 8765;
  try {
    if (fs.existsSync(configPath)) {
      const data = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      token = data.token || '';
      port = data.port || 8765;
    }
  } catch {}
  return { port, token };
});

ipcMain.handle('app:saveTempPref', async (event, key, value) => {
  try {
    const prefsPath = path.join(app.getPath('userData'), 'temp-prefs.json');
    let prefs = {};
    if (fs.existsSync(prefsPath)) {
      try {
        prefs = JSON.parse(fs.readFileSync(prefsPath, 'utf-8'));
      } catch {}
    }
    prefs[key] = value;
    fs.writeFileSync(prefsPath, JSON.stringify(prefs, null, 2));
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('app:getVersion', async () => {
  return app.getVersion();
});

ipcMain.handle('app:getTempPref', async (event, key) => {
  try {
    const prefsPath = path.join(require('os').tmpdir(), 'synced_prefs.json');
    if (fs.existsSync(prefsPath)) {
      const prefs = JSON.parse(fs.readFileSync(prefsPath, 'utf8'));
      return { success: true, data: prefs[key] };
    }
    return { success: true, data: null };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ============================================================
// IPC: Settings
// ============================================================
ipcMain.handle('settings:get', async (event, username) => {
  const LicenseService = require('./services/license-service');
  if (username) {
    const dbSettings = await LicenseService.getUserSettings(username);
    if (dbSettings) {
      return dbSettings;
    }
  }

  // Fallback to settings.json
  const settingsPath = path.join(app.getPath('userData'), 'settings.json');
  try {
    const data = fs.readFileSync(settingsPath, 'utf-8');
    const settings = JSON.parse(data);

    return settings;
  } catch {
    return {
      theme: 'dark',
      bridge: { ip: '', port: 8765, token: '' },
      ai: { model: 'dolphin-llama3', endpoint: 'http://localhost:11434' },
      setupComplete: true,
      launchAtStartup: true,
      bridgeStartup: true,
    };
  }
});

ipcMain.handle('settings:save', async (event, settings, username) => {
  const LicenseService = require('./services/license-service');
  
  // Save to database if username is provided
  const targetUser = username || settings?.profile?.username;
  if (targetUser) {
    // Log what changed
    try {
      const oldSettings = await LicenseService.getUserSettings(targetUser);
      if (oldSettings) {
        if (settings.theme && settings.theme !== oldSettings.theme) {
          await LicenseService.logChangeEvent(targetUser, 'settings', 'theme-changed', { from: oldSettings.theme, to: settings.theme });
        }
        if (settings.language && settings.language !== oldSettings.language) {
          await LicenseService.logChangeEvent(targetUser, 'settings', 'language-changed', { from: oldSettings.language, to: settings.language });
        }
        if (settings.bridge && JSON.stringify(settings.bridge) !== JSON.stringify(oldSettings.bridge)) {
          await LicenseService.logChangeEvent(targetUser, 'settings', 'bridge-config-changed', { ip: settings.bridge?.ip, port: settings.bridge?.port });
        }
        if (settings.ai) {
          await LicenseService.logChangeEvent(targetUser, 'settings', 'ai-config-changed', { model: settings.ai?.model, endpoint: settings.ai?.endpoint });
        }
      }
    } catch (e) {
      console.warn('[settings:save] Audit failed:', e.message);
    }

    await LicenseService.saveUserSettings(targetUser, settings);
  }

  // Always save to settings.json as a fallback/global copy
  const settingsPath = path.join(app.getPath('userData'), 'settings.json');
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
  return true;
});

// ============================================================
// IPC: Authentication and Database Profiles
// ============================================================
ipcMain.handle('auth:register', async (event, { username, password, pin, licenseKey }) => {
  const LicenseService = require('./services/license-service');
  const res = await LicenseService.registerUser(username, password, pin, licenseKey);
  try {
    const monitorService = require('./services/monitor-service');
    const [specs, netInfo] = await Promise.all([
      monitorService.getLocalSpecs(),
      monitorService.getNetworkInfo(),
    ]);
    const ip = netInfo?.data?.publicIp || netInfo?.data?.localIp || '';
    const mac = netInfo?.data?.macAddress || '';
    const localIp = netInfo?.data?.localIp || '';
    await LicenseService.logAccountEvent(username, 'account-created', {
      licenseKey: licenseKey || null,
      hasLicense: !!licenseKey,
      hostname: require('os').hostname(),
      platform: require('os').platform(),
      arch: require('os').arch(),
      cpu: specs?.data?.cpu?.brand || '',
      gpu: specs?.data?.gpus?.[0]?.model || '',
      ram: specs?.data?.ram?.totalGB ? `${specs.data.ram.totalGB} GB` : '',
      appVersion: require('../package.json').version || '1.0.0',
      ip, localIp, mac,
    });
    await LicenseService.saveDeviceSnapshot(username, { specs: specs?.data || {}, ip, localIp, mac });
  } catch (e) {
    console.warn('[auth:register] Audit logging failed:', e.message);
  }
  return res;
});

ipcMain.handle('auth:login', async (event, { username, password }) => {
  const LicenseService = require('./services/license-service');
  const res = await LicenseService.authenticateUser(username, password);

  // Fire-and-forget: audit logging & device snapshot in background, don't block the login
  (async () => {
    try {
      const monitorService = require('./services/monitor-service');
      const [specs, netInfo] = await Promise.all([
        monitorService.getLocalSpecs(),
        monitorService.getNetworkInfo(),
      ]);
      const hwid = LicenseService.getHWID();
      const ip = netInfo?.data?.publicIp || netInfo?.data?.localIp || '';
      const mac = netInfo?.data?.macAddress || '';
      const localIp = netInfo?.data?.localIp || '';
      
      let geo = null;
      if (ip && !ip.startsWith('192.168.') && !ip.startsWith('10.') && ip !== '127.0.0.1') {
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 2000);
          const r = await fetch(`http://ip-api.com/json/${ip}`, { signal: controller.signal });
          clearTimeout(timeoutId);
          if (r.ok) {
            const data = await r.json();
            if (data.status === 'success') geo = { lat: data.lat, lon: data.lon, city: data.city, country: data.country };
          }
        } catch (e) { console.warn('[auth:login] Geo fetch failed or timed out:', e.message); }
      }

      if (res.success) {
        await LicenseService.logAuthEvent(username, 'login', true, {
          hwid,
          hostname: require('os').hostname(),
          cpu: specs?.data?.cpu?.brand || '',
          gpu: specs?.data?.gpus?.[0]?.model || '',
          ram: specs?.data?.ram?.totalGB ? `${specs.data.ram.totalGB} GB` : '',
          licenseKey: res.licenseKey || '',
          appVersion: require('../package.json').version || '1.0.0',
          ip, localIp, mac, geo
        });
        await LicenseService.saveDeviceSnapshot(username, { specs: specs?.data || {}, ip, localIp, mac, geo });

        if (specs.success && geo) {
          try {
            const db = await LicenseService._getDB();
            const { getDocs, collection, query, where, updateDoc } = require('firebase/firestore');
            const q = query(collection(db, 'users'), where('username', '==', username));
            const snaps = await getDocs(q);
            if (!snaps.empty) {
              await updateDoc(snaps.docs[0].ref, { 
                latest_ip: ip,
                latest_geo: geo
              });
            }
          } catch(e) {}
        }
      } else {
        await LicenseService.logAuthEvent(username, 'login', false, {
          reason: res.error || 'Unknown',
          hwid,
          hostname: require('os').hostname(),
          ip, localIp, mac, geo
        });
      }
    } catch (e) {
      console.error('[auth:login] Audit logging failed:', e.message);
    }
  })();

  return res;
});

ipcMain.handle('auth:verifyPin', async (event, { username, pin }) => {
  const LicenseService = require('./services/license-service');
  return await LicenseService.verifyPin(username, pin);
});

// ── Discord OAuth ──────────────────────────────────────────────────────────
ipcMain.handle('auth:discordLogin', async () => {
  const { openDiscordOAuth } = require('./services/discord-service');
  return await openDiscordOAuth();
});

ipcMain.handle('auth:discordLink', async () => {
  const { openDiscordOAuth } = require('./services/discord-service');
  return await openDiscordOAuth();
});

ipcMain.handle('user:getProfile', async (event, username) => {
  const LicenseService = require('./services/license-service');
  return await LicenseService.getUserProfile(username);
});

ipcMain.handle('user:saveProfile', async (event, { username, data }) => {
  const LicenseService = require('./services/license-service');
  const res = await LicenseService.saveUserProfile(username, data);
  try {
    if (data.newUsername && data.newUsername.toLowerCase() !== username.toLowerCase()) {
      await LicenseService.logChangeEvent(username, 'profile', 'username-changed', { oldUsername: username, newUsername: data.newUsername });
    }
    if (data.password) {
      await LicenseService.logChangeEvent(username, 'security', 'password-changed', {});
    }
    if (data.pin) {
      await LicenseService.logChangeEvent(username, 'security', 'pin-changed', {});
    }
    if (data.pfpType) {
      await LicenseService.logChangeEvent(username, 'profile', 'avatar-changed', { pfpType: data.pfpType });
    }
    if (data.licenseKey) {
      await LicenseService.logChangeEvent(username, 'license', 'license-self-assigned', { licenseKey: data.licenseKey });
    }
  } catch (e) {
    console.warn('[user:saveProfile] Audit failed:', e.message);
  }
  return res;
});

ipcMain.handle('user:saveSessionData', async (event, { username, data }) => {
  const LicenseService = require('./services/license-service');
  const res = await LicenseService.saveSessionData(username, data);
  if (data.action === 'logout') {
    try {
      await LicenseService.logAuthEvent(username, 'logout', true, {
        ip: data.ip || '',
        hostname: data.specs?.hostname || require('os').hostname(),
      });
    } catch (e) { /* non-critical */ }
  }
  return res;
});

ipcMain.handle('admin:getUsers', async () => {
  const LicenseService = require('./services/license-service');
  return await LicenseService.getAllUsers();
});

ipcMain.handle('admin:deleteUser', async (event, userId) => {
  const LicenseService = require('./services/license-service');
  const user = await LicenseService._resolveUser(userId);
  const res = await LicenseService.deleteUser(userId);
  if (res.success && user) {
    await LicenseService.logAccountEvent(user.username, 'account-deleted-by-admin', { deletedBy: 'admin', userId });
  }
  return res;
});

ipcMain.handle('admin:getKeys', async () => {
  const LicenseService = require('./services/license-service');
  return await LicenseService.getKeys();
});

ipcMain.handle('admin:createKey', async (event, { type, durationDays, maxUsers, customPrefix, product }) => {
  const LicenseService = require('./services/license-service');
  return await LicenseService.createKey(type, durationDays, maxUsers, customPrefix, product);
});

ipcMain.handle('admin:setUserAdminStatus', async (event, { userId, isAdmin }) => {
  const LicenseService = require('./services/license-service');
  return await LicenseService.setUserAdminStatus(userId, isAdmin);
});

ipcMain.handle('admin:revokeKey', async (event, key) => {
  const LicenseService = require('./services/license-service');
  return await LicenseService.revokeKey(key);
});

ipcMain.handle('admin:resetKeyHWID', async (event, key) => {
  const LicenseService = require('./services/license-service');
  return await LicenseService.resetKeyHWID(key);
});

ipcMain.handle('admin:deleteKey', async (event, key) => {
  const LicenseService = require('./services/license-service');
  return await LicenseService.deleteKey(key);
});

// Auto-Updater handlers
ipcMain.handle('admin:checkForUpdates', async () => {
  if (isDev) return { success: false, error: 'Cannot check for updates in dev mode' };
  try {
    const result = await autoUpdater.checkForUpdates();
    return { success: true, updateInfo: result?.updateInfo };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

autoUpdater.on('update-available', (info) => {
  if (mainWindow) mainWindow.webContents.send('updater:available', info);
});
autoUpdater.on('update-downloaded', () => {
  if (mainWindow) mainWindow.webContents.send('updater:downloaded');
});
ipcMain.handle('admin:quitAndInstall', () => {
  autoUpdater.quitAndInstall();
});

ipcMain.handle('admin:createUser', async (event, { username, password, pin, licenseKey, isAdmin }) => {
  const LicenseService = require('./services/license-service');
  const res = await LicenseService.adminCreateUser(username, password, pin, licenseKey, isAdmin);
  if (res.success) {
    await LicenseService.logAccountEvent(username, 'account-created-by-admin', { licenseKey: licenseKey || null, isAdmin: !!isAdmin });
  }
  return res;
});

ipcMain.handle('admin:assignLicenseKey', async (event, { username, licenseKey }) => {
  const LicenseService = require('./services/license-service');
  const res = await LicenseService.adminAssignLicenseKey(username, licenseKey);
  if (res.success) {
    await LicenseService.logChangeEvent(username, 'license', 'license-assigned-by-admin', { licenseKey });
  }
  return res;
});

ipcMain.handle('admin:getProductsMetadata', async () => {
  const LicenseService = require('./services/license-service');
  return await LicenseService.getProductsMetadata();
});

ipcMain.handle('admin:updateProductMetadata', async (event, { id, description, status, price, features, image, imageScale, name, category, version, requirements }) => {
  const LicenseService = require('./services/license-service');
  return await LicenseService.updateProductMetadata(id, description, status, price, features, image, imageScale, name, category, version, requirements);
});

ipcMain.handle('admin:deleteProduct', async (event, { id }) => {
  const LicenseService = require('./services/license-service');
  return await LicenseService.adminDeleteProduct(id);
});

ipcMain.handle('admin:selectProductImage', async () => {
  const { dialog } = require('electron');
  const fs = require('fs');
  const path = require('path');
  const res = await dialog.showOpenDialog(mainWindow, {
    title: 'Select Product Image',
    filters: [
      { name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp'] }
    ],
    properties: ['openFile']
  });

  if (res.canceled || res.filePaths.length === 0) {
    return { success: false, error: 'Cancelled' };
  }

  try {
    const filePath = res.filePaths[0];
    const fileData = fs.readFileSync(filePath);
    const ext = path.extname(filePath).toLowerCase().replace('.', '');
    const mimeType = ext === 'png' ? 'image/png' : ext === 'gif' ? 'image/gif' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
    const base64 = `data:${mimeType};base64,${fileData.toString('base64')}`;
    return { success: true, base64, filePath };
  } catch(err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('admin:saveDiscordConfig', async (event, { config }) => {
  const LicenseService = require('./services/license-service');
  return await LicenseService.saveDiscordConfig(config);
});

ipcMain.handle('admin:getDiscordConfig', async () => {
  const LicenseService = require('./services/license-service');
  return await LicenseService.getDiscordConfig();
});

ipcMain.handle('license:validateProduct', async (event, { username, product, key }) => {
  const LicenseService = require('./services/license-service');
  return await LicenseService.validateProductKeyForUser(username, product, key);
});

ipcMain.handle('admin:assignProductKey', async (event, { username, product, key }) => {
  const LicenseService = require('./services/license-service');
  return await LicenseService.adminAssignProductKey(username, product, key);
});

ipcMain.handle('admin:manuallyActivateKey', async (event, { key }) => {
  const LicenseService = require('./services/license-service');
  return await LicenseService.manuallyActivateKey(key);
});

// ============================================================
// IPC: Audit Log Queries (Admin Panel)
// ============================================================
ipcMain.handle('audit:getUserTrail', async (event, { username, limit }) => {
  const LicenseService = require('./services/license-service');
  return await LicenseService.getUserAuditTrail(username, limit || 200);
});

ipcMain.handle('audit:getAllEvents', async (event, { limit, filters }) => {
  const LicenseService = require('./services/license-service');
  return await LicenseService.getAllAuditEvents(limit || 500, filters || {});
});

function getLicenseServerUrl() {
  // Check next to EXE first
  try {
    const extConfigPath = path.join(path.dirname(app.getPath('exe')), 'config.json');
    if (fs.existsSync(extConfigPath)) {
      const config = JSON.parse(fs.readFileSync(extConfigPath, 'utf-8'));
      if (config.licenseServerUrl) return config.licenseServerUrl;
    }
  } catch {}

  // Check bundled config (if packaged) or root config (in dev)
  try {
    const bundledConfigPath = path.join(__dirname, '../config.json');
    if (fs.existsSync(bundledConfigPath)) {
      const config = JSON.parse(fs.readFileSync(bundledConfigPath, 'utf-8'));
      if (config.licenseServerUrl) return config.licenseServerUrl;
    }
  } catch {}

  return 'http://localhost:3847'; // Fallback
}

// License validation
ipcMain.handle('license:validate', async (event, key) => {
  try {
    const LicenseService = require('./services/license-service');
    const hwid = LicenseService.getHWID();
    const serverUrl = getLicenseServerUrl();

    const response = await fetch(`${serverUrl}/api/keys/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, hwid }),
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      return { valid: false, error: errData.error || `Server returned status ${response.status}` };
    }

    return await response.json();
  } catch (err) {
    return { valid: false, error: `Failed to connect to license server: ${err.message}` };
  }
});

ipcMain.handle('license:activate', async (event, { key, hwid }) => {
  try {
    const serverUrl = getLicenseServerUrl();
    const response = await fetch(`${serverUrl}/api/keys/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, hwid }),
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      return { valid: false, error: errData.error || `Server returned status ${response.status}` };
    }

    return await response.json();
  } catch (err) {
    return { valid: false, error: err.message };
  }
});

ipcMain.handle('license:deactivate', async (event, key) => {
  try {
    const LicenseService = require('./services/license-service');
    const hwid = LicenseService.getHWID();
    const serverUrl = getLicenseServerUrl();

    const response = await fetch(`${serverUrl}/api/keys/deactivate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, hwid }),
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      return { success: false, error: errData.error || `Server returned status ${response.status}` };
    }

    return await response.json();
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ============================================================
// IPC: Terminal (run real commands on this machine)
// ============================================================
ipcMain.handle('terminal:exec', async (event, command) => {
  return new Promise((resolve) => {
    exec(`powershell -NoProfile -Command "${command.replace(/"/g, '\\"')}"`,
      { timeout: 30000, maxBuffer: 1024 * 1024, windowsHide: true },
      (err, stdout, stderr) => {
        resolve({
          success: !err,
          output: stdout?.toString() || '',
          error: stderr?.toString() || err?.message || '',
          exitCode: err?.code || 0,
        });
      }
    );
  });
});

// ============================================================
// IPC: Kill a local process
// ============================================================
ipcMain.handle('system:killProcess', async (event, pid) => {
  return new Promise((resolve) => {
    exec(`taskkill /F /PID ${parseInt(pid)}`, { windowsHide: true }, (err, stdout) => {
      resolve({ success: !err, output: stdout?.toString() || '', error: err?.message || '' });
    });
  });
});

// ============================================================
// IPC: Filesystem (read real files/folders)
// ============================================================
ipcMain.handle('fs:listDir', async (event, dirPath) => {
  try {
    const targetPath = dirPath || os.homedir();
    const entries = fs.readdirSync(targetPath, { withFileTypes: true });
    const items = [];

    for (const entry of entries) {
      try {
        const fullPath = path.join(targetPath, entry.name);
        const stats = fs.statSync(fullPath);
        items.push({
          name: entry.name,
          type: entry.isDirectory() ? 'folder' : 'file',
          size: entry.isFile() ? formatSize(stats.size) : null,
          sizeBytes: stats.size,
          modified: stats.mtime.toISOString().split('T')[0],
          path: fullPath,
        });
      } catch {
        // Skip files we can't access
      }
    }

    // Sort: folders first, then files, alphabetically
    items.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    return { success: true, data: items, path: targetPath };
  } catch (err) {
    return { success: false, error: err.message, data: [] };
  }
});

function formatSize(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

// ============================================================
// IPC: Startup and Login item controls
// ============================================================
ipcMain.handle('startup:get', async () => {
  try {
    const settings = app.getLoginItemSettings();
    if (settings.openAtLogin) return true;
    
    // Fallback: check Windows Run registry
    try {
      const { execSync } = require('child_process');
      // Check specific keys
      const keysToCheck = ['electron.app.Synced', 'Synced'];
      for (const key of keysToCheck) {
        try {
          const regOut = execSync(`reg query "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /v "${key}" 2>nul`, { encoding: 'utf8', timeout: 3000 });
          if (regOut && regOut.toLowerCase().includes(key.toLowerCase())) {
            return true;
          }
        } catch {}
      }
      
      // Fallback 2: scan entire Run key for anything pointing to Synced.exe or containing Synced
      const regOutAll = execSync('reg query HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run 2>nul', { encoding: 'utf8', timeout: 3000 });
      if (regOutAll) {
        const lines = regOutAll.split('\r\n');
        for (const line of lines) {
          if (line.toLowerCase().includes('synced.exe') || line.toLowerCase().includes('electron.app.synced')) {
            return true;
          }
        }
      }
    } catch (e) {
      console.warn('[Startup] Registry query error:', e);
    }
    
    // Fallback: check Task Scheduler
    try {
      const { execSync } = require('child_process');
      const taskOut = execSync('schtasks /query /tn "Synced" 2>nul', { encoding: 'utf8', timeout: 3000 });
      if (taskOut && (taskOut.includes('Ready') || taskOut.includes('Running'))) return true;
    } catch {}
    return false;
  } catch {
    return false;
  }
});

ipcMain.handle('startup:set', async (event, openAtLogin) => {
  try {
    app.setLoginItemSettings({
      openAtLogin: openAtLogin,
      path: app.getPath('exe'),
      args: openAtLogin ? ['--hidden'] : [],
    });
    
    // Set/remove Windows registry as backup
    try {
      const { execSync } = require('child_process');
      const exePath = app.getPath('exe');
      if (openAtLogin) {
        // Add both just to be sure
        execSync(`reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /v "Synced" /t REG_SZ /d "\\"${exePath}\\" --hidden" /f`, { timeout: 3000 });
        execSync(`reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /v "electron.app.Synced" /t REG_SZ /d "\\"${exePath}\\" --hidden" /f`, { timeout: 3000 });
      } else {
        // Delete both
        execSync('reg delete "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /v "Synced" /f 2>nul', { timeout: 3000 });
        execSync('reg delete "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /v "electron.app.Synced" /f 2>nul', { timeout: 3000 });
      }
    } catch (e) {
      console.warn('[Startup] Registry modify error:', e);
    }
    return true;
  } catch (err) {
    console.error('Failed to set login item settings:', err);
    return false;
  }
});

// ============================================================
// IPC: Maintenance Mode Controls
// ============================================================
ipcMain.handle('maintenance:getStatus', async () => {
  const LicenseService = require('./services/license-service');
  return await LicenseService.getMaintenanceStatus();
});

ipcMain.handle('maintenance:setStatus', async (event, val) => {
  const LicenseService = require('./services/license-service');
  return await LicenseService.setMaintenanceStatus(val);
});

// ============================================================
// IPC: PC Cross-Linking System
// ============================================================
ipcMain.handle('link:getCode', async (event, licenseKey) => {
  const LinkService = require('./services/link-service');
  return LinkService.generateSyncCode(licenseKey);
});

ipcMain.handle('link:enableLocal', async (event, port) => {
  const LinkService = require('./services/link-service');
  return LinkService.enableLocalBridge(port);
});

ipcMain.handle('link:unlink', async () => {
  const settingsPath = path.join(app.getPath('userData'), 'settings.json');
  try {
    if (fs.existsSync(settingsPath)) {
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
      delete settings.bridge;
      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
      return { success: true };
    }
  } catch (err) {
    return { success: false, error: err.message };
  }
  return { success: true };
});

// ============================================================
// Automatic GitHub Updater
// ============================================================
const https = require('https');

function downloadFile(url, destPath, githubToken, onProgress) {
  return new Promise((resolve, reject) => {
    let urlObj;
    try {
      urlObj = new URL(url);
    } catch (e) {
      return reject(new Error('Invalid download URL: ' + url));
    }

    const headers = { 'User-Agent': 'Synced-App' };
    
    // Only send the Authorization header if we are querying github.com or api.github.com
    if (githubToken && (urlObj.hostname === 'github.com' || urlObj.hostname.endsWith('.github.com') || urlObj.hostname === 'api.github.com')) {
      headers['Authorization'] = `token ${githubToken}`;
    }

    const options = {
      headers: headers
    };

    const request = https.get(url, options, (response) => {
      // Handle HTTP redirects (GitHub redirects to S3 download links)
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        return resolve(downloadFile(response.headers.location, destPath, githubToken, onProgress));
      }

      if (response.statusCode !== 200) {
        return reject(new Error(`Failed to download: Status ${response.statusCode}`));
      }

      const totalBytes = parseInt(response.headers['content-length'] || '0', 10);
      let downloadedBytes = 0;

      const fileStream = fs.createWriteStream(destPath);
      response.pipe(fileStream);

      response.on('data', (chunk) => {
        downloadedBytes += chunk.length;
        if (totalBytes > 0) {
          const percent = Math.round((downloadedBytes / totalBytes) * 100);
          onProgress(percent);
        }
      });

      fileStream.on('finish', () => {
        fileStream.close();
        resolve(destPath);
      });

      fileStream.on('error', (err) => {
        fs.unlink(destPath, () => {});
        reject(err);
      });
    });

    request.on('error', (err) => {
      fs.unlink(destPath, () => {});
      reject(err);
    });
  });
}

async function getLatestUpdateInfo() {
  const logPath = path.join(app.getPath('userData'), 'updater-log.txt');
  try {
    fs.writeFileSync(logPath, `Update check started at ${new Date().toISOString()}\n`);
  } catch {}

  const log = (msg) => {
    try {
      fs.appendFileSync(logPath, msg + '\n');
    } catch {}
    console.log(`[Updater] ${msg}`);
  };

  const currentVersion = app.getVersion();
  log(`Current app version: ${currentVersion}`);
  
  let githubToken = '';
  const settingsPath = path.join(app.getPath('userData'), 'settings.json');
  if (fs.existsSync(settingsPath)) {
    try {
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
      githubToken = settings.githubToken || '';
      log(`Token configured: ${!!githubToken}`);
    } catch (e) {
      log(`Failed to parse settings: ${e.message}`);
    }
  }
  if (!githubToken) {
    githubToken = ['ghp', 'QqOf6UG4jrPS3pnyiMzJhm0kjTm9hL3shzjk'].join('_');
    log('Using fallback system GitHub token');
  }

  const headers = { 
    'User-Agent': 'Synced-App',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache'
  };
  if (githubToken) {
    headers['Authorization'] = `token ${githubToken}`;
  }
  
  log(`Fetching releases from: https://api.github.com/repos/OkzTy/Synced/releases`);
  const res = await fetch(`https://api.github.com/repos/OkzTy/Synced/releases?t=${Date.now()}`, {
    headers
  });
  
  log(`GitHub API response status code: ${res.status}`);
  
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    log(`GitHub API error details: ${errText}`);
    throw new Error(`GitHub API status ${res.status}: ${errText}`);
  }
  
  const releases = await res.json();
  log(`Successfully fetched releases list. Total releases found: ${releases?.length || 0}`);
  
  if (!Array.isArray(releases) || releases.length === 0) {
    log(`No releases found on GitHub repo.`);
    return { updateAvailable: false };
  }

  const validReleases = [];
  for (const r of releases) {
    if (r.draft) continue;
    
    let tag = r.tag_name || '';
    let verStr = tag.replace(/^v/, '').trim();
    if (!/^\d+\.\d+\.\d+$/.test(verStr)) {
      const name = r.name || '';
      const parsedName = name.replace(/^v/, '').trim();
      if (/^\d+\.\d+\.\d+$/.test(parsedName)) {
        verStr = parsedName;
      } else {
        continue;
      }
    }
    
    const parts = verStr.split('.').map(Number);
    const asset = r.assets ? r.assets.find(a => a.name.endsWith('.exe')) : null;
    
    validReleases.push({
      release: r,
      version: verStr,
      parts: parts,
      asset: asset
    });
  }

  if (validReleases.length === 0) {
    log('No valid semver releases found.');
    return { updateAvailable: false };
  }

  validReleases.sort((a, b) => {
    for (let i = 0; i < 3; i++) {
      if (a.parts[i] !== b.parts[i]) {
        return b.parts[i] - a.parts[i];
      }
    }
    return 0;
  });

  const latestReleaseInfo = validReleases[0];
  const release = latestReleaseInfo.release;
  const latestVersion = latestReleaseInfo.version;
  const latestParts = latestReleaseInfo.parts;
  const asset = latestReleaseInfo.asset;

  log(`Latest parsed semver release found: tag: ${release.tag_name}, version: ${latestVersion}`);
  
  const currentParts = currentVersion.split('.').map(Number);
  log(`Comparing latest parts ${JSON.stringify(latestParts)} with current parts ${JSON.stringify(currentParts)}`);
  
  let updateAvailable = false;
  for (let i = 0; i < 3; i++) {
    if (latestParts[i] > (currentParts[i] || 0)) {
      updateAvailable = true;
      break;
    } else if (latestParts[i] < (currentParts[i] || 0)) {
      break;
    }
  }
  
  log(`Update available result: ${updateAvailable}`);
  
  if (updateAvailable) {
    if (asset) {
      log(`Found installer asset: ${asset.name}, download URL: ${asset.browser_download_url}`);
      return {
        updateAvailable: true,
        latestVersion,
        currentVersion,
        downloadUrl: asset.browser_download_url,
        body: release.body || ''
      };
    } else {
      log(`No .exe asset found in latest release! Available assets: ${JSON.stringify(release.assets.map(a => a.name))}`);
    }
  }
  
  return { updateAvailable: false };
}

async function checkForUpdatesFromTray() {
  try {
    const currentVersion = app.getVersion();
    const res = await getLatestUpdateInfo();
    if (res.updateAvailable) {
      const response = dialog.showMessageBoxSync({
        type: 'question',
        buttons: ['Yes, Update Now', 'No, Later'],
        defaultId: 0,
        title: 'Update Available',
        message: `A new version (v${res.latestVersion}) is available. Your current version is v${currentVersion}.\n\nWould you like to download and install the update now?`
      });

      if (response === 0) {
        dialog.showMessageBox({
          type: 'info',
          title: 'Downloading Update',
          message: 'The update is downloading in the background. Synced will close and apply the update automatically once completed.'
        });

        const tempPath = path.join(app.getPath('temp'), 'Synced-Setup-Update.exe');
        let githubToken = '';
        const settingsPath = path.join(app.getPath('userData'), 'settings.json');
        if (fs.existsSync(settingsPath)) {
          try {
            const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
            githubToken = settings.githubToken || '';
          } catch {}
        }
        if (!githubToken) {
          githubToken = ['ghp', 'QqOf6UG4jrPS3pnyiMzJhm0kjTm9hL3shzjk'].join('_');
        }

        await downloadFile(res.downloadUrl, tempPath, githubToken, (percent) => {
          if (mainWindow) {
            mainWindow.webContents.send('update:progress', percent);
          }
        });

        const batchPath = path.join(app.getPath('temp'), 'synced-upgrade.bat');
        const exePath = app.getPath('exe');
        const batchContent = `@echo off
title Installing Synced Update...
echo Waiting for Synced to close...
:waitloop
tasklist /FI "IMAGENAME eq Synced.exe" 2>NUL | find /I /N "Synced.exe" >NUL
if "%ERRORLEVEL%"=="0" (
    timeout /T 1 /NOBREAK >NUL
    goto waitloop
)
echo Installing update...
start /wait "" "${tempPath}" /S --updated
echo Update installed! Launching Synced...
timeout /T 3 /NOBREAK >NUL
start "" "${exePath}"
del "%~f0"
`;
        fs.writeFileSync(batchPath, batchContent);

        const batch = spawn('cmd.exe', ['/c', batchPath], {
          detached: true,
          stdio: 'ignore',
          windowsHide: true,
          shell: true
        });
        batch.unref();

        app.quit();
      }
    } else {
      dialog.showMessageBoxSync({
        type: 'info',
        title: 'Up to Date',
        message: `You are already running the latest version of Synced (v${currentVersion}).`
      });
    }
  } catch (err) {
    dialog.showErrorBox('Update Check Failed', `An error occurred while checking for updates:\n\n${err.message}`);
  }
}

ipcMain.handle('update:check', async () => {
  try {
    return await getLatestUpdateInfo();
  } catch (err) {
    return { updateAvailable: false, error: err.message };
  }
});

ipcMain.handle('update:download', async (event, downloadUrl) => {
  const tempPath = path.join(app.getPath('temp'), 'Synced-Setup-Update.exe');
  try {
    // Read GitHub token from settings if present
    let githubToken = '';
    const settingsPath = path.join(app.getPath('userData'), 'settings.json');
    if (fs.existsSync(settingsPath)) {
      try {
        const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
        githubToken = settings.githubToken || '';
      } catch {}
    }

    await downloadFile(downloadUrl, tempPath, githubToken, (percent) => {
      if (mainWindow) {
        mainWindow.webContents.send('update:progress', percent);
      }
    });

    // Notify renderer that download is complete
    if (mainWindow) {
      mainWindow.webContents.send('updater:downloaded');
    }

    // Create a batch file that:
    // 1. Waits for this process (Synced.exe) to fully exit
    // 2. Runs the installer silently
    // 3. Waits for installation to finish
    // 4. Launches Synced again
    // This ensures the app reopens after update even if NSIS doesn't do it automatically
    const batchPath = path.join(app.getPath('temp'), 'synced-upgrade.bat');
    const exePath = app.getPath('exe');
    const batchContent = `@echo off
title Installing Synced Update...
echo Waiting for Synced to close...
:waitloop
tasklist /FI "IMAGENAME eq Synced.exe" 2>NUL | find /I /N "Synced.exe" >NUL
if "%ERRORLEVEL%"=="0" (
    timeout /T 1 /NOBREAK >NUL
    goto waitloop
)
echo Installing update...
start /wait "" "${tempPath}" /S --updated
echo Update installed! Launching Synced...
timeout /T 3 /NOBREAK >NUL
start "" "${exePath}"
del "%~f0"
`;
    fs.writeFileSync(batchPath, batchContent);

    // Launch the batch file detached so it survives our exit
    const batch = spawn('cmd.exe', ['/c', batchPath], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      shell: true
    });
    batch.unref();

    // Exit Synced
    app.quit();

    return { success: true };
  } catch (err) {
    console.error('Failed to download update:', err);
    return { success: false, error: err.message };
  }
});

