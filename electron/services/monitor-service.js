/**
 * Monitor Service - Gets system specs and usage for the local (main) PC
 */

class MonitorService {
  static _si = null;
  static _cachedSpecs = null;

  static async _getSI() {
    if (!this._si) {
      this._si = await import('systeminformation');
    }
    return this._si;
  }

  /**
   * Get full system specs for the local PC
   */
  static async getLocalSpecs() {
    if (this._cachedSpecs) {
      return { success: true, data: this._cachedSpecs };
    }
    try {
      const si = await this._getSI();

      const [cpu, mem, graphics, osInfo, diskLayout, system] = await Promise.all([
        si.cpu(),
        si.mem(),
        si.graphics(),
        si.osInfo(),
        si.diskLayout(),
        si.system(),
      ]);

      let gpus = graphics.controllers
        .filter((g) => {
          if (!g.model) return false;
          const modelLower = g.model.toLowerCase();
          return !modelLower.includes('parsec') && 
                 !modelLower.includes('virtual') && 
                 !modelLower.includes('microsoft remote') && 
                 !modelLower.includes('idd') && 
                 !modelLower.includes('indirect');
        })
        .map((g) => ({
          model: g.model,
          vram: g.vram,
          vendor: g.vendor,
        }));

      if (gpus.length === 0 && graphics.controllers.length > 0) {
        gpus = graphics.controllers.map((g) => ({
          model: g.model,
          vram: g.vram,
          vendor: g.vendor,
        }));
      }

      const specsResult = {
        hostname: osInfo.hostname,
        os: `${osInfo.distro} ${osInfo.release}`,
        cpu: {
          brand: cpu.brand,
          manufacturer: cpu.manufacturer,
          cores: cpu.cores,
          physicalCores: cpu.physicalCores,
          speed: cpu.speed,
          speedMax: cpu.speedMax,
        },
        ram: {
          total: mem.total,
          totalGB: (mem.total / 1073741824).toFixed(1),
        },
        gpus,
        disks: diskLayout.map((d) => ({
          name: d.name,
          size: d.size,
          sizeGB: (d.size / 1073741824).toFixed(1),
          type: d.type,
        })),
        system: {
          manufacturer: system.manufacturer,
          model: system.model,
        },
      };

      this._cachedSpecs = specsResult;

      return {
        success: true,
        data: specsResult,
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Get current resource usage for the local PC
   */
  static async getLocalUsage() {
    try {
      const si = await this._getSI();

      const [currentLoad, mem, graphics] = await Promise.all([
        si.currentLoad(),
        si.mem(),
        si.graphics(),
      ]);

      const gpuUsage = graphics.controllers.map((g) => ({
        model: g.model,
        utilizationGpu: g.utilizationGpu || 0,
        temperatureGpu: g.temperatureGpu || 0,
        memoryUsed: g.memoryUsed || 0,
        memoryTotal: g.memoryTotal || 0,
      }));

      return {
        success: true,
        data: {
          cpu: {
            usage: currentLoad.currentLoad,
            cores: currentLoad.cpus.map((c) => c.load),
          },
          ram: {
            total: mem.total,
            used: mem.used,
            free: mem.free,
            usagePercent: ((mem.used / mem.total) * 100).toFixed(1),
          },
          gpu: gpuUsage,
          disk: [],
        },
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Get running processes on the local PC
   */
  static async getLocalProcesses() {
    try {
      const si = await this._getSI();
      const processes = await si.processes();

      const sorted = processes.list
        .sort((a, b) => b.cpu - a.cpu)
        .slice(0, 100)
        .map((p) => ({
          pid: p.pid,
          name: p.name,
          cpu: p.cpu,
          mem: p.mem,
          memRss: p.memRss,
          state: p.state,
          user: p.user,
          path: p.path,
        }));

      return {
        success: true,
        data: {
          total: processes.all,
          running: processes.running,
          list: sorted,
         },
       };
     } catch (err) {
       return { success: false, error: err.message };
     }
   }
 
   /**
    * Get network and identity info for the local PC
    * Returns: localIp, macAddress, publicIp, interfaces[], uptime
    */
   static async getNetworkInfo() {
     try {
       const os = require('os');
       const interfaces = os.networkInterfaces();
       const allIfaces = [];
       let primaryIp = '';
       let primaryMac = '';
 
       for (const [name, addrs] of Object.entries(interfaces)) {
         for (const iface of addrs) {
           if (iface.internal) continue;
           allIfaces.push({
             name,
             address: iface.address,
             mac: iface.mac,
             family: iface.family,
             netmask: iface.netmask,
           });
           // Pick the first non-internal IPv4 as primary
           if (!primaryIp && iface.family === 'IPv4') {
             primaryIp = iface.address;
             primaryMac = iface.mac;
           }
         }
       }
 
       // Try to get public IP (non-blocking, short timeout)
       let publicIp = '';
       try {
         const https = require('https');
         publicIp = await new Promise((resolve) => {
           const req = https.get('https://api.ipify.org?format=json', { timeout: 3000 }, (res) => {
             let data = '';
             res.on('data', (chunk) => (data += chunk));
             res.on('end', () => {
               try { resolve(JSON.parse(data).ip || ''); }
               catch { resolve(''); }
             });
           });
           req.on('error', () => resolve(''));
           req.on('timeout', () => { req.destroy(); resolve(''); });
         });
       } catch { /* silent */ }
 
       return {
         success: true,
         data: {
           localIp: primaryIp,
           macAddress: primaryMac,
           publicIp,
           hostname: os.hostname(),
           uptime: os.uptime(),
           platform: os.platform(),
           arch: os.arch(),
           interfaces: allIfaces,
         },
       };
     } catch (err) {
       return { success: false, error: err.message };
     }
   }
 }
 
 module.exports = MonitorService;

