/**
 * Synced Admin Panel Server
 * Standalone Express server for managing license keys
 * Run with: node admin/admin-server.js
 */

const express = require('express');
const path = require('path');
const cors = require('cors');

// We need to reference the license service from the electron folder
const LicenseService = require('../electron/services/license-service');

const app = express();
const PORT = 3847;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// ============================================================
// License Key Management API
// ============================================================

// Generate a single license key
app.post('/api/keys/generate', (req, res) => {
  try {
    const { type = 'WEEK' } = req.body;
    const validTypes = ['TRIAL', '3DAY', 'WEEK', 'MONTH', 'QUARTER', 'LIFETIME'];

    if (!validTypes.includes(type)) {
      return res.status(400).json({ error: `Invalid key type. Valid: ${validTypes.join(', ')}` });
    }

    const key = LicenseService.generateKey(type);
    res.json({ success: true, key });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Generate multiple keys at once
app.post('/api/keys/bulk', (req, res) => {
  try {
    const { type = 'WEEK', count = 1 } = req.body;

    if (count < 1 || count > 100) {
      return res.status(400).json({ error: 'Count must be between 1 and 100' });
    }

    const keys = LicenseService.bulkGenerate(type, count);
    res.json({ success: true, keys, count: keys.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// List all license keys
app.get('/api/keys', (req, res) => {
  try {
    const keys = LicenseService.listKeys();
    const now = new Date();

    const enriched = keys.map((k) => ({
      ...k,
      status: !k.is_active
        ? 'revoked'
        : !k.activated_at
        ? 'unused'
        : k.expires_at && new Date(k.expires_at) < now
        ? 'expired'
        : 'active',
    }));

    res.json({ success: true, keys: enriched, total: enriched.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Revoke a license key
app.delete('/api/keys/:key', (req, res) => {
  try {
    const result = LicenseService.revokeKey(req.params.key);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Validate a license key
app.post('/api/keys/validate', (req, res) => {
  try {
    const { key, hwid } = req.body;
    const result = LicenseService.validateKey(key, hwid);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Deactivate a license key (unbind user account and reset key)
app.post('/api/keys/deactivate', (req, res) => {
  try {
    const { key } = req.body;
    const db = LicenseService._getDB();
    const license = db.prepare('SELECT * FROM license_keys WHERE key = ?').get(key);
    
    if (!license) {
      return res.status(404).json({ error: 'License key not found' });
    }
    
    db.prepare('UPDATE users SET license_key = NULL WHERE license_key = ?').run(key);
    db.prepare('UPDATE license_keys SET activated_at = NULL, expires_at = NULL, hwid = NULL WHERE key = ?').run(key);
    db.prepare('INSERT INTO activation_log (license_key, action) VALUES (?, \'deactivate\')').run(key);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// Admin Panel HTML
// ============================================================

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin-panel.html'));
});

// ============================================================
// Start Server
// ============================================================

app.listen(PORT, () => {
  console.log('');
  console.log('  ╔══════════════════════════════════════════╗');
  console.log('  ║       SYNCED — Admin Panel               ║');
  console.log(`  ║       Running on http://localhost:${PORT}   ║`);
  console.log('  ╚══════════════════════════════════════════╝');
  console.log('');
});
