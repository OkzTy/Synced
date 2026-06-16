const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { exec, spawn } = require('child_process');

class LinkService {
  static OLLAMA_HOST = 'http://localhost:11434';
  static activeCode = null;
  static activeConfig = null;
  static onLinkSuccessCallback = null;

  static setOnLinkSuccess(cb) {
    this.onLinkSuccessCallback = cb;
  }

  /**
   * Get local IP address
   */
  static getLocalIP() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name]) {
        if (iface.internal || iface.family !== 'IPv4') continue;
        return iface.address;
      }
    }
    return '127.0.0.1';
  }

  /**
   * Generate a unique 6-digit Sync Code and register the local PC bridge config
   */
  static generateSyncCode(licenseKey) {
    // Generate a random 6-digit number
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    this.activeCode = code;

    // Read local bridge config to share with secondary PC
    const bridgeDir = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'synced-bridge');
    const configPath = path.join(bridgeDir, 'config.json');
    let localToken = '';
    let localPort = 8765;

    try {
      if (fs.existsSync(configPath)) {
        const configData = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        localToken = configData.token || '';
        localPort = configData.port || 8765;
      }
    } catch (e) {
      console.error('[LinkService] Failed to read local bridge config:', e.message);
    }

    this.activeConfig = {
      licenseKey,
      mainBridge: {
        ip: this.getLocalIP(),
        port: localPort,
        token: localToken
      }
    };

    console.log(`[LinkService] Generated Sync Code: ${code}`);
    return code;
  }

  /**
   * Verify a code sent by the secondary PC
   */
  static verifyCode(code, clientBridgeConfig) {
    if (!this.activeCode || code !== this.activeCode) {
      return { success: false, error: 'Invalid or expired Sync Code' };
    }

    const config = this.activeConfig;
    
    // Clear code so it can only be used once
    this.activeCode = null;
    this.activeConfig = null;

    // Save secondary PC's bridge config to our local settings.json
    try {
      const settingsPath = path.join(app.getPath('userData'), 'settings.json');
      let settings = { theme: 'dark' };
      if (fs.existsSync(settingsPath)) {
        settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
      }
      settings.bridge = clientBridgeConfig;
      settings.setupComplete = true;
      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));

      // Trigger IPC notification to the React frontend
      if (this.onLinkSuccessCallback) {
        this.onLinkSuccessCallback(settings);
      }
      console.log('[LinkService] Symmetric pairing complete! Secondary PC linked.');
    } catch (e) {
      console.error('[LinkService] Failed to save linked config locally:', e.message);
    }

    // Return our details to the client
    return {
      success: true,
      licenseKey: config.licenseKey,
      bridge: config.mainBridge
    };
  }

  /**
   * Enable and start the bridge server locally on this PC
   */
  static async enableLocalBridge(port = 8765) {
    return new Promise((resolve) => {
      const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
      const bridgeDir = path.join(localAppData, 'synced-bridge');
      const configPath = path.join(bridgeDir, 'config.json');

      if (!fs.existsSync(bridgeDir)) {
        fs.mkdirSync(bridgeDir, { recursive: true });
      }

      let token = '';
      if (fs.existsSync(configPath)) {
        try {
          const cfg = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
          token = cfg.token;
        } catch {}
      }

      if (!token) {
        const crypto = require('crypto');
        token = crypto.randomBytes(32).toString('hex');
      }

      const cfg = {
        token,
        port,
        createdAt: new Date().toISOString(),
        hostname: os.hostname(),
      };

      fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2), 'utf-8');

      // Open firewall port
      exec(`powershell.exe -NoProfile -Command "New-NetFirewallRule -DisplayName 'SyncedBridge-Port-${port}' -Direction Inbound -Protocol TCP -LocalPort ${port} -Action Allow -Profile Private,Domain -ErrorAction SilentlyContinue"`, { windowsHide: true }, (err) => {
        // Restart the built-in bridge server
        try {
          const bridgeServer = require('./bridge-server-node');
          bridgeServer.stop();
          bridgeServer.start();
          console.log(`[LinkService] Built-in bridge server restarted on port ${port}`);
        } catch (serverErr) {
          console.error('[LinkService] Failed to restart node bridge server:', serverErr.message);
        }

        resolve({ success: true });
      });
    });
  }
}

module.exports = LinkService;
