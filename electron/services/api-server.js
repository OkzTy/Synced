/**
 * API Server - Express server running inside Electron
 * Handles internal API requests and serves the bridge installer script
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const os = require('os');
const https = require('https');

function getGithubReleases(githubToken) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.github.com',
      path: '/repos/OkzTy/Synced/releases',
      method: 'GET',
      headers: {
        'User-Agent': 'Synced-App',
        'Accept': 'application/json'
      }
    };
    if (githubToken) {
      options.headers['Authorization'] = `token ${githubToken}`;
    }

    const req = https.get(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode !== 200) {
          return reject(new Error(`GitHub API returned status ${res.statusCode}: ${data}`));
        }
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function streamGithubFile(url, githubToken, expressRes) {
  let urlObj;
  try {
    urlObj = new URL(url);
  } catch (e) {
    return expressRes.status(500).send('Invalid download URL');
  }

  const headers = { 'User-Agent': 'Synced-App' };
  
  if (urlObj.hostname === 'api.github.com') {
    headers['Accept'] = 'application/octet-stream';
  }
  
  if (githubToken && (urlObj.hostname === 'github.com' || urlObj.hostname.endsWith('.github.com') || urlObj.hostname === 'api.github.com')) {
    headers['Authorization'] = `token ${githubToken}`;
  }

  https.get(url, { headers }, (response) => {
    if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
      return streamGithubFile(response.headers.location, githubToken, expressRes);
    }

    if (response.statusCode !== 200) {
      return expressRes.status(response.statusCode).send(`GitHub stream error: ${response.statusMessage}`);
    }

    expressRes.setHeader('Content-Type', response.headers['content-type'] || 'application/octet-stream');
    if (response.headers['content-length']) {
      expressRes.setHeader('Content-Length', response.headers['content-length']);
    }
    expressRes.setHeader('Content-Disposition', 'attachment; filename="Synced Setup.exe"');

    response.pipe(expressRes);
  }).on('error', (err) => {
    expressRes.status(500).send(`Streaming failed: ${err.message}`);
  });
}

let server = null;
const PORT = 9876;

function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.internal || iface.family !== 'IPv4') continue;
      return iface.address;
    }
  }
  return '127.0.0.1';
}

function start() {
  const app = express();
  app.use(cors());
  app.use(express.json());

  // Serve the bridge installer script for the secondary PC
  // When user runs: irm \"http://<MAIN_PC_IP>:9876/install\" | iex
  app.get('/install', async (req, res) => {
    const bridgePath = path.join(__dirname, '../../bridge/install-bridge.ps1');
    if (fs.existsSync(bridgePath)) {
      let script = fs.readFileSync(bridgePath, 'utf-8');
      const localIP = getLocalIP();
      script = script.replace(/\$MAIN_PC_IP/g, localIP);

      // Fetch active user from Turso DB
      let user = null;
      try {
        const LicenseService = require('./license-service');
        const db = await LicenseService._getDB();
        const result = await db.execute('SELECT * FROM users LIMIT 1');
        user = result.rows[0] || null;
      } catch (e) {
        console.error('[API Server] Failed to fetch active user for installer injection:', e.message);
      }

      // Read current settings.json to get licenseKey if not in user db record
      let licenseKey = '';
      let theme = 'dark';
      let language = 'en';
      let customization = '{}';
      
      try {
        const { app: electronApp } = require('electron');
        const settingsFile = path.join(electronApp.getPath('userData'), 'settings.json');
        if (fs.existsSync(settingsFile)) {
          const settings = JSON.parse(fs.readFileSync(settingsFile, 'utf-8'));
          licenseKey = settings.licenseKey || '';
          theme = settings.theme || 'dark';
          language = settings.language || 'en';
          if (settings.customization) {
            customization = JSON.stringify(settings.customization);
          }
        }
      } catch {}

      const userUsername = user ? user.username : '';
      const userPasswordHash = user ? user.password_hash : '';
      const userPinHash = user ? user.pin_hash : '';
      const userLicenseKey = user ? (user.license_key || licenseKey) : licenseKey;
      const userPfpType = user ? (user.pfp_type || 'initials') : 'initials';
      const userPfpValue = user ? (user.pfp_value || (userUsername ? userUsername[0].toUpperCase() : 'U')) : 'U';
      const userTheme = user ? (user.theme || theme) : theme;
      const userLanguage = user ? (user.language || language) : language;
      const userCustomization = user ? (user.customization || customization) : customization;

      script = script.replace(/\$USER_USERNAME/g, userUsername);
      script = script.replace(/\$USER_PASSWORD_HASH/g, userPasswordHash);
      script = script.replace(/\$USER_PIN_HASH/g, userPinHash);
      script = script.replace(/\$USER_LICENSE_KEY/g, userLicenseKey);
      script = script.replace(/\$USER_PFP_TYPE/g, userPfpType);
      script = script.replace(/\$USER_PFP_VALUE/g, userPfpValue);
      script = script.replace(/\$USER_THEME/g, userTheme);
      script = script.replace(/\$USER_LANGUAGE/g, userLanguage);
      script = script.replace(/\$USER_CUSTOMIZATION/g, userCustomization);

      res.type('text/plain').send(script);
    } else {
      res.status(404).send('# Bridge installer not found');
    }
  });

  // Serve the compiled installer executable
  app.get('/download', async (req, res) => {
    const packageJsonPath = path.join(__dirname, '../../package.json');
    let version = '1.0.8';
    try {
      if (fs.existsSync(packageJsonPath)) {
        const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
        version = pkg.version || version;
      }
    } catch {}

    const installerPath = path.join(__dirname, `../../dist-electron/Synced Setup ${version}.exe`);
    if (fs.existsSync(installerPath)) {
      return res.download(installerPath, `Synced Setup ${version}.exe`);
    }

    // Fallback 1: search for any .exe in dist-electron
    const distElectronPath = path.join(__dirname, '../../dist-electron');
    try {
      if (fs.existsSync(distElectronPath)) {
        const files = fs.readdirSync(distElectronPath);
        const exeFile = files.find(f => f.startsWith('Synced Setup') && f.endsWith('.exe'));
        if (exeFile) {
          return res.download(path.join(distElectronPath, exeFile), exeFile);
        }
      }
    } catch {}

    // Fallback 2: Stream dynamically from GitHub releases using the configured token
    try {
      const { app: electronApp } = require('electron');
      const settingsFile = path.join(electronApp.getPath('userData'), 'settings.json');
      let githubToken = '';
      if (fs.existsSync(settingsFile)) {
        try {
          const settings = JSON.parse(fs.readFileSync(settingsFile, 'utf-8'));
          githubToken = settings.githubToken || '';
        } catch {}
      }

      console.log(`[API Server] Local installer not found. Fetching fallback release from GitHub...`);
      const releases = await getGithubReleases(githubToken);
      if (!Array.isArray(releases) || releases.length === 0) {
        return res.status(404).send('No GitHub releases found');
      }

      // Find the first release with a setup exe
      for (const r of releases) {
        const asset = r.assets?.find(a => a.name.endsWith('.exe'));
        if (asset && asset.url) {
          console.log(`[API Server] Streaming installer from GitHub release asset: ${asset.name} (${asset.url})`);
          return streamGithubFile(asset.url, githubToken, res);
        }
      }

      res.status(404).send('No installer executable found in GitHub releases');
    } catch (err) {
      console.error('[API Server] Fallback downloader failed:', err.message);
      res.status(500).send(`Server error fetching installer: ${err.message}`);
    }
  });

  // Serve the bridge uninstaller script for the secondary PC
  // When user runs: irm "http://<MAIN_PC_IP>:9876/uninstall" | iex
  app.get('/uninstall', (req, res) => {
    const bridgePath = path.join(__dirname, '../../bridge/uninstall-bridge.ps1');
    if (fs.existsSync(bridgePath)) {
      const script = fs.readFileSync(bridgePath, 'utf-8');
      const localIP = getLocalIP();
      const modified = script.replace(/\$MAIN_PC_IP/g, localIP);
      res.type('text/plain').send(modified);
    } else {
      res.status(404).send('# Bridge uninstaller not found');
    }
  });

  // Serve the bridge server script
  app.get('/bridge-server', (req, res) => {
    const bridgePath = path.join(__dirname, '../../bridge/bridge-server.ps1');
    if (fs.existsSync(bridgePath)) {
      res.type('text/plain').sendFile(bridgePath);
    } else {
      res.status(404).send('# Bridge server script not found');
    }
  });

  // Serve the monitoring agent script
  app.get('/synced-agent', (req, res) => {
    const agentPath = path.join(__dirname, '../../bridge/synced-agent.ps1');
    if (fs.existsSync(agentPath)) {
      res.type('text/plain').sendFile(agentPath);
    } else {
      res.status(404).send('# Synced agent script not found');
    }
  });

  // Generate Sync Code (Main PC)
  app.get('/api/link/code', (req, res) => {
    try {
      const LinkService = require('./link-service');
      const { app } = require('electron');
      const settingsFile = path.join(app.getPath('userData'), 'settings.json');
      let licenseKey = '';
      try {
        if (fs.existsSync(settingsFile)) {
          const settings = JSON.parse(fs.readFileSync(settingsFile, 'utf-8'));
          licenseKey = settings.licenseKey || '';
        }
      } catch {}

      const code = LinkService.generateSyncCode(licenseKey);
      res.json({ success: true, code });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Verify Sync Code & Handshake (Secondary PC client)
  app.post('/api/link/verify', (req, res) => {
    const { code, bridge } = req.body;
    if (!code || !bridge) {
      return res.status(400).json({ success: false, error: 'Missing code or bridge details' });
    }

    try {
      const LinkService = require('./link-service');
      const result = LinkService.verifyCode(code, bridge);
      res.json(result);
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Automatic pairing registration from secondary PC installer script
  app.post('/api/link/auto-register', async (req, res) => {
    const { ip, port, token, hostname, specs } = req.body;
    if (!ip || !port || !token) {
      return res.status(400).json({ success: false, error: 'Missing bridge details' });
    }

    try {
      const LinkService = require('./link-service');
      const LicenseService = require('./license-service');
      const settingsFile = path.join(require('electron').app.getPath('userData'), 'settings.json');
      
      let settings = { theme: 'dark' };
      if (fs.existsSync(settingsFile)) {
        try {
          settings = JSON.parse(fs.readFileSync(settingsFile, 'utf-8'));
        } catch {}
      }

      // Read local details to include specs
      const localSpecs = require('./monitor-service').getLocalSpecs();
      const localIP = getLocalIP();
      
      const bridgeData = {
        ip,
        port,
        token,
        hostname: hostname || 'Secondary PC',
        specs: specs || null,
        mainIP: localIP,
        mainSpecs: localSpecs?.success ? localSpecs.data : null,
        connectionIP: ip
      };

      settings.bridge = bridgeData;
      settings.setupComplete = true;

      // Save to settings.json
      fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2));

      // Save to Turso database for currently configured user(s)
      const db = await LicenseService._getDB();
      const userResult = await db.execute('SELECT username FROM users LIMIT 1');
      const user = userResult.rows[0];
      if (user && user.username) {
        await LicenseService.saveUserSettings(user.username, { bridge: bridgeData });
      }

      // Notify frontend
      if (LinkService.onLinkSuccessCallback) {
        LinkService.onLinkSuccessCallback(settings);
      }

      console.log(`[LinkService] Automatic pairing complete! Linked with secondary PC at ${ip}:${port}`);
      
      res.json({
        success: true,
        licenseKey: settings.licenseKey || '',
        hostname: os.hostname()
      });
    } catch (err) {
      console.error('[LinkService] Auto pairing failed:', err.message);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Health check
  app.get('/health', (req, res) => {
    res.json({
      status: 'ok',
      service: 'synced-api',
      ip: getLocalIP(),
      timestamp: new Date().toISOString(),
    });
  });

  server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Synced API] Running on http://${getLocalIP()}:${PORT}`);
    console.log(`[Synced API] Bridge installer available at  : irm "http://${getLocalIP()}:${PORT}/install" | iex`);
    console.log(`[Synced API] Bridge uninstaller available at: irm "http://${getLocalIP()}:${PORT}/uninstall" | iex`);
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`[Synced API] Port ${PORT} already in use, trying ${PORT + 1}`);
      server = app.listen(PORT + 1, '0.0.0.0');
    }
  });
}

function stop() {
  if (server) {
    server.close();
    server = null;
  }
}

module.exports = { start, stop };
