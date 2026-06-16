const { contextBridge, ipcRenderer } = require('electron');

/**
 * Wrap ipcRenderer.invoke with a timeout to prevent hanging the renderer
 * if the main process takes too long or crashes.
 */
function invokeWithTimeout(channel, ...args) {
  const TIMEOUT_MS = 15000; // 15 second timeout for all IPC calls
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`IPC call "${channel}" timed out after ${TIMEOUT_MS}ms`));
    }, TIMEOUT_MS);

    ipcRenderer.invoke(channel, ...args)
      .then((result) => {
        clearTimeout(timer);
        resolve(result);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

contextBridge.exposeInMainWorld('synced', {
  // Window controls
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    maximize: () => ipcRenderer.send('window:maximize'),
    close: () => ipcRenderer.send('window:close'),
    isMaximized: () => invokeWithTimeout('window:isMaximized'),
    onMaximized: (cb) => {
      const listener = (_, v) => cb(v);
      ipcRenderer.on('window:maximized', listener);
      return () => ipcRenderer.removeListener('window:maximized', listener);
    },
  },

  // Real system info from THIS machine
  system: {
    specs: () => invokeWithTimeout('system:specs'),
    usage: () => invokeWithTimeout('system:usage'),
    processes: () => invokeWithTimeout('system:processes'),
    killProcess: (pid) => invokeWithTimeout('system:killProcess', pid),
  },

  // Bridge to secondary PC
  bridge: {
    execute: (config, command) => invokeWithTimeout('bridge:execute', { ...config, command }),
    status: (config) => invokeWithTimeout('bridge:status', config),
    specs: (config) => invokeWithTimeout('bridge:specs', config),
    processes: (config) => invokeWithTimeout('bridge:processes', config),
    readFile: (config, filePath) => invokeWithTimeout('bridge:readFile', { ...config, filePath }),
    writeFile: (config, filePath, content) => invokeWithTimeout('bridge:writeFile', { ...config, filePath, content }),
    killProcess: (config, pid) => invokeWithTimeout('bridge:killProcess', { ...config, pid }),
    launch: (config, exePath, args) => invokeWithTimeout('bridge:launch', { ...config, exePath, args }),
    shutdown: (config, action) => invokeWithTimeout('bridge:shutdown', { ...config, action }),
    listDir: (config, dirPath) => invokeWithTimeout('bridge:listDir', { ...config, dirPath }),
  },

  // Network discovery
  discovery: {
    scan: () => invokeWithTimeout('discovery:scan'),
  },

  // AI
  ai: {
    chat: (message, history) => invokeWithTimeout('ai:chat', { message, history }),
    status: () => invokeWithTimeout('ai:status'),
  },

  // Terminal (run real commands)
  terminal: {
    exec: (command) => invokeWithTimeout('terminal:exec', command),
  },

  // Filesystem
  fs: {
    listDir: (dirPath) => invokeWithTimeout('fs:listDir', dirPath),
  },

  // Setup actions
  setup: {
    getLocalIP: () => invokeWithTimeout('setup:getLocalIP'),
    checkOllama: () => invokeWithTimeout('setup:checkOllama'),
    startOllama: () => invokeWithTimeout('setup:startOllama'),
    pullModel: (model) => invokeWithTimeout('setup:pullModel', model),
    openOllamaDownload: () => invokeWithTimeout('setup:openOllamaDownload'),
    execPowershell: (cmd) => invokeWithTimeout('setup:execPowershell', cmd),
    getMachineInfo: () => invokeWithTimeout('setup:getMachineInfo'),
    getLocalBridgeDetails: () => invokeWithTimeout('setup:getLocalBridgeDetails'),
    onPullProgress: (cb) => {
      const listener = (_, data) => cb(data);
      ipcRenderer.on('setup:pullProgress', listener);
      return () => ipcRenderer.removeListener('setup:pullProgress', listener);
    },
  },

  // Settings
  settings: {
    get: (username) => invokeWithTimeout('settings:get', username),
    save: (s, username) => invokeWithTimeout('settings:save', s, username),
  },

  // Authentication & DB Profile
  auth: {
    register: (username, password, pin, licenseKey) => invokeWithTimeout('auth:register', { username, password, pin, licenseKey }),
    login: (username, password) => invokeWithTimeout('auth:login', { username, password }),
    verifyPin: (username, pin) => invokeWithTimeout('auth:verifyPin', { username, pin }),
    discordLogin: () => invokeWithTimeout('auth:discordLogin'),
    discordLink: () => invokeWithTimeout('auth:discordLink'),
  },
  discord: {
    updatePresence: (page, extra) => invokeWithTimeout('discord:updatePresence', { page, extra }),
  },
  user: {
    getProfile: (username) => invokeWithTimeout('user:getProfile', username),
    saveProfile: (username, data) => invokeWithTimeout('user:saveProfile', { username, data }),
    saveSessionData: (username, data) => invokeWithTimeout('user:saveSessionData', { username, data }),
  },
  admin: {
    getUsers: () => invokeWithTimeout('admin:getUsers'),
    deleteUser: (userId) => invokeWithTimeout('admin:deleteUser', userId),
    getKeys: () => invokeWithTimeout('admin:getKeys'),
    createKey: (opts) => invokeWithTimeout('admin:createKey', opts),
    revokeKey: (key) => invokeWithTimeout('admin:revokeKey', key),
    resetKeyHWID: (key) => invokeWithTimeout('admin:resetKeyHWID', key),
    deleteKey: (key) => invokeWithTimeout('admin:deleteKey', key),
    createUser: (username, password, pin, licenseKey, isAdmin) => invokeWithTimeout('admin:createUser', { username, password, pin, licenseKey, isAdmin }),
    assignLicenseKey: (username, licenseKey) => invokeWithTimeout('admin:assignLicenseKey', { username, licenseKey }),
    setUserAdminStatus: (userId, isAdmin) => invokeWithTimeout('admin:setUserAdminStatus', { userId, isAdmin }),
    getProductsMetadata: () => invokeWithTimeout('admin:getProductsMetadata'),
    updateProductMetadata: (id, description, status, price, features, image, imageScale, name, category, version, requirements) => invokeWithTimeout('admin:updateProductMetadata', { id, description, status, price, features, image, imageScale, name, category, version, requirements }),
    deleteProduct: (id) => invokeWithTimeout('admin:deleteProduct', { id }),
    selectProductImage: () => invokeWithTimeout('admin:selectProductImage'),
    saveDiscordConfig: (config) => invokeWithTimeout('admin:saveDiscordConfig', { config }),
    getDiscordConfig: () => invokeWithTimeout('admin:getDiscordConfig'),
    assignProductKey: (username, product, key) => invokeWithTimeout('admin:assignProductKey', { username, product, key }),
    manuallyActivateKey: (key) => invokeWithTimeout('admin:manuallyActivateKey', { key }),
  },
  audit: {
    getUserTrail: (username, limit) => invokeWithTimeout('audit:getUserTrail', { username, limit }),
    getAllEvents: (limit, filters) => invokeWithTimeout('audit:getAllEvents', { limit, filters }),
  },

  // Startup controls
  startup: {
    get: () => invokeWithTimeout('startup:get'),
    set: (v) => invokeWithTimeout('startup:set', v),
  },

  // Maintenance controls
  maintenance: {
    getStatus: () => invokeWithTimeout('maintenance:getStatus'),
    setStatus: (v) => invokeWithTimeout('maintenance:setStatus', v),
  },

  // Auto-Updater
  update: {
    check: () => invokeWithTimeout('update:check'),
    download: (url) => invokeWithTimeout('update:download', url),
    onProgress: (cb) => {
      const listener = (_, percent) => cb(percent);
      ipcRenderer.on('update:progress', listener);
      return () => ipcRenderer.removeListener('update:progress', listener);
    },
    onDownloaded: (cb) => {
      const listener = () => cb();
      ipcRenderer.on('updater:downloaded', listener);
      return () => ipcRenderer.removeListener('updater:downloaded', listener);
    },
  },

  // License
  license: {
    validate: (key) => invokeWithTimeout('license:validate', key),
    activate: (key, hwid) => invokeWithTimeout('license:activate', { key, hwid }),
    deactivate: (key) => invokeWithTimeout('license:deactivate', key),
    validateProductKey: (username, product, key) => invokeWithTimeout('license:validateProduct', { username, product, key }),
  },

  // PC Cross-Linking
  link: {
    getCode: (licenseKey) => invokeWithTimeout('link:getCode', licenseKey),
    enableLocal: (port) => invokeWithTimeout('link:enableLocal', port),
    unlink: () => invokeWithTimeout('link:unlink'),
    onSettingsUpdated: (cb) => {
      const listener = (_, settings) => cb(settings);
      ipcRenderer.on('settings:updated', listener);
      return () => ipcRenderer.removeListener('settings:updated', listener);
    },
  },

  // KryoK launcher
  kryok: {
    launch: (licenseKey) => invokeWithTimeout('kryok:launch', licenseKey),
  },

  // App Level Prefs
  app: {
    saveTempPref: (key, value) => invokeWithTimeout('app:saveTempPref', key, value),
    getTempPref: (key) => invokeWithTimeout('app:getTempPref', key),
    getVersion: () => invokeWithTimeout('app:getVersion'),
  },

  isElectron: true,
});
