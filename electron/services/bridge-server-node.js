/**
 * Node-based Bridge Server
 * Replaces the PowerShell bridge-server.ps1 script, running natively inside Electron.
 * Listens on the configured bridge port and exposes REST endpoints for dual-PC management.
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { exec, spawn } = require('child_process');

let server = null;
const startTime = new Date();
const version = '1.0.0';

function getBridgeConfigPath() {
  const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  return path.join(localAppData, 'synced-bridge', 'config.json');
}

function initializeConfig() {
  const configPath = getBridgeConfigPath();
  const bridgeDir = path.dirname(configPath);

  // Ensure writable directory exists
  if (!fs.existsSync(bridgeDir)) {
    fs.mkdirSync(bridgeDir, { recursive: true });
  }

  // Load or create config.json
  if (fs.existsSync(configPath)) {
    try {
      const cfg = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      if (cfg.token && cfg.port) {
        console.log(`[BridgeServer] Loaded config from ${configPath}`);
        return cfg;
      }
    } catch (err) {
      console.warn(`[BridgeServer] Invalid config at ${configPath}, regenerating...`);
    }
  }

  // Generate new config
  const token = crypto.randomBytes(32).toString('hex');
  const port = 8765;
  const cfg = {
    token,
    port,
    createdAt: new Date().toISOString(),
    hostname: os.hostname(),
  };

  fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2), 'utf-8');
  console.log(`[BridgeServer] Generated new bridge config at ${configPath}`);
  return cfg;
}

function start() {
  if (server) {
    console.warn('[BridgeServer] Server is already running.');
    return;
  }

  const config = initializeConfig();
  const token = config.token;
  const port = config.port || 8765;

  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '100mb' }));

  // Inbound Bearer Token Auth Middleware
  const authMiddleware = (req, res, next) => {
    if (req.method === 'OPTIONS') return next();

    const authHeader = req.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      console.warn(`[BridgeServer] Unauthorized request (missing token) from ${req.ip}`);
      return res.status(401).json({ error: true, message: 'Unauthorized. Provide a valid Bearer token.' });
    }

    const providedToken = authHeader.substring(7).trim();
    if (providedToken !== token) {
      console.warn(`[BridgeServer] Unauthorized request (invalid token) from ${req.ip}`);
      return res.status(401).json({ error: true, message: 'Unauthorized. Provide a valid Bearer token.' });
    }

    next();
  };

  app.use(authMiddleware);

  // ── GET /status ──────────────────────────────────────────────────────────────
  app.get('/status', (req, res) => {
    const uptimeSeconds = Math.round((new Date() - startTime) / 1000);
    res.json({
      service: 'synced-bridge',
      hostname: os.hostname(),
      version: version,
      uptime: uptimeSeconds,
      os: `${os.type()} ${os.release()}`,
    });
  });

  // ── GET /specs ───────────────────────────────────────────────────────────────
  app.get('/specs', async (req, res) => {
    try {
      const si = await import('systeminformation');
      const [cpu, mem, graphics, osInfo, disks] = await Promise.all([
        si.cpu(),
        si.mem(),
        si.graphics(),
        si.osInfo(),
        si.fsSize(),
      ]);
      const currentLoad = await si.currentLoad();

      const diskLayout = disks.map((d) => ({
        drive: d.mount,
        totalGB: parseFloat((d.size / 1073741824).toFixed(2)),
        freeGB: parseFloat((d.available / 1073741824).toFixed(2)),
        usedPct: parseFloat(d.use.toFixed(1)),
      }));

      res.json({
        hostname: os.hostname(),
        os: `${osInfo.distro} ${osInfo.release}`,
        cpu: {
          model: cpu.brand,
          cores: cpu.cores,
          threads: cpu.threads || cpu.cores,
          maxClockMHz: cpu.speedMax ? cpu.speedMax * 1000 : cpu.speed * 1000,
          loadPct: Math.round(currentLoad.currentLoad),
        },
        ram: {
          totalGB: parseFloat((mem.total / 1073741824).toFixed(2)),
          availableGB: parseFloat((mem.free / 1073741824).toFixed(2)),
          usedPct: parseFloat(((mem.used / mem.total) * 100).toFixed(1)),
        },
        gpu: {
          model: graphics.controllers[0]?.model || 'N/A',
          vramMB: graphics.controllers[0]?.vram || 0,
          driver: graphics.controllers[0]?.driverVersion || 'N/A',
          status: 'ok',
        },
        disks: diskLayout,
        uptime: Math.round(os.uptime() / 3600), // hours
      });
    } catch (err) {
      console.error('[BridgeServer] Error fetching specs:', err.message);
      res.status(500).json({ error: true, message: err.message });
    }
  });

  // ── GET /processes ───────────────────────────────────────────────────────────
  app.get('/processes', async (req, res) => {
    try {
      const si = await import('systeminformation');
      const processes = await si.processes();
      const list = processes.list
        .sort((a, b) => b.cpu - a.cpu)
        .slice(0, 100)
        .map((p) => ({
          pid: p.pid,
          name: p.name,
          cpu: parseFloat(p.cpu.toFixed(2)),
          memory: parseFloat((p.memRss / 1048576).toFixed(2)), // to MB
          path: p.path || '',
        }));

      res.json({
        processes: list,
        count: list.length,
      });
    } catch (err) {
      console.error('[BridgeServer] Error fetching processes:', err.message);
      res.status(500).json({ error: true, message: err.message });
    }
  });

  // ── POST /exec ───────────────────────────────────────────────────────────────
  app.post('/exec', (req, res) => {
    const { command } = req.body;
    if (!command) {
      return res.status(400).json({ error: true, message: 'Missing "command" in request body.' });
    }

    console.log(`[BridgeServer] EXEC: ${command}`);
    // Run in powershell (bypass execution policy and profile)
    exec(`powershell.exe -NoProfile -NonInteractive -Command "${command.replace(/"/g, '\\"')}"`, (err, stdout, stderr) => {
      res.json({
        output: stdout || '',
        error: stderr || (err ? err.message : ''),
        exitCode: err ? err.code : 0,
      });
    });
  });

  // ── POST /read ───────────────────────────────────────────────────────────────
  app.post('/read', (req, res) => {
    const { path: filePath } = req.body;
    if (!filePath) {
      return res.status(400).json({ error: true, message: 'Missing "path" in request body.' });
    }

    // Replace env variables (e.g. %USERPROFILE% or $env:USERPROFILE)
    let resolvedPath = filePath.replace(/%([^%]+)%/g, (_, name) => process.env[name] || '');
    resolvedPath = resolvedPath.replace(/\$env:([^/\\]+)/gi, (_, name) => process.env[name] || '');

    if (!fs.existsSync(resolvedPath)) {
      return res.status(404).json({ error: true, message: `File not found: ${resolvedPath}` });
    }

    try {
      const stats = fs.statSync(resolvedPath);
      if (stats.isDirectory()) {
        return res.status(400).json({ error: true, message: 'Path is a directory, not a file' });
      }
      const content = fs.readFileSync(resolvedPath, 'utf-8');
      res.json({
        content,
        path: resolvedPath,
        size: stats.size,
      });
    } catch (err) {
      res.status(500).json({ error: true, message: `Failed to read file: ${err.message}` });
    }
  });

  // ── POST /write ──────────────────────────────────────────────────────────────
  app.post('/write', (req, res) => {
    const { path: filePath, content } = req.body;
    if (!filePath) {
      return res.status(400).json({ error: true, message: 'Missing "path" in request body.' });
    }

    let resolvedPath = filePath.replace(/%([^%]+)%/g, (_, name) => process.env[name] || '');
    resolvedPath = resolvedPath.replace(/\$env:([^/\\]+)/gi, (_, name) => process.env[name] || '');

    try {
      const dir = path.dirname(resolvedPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(resolvedPath, content || '', 'utf-8');
      res.json({ success: true, path: resolvedPath });
    } catch (err) {
      res.status(500).json({ error: true, message: `Failed to write file: ${err.message}` });
    }
  });

  // ── POST /kill ───────────────────────────────────────────────────────────────
  app.post('/kill', (req, res) => {
    const { pid } = req.body;
    if (!pid) {
      return res.status(400).json({ error: true, message: 'Missing "pid" in request body.' });
    }

    console.log(`[BridgeServer] KILL PID: ${pid}`);
    exec(`taskkill /F /PID ${parseInt(pid)}`, (err, stdout, stderr) => {
      if (err) {
        return res.status(500).json({ error: true, message: `Failed to kill process: ${stderr || err.message}` });
      }
      res.json({ success: true, pid });
    });
  });

  // ── POST /launch ─────────────────────────────────────────────────────────────
  app.post('/launch', (req, res) => {
    const { path: exePath, args } = req.body;
    if (!exePath) {
      return res.status(400).json({ error: true, message: 'Missing "path" in request body.' });
    }

    let resolvedPath = exePath.replace(/%([^%]+)%/g, (_, name) => process.env[name] || '');
    resolvedPath = resolvedPath.replace(/\$env:([^/\\]+)/gi, (_, name) => process.env[name] || '');

    if (!fs.existsSync(resolvedPath)) {
      return res.status(404).json({ error: true, message: `Executable not found: ${resolvedPath}` });
    }

    try {
      const childArgs = args ? args.split(' ') : [];
      const child = spawn(resolvedPath, childArgs, {
        detached: true,
        stdio: 'ignore',
        windowsHide: false,
      });
      child.unref();
      res.json({ success: true, pid: child.pid });
    } catch (err) {
      res.status(500).json({ error: true, message: `Failed to launch: ${err.message}` });
    }
  });

  // ── POST /shutdown ───────────────────────────────────────────────────────────
  app.post('/shutdown', (req, res) => {
    const { action } = req.body;
    if (!action || !['shutdown', 'restart', 'sleep'].includes(action.toLowerCase())) {
      return res.status(400).json({ error: true, message: 'Missing or invalid "action". Expected: shutdown, restart, sleep.' });
    }

    const powerAction = action.toLowerCase();
    console.log(`[BridgeServer] POWER ACTION: ${powerAction}`);
    
    // Respond immediately before executing the power operation
    res.json({ success: true, action: powerAction });

    setTimeout(() => {
      if (powerAction === 'shutdown') {
        exec('shutdown /s /t 0');
      } else if (powerAction === 'restart') {
        exec('shutdown /r /t 0');
      } else if (powerAction === 'sleep') {
        exec('rundll32.exe powrprof.dll,SetSuspendState 0,1,0');
      }
    }, 1500);
  });

  // ── POST /transfer ───────────────────────────────────────────────────────────
  app.post('/transfer', (req, res) => {
    const { path: filePath, content, encoding } = req.body;
    if (!filePath || content === undefined) {
      return res.status(400).json({ error: true, message: 'Missing "path" and/or "content" in request body.' });
    }

    let resolvedPath = filePath.replace(/%([^%]+)%/g, (_, name) => process.env[name] || '');
    resolvedPath = resolvedPath.replace(/\$env:([^/\\]+)/gi, (_, name) => process.env[name] || '');

    try {
      const dir = path.dirname(resolvedPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      if (encoding === 'base64') {
        const buffer = Buffer.from(content, 'base64');
        fs.writeFileSync(resolvedPath, buffer);
      } else {
        fs.writeFileSync(resolvedPath, content, 'utf-8');
      }

      const stats = fs.statSync(resolvedPath);
      res.json({ success: true, path: resolvedPath, sizeBytes: stats.size });
    } catch (err) {
      res.status(500).json({ error: true, message: `Transfer failed: ${err.message}` });
    }
  });

  // ── DB Routes (LicenseService operations via bridge) ─────────────────────────
  const LicenseService = require('./license-service');

  // POST /api/db/register — Create a new user account
  app.post('/api/db/register', async (req, res) => {
    try {
      const { username, password, pin, licenseKey } = req.body;
      const result = await LicenseService.registerUser(username, password, pin, licenseKey);
      res.json(result);
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // POST /api/db/login — Authenticate user
  app.post('/api/db/login', async (req, res) => {
    try {
      const { username, password } = req.body;
      const result = await LicenseService.authenticateUser(username, password);
      res.json(result);
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // POST /api/db/verifyPin — Verify user PIN
  app.post('/api/db/verifyPin', async (req, res) => {
    try {
      const { username, pin } = req.body;
      const result = await LicenseService.verifyPin(username, pin);
      res.json(result);
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // GET /api/db/profile?username=X — Get user profile
  app.get('/api/db/profile', async (req, res) => {
    try {
      const { username } = req.query;
      const result = await LicenseService.getUserProfile(username);
      res.json(result);
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // POST /api/db/profile — Save user profile
  app.post('/api/db/profile', async (req, res) => {
    try {
      const { username, data } = req.body;
      const result = await LicenseService.saveUserProfile(username, data);
      res.json(result);
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // POST /api/db/sessionData — Save session data
  app.post('/api/db/sessionData', async (req, res) => {
    try {
      const { username, data } = req.body;
      const result = await LicenseService.saveSessionData(username, data);
      res.json(result);
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // GET /api/db/users — List all users (admin)
  app.get('/api/db/users', async (req, res) => {
    try {
      const result = await LicenseService.getAllUsers();
      res.json(result);
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // POST /api/db/createUser — Admin create user
  app.post('/api/db/createUser', async (req, res) => {
    try {
      const { username, password, pin, licenseKey, isAdmin } = req.body;
      const result = await LicenseService.adminCreateUser(username, password, pin, licenseKey, isAdmin);
      res.json(result);
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // POST /api/db/deleteUser — Admin delete user
  app.post('/api/db/deleteUser', async (req, res) => {
    try {
      const { userId } = req.body;
      const result = await LicenseService.deleteUser(userId);
      res.json(result);
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // POST /api/db/assignLicense — Admin assign license key to user
  app.post('/api/db/assignLicense', async (req, res) => {
    try {
      const { username, key } = req.body;
      const result = await LicenseService.adminAssignLicenseKey(username, key);
      res.json(result);
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // GET /api/db/keys — List all license keys
  app.get('/api/db/keys', async (req, res) => {
    try {
      const result = await LicenseService.getKeys();
      res.json(result);
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // POST /api/db/createKey — Create a new license key
  app.post('/api/db/createKey', async (req, res) => {
    try {
      const { type } = req.body;
      const result = await LicenseService.createKey(type);
      res.json(result);
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // POST /api/db/revokeKey — Revoke a license key
  app.post('/api/db/revokeKey', async (req, res) => {
    try {
      const { key } = req.body;
      const result = await LicenseService.revokeKey(key);
      res.json(result);
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // POST /api/db/resetKeyHWID — Reset HWID lock on a license key
  app.post('/api/db/resetKeyHWID', async (req, res) => {
    try {
      const { key } = req.body;
      const result = await LicenseService.resetKeyHWID(key);
      res.json(result);
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // POST /api/db/deleteKey — Delete a license key
  app.post('/api/db/deleteKey', async (req, res) => {
    try {
      const { key } = req.body;
      const result = await LicenseService.deleteKey(key);
      res.json(result);
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // GET /api/db/settings?username=X — Get user settings
  app.get('/api/db/settings', async (req, res) => {
    try {
      const { username } = req.query;
      const result = await LicenseService.getUserSettings(username);
      res.json(result);
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // POST /api/db/validateProductKey
  app.post('/api/db/validateProductKey', async (req, res) => {
    try {
      const { username, product, key } = req.body;
      const result = await LicenseService.validateProductKeyForUser(username, product, key);
      res.json(result);
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // POST /api/db/assignProductKey
  app.post('/api/db/assignProductKey', async (req, res) => {
    try {
      const { username, product, key } = req.body;
      const result = await LicenseService.adminAssignProductKey(username, product, key);
      res.json(result);
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // POST /api/db/manuallyActivateKey
  app.post('/api/db/manuallyActivateKey', async (req, res) => {
    try {
      const { key } = req.body;
      const result = await LicenseService.manuallyActivateKey(key);
      res.json(result);
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // GET /api/db/productsMetadata
  app.get('/api/db/productsMetadata', async (req, res) => {
    try {
      const result = await LicenseService.getProductsMetadata();
      res.json(result);
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // POST /api/db/updateProductMetadata
  app.post('/api/db/updateProductMetadata', async (req, res) => {
    try {
      const { id, description, status, price, features, image, imageScale, name, category, version, requirements } = req.body;
      const result = await LicenseService.updateProductMetadata(id, description, status, price, features, image, imageScale, name, category, version, requirements);
      res.json(result);
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Listen to 0.0.0.0 to be accessible on local network
  server = app.listen(port, '0.0.0.0', () => {
    console.log(`[BridgeServer] Built-in server running on port ${port}`);
    // Open firewall port automatically in private/domain networks
    exec(`powershell.exe -NoProfile -Command "New-NetFirewallRule -DisplayName 'SyncedBridge-Port-${port}' -Direction Inbound -Protocol TCP -LocalPort ${port} -Action Allow -Profile Private,Domain -ErrorAction SilentlyContinue"`, { windowsHide: true });
  });

  server.on('error', (err) => {
    console.error(`[BridgeServer] Failed to start server:`, err.message);
  });
}

function stop() {
  if (server) {
    server.close();
    server = null;
    console.log('[BridgeServer] Stopped built-in server.');
  }
}

module.exports = { start, stop };
