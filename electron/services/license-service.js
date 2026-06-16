/**
 * License Service - Handles license key validation and management
 * Uses Turso Cloud SQL (libsql) database for global synchronization.
 */

const path = require('path');
const os = require('os');
const crypto = require('crypto');
const fs = require('fs');

class LicenseService {
  static _db = null;

  // ── Database Initialization ──────────────────────────────────────────────────
  static async _getDB() {
    if (!this._db) {
      console.log('[LicenseService] Initializing Turso database client...');
      const fs = require('fs');
      const path = require('path');
      const { app } = require('electron');

      let dbUrl = 'file:synced.db';
      let dbAuthToken = '';

      const configPaths = [
        app ? path.join(path.dirname(app.getPath('exe')), 'config.json') : null,
        app ? path.join(app.getAppPath(), 'config.json') : null,
        path.join(__dirname, '..', '..', 'config.json'),
        path.join(__dirname, '..', 'config.json')
      ];

      for (const p of configPaths) {
        if (p && fs.existsSync(p)) {
          try {
            const config = JSON.parse(fs.readFileSync(p, 'utf-8'));
            if (config.dbUrl) dbUrl = config.dbUrl;
            if (config.dbAuthToken) dbAuthToken = config.dbAuthToken;
            break;
          } catch (e) {
            console.error('Failed to parse config at', p, e);
          }
        }
      }

      const { createClient } = require('@libsql/client');
      this._db = createClient({
        url: dbUrl,
        authToken: dbAuthToken
      });

      // Ensure tables exist
      await this._db.execute(`
        CREATE TABLE IF NOT EXISTS users (
          id TEXT PRIMARY KEY,
          username TEXT UNIQUE,
          email TEXT,
          pin_hash TEXT,
          plain_password TEXT,
          plain_pin TEXT,
          hwid TEXT,
          license_key TEXT,
          products_map TEXT, -- JSON map: {"CS2": "key1", "EFT_RADAR": "key2", "KRYOK": "key3"}
          pfp_type TEXT,
          pfp_value TEXT,
          is_admin INTEGER DEFAULT 0,
          theme TEXT DEFAULT 'dark',
          language TEXT DEFAULT 'en',
          customization TEXT,
          device_info TEXT,
          created_at TEXT,
          last_login TEXT
        )
      `);

      await this._db.execute(`
        CREATE TABLE IF NOT EXISTS license_keys (
          key TEXT PRIMARY KEY,
          type TEXT,
          duration_days INTEGER,
          max_users INTEGER,
          is_active INTEGER DEFAULT 1,
          created_at TEXT,
          activated_at TEXT,
          expires_at TEXT,
          hwid TEXT,
          product TEXT
        )
      `);

      await this._db.execute(`
        CREATE TABLE IF NOT EXISTS products_metadata (
          id TEXT PRIMARY KEY,
          name TEXT,
          category TEXT DEFAULT 'DMA',
          description TEXT,
          status TEXT,
          price REAL,
          features TEXT,
          image TEXT,
          image_scale REAL DEFAULT 1.0,
          version TEXT DEFAULT '1.0.0',
          requirements TEXT
        )
      `);

      try {
        await this._db.execute('ALTER TABLE products_metadata ADD COLUMN name TEXT');
      } catch (e) {}
      try {
        await this._db.execute("ALTER TABLE products_metadata ADD COLUMN category TEXT DEFAULT 'DMA'");
      } catch (e) {}
      try {
        await this._db.execute('ALTER TABLE products_metadata ADD COLUMN image TEXT');
      } catch (e) {}
      try {
        await this._db.execute('ALTER TABLE products_metadata ADD COLUMN image_scale REAL DEFAULT 1.0');
      } catch (e) {}
      try {
        await this._db.execute("ALTER TABLE products_metadata ADD COLUMN version TEXT DEFAULT '1.0.0'");
      } catch (e) {}
      try {
        await this._db.execute('ALTER TABLE products_metadata ADD COLUMN requirements TEXT');
      } catch (e) {}
      try {
        await this._db.execute('ALTER TABLE users ADD COLUMN products_map TEXT');
      } catch (e) {}

      await this._db.execute(`
        CREATE TABLE IF NOT EXISTS activation_log (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          license_key TEXT,
          hwid TEXT,
          action TEXT,
          timestamp TEXT
        )
      `);

      await this._db.execute(`
        CREATE TABLE IF NOT EXISTS auth_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id TEXT,
          event_type TEXT,
          success INTEGER,
          data_json TEXT,
          timestamp TEXT
        )
      `);

      await this._db.execute(`
        CREATE TABLE IF NOT EXISTS user_session_data (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id TEXT,
          action TEXT,
          ip TEXT,
          hostname TEXT,
          timestamp TEXT,
          data_json TEXT
        )
      `);

      await this._db.execute(`
        CREATE TABLE IF NOT EXISTS device_snapshots (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id TEXT,
          timestamp TEXT,
          data_json TEXT
        )
      `);

      await this._db.execute(`
        CREATE TABLE IF NOT EXISTS settings (
          key TEXT PRIMARY KEY,
          value TEXT
        )
      `);

      // Seed default admin account if not exists
      try {
        const adminCheck = await this._db.execute({
          sql: 'SELECT id FROM users WHERE LOWER(username) = ?',
          args: ['okzty']
        });
        if (adminCheck.rows.length === 0) {
          console.log('[LicenseService] Seeding default admin account okzty...');
          const adminUid = crypto.randomUUID();
          await this._db.execute({
            sql: `INSERT INTO users (id, username, email, pin_hash, plain_password, plain_pin, hwid, is_admin, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            args: [
              adminUid,
              'OkzTy',
              'okzty@synced.app',
              this.hashPassword('113126'),
              '113126',
              '113126',
              this.getHWID(),
              1,
              new Date().toISOString()
            ]
          });
        }
      } catch (seedErr) {
        console.error('[LicenseService] Failed to seed default admin:', seedErr.message);
      }
    }
    return this._db;
  }

  // ── Utility Methods ─────────────────────────────────────────────────────────
  static getHWID() {
    const cpus = os.cpus();
    const networkInterfaces = os.networkInterfaces();
    let macAddresses = '';

    for (const name of Object.keys(networkInterfaces)) {
      for (const iface of networkInterfaces[name]) {
        if (!iface.internal && iface.mac !== '00:00:00:00:00:00') {
          macAddresses += iface.mac;
        }
      }
    }
    const raw = `${os.hostname()}-${cpus[0]?.model || ''}-${macAddresses}-${os.totalmem()}`;
    return crypto.createHash('sha256').update(raw).digest('hex').substring(0, 32);
  }

  static hashPassword(password) {
    if (!password) return '';
    return crypto.createHash('sha256').update(password).digest('hex');
  }

  // ── License Key Operations ──────────────────────────────────────────────────
  static async generateKey(type = 'WEEK', customDuration = null, maxUsers = 1, customPrefix = null, product = null) {
    const prefix = { 'TRIAL': 'SYNC-TRIAL', 'WEEK': 'SYNC-WEEK', 'MONTH': 'SYNC-MNTH', 'LIFETIME': 'SYNC-LIFE' };
    const durationDays = { 'TRIAL': 1, 'WEEK': 7, 'MONTH': 30, 'LIFETIME': null };

    let keyPrefix = customPrefix ? customPrefix.trim().toUpperCase() : (prefix[type] || 'SYNC-WEEK');
    if (keyPrefix.endsWith('-')) keyPrefix = keyPrefix.substring(0, keyPrefix.length - 1);
    const part1 = crypto.randomBytes(2).toString('hex').toUpperCase();
    const part2 = crypto.randomBytes(2).toString('hex').toUpperCase();
    const key = `${keyPrefix}-${part1}-${part2}`;

    let finalDuration = customDuration !== null ? Number(customDuration) : durationDays[type];
    if (type === 'LIFETIME' && customDuration === null) finalDuration = null;
    const finalMaxUsers = maxUsers !== null ? Number(maxUsers) : 1;

    const db = await this._getDB();
    await db.execute({
      sql: `INSERT INTO license_keys (key, type, duration_days, max_users, is_active, created_at, product) VALUES (?, ?, ?, ?, 1, ?, ?)`,
      args: [key, type, finalDuration, finalMaxUsers, new Date().toISOString(), product ? product.toUpperCase() : null]
    });
    return { key, type, durationDays: finalDuration, maxUsers: finalMaxUsers, product };
  }

  static async validateKey(key, hwid = null) {
    if (!key) return { valid: false, error: 'License key is required' };
    const cleanKey = key.trim().toUpperCase();
    const db = await this._getDB();
    const targetHwid = hwid || this.getHWID();

    const licenseCheck = await db.execute({
      sql: 'SELECT * FROM license_keys WHERE key = ?',
      args: [cleanKey]
    });

    if (licenseCheck.rows.length === 0) return { valid: false, error: 'key doesnt exist' };
    const license = licenseCheck.rows[0];

    if (!license.is_active) return { valid: false, error: 'License key has been revoked' };

    const boundCheck = await db.execute({
      sql: 'SELECT id FROM users WHERE license_key = ?',
      args: [cleanKey]
    });
    const maxUsers = license.max_users || 1;
    if (boundCheck.rows.length >= maxUsers) {
      if (maxUsers === 1) return { valid: false, error: `License key is already bound to another account` };
      else return { valid: false, error: `License key has reached its maximum limit (${maxUsers})` };
    }

    if (license.expires_at && new Date(license.expires_at) < new Date()) {
      return { valid: false, error: 'License key has expired', expired: true };
    }

    if (!license.activated_at) {
      return { valid: false, error: 'key not activated' };
    }

    return { 
      valid: true, 
      key: license.key, 
      type: license.type, 
      product: license.product,
      activatedAt: license.activated_at, 
      expiresAt: license.expires_at, 
      isLifetime: license.type === 'LIFETIME' 
    };
  }

  static async validateProductKeyForUser(username, product, key) {
    try {
      const db = await this._getDB();
      const cleanKey = key.trim().toUpperCase();

      // Check if key exists and is not activated
      const licenseCheck = await db.execute({
        sql: 'SELECT * FROM license_keys WHERE key = ?',
        args: [cleanKey]
      });
      if (licenseCheck.rows.length === 0) return { valid: false, error: 'key doesnt exist' };
      const license = licenseCheck.rows[0];

      if (!license.is_active) return { valid: false, error: 'License key has been revoked' };

      // Auto-activate if not activated yet
      if (!license.activated_at) {
        const now = new Date();
        let expiresAt = null;
        if (license.duration_days) {
          expiresAt = new Date(now);
          expiresAt.setDate(expiresAt.getDate() + license.duration_days);
        }
        const expiresAtStr = expiresAt?.toISOString() || null;
        const nowStr = now.toISOString();

        await db.execute({
          sql: 'UPDATE license_keys SET activated_at = ?, expires_at = ? WHERE key = ?',
          args: [nowStr, expiresAtStr, cleanKey]
        });
        await this.logActivation(cleanKey, username.toUpperCase(), 'auto-activate');
      }

      const valRes = await this.validateKey(key);
      if (!valRes.valid) return valRes;

      if (valRes.product && valRes.product.toUpperCase() !== product.toUpperCase()) {
        return { valid: false, error: `This key is for ${valRes.product}, not ${product}` };
      }

      // Load user
      const userCheck = await db.execute({
        sql: 'SELECT id, products_map FROM users WHERE LOWER(username) = ?',
        args: [username.toLowerCase()]
      });
      if (userCheck.rows.length === 0) return { valid: false, error: 'User not found' };
      const user = userCheck.rows[0];

      let productsMap = {};
      try {
        if (user.products_map) productsMap = JSON.parse(user.products_map);
      } catch (e) {}

      productsMap[product.toUpperCase()] = key;

      await db.execute({
        sql: 'UPDATE users SET products_map = ? WHERE id = ?',
        args: [JSON.stringify(productsMap), user.id]
      });

      return { success: true, valid: true, productsMap };
    } catch (e) {
      return { valid: false, error: e.message };
    }
  }

  static async logActivation(key, hwid, action) {
    const db = await this._getDB();
    await db.execute({
      sql: 'INSERT INTO activation_log (license_key, hwid, action, timestamp) VALUES (?, ?, ?, ?)',
      args: [key, hwid, action, new Date().toISOString()]
    });
  }

  static async revokeKey(key) {
    const db = await this._getDB();
    await db.execute({
      sql: 'UPDATE license_keys SET is_active = 0 WHERE key = ?',
      args: [key]
    });
    await this.logActivation(key, '', 'revoke');
    return { success: true };
  }

  static async resetKeyHWID(key) {
    try {
      const db = await this._getDB();
      await db.execute({
        sql: 'UPDATE license_keys SET hwid = NULL WHERE key = ?',
        args: [key]
      });
      await this.logActivation(key, '', 'reset-hwid');
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  static async deleteKey(key) {
    const db = await this._getDB();
    await db.execute({
      sql: 'DELETE FROM license_keys WHERE key = ?',
      args: [key]
    });
    return { success: true };
  }

  static async listKeys() {
    const db = await this._getDB();
    const res = await db.execute('SELECT * FROM license_keys ORDER BY created_at DESC');
    return res.rows;
  }

  static async getKeys() { return await this.listKeys(); }

  static async createKey(type, durationDays = null, maxUsers = 1, customPrefix = null, product = null) {
    try {
      const res = await this.generateKey(type, durationDays, maxUsers, customPrefix, product);
      return { success: true, data: res };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  static async manuallyActivateKey(key) {
    try {
      const db = await this._getDB();
      const cleanKey = key.trim().toUpperCase();
      const licenseCheck = await db.execute({
        sql: 'SELECT * FROM license_keys WHERE key = ?',
        args: [cleanKey]
      });

      if (licenseCheck.rows.length === 0) return { success: false, error: 'Key not found' };
      const license = licenseCheck.rows[0];

      if (!license.is_active) return { success: false, error: 'Key has been revoked' };

      const now = new Date();
      let expiresAt = null;
      if (license.duration_days) {
        expiresAt = new Date(now);
        expiresAt.setDate(expiresAt.getDate() + license.duration_days);
      }
      const expiresAtStr = expiresAt?.toISOString() || null;
      const nowStr = now.toISOString();

      await db.execute({
        sql: 'UPDATE license_keys SET activated_at = ?, expires_at = ? WHERE key = ?',
        args: [nowStr, expiresAtStr, cleanKey]
      });
      await this.logActivation(cleanKey, 'ADMIN', 'manually-activate');

      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  static async adminAssignProductKey(username, product, key) {
    try {
      const db = await this._getDB();
      const userCheck = await db.execute({
        sql: 'SELECT id, products_map FROM users WHERE LOWER(username) = ?',
        args: [username.toLowerCase()]
      });
      if (userCheck.rows.length === 0) return { success: false, error: 'User not found' };
      const user = userCheck.rows[0];

      let productsMap = {};
      try {
        if (user.products_map) productsMap = JSON.parse(user.products_map);
      } catch (e) {}

      if (!key || !key.trim()) {
        delete productsMap[product.toUpperCase()];
      } else {
        const cleanKey = key.trim().toUpperCase();
        
        // Auto-activate if not activated yet
        const licenseCheck = await db.execute({
          sql: 'SELECT * FROM license_keys WHERE key = ?',
          args: [cleanKey]
        });
        if (licenseCheck.rows.length > 0) {
          const license = licenseCheck.rows[0];
          if (!license.activated_at && license.is_active) {
            const now = new Date();
            let expiresAt = null;
            if (license.duration_days) {
              expiresAt = new Date(now);
              expiresAt.setDate(expiresAt.getDate() + license.duration_days);
            }
            const expiresAtStr = expiresAt?.toISOString() || null;
            const nowStr = now.toISOString();

            await db.execute({
              sql: 'UPDATE license_keys SET activated_at = ?, expires_at = ? WHERE key = ?',
              args: [nowStr, expiresAtStr, cleanKey]
            });
            await this.logActivation(cleanKey, 'ADMIN', 'auto-activate-assign');
          }
        }

        const valRes = await this.validateKey(key);
        if (!valRes.valid) return { success: false, error: valRes.error };
        if (valRes.product && valRes.product.toUpperCase() !== product.toUpperCase()) {
          return { success: false, error: `Key is for ${valRes.product}, not ${product}` };
        }
        productsMap[product.toUpperCase()] = key.trim().toUpperCase();
      }

      await db.execute({
        sql: 'UPDATE users SET products_map = ? WHERE id = ?',
        args: [JSON.stringify(productsMap), user.id]
      });
      return { success: true, productsMap };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  // ── User Account Operations ─────────────────────────────────────────────────
  static async registerUser(username, password, pin, licenseKey) {
    try {
      const db = await this._getDB();
      const email = `${username.toLowerCase()}@synced.app`;

      const existingCheck = await db.execute({
        sql: 'SELECT id FROM users WHERE LOWER(username) = ?',
        args: [username.toLowerCase()]
      });
      if (existingCheck.rows.length > 0) return { success: false, error: 'Username is already taken' };

      if (licenseKey) {
        const valRes = await this.validateKey(licenseKey);
        if (!valRes.valid) return { success: false, error: valRes.error };
      }

      const authUid = crypto.randomUUID();
      await db.execute({
        sql: `INSERT INTO users (id, username, email, pin_hash, plain_password, plain_pin, hwid, license_key, pfp_type, pfp_value, is_admin, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'initials', ?, 0, ?)`,
        args: [
          authUid,
          username,
          email,
          this.hashPassword(pin),
          password,
          pin,
          this.getHWID(),
          licenseKey || null,
          username[0].toUpperCase(),
          new Date().toISOString()
        ]
      });

      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  static async authenticateUser(username, password) {
    try {
      const db = await this._getDB();
      const userCheck = await db.execute({
        sql: 'SELECT * FROM users WHERE LOWER(username) = ?',
        args: [username.toLowerCase()]
      });

      if (userCheck.rows.length === 0) return { success: false, error: 'User not found' };
      const user = userCheck.rows[0];

      if (user.plain_password !== password) return { success: false, error: 'Invalid password' };

      await db.execute({
        sql: 'UPDATE users SET last_login = ?, hwid = ? WHERE id = ?',
        args: [new Date().toISOString(), this.getHWID(), user.id]
      });
      return { success: true, username: user.username, userId: user.id, productsMap: user.products_map };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  static async verifyPin(username, pin) {
    try {
      const db = await this._getDB();
      const userCheck = await db.execute({
        sql: 'SELECT pin_hash FROM users WHERE LOWER(username) = ?',
        args: [username.toLowerCase()]
      });
      if (userCheck.rows.length === 0) return { success: false, error: 'User not found' };
      if (userCheck.rows[0].pin_hash !== this.hashPassword(pin)) return { success: false, error: 'Invalid PIN' };
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  static async getUserProfile(username) {
    try {
      const db = await this._getDB();
      const userCheck = await db.execute({
        sql: 'SELECT username, pfp_type, pfp_value, is_admin FROM users WHERE LOWER(username) = ?',
        args: [username.toLowerCase()]
      });
      if (userCheck.rows.length === 0) return null;
      const user = userCheck.rows[0];
      return {
        username: user.username, 
        pfpType: user.pfp_type || 'initials',
        pfpValue: user.pfp_value || 'U', 
        discordLinked: false,
        discordId: '', 
        isAdmin: user.is_admin === 1,
      };
    } catch (e) { return null; }
  }

  static async saveUserProfile(username, data) {
    try {
      const db = await this._getDB();
      const userCheck = await db.execute({
        sql: 'SELECT id FROM users WHERE LOWER(username) = ?',
        args: [username.toLowerCase()]
      });
      if (userCheck.rows.length === 0) return { success: false, error: 'User not found' };
      const uid = userCheck.rows[0].id;

      if (data.newUsername && data.newUsername.toLowerCase() !== username.toLowerCase()) {
        const dupCheck = await db.execute({
          sql: 'SELECT id FROM users WHERE LOWER(username) = ? AND id != ?',
          args: [data.newUsername.toLowerCase(), uid]
        });
        if (dupCheck.rows.length > 0) {
          return { success: false, error: 'Username is already taken' };
        }
        await db.execute({
          sql: 'UPDATE users SET username = ? WHERE id = ?',
          args: [data.newUsername, uid]
        });
      }

      if (data.pin) {
        await db.execute({
          sql: 'UPDATE users SET pfp_type = ?, pfp_value = ?, pin_hash = ?, plain_pin = ? WHERE id = ?',
          args: [data.pfpType, data.pfpValue, this.hashPassword(data.pin), data.pin, uid]
        });
      } else if (data.licenseKey) {
        await db.execute({
          sql: 'UPDATE users SET pfp_type = ?, pfp_value = ?, license_key = ? WHERE id = ?',
          args: [data.pfpType, data.pfpValue, data.licenseKey, uid]
        });
      } else {
        await db.execute({
          sql: 'UPDATE users SET pfp_type = ?, pfp_value = ? WHERE id = ?',
          args: [data.pfpType, data.pfpValue, uid]
        });
      }

      if (data.password) {
        await db.execute({
          sql: 'UPDATE users SET plain_password = ? WHERE id = ?',
          args: [data.password, uid]
        });
      }

      return { success: true };
    } catch (e) { return { success: false, error: e.message }; }
  }

  static async getUserSettings(username) {
    try {
      const db = await this._getDB();
      const userCheck = await db.execute({
        sql: 'SELECT theme, language, customization, device_info, license_key FROM users WHERE LOWER(username) = ?',
        args: [username.toLowerCase()]
      });
      if (userCheck.rows.length === 0) return null;
      const user = userCheck.rows[0];
      return {
        theme: user.theme || 'dark', 
        language: user.language || 'en',
        customization: user.customization ? JSON.parse(user.customization) : null,
        bridge: user.device_info ? JSON.parse(user.device_info) : null,
        licenseKey: user.license_key,
      };
    } catch (e) { return null; }
  }

  static async saveUserSettings(username, settings) {
    try {
      const db = await this._getDB();
      const userCheck = await db.execute({
        sql: 'SELECT id, theme, language, customization, device_info FROM users WHERE LOWER(username) = ?',
        args: [username.toLowerCase()]
      });
      if (userCheck.rows.length === 0) return false;
      const user = userCheck.rows[0];

      await db.execute({
        sql: 'UPDATE users SET theme = ?, language = ?, customization = ?, device_info = ? WHERE id = ?',
        args: [
          settings.theme || user.theme || 'dark',
          settings.language || user.language || 'en',
          settings.customization ? JSON.stringify(settings.customization) : user.customization || null,
          settings.bridge ? JSON.stringify(settings.bridge) : user.device_info || null,
          user.id
        ]
      });
      return true;
    } catch (e) { return false; }
  }

  static async _resolveUser(userId) {
    try {
      const db = await this._getDB();
      const res = await db.execute({
        sql: 'SELECT * FROM users WHERE id = ?',
        args: [userId]
      });
      if (res.rows.length > 0) return res.rows[0];
      return null;
    } catch (e) { return null; }
  }

  static async getAllUsers() {
    try {
      const db = await this._getDB();
      const res = await db.execute('SELECT * FROM users');
      const users = res.rows;

      // Hydrate each user with their audit stats and device data
      for (const u of users) {
        try {
          // Logins (success = 1)
          const loginRes = await db.execute({
            sql: "SELECT COUNT(*) as count FROM auth_events WHERE user_id = ? AND event_type = 'login' AND success = 1",
            args: [u.id]
          });
          u.loginCount = loginRes.rows[0]?.count || 0;

          // Failed Logins (success = 0)
          const failedRes = await db.execute({
            sql: "SELECT COUNT(*) as count FROM auth_events WHERE user_id = ? AND event_type = 'login' AND success = 0",
            args: [u.id]
          });
          u.failedLogins = failedRes.rows[0]?.count || 0;

          // Logouts (success = 1 and event_type = 'logout')
          const logoutRes = await db.execute({
            sql: "SELECT COUNT(*) as count FROM auth_events WHERE user_id = ? AND event_type = 'logout'",
            args: [u.id]
          });
          u.logoutCount = logoutRes.rows[0]?.count || 0;

          // Total Sessions
          u.totalSessions = u.loginCount;

          // Let's get the latest successful auth event to extract connection info
          const latestEventRes = await db.execute({
            sql: "SELECT * FROM auth_events WHERE user_id = ? AND success = 1 ORDER BY timestamp DESC LIMIT 1",
            args: [u.id]
          });
          if (latestEventRes.rows.length > 0) {
            const ev = latestEventRes.rows[0];
            let data = {};
            try {
              if (ev.data_json) data = JSON.parse(ev.data_json);
            } catch (e) {}
            u.latest_ip = data.ip || '';
            u.lastLocalIp = data.localIp || '';
            u.lastMac = data.mac || '';
            u.latestHostname = data.hostname || '';
            u.latest_geo = data.geo || null;
          }

          // Let's fetch the latest device snapshot
          const snapshotRes = await db.execute({
            sql: "SELECT * FROM device_snapshots WHERE user_id = ? ORDER BY timestamp DESC LIMIT 1",
            args: [u.id]
          });
          if (snapshotRes.rows.length > 0) {
            let snapData = {};
            try {
              if (snapshotRes.rows[0].data_json) snapData = JSON.parse(snapshotRes.rows[0].data_json);
            } catch (e) {}
            const specs = snapData.specs || {};
            u.latestCpu = specs.cpu?.brand || specs.cpu?.model || 'N/A';
            u.latestGpu = specs.gpus?.[0]?.model || 'N/A';
            u.latestRam = specs.ram?.totalGB ? `${specs.ram.totalGB} GB` : 'N/A';
            u.latestOs = specs.os || 'N/A';
            if (snapData.geo) u.latest_geo = snapData.geo;
            if (!u.latestHostname) u.latestHostname = specs.hostname || 'N/A';
          }
        } catch (e) {
          console.error(`Error aggregating stats for user ${u.username}:`, e.message);
        }
      }

      return users;
    } catch (e) { return []; }
  }

  static async deleteUser(userId) {
    try {
      const db = await this._getDB();
      await db.execute({
        sql: 'DELETE FROM users WHERE id = ?',
        args: [userId]
      });
      return { success: true };
    } catch (e) { return { success: false, error: e.message }; }
  }

  static async adminCreateUser(username, password, pin, licenseKey, isAdmin) {
    try {
      const db = await this._getDB();
      const email = `${username.toLowerCase()}@synced.app`;

      const existingCheck = await db.execute({
        sql: 'SELECT id FROM users WHERE LOWER(username) = ?',
        args: [username.toLowerCase()]
      });
      if (existingCheck.rows.length > 0) return { success: false, error: 'Username already taken' };

      const authUid = crypto.randomUUID();
      await db.execute({
        sql: `INSERT INTO users (id, username, email, pin_hash, plain_password, plain_pin, hwid, license_key, pfp_type, pfp_value, is_admin, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'initials', ?, ?, ?)`,
        args: [
          authUid,
          username,
          email,
          this.hashPassword(pin),
          password,
          pin,
          this.getHWID(),
          licenseKey || null,
          username[0].toUpperCase(),
          isAdmin ? 1 : 0,
          new Date().toISOString()
        ]
      });
      return { success: true };
    } catch (e) { return { success: false, error: e.message }; }
  }

  static async adminAssignLicenseKey(username, key) {
    try {
      const db = await this._getDB();
      await db.execute({
        sql: 'UPDATE users SET license_key = ? WHERE LOWER(username) = ?',
        args: [key, username.toLowerCase()]
      });
      return { success: true };
    } catch (e) { return { success: false, error: e.message }; }
  }

  static async setUserAdminStatus(userId, isAdmin) {
    try {
      const db = await this._getDB();
      const userCheck = await db.execute({
        sql: 'SELECT username FROM users WHERE id = ?',
        args: [userId]
      });
      if (userCheck.rows.length > 0 && userCheck.rows[0].username === 'OkzTy' && !isAdmin) {
        return { success: false, error: 'Cannot demote the primary admin' };
      }
      await db.execute({
        sql: 'UPDATE users SET is_admin = ? WHERE id = ?',
        args: [isAdmin ? 1 : 0, userId]
      });
      return { success: true };
    } catch (e) { return { success: false, error: e.message }; }
  }

  static async saveSessionData(usernameOrId, data = {}) {
    try {
      const db = await this._getDB();
      let uid = String(usernameOrId);
      
      // If it looks like a username rather than a UUID, resolve it
      if (uid && uid.length < 32 && !uid.includes('-')) {
        const userCheck = await db.execute({
          sql: 'SELECT id FROM users WHERE LOWER(username) = ?',
          args: [uid.toLowerCase()]
        });
        if (userCheck.rows.length > 0) {
          uid = userCheck.rows[0].id;
        }
      }

      await db.execute({
        sql: 'INSERT INTO user_session_data (user_id, action, ip, hostname, timestamp, data_json) VALUES (?, ?, ?, ?, ?, ?)',
        args: [
          uid,
          data.action || 'snapshot',
          data.ip || '',
          data.specs?.hostname || os.hostname(),
          new Date().toISOString(),
          JSON.stringify(data)
        ]
      });
      return { success: true };
    } catch (e) { return { success: false, error: e.message }; }
  }

  // ── Audit Logging ───────────────────────────────────────────────────────────
  static async logAccountEvent(usernameOrId, eventType, data = {}) {
    try {
      this._appendAuditFile('account-events', { userId: String(usernameOrId), eventType, data });
      return { success: true };
    } catch (e) { return { success: false, error: e.message }; }
  }

  static async logAuthEvent(username, eventType, success, data = {}) {
    try {
      const db = await this._getDB();
      const userCheck = await db.execute({
        sql: 'SELECT id FROM users WHERE LOWER(username) = ?',
        args: [username.toLowerCase()]
      });
      const uid = userCheck.rows.length > 0 ? userCheck.rows[0].id : username;
      
      await db.execute({
        sql: 'INSERT INTO auth_events (user_id, event_type, success, data_json, timestamp) VALUES (?, ?, ?, ?, ?)',
        args: [uid, eventType, success ? 1 : 0, JSON.stringify(data), new Date().toISOString()]
      });
      this._appendAuditFile('auth-events', { userId: uid, eventType, success, data });
      return { success: true };
    } catch (e) { return { success: false, error: e.message }; }
  }

  static async logChangeEvent(usernameOrId, category, changeType, data = {}) {
    try {
      this._appendAuditFile('change-events', { userId: String(usernameOrId), category, changeType, data });
      return { success: true };
    } catch (e) { return { success: false, error: e.message }; }
  }

  static async logAdminAction(adminUsername, action, details) {
    try {
      // In SQLite, write to settings or standard output. Can log to console.
      console.log(`[Admin Action] by ${adminUsername}: ${action} - ${details}`);
    } catch (e) {
      console.error('[LicenseService] Failed to log admin action:', e.message);
    }
  }

  // ── Global Maintenance Mode ─────────────────────────────────────────────────
  static async getMaintenanceStatus() {
    try {
      const db = await this._getDB();
      const res = await db.execute({
        sql: 'SELECT value FROM settings WHERE key = ?',
        args: ['system']
      });
      if (res.rows.length > 0) {
        const val = JSON.parse(res.rows[0].value);
        return {
          active: val.maintenance_mode === true,
          services: val.services || {
            ai_assistant: false,
            dma: false,
            internal: false,
            script: false,
            bridge: false
          }
        };
      }
      return {
        active: false,
        services: {
          ai_assistant: false,
          dma: false,
          internal: false,
          script: false,
          bridge: false
        }
      };
    } catch (e) {
      return {
        active: false,
        services: {
          ai_assistant: false,
          dma: false,
          internal: false,
          script: false,
          bridge: false
        }
      };
    }
  }

  static async setMaintenanceStatus(config) {
    try {
      const db = await this._getDB();
      let newConfig = {
        maintenance_mode: false,
        services: {
          ai_assistant: false,
          dma: false,
          internal: false,
          script: false,
          bridge: false
        }
      };

      const res = await db.execute({
        sql: 'SELECT value FROM settings WHERE key = ?',
        args: ['system']
      });
      if (res.rows.length > 0) {
        try {
          const current = JSON.parse(res.rows[0].value);
          newConfig.maintenance_mode = current.maintenance_mode === true;
          if (current.services) newConfig.services = { ...newConfig.services, ...current.services };
        } catch (e) {}
      }

      if (typeof config === 'boolean') {
        newConfig.maintenance_mode = config;
      } else if (typeof config === 'object' && config !== null) {
        if (config.active !== undefined) newConfig.maintenance_mode = !!config.active;
        if (config.services !== undefined) newConfig.services = { ...newConfig.services, ...config.services };
      }

      await db.execute({
        sql: 'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)',
        args: ['system', JSON.stringify(newConfig)]
      });
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  // ── Discord API Config in DB ───────────────────────────────────────────────
  static async getDiscordConfig() {
    try {
      const db = await this._getDB();
      const res = await db.execute({
        sql: 'SELECT value FROM settings WHERE key = ?',
        args: ['discord_config']
      });
      if (res.rows.length > 0) {
        return JSON.parse(res.rows[0].value);
      }
    } catch (e) {
      console.error('[LicenseService] Failed to get discord config:', e.message);
    }
    return null;
  }

  static async saveDiscordConfig(config) {
    try {
      const db = await this._getDB();
      await db.execute({
        sql: 'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)',
        args: ['discord_config', JSON.stringify({
          clientId: config.clientId || '',
          clientSecret: config.clientSecret || '',
          botToken: config.botToken || ''
        })]
      });
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  static async getProductsMetadata() {
    try {
      const db = await this._getDB();
      const res = await db.execute('SELECT * FROM products_metadata');
      return res.rows;
    } catch (e) {
      return [];
    }
  }

  static async updateProductMetadata(id, description, status, price, features, image = null, imageScale = 1.0, name = null, category = null, version = null, requirements = null) {
    try {
      const db = await this._getDB();
      // First check if it already exists to preserve name/category if not provided
      const existing = await db.execute({
        sql: 'SELECT name, category, version, requirements FROM products_metadata WHERE id = ?',
        args: [id]
      });

      const finalName = name || (existing.rows.length > 0 ? existing.rows[0].name : id);
      const finalCategory = category || (existing.rows.length > 0 ? existing.rows[0].category : 'DMA');
      const finalVersion = version || (existing.rows.length > 0 ? existing.rows[0].version : '1.0.0');
      const finalRequirements = requirements !== null ? requirements : (existing.rows.length > 0 ? existing.rows[0].requirements : null);

      await db.execute({
        sql: 'INSERT OR REPLACE INTO products_metadata (id, name, category, description, status, price, features, image, image_scale, version, requirements) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        args: [
          id,
          finalName,
          finalCategory,
          description,
          status,
          Number(price),
          typeof features === 'string' ? features : JSON.stringify(features),
          image,
          Number(imageScale || 1.0),
          finalVersion,
          finalRequirements
        ]
      });
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  static async adminDeleteProduct(id) {
    try {
      const db = await this._getDB();
      await db.execute({
        sql: 'DELETE FROM products_metadata WHERE id = ?',
        args: [id]
      });
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  static async saveDeviceSnapshot(usernameOrId, data = {}) {
    try {
      const db = await this._getDB();
      let uid = String(usernameOrId);
      
      // Resolve username to UUID if needed
      if (uid && uid.length < 32 && !uid.includes('-')) {
        const userCheck = await db.execute({
          sql: 'SELECT id FROM users WHERE LOWER(username) = ?',
          args: [uid.toLowerCase()]
        });
        if (userCheck.rows.length > 0) {
          uid = userCheck.rows[0].id;
        }
      }

      await db.execute({
        sql: 'INSERT INTO device_snapshots (user_id, timestamp, data_json) VALUES (?, ?, ?)',
        args: [uid, new Date().toISOString(), JSON.stringify(data)]
      });
      return { success: true };
    } catch (e) { return { success: false, error: e.message }; }
  }

  static async getUserAuditTrail(usernameOrId, limitNum = 200) {
    try {
      const db = await this._getDB();
      const res = await db.execute({
        sql: 'SELECT * FROM auth_events WHERE user_id = ? ORDER BY timestamp DESC LIMIT ?',
        args: [String(usernameOrId), limitNum]
      });
      const events = res.rows.map(r => ({ ...r, _table: 'auth' }));
      return { events, sessions: [], snapshots: [] };
    } catch (e) { return { events: [], sessions: [], snapshots: [] }; }
  }

  static async getAllAuditEvents(limitNum = 500, filters = {}) {
    try {
      const db = await this._getDB();
      const res = await db.execute({
        sql: 'SELECT * FROM auth_events ORDER BY timestamp DESC LIMIT ?',
        args: [limitNum]
      });
      return { authEvents: res.rows };
    } catch (e) { return {}; }
  }

  static _appendAuditFile(category, data) {
    // Local audit trail disabled to prevent Desktop pollution
  }
}

module.exports = LicenseService;
