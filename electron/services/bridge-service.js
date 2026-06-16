/**
 * Bridge Service - Communicates with the secondary PC's PowerShell HTTP bridge
 */

const http = require('http');
const https = require('https');

class BridgeService {
  /**
   * Send a request to the bridge
   */
  static async _request(ip, port, token, endpoint, method = 'POST', body = null) {
    return new Promise((resolve, reject) => {
      const options = {
        hostname: ip,
        port: port,
        path: endpoint,
        method: method,
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        timeout: 10000,
      };

      // Try HTTPS first, fall back to HTTP
      const protocol = port === 8766 ? https : http;
      
      const req = protocol.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          if (res.statusCode < 200 || res.statusCode >= 300) {
            resolve({ success: false, error: `HTTP ${res.statusCode}: ${data || res.statusMessage || 'Unauthorized'}` });
            return;
          }
          try {
            const parsed = JSON.parse(data);
            resolve({ success: true, data: parsed });
          } catch {
            resolve({ success: true, data: data });
          }
        });
      });

      req.on('error', (err) => {
        resolve({ success: false, error: err.message });
      });

      req.on('timeout', () => {
        req.destroy();
        resolve({ success: false, error: 'Connection timed out' });
      });

      if (body) {
        req.write(JSON.stringify(body));
      }

      req.end();
    });
  }

  /**
   * Execute a PowerShell command on the secondary PC
   */
  static async executeCommand(ip, port, token, command) {
    return this._request(ip, port, token, '/exec', 'POST', { command });
  }

  /**
   * Check if the bridge is online
   */
  static async checkStatus(ip, port, token) {
    return this._request(ip, port, token, '/status', 'GET');
  }

  /**
   * Get system specs from the secondary PC
   */
  static async getSpecs(ip, port, token) {
    return this._request(ip, port, token, '/specs', 'GET');
  }

  /**
   * Get running processes from the secondary PC
   */
  static async getProcesses(ip, port, token) {
    return this._request(ip, port, token, '/processes', 'GET');
  }

  /**
   * Read a file from the secondary PC
   */
  static async readFile(ip, port, token, filePath) {
    return this._request(ip, port, token, '/read', 'POST', { path: filePath });
  }

  /**
   * Write a file on the secondary PC
   */
  static async writeFile(ip, port, token, filePath, content) {
    return this._request(ip, port, token, '/write', 'POST', { path: filePath, content });
  }

  /**
   * Kill a process on the secondary PC
   */
  static async killProcess(ip, port, token, pid) {
    return this._request(ip, port, token, '/kill', 'POST', { pid });
  }

  /**
   * Launch an executable on the secondary PC
   */
  static async launchProcess(ip, port, token, exePath, args = '') {
    return this._request(ip, port, token, '/launch', 'POST', { path: exePath, args });
  }

  /**
   * Shutdown/restart the secondary PC
   */
  static async shutdownPC(ip, port, token, action = 'shutdown') {
    return this._request(ip, port, token, '/shutdown', 'POST', { action });
  }

  /**
   * Transfer a file to the secondary PC
   */
  static async transferFile(ip, port, token, localPath, remotePath) {
    const fs = require('fs');
    const content = fs.readFileSync(localPath, { encoding: 'base64' });
    return this._request(ip, port, token, '/transfer', 'POST', {
      path: remotePath,
      content,
      encoding: 'base64',
    });
  }

  /**
   * List directory contents on the secondary PC
   */
  static async listDirectory(ip, port, token, dirPath) {
    const targetPath = dirPath || '$env:USERPROFILE';
    
    // Build a powershell command that lists files and returns structured JSON
    const command = `
      $path = (Resolve-Path "${targetPath.replace(/"/g, '`"')}" -ErrorAction SilentlyContinue).Path
      if (-not $path) { $path = (Get-Item "${targetPath.replace(/"/g, '`"')}" -ErrorAction SilentlyContinue).FullName }
      if (-not $path) { 
        [ordered]@{ success = $false; error = "Path not found" } | ConvertTo-Json -Compress
        return
      }
      $items = Get-ChildItem -Path $path -ErrorAction SilentlyContinue | ForEach-Object {
        [ordered]@{
          name = $_.Name
          type = if ($_.PSIsContainer) { 'folder' } else { 'file' }
          size = if ($_.PSIsContainer) { 0 } else { $_.Length }
          modified = $_.LastWriteTime.ToString('yyyy-MM-dd HH:mm')
          path = $_.FullName
        }
      }
      $list = if ($items) { $items } else { @() }
      if ($list -isnot [array]) { $list = @($list) }
      [ordered]@{
        success = $true
        path = $path
        items = $list
      } | ConvertTo-Json -Depth 3 -Compress
    `.trim();

    const res = await this.executeCommand(ip, port, token, command);
    if (!res.success) return res;

    try {
      const output = res.data.output || res.data || '';
      // Sometimes powershell outputs error streams or warnings, so let's try parsing the last line or find JSON
      const jsonStart = output.indexOf('{');
      if (jsonStart === -1) {
        return { success: false, error: 'No JSON found in response: ' + output };
      }
      const jsonStr = output.substring(jsonStart);
      const parsed = JSON.parse(jsonStr);
      
      if (!parsed.success) {
        return { success: false, error: parsed.error || 'Failed to resolve path' };
      }

      const list = parsed.items || [];
      
      // Helper function to format bytes (since it's not defined in this scope)
      const formatBytes = (bytes) => {
        if (!bytes || bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
      };

      const cleaned = list.map((item) => ({
        name: item.name,
        type: item.type,
        size: item.type === 'folder' ? '' : formatBytes(item.size),
        modified: item.modified,
        path: item.path,
      }));

      return { success: true, data: cleaned, path: parsed.path };
    } catch (err) {
      return { success: false, error: 'Failed to parse directory contents: ' + err.message };
    }
  }
}

module.exports = BridgeService;
