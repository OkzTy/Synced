/**
 * API client — wraps Electron IPC or Bridge HTTP. All real data, no fakes.
 * If a bridge config is present in localStorage, DB operations route to the bridge server.
 */

const isElectron = () => typeof window !== 'undefined' && window.synced?.isElectron;

/** Read bridge config from localStorage (set when linked to Main PC). */
function getBridgeConfig() {
  try {
    const raw = localStorage.getItem('synced-config');
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed?.bridge?.ip && parsed?.bridge?.port) return parsed.bridge;
    return null;
  } catch {
    return null;
  }
}

/**
 * Perform a fetch to the bridge server for a DB operation.
 * Only used when the app is running on a secondary (linked) PC.
 */
async function bridgeFetch(method, path, body = null) {
  const bridge = getBridgeConfig();
  if (!bridge) return { success: false, error: 'No bridge configured' };
  const url = `http://${bridge.ip}:${bridge.port}${path}`;
  const headers = {
    'Content-Type': 'application/json',
  };
  if (bridge.token) {
    headers['Authorization'] = `Bearer ${bridge.token}`;
  }
  try {
    const opts = { method, headers };
    if (body) opts.body = JSON.stringify(body);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout
    opts.signal = controller.signal;
    const res = await fetch(url, opts);
    clearTimeout(timeoutId);
    return await res.json();
  } catch (err) {
    if (err.name === 'AbortError') {
      return { success: false, error: 'Bridge request timed out after 10s' };
    }
    return { success: false, error: `Bridge unreachable: ${err.message}` };
  }
}

export const api = {
  // System specs & usage (real hardware data)
  async getLocalSpecs() {
    if (isElectron()) return window.synced.system.specs();
    return { success: false, error: 'Run as Electron app for real data' };
  },

  async getLocalUsage() {
    if (isElectron()) return window.synced.system.usage();
    return { success: false };
  },

  async getLocalProcesses() {
    if (isElectron()) return window.synced.system.processes();
    return { success: false };
  },

  async killLocalProcess(pid) {
    if (isElectron()) return window.synced.system.killProcess(pid);
    return { success: false };
  },

  // Terminal (real command execution)
  async execLocal(command) {
    if (isElectron()) return window.synced.terminal.exec(command);
    return { success: false, output: '', error: 'Not in Electron' };
  },

  // Filesystem (real files)
  async listDir(dirPath) {
    if (isElectron()) return window.synced.fs.listDir(dirPath);
    return { success: false, data: [] };
  },

  // Bridge (Secondary PC)
  async getBridgeStatus(config) {
    if (!config?.ip) return { success: false };
    if (isElectron()) return window.synced.bridge.status(config);
    return { success: false };
  },

  async getBridgeSpecs(config) {
    if (!config?.ip) return { success: false };
    if (isElectron()) return window.synced.bridge.specs(config);
    return { success: false };
  },

  async getBridgeProcesses(config) {
    if (!config?.ip) return { success: false };
    if (isElectron()) return window.synced.bridge.processes(config);
    return { success: false };
  },

  async executeOnBridge(config, command) {
    if (!config?.ip) return { success: false, output: '', error: 'No bridge configured' };
    if (isElectron()) return window.synced.bridge.execute(config, command);
    return { success: false };
  },

  async killProcessOnBridge(config, pid) {
    if (isElectron()) return window.synced.bridge.killProcess(config, pid);
    return { success: false };
  },

  async shutdownBridge(config, action) {
    if (isElectron()) return window.synced.bridge.shutdown(config, action);
    return { success: false };
  },

  async listBridgeDir(config, dirPath) {
    if (!config?.ip) return { success: false, error: 'No bridge configured' };
    if (isElectron()) return window.synced.bridge.listDir(config, dirPath);
    return { success: false, data: [] };
  },

  // Discovery
  async scanNetwork() {
    if (isElectron()) return window.synced.discovery.scan();
    return { success: false };
  },

  // AI
  async chatWithAI(message, history) {
    if (isElectron()) return window.synced.ai.chat(message, history);
    return { success: false, error: 'AI requires Ollama' };
  },

  async getAIStatus() {
    if (isElectron()) return window.synced.ai.status();
    return { success: false, data: { status: 'offline' } };
  },

  async launchOllama() {
    return this.startOllama();
  },

  // Setup
  async getLocalIP() {
    if (isElectron()) return window.synced.setup.getLocalIP();
    return { success: false, ip: '127.0.0.1' };
  },
  async checkOllama() {
    if (isElectron()) return window.synced.setup.checkOllama();
    return { installed: false, running: false };
  },
  async startOllama() {
    if (isElectron()) return window.synced.setup.startOllama();
    return { success: false };
  },
  async pullModel(model) {
    if (isElectron()) return window.synced.setup.pullModel(model);
    return { success: false };
  },
  async openOllamaDownload() {
    if (isElectron()) return window.synced.setup.openOllamaDownload();
    return { success: false };
  },
  async getMachineInfo() {
    if (isElectron()) return window.synced.setup.getMachineInfo();
    return null;
  },
  async getLocalBridgeDetails() {
    if (isElectron()) return window.synced.setup.getLocalBridgeDetails();
    return { port: 8765, token: '' };
  },
  onPullProgress(cb) {
    if (isElectron()) return window.synced.setup.onPullProgress(cb);
    return () => {};
  },

  // License — these hit the cloud license server, not local DB, so no bridge
  async validateLicense(key) {
    if (isElectron()) return window.synced.license.validate(key);
    return { valid: false };
  },
  async deactivateLicense(key) {
    if (isElectron()) return window.synced.license.deactivate(key);
    return { success: false };
  },

  // Settings
  async getSettings(username) {
    const bridge = getBridgeConfig();
    if (bridge) return bridgeFetch('GET', `/api/db/settings?username=${encodeURIComponent(username)}`);
    if (isElectron()) return window.synced.settings.get(username);
    return null;
  },
  async saveSettings(settings, username) {
    const bridge = getBridgeConfig();
    if (bridge) return bridgeFetch('POST', '/api/db/settings', { username, settings });
    if (isElectron()) return window.synced.settings.save(settings, username);
    return false;
  },

  // Authentication & DB Profile
  async registerUser(username, password, pin, licenseKey) {
    const bridge = getBridgeConfig();
    if (bridge) return bridgeFetch('POST', '/api/db/register', { username, password, pin, licenseKey });
    if (isElectron()) return window.synced.auth.register(username, password, pin, licenseKey);
    return { success: false, error: 'Not in Electron' };
  },
  async loginUser(username, password) {
    const bridge = getBridgeConfig();
    if (bridge) return bridgeFetch('POST', '/api/db/login', { username, password });
    if (isElectron()) return window.synced.auth.login(username, password);
    return { success: false, error: 'Not in Electron' };
  },
  async verifyPin(username, pin) {
    const bridge = getBridgeConfig();
    if (bridge) return bridgeFetch('POST', '/api/db/verifyPin', { username, pin });
    if (isElectron()) return window.synced.auth.verifyPin(username, pin);
    return { success: false, error: 'Not in Electron' };
  },
  async discordLogin() {
    if (isElectron()) return window.synced.auth.discordLogin();
    return { success: false, error: 'Not in Electron' };
  },
  async discordLink() {
    if (isElectron()) return window.synced.auth.discordLink();
    return { success: false, error: 'Not in Electron' };
  },
  async updateDiscordPresence(page, extra) {
    if (isElectron()) return window.synced.discord.updatePresence(page, extra);
  },
  async getUserProfile(username) {
    const bridge = getBridgeConfig();
    if (bridge) return bridgeFetch('GET', `/api/db/profile?username=${encodeURIComponent(username)}`);
    if (isElectron()) return window.synced.user.getProfile(username);
    return null;
  },
  async saveUserProfile(username, data) {
    const bridge = getBridgeConfig();
    if (bridge) return bridgeFetch('POST', '/api/db/profile', { username, data });
    if (isElectron()) return window.synced.user.saveProfile(username, data);
    return { success: false };
  },
  async saveSessionData(username, data) {
    const bridge = getBridgeConfig();
    if (bridge) return bridgeFetch('POST', '/api/db/sessionData', { username, data });
    if (isElectron()) return window.synced.user.saveSessionData(username, data);
    return { success: false };
  },
  async adminGetUsers() {
    const bridge = getBridgeConfig();
    if (bridge) return bridgeFetch('GET', '/api/db/users');
    if (isElectron()) return window.synced.admin.getUsers();
    return [];
  },
  async adminDeleteUser(userId) {
    const bridge = getBridgeConfig();
    if (bridge) return bridgeFetch('POST', '/api/db/deleteUser', { userId });
    if (isElectron()) return window.synced.admin.deleteUser(userId);
    return { success: false };
  },
  async adminGetKeys() {
    const bridge = getBridgeConfig();
    if (bridge) return bridgeFetch('GET', '/api/db/keys');
    if (isElectron()) return window.synced.admin.getKeys();
    return [];
  },
  async adminCreateKey(opts) {
    const bridge = getBridgeConfig();
    if (bridge) return bridgeFetch('POST', '/api/db/createKey', opts);
    if (isElectron()) return window.synced.admin.createKey(opts);
    return { success: false };
  },
  async adminRevokeKey(key) {
    const bridge = getBridgeConfig();
    if (bridge) return bridgeFetch('POST', '/api/db/revokeKey', { key });
    if (isElectron()) return window.synced.admin.revokeKey(key);
    return { success: false };
  },
  async adminResetKeyHWID(key) {
    const bridge = getBridgeConfig();
    if (bridge) return bridgeFetch('POST', '/api/db/resetKeyHWID', { key });
    if (isElectron()) return window.synced.admin.resetKeyHWID(key);
    return { success: false };
  },
  async adminDeleteKey(key) {
    const bridge = getBridgeConfig();
    if (bridge) return bridgeFetch('POST', '/api/db/deleteKey', { key });
    if (isElectron()) return window.synced.admin.deleteKey(key);
    return { success: false };
  },
  async adminCreateUser(username, password, pin, licenseKey, isAdmin) {
    const bridge = getBridgeConfig();
    if (bridge) return bridgeFetch('POST', '/api/db/createUser', { username, password, pin, licenseKey, isAdmin });
    if (isElectron()) return window.synced.admin.createUser(username, password, pin, licenseKey, isAdmin);
    return { success: false };
  },
  async adminAssignLicenseKey(username, licenseKey) {
    const bridge = getBridgeConfig();
    if (bridge) return bridgeFetch('POST', '/api/db/assignLicense', { username, key: licenseKey });
    if (isElectron()) return window.synced.admin.assignLicenseKey(username, licenseKey);
    return { success: false };
  },
  async adminSetUserAdminStatus(userId, isAdmin) {
    const bridge = getBridgeConfig();
    if (bridge) return bridgeFetch('POST', '/api/db/setUserAdminStatus', { userId, isAdmin });
    if (isElectron()) return window.synced.admin.setUserAdminStatus(userId, isAdmin);
    return { success: false };
  },
  async adminGetProductsMetadata() {
    const bridge = getBridgeConfig();
    if (bridge) return bridgeFetch('GET', '/api/db/productsMetadata');
    if (isElectron()) return window.synced.admin.getProductsMetadata();
    return [];
  },
  async adminUpdateProductMetadata(id, description, status, price, features, image = null, imageScale = 1.0, name = null, category = null, version = null, requirements = null) {
    const bridge = getBridgeConfig();
    if (bridge) return bridgeFetch('POST', '/api/db/updateProductMetadata', { id, description, status, price, features, image, imageScale, name, category, version, requirements });
    if (isElectron()) return window.synced.admin.updateProductMetadata(id, description, status, price, features, image, imageScale, name, category, version, requirements);
    return { success: false };
  },
  async adminDeleteProduct(id) {
    const bridge = getBridgeConfig();
    if (bridge) return bridgeFetch('POST', '/api/db/deleteProduct', { id });
    if (isElectron()) return window.synced.admin.deleteProduct(id);
    return { success: false };
  },
  async adminSelectProductImage() {
    if (isElectron()) return window.synced.admin.selectProductImage();
    return { success: false, error: 'Not in Electron' };
  },
  async adminSaveDiscordConfig(config) {
    if (isElectron()) return window.synced.admin.saveDiscordConfig(config);
    return { success: false };
  },
  async adminGetDiscordConfig() {
    if (isElectron()) return window.synced.admin.getDiscordConfig();
    return null;
  },
  async validateProductKey(username, product, key) {
    const bridge = getBridgeConfig();
    if (bridge) return bridgeFetch('POST', '/api/db/validateProductKey', { username, product, key });
    if (isElectron()) return window.synced.license.validateProductKey(username, product, key);
    return { valid: false };
  },
  async adminAssignProductKey(username, product, key) {
    const bridge = getBridgeConfig();
    if (bridge) return bridgeFetch('POST', '/api/db/assignProductKey', { username, product, key });
    if (isElectron()) return window.synced.admin.assignProductKey(username, product, key);
    return { success: false };
  },
  async adminManuallyActivateKey(key) {
    const bridge = getBridgeConfig();
    if (bridge) return bridgeFetch('POST', '/api/db/manuallyActivateKey', { key });
    if (isElectron()) return window.synced.admin.manuallyActivateKey(key);
    return { success: false };
  },

  // Audit logs
  async getUserAuditTrail(username, limit) {
    if (isElectron()) return window.synced.audit.getUserTrail(username, limit);
    return { events: [], sessions: [], snapshots: [] };
  },
  async getAllAuditEvents(limit, filters) {
    if (isElectron()) return window.synced.audit.getAllEvents(limit, filters);
    return {};
  },

  // Startup controls
  async getStartup() {
    if (isElectron()) return window.synced.startup.get();
    return false;
  },
  async setStartup(v) {
    if (isElectron()) return window.synced.startup.set(v);
    return false;
  },

  // Maintenance controls
  async getMaintenanceStatus() {
    if (isElectron()) return window.synced.maintenance.getStatus();
    return { active: false };
  },
  async setMaintenanceStatus(v) {
    if (isElectron()) return window.synced.maintenance.setStatus(v);
    return { success: false };
  },

  // Auto-Updater
  async checkUpdate() {
    if (isElectron()) return window.synced.update.check();
    return { updateAvailable: false };
  },
  async downloadUpdate(url) {
    if (isElectron()) return window.synced.update.download(url);
    return { success: false };
  },
  onUpdateProgress(cb) {
    if (isElectron()) return window.synced.update.onProgress(cb);
    return () => {};
  },
  onUpdateDownloaded(cb) {
    if (isElectron()) return window.synced.update.onDownloaded(cb);
    return () => {};
  },

  // PC Cross-Linking
  async generateSyncCode(licenseKey) {
    if (isElectron()) return window.synced.link.getCode(licenseKey);
    return null;
  },
  async enableLocalBridge(port) {
    if (isElectron()) return window.synced.link.enableLocal(port);
    return { success: false };
  },
  async unlinkPC() {
    if (isElectron()) return window.synced.link.unlink();
    return { success: false };
  },

  // App Level Prefs
  async getAppVersion() {
    if (isElectron() && window.synced.app?.getVersion) return window.synced.app.getVersion();
    return '1.6.1';
  },
  async saveTempPref(key, value) {
    if (isElectron() && window.synced.app) return window.synced.app.saveTempPref(key, value);
    return { success: true };
  },
  async getTempPref(key) {
    if (isElectron() && window.synced.app) return window.synced.app.getTempPref(key);
    return { success: true, data: null };
  },

  onSettingsUpdated(cb) {
    if (isElectron()) return window.synced.link.onSettingsUpdated(cb);
    return () => {};
  },
};
