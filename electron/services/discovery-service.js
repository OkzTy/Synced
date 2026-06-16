/**
 * Discovery Service - Auto-discovers the secondary PC on the local network
 * Scans the local subnet for machines running the Synced bridge
 */

const http = require('http');
const os = require('os');

class DiscoveryService {
  /**
   * Get the local subnet base (e.g., "192.168.1")
   */
  static _getSubnet() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name]) {
        // Skip loopback and non-IPv4
        if (iface.internal || iface.family !== 'IPv4') continue;
        // Extract subnet (first 3 octets)
        const parts = iface.address.split('.');
        return {
          subnet: `${parts[0]}.${parts[1]}.${parts[2]}`,
          localIP: iface.address,
        };
      }
    }
    return null;
  }

  /**
   * Probe a single IP to check if the bridge is running
   */
  static _probe(ip, port = 8765, timeout = 1500) {
    return new Promise((resolve) => {
      const req = http.request(
        {
          hostname: ip,
          port,
          path: '/status',
          method: 'GET',
          timeout,
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => { data += chunk; });
          res.on('end', () => {
            try {
              const parsed = JSON.parse(data);
              if (parsed.service === 'synced-bridge') {
                resolve({
                  found: true,
                  ip,
                  port,
                  hostname: parsed.hostname || ip,
                  version: parsed.version || 'unknown',
                });
              } else {
                resolve({ found: false });
              }
            } catch {
              resolve({ found: false });
            }
          });
        }
      );

      req.on('error', () => resolve({ found: false }));
      req.on('timeout', () => {
        req.destroy();
        resolve({ found: false });
      });

      req.end();
    });
  }

  /**
   * Scan the local network for bridge instances
   * Scans IPs 1-254 on the local subnet in parallel batches
   */
  static async scanNetwork(port = 8765) {
    const network = this._getSubnet();
    if (!network) {
      return { success: false, error: 'Could not determine local network' };
    }

    const { subnet, localIP } = network;
    const results = [];
    const batchSize = 50;

    console.log(`[Discovery] Scanning ${subnet}.0/24 for Synced bridges...`);
    console.log(`[Discovery] Local IP: ${localIP}`);

    for (let batchStart = 1; batchStart <= 254; batchStart += batchSize) {
      const batch = [];
      for (let i = batchStart; i < Math.min(batchStart + batchSize, 255); i++) {
        const targetIP = `${subnet}.${i}`;
        // Skip our own IP
        if (targetIP === localIP) continue;
        batch.push(this._probe(targetIP, port));
      }

      const batchResults = await Promise.all(batch);
      for (const result of batchResults) {
        if (result.found) {
          results.push(result);
          console.log(`[Discovery] Found bridge at ${result.ip}:${port}`);
        }
      }
    }

    console.log(`[Discovery] Scan complete. Found ${results.length} bridge(s).`);

    return {
      success: true,
      data: {
        localIP,
        subnet: `${subnet}.0/24`,
        found: results,
      },
    };
  }
}

module.exports = DiscoveryService;
