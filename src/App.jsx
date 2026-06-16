import React, { useState, useEffect } from 'react';
import { HashRouter as Router, Routes, Route, useLocation } from 'react-router-dom';
import Layout from './components/layout/Layout';
import Dashboard from './pages/Dashboard';
import AIAssistant from './pages/AIAssistant';
import Processes from './pages/Processes';
import Terminal from './pages/Terminal';
import Files from './pages/Files';
import Settings from './pages/Settings';
import SetupWizard from './pages/SetupWizard';
import Profile from './pages/Profile';
import AdminPanel from './pages/AdminPanel';
import DMA from './pages/DMA';
import ExternalCheat from './pages/ExternalCheat';
import InternalCheat from './pages/InternalCheat';
import Scripting from './pages/Scripting';
import { initTheme } from './utils/themes';
import { api } from './utils/api';
import ErrorBoundary from './components/layout/ErrorBoundary';
import startupAnimation from './assets/startup-animation.mp4';

function AppContent() {
  const location = useLocation();
  const [setupComplete, setSetupComplete] = useState(true);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [loginMode, setLoginMode] = useState('login'); // 'login' or 'register'
  const [loginUserVal, setLoginUserVal] = useState(() => localStorage.getItem('synced-username') || '');
  const [loginPassVal, setLoginPassVal] = useState(() => localStorage.getItem('synced-saved-password') || '');
  const [rememberMe, setRememberMe] = useState(() => localStorage.getItem('synced-remember-me') !== 'false');
  const [loginErr, setLoginErr] = useState('');
  const [loginSubmitting, setLoginSubmitting] = useState(false);
  const [discordLoggingIn, setDiscordLoggingIn] = useState(false);

  const [regUser, setRegUser] = useState('');
  const [regPass, setRegPass] = useState('');
  const [regPin, setRegPin] = useState('');
  const [regKey, setRegKey] = useState('');
  const [regErr, setRegErr] = useState('');
  const [regSubmitting, setRegSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showSplash, setShowSplash] = useState(() => !sessionStorage.getItem('synced-splash-seen'));
  const [splashFading, setSplashFading] = useState(false);
  const [isOnline, setIsOnline] = useState(true);

  useEffect(() => {
    setIsOnline(navigator.onLine);
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    if (!showSplash) return undefined;
    const fadeTimer = setTimeout(() => setSplashFading(true), 2600);
    const hideTimer = setTimeout(() => {
      sessionStorage.setItem('synced-splash-seen', 'true');
      setShowSplash(false);
    }, 3300);
    return () => {
      clearTimeout(fadeTimer);
      clearTimeout(hideTimer);
    };
  }, [showSplash]);

  const handleMinimize = () => window.synced?.window?.minimize();
  const handleMaximize = () => window.synced?.window?.maximize();
  const handleClose = () => window.synced?.window?.close();
  const [bridgeConfig, setBridgeConfig] = useState({
    ip: '',
    port: 8765,
    token: '',
  });
  const [bridgeOnline, setBridgeOnline] = useState(false);
  const [theme, setThemeState] = useState('dark');
  const [language, setLanguageState] = useState('en');
  const [mainHostname, setMainHostname] = useState('Main PC');
  const [bridgeHostname, setBridgeHostname] = useState('Secondary PC');

  const [searchQuery, setSearchQuery] = useState('');
  const [customization, setCustomization] = useState({
    glassOpacity: 0.7,
    glassBlur: 16,
    borderRadius: 8,
    glowEffects: true,
    animationSpeed: 0.3,
    terminalFontSize: 14,
  });

  useEffect(() => {
    setSearchQuery('');
  }, [location.pathname]);

  // Discord Rich Presence — update on route change
  useEffect(() => {
    // Map route paths to page identifiers for Discord presence
    const path = location.pathname;
    let page = 'dashboard';
    if (path === '/dma') page = 'dma';
    else if (path === '/external') page = 'external';
    else if (path === '/internal') page = 'internal';
    else if (path === '/scripts') page = 'scripts';
    else if (path === '/ai') page = 'ai';
    else if (path === '/processes') page = 'processes';
    else if (path === '/terminal') page = 'terminal';
    else if (path === '/files') page = 'files';
    else if (path === '/settings') page = 'settings';
    else if (path === '/profile') page = 'profile';
    else if (path === '/admin') page = 'admin';
    api.updateDiscordPresence(page, {
      hostname: mainHostname,
      username: localStorage.getItem('synced-username') || '',
    }).catch(() => { });
  }, [location.pathname, mainHostname]);

  // Auto-updater states
  const [updateInfo, setUpdateInfo] = useState(null);
  const [updateProgress, setUpdateProgress] = useState(0);
  const [updating, setUpdating] = useState(false);
  const [updateError, setUpdateError] = useState(null);

  // Maintenance states
  const [maintenanceActive, setMaintenanceActive] = useState(false);
  const [maintenanceServices, setMaintenanceServices] = useState({
    ai_assistant: false,
    dma: false,
    internal: false,
    script: false,
    bridge: false
  });

  useEffect(() => {
    async function checkMaintenance() {
      try {
        const res = await api.getMaintenanceStatus();
        setMaintenanceActive(!!res.active);
        if (res.services) {
          setMaintenanceServices(res.services);
        }
      } catch (e) {
        console.warn('Failed to fetch maintenance status:', e);
      }
    }
    checkMaintenance();
    const interval = setInterval(checkMaintenance, 2000);
    return () => clearInterval(interval);
  }, []);

  const isServiceInMaintenance = (serviceKey) => {
    if (getIsAdmin()) return false;
    if (maintenanceActive) return true;
    return !!maintenanceServices[serviceKey];
  };

  useEffect(() => {
    if (!localStorage.getItem('synced-setup-complete') && !localStorage.getItem('synced-username')) {
      localStorage.setItem('synced-username', 'OkzTy');
      localStorage.setItem('synced-profile', JSON.stringify({
        username: 'OkzTy',
        pfpType: 'initials',
        pfpValue: 'O'
      }));
    }

    const t = initTheme();
    setThemeState(t);
    checkSetupStatus();
    fetchMainSpecs();

    // Ensure keyboard focus is never trapped or lost on click/focus
    const handleFocus = () => {
      const activeEl = document.activeElement;
      if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA')) {
        activeEl.focus();
      }
    };
    window.addEventListener('focus', handleFocus);

    return () => {
      window.removeEventListener('focus', handleFocus);
    };
  }, []);

  async function fetchMainSpecs() {
    try {
      const ms = await api.getLocalSpecs();
      if (ms.success && ms.data?.hostname) {
        setMainHostname(ms.data.hostname);
      }
    } catch (e) {
      console.warn('Failed to fetch local specs in App:', e);
    }
  }

  // Listen to remote linking handshake events (Main PC receiving config)
  useEffect(() => {
    const unsubscribe = api.onSettingsUpdated?.((settings) => {
      if (settings?.bridge) {
        setBridgeConfig(settings.bridge);
        setBridgeOnline(true);
        setSetupComplete(true);
        localStorage.setItem('synced-setup-complete', 'true');
        localStorage.setItem(
          'synced-config',
          JSON.stringify({
            licenseKey: settings.licenseKey || '',
            bridge: settings.bridge,
            setupComplete: true,
          })
        );
        if (settings.language) {
          setLanguageState(settings.language);
        }
      }
    });
    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, []);

  async function checkSetupStatus() {
    const remember = localStorage.getItem('synced-remember-me') !== 'false';
    if (!remember) {
      localStorage.removeItem('synced-username');
      localStorage.removeItem('synced-profile');
      localStorage.removeItem('synced-saved-password');
    }

    const done = localStorage.getItem('synced-setup-complete');
    const config = localStorage.getItem('synced-config');
    const username = localStorage.getItem('synced-username');

    if (username) {
      setIsLoggedIn(true);
    } else {
      setIsLoggedIn(false);
    }

    try {
      const s = await api.getSettings(username);
      if (s) {
        if (s.language) {
          setLanguageState(s.language);
        }
        if (s.theme) {
          setThemeState(s.theme);
          document.documentElement.setAttribute('data-theme', s.theme);
        }
        if (s.bridge) {
          setBridgeConfig(s.bridge);
        }
        if (s.customization) {
          setCustomization((prev) => ({
            ...prev,
            ...s.customization,
          }));
        }
        if (s.setupComplete) {
          setSetupComplete(true);
          localStorage.setItem('synced-setup-complete', 'true');
          localStorage.setItem('synced-config', JSON.stringify({
            licenseKey: s.licenseKey || '',
            bridge: s.bridge,
            setupComplete: true
          }));
          setLoading(false);
          return;
        }
      }
    } catch (e) {
      console.warn('Failed to load settings in App:', e);
    }

    if (done === 'true' && config) {
      try {
        const parsed = JSON.parse(config);
        if (parsed.bridge) setBridgeConfig(parsed.bridge);
        setSetupComplete(true);
      } catch {
        setSetupComplete(false);
      }
    } else {
      setSetupComplete(false);
    }
    setLoading(false);
  }

  // ==================== AUTO-UPDATER ====================
  // Checks every 30s so user sees the update popup quickly
  // Uses exponential backoff if rate-limited (GitHub: 60 req/hr unauthenticated)

  const CHECK_INTERVAL_MS = 30000; // 30 seconds
  const RATE_LIMIT_BACKOFF_MS = 300000; // back off 5 min if rate limited

  useEffect(() => {
    async function checkForUpdates() {
      try {
        const res = await api.checkUpdate();
        if (res?.updateAvailable) {
          setUpdateInfo(res);
        }
      } catch (e) {
        console.warn('Failed to check for updates:', e);
      }
    }
    checkForUpdates();
  }, []);

  // Hook into update progress callback
  useEffect(() => {
    const unsubscribe = api.onUpdateProgress((percent) => {
      setUpdateProgress(percent);
    });
    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, []);

  // Hook into update completed (downloaded + extracted)
  useEffect(() => {
    const unsubscribe = api.onUpdateDownloaded(() => {
      setUpdating(false);
      setUpdateInfo({ ...updateInfo, installing: true });
    });
    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, []);

  const handleStartUpdate = async () => {
    if (!updateInfo?.downloadUrl || updating) return;
    setUpdating(true);
    setUpdateError(null);
    try {
      const res = await api.downloadUpdate(updateInfo.downloadUrl);
      if (!res.success) {
        setUpdateError(res.error || 'Failed to download update.');
        setUpdating(false);
      }
    } catch (e) {
      setUpdateError(e.message || 'Error occurred during update.');
      setUpdating(false);
    }
  };

  function handleSetupComplete(config) {
    if (config?.bridge) setBridgeConfig(config.bridge);
    setSetupComplete(true);
    setIsLoggedIn(true);
  }

  const handleDiscordLogin = async () => {
    if (discordLoggingIn) return;
    setDiscordLoggingIn(true);
    setLoginErr('');
    try {
      const res = await api.discordLogin();
      if (res && res.success) {
        // Discord login succeeded — get their info
        const discordUsername = res.username || `discord_${res.discordId}`;
        localStorage.setItem('synced-username', discordUsername);
        localStorage.setItem('synced-profile', JSON.stringify({
          username: discordUsername,
          pfpType: res.avatar ? 'url' : 'initials',
          pfpValue: res.avatar || discordUsername.charAt(0).toUpperCase(),
          discordId: res.discordId,
          isAdmin: discordUsername.toLowerCase() === 'okzty'
        }));
        setIsLoggedIn(true);
        window.dispatchEvent(new Event('storage'));
      } else {
        setLoginErr(res?.error || 'Discord login failed. Try signing in with username/password.');
      }
    } catch (err) {
      setLoginErr('Discord login error: ' + err.message);
    } finally {
      setDiscordLoggingIn(false);
    }
  };

  const handleDiscordRegister = async () => {
    if (discordLoggingIn) return;
    setDiscordLoggingIn(true);
    setRegErr('');
    try {
      const res = await api.discordLogin();
      if (res && res.success) {
        // Pre-fill registration with their Discord data
        const discordUsername = res.username || `discord_${res.discordId}`;
        setRegUser(discordUsername);
        setRegPass('');
        setRegPin('');
        // Save Discord info for profile picture later
        localStorage.setItem('synced-discord-data', JSON.stringify({
          discordId: res.discordId,
          avatar: res.avatar,
          username: discordUsername,
        }));
        setRegErr(`✓ Discord account @${discordUsername} connected! Set a password and PIN to finish registration.`);
      } else {
        setRegErr(res?.error || 'Discord registration failed.');
      }
    } catch (err) {
      setRegErr('Discord error: ' + err.message);
    } finally {
      setDiscordLoggingIn(false);
    }
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    if (!loginUserVal.trim() || !loginPassVal) {
      setLoginErr('Username and password are required');
      return;
    }
    setLoginErr('');
    setLoginSubmitting(true);
    try {
      const res = await api.loginUser(loginUserVal.trim(), loginPassVal);
      if (res && res.success) {
        // Retrieve profile to check isAdmin
        const profileRes = await api.getUserProfile(res.username);
        const userIsAdmin = profileRes?.isAdmin || res.username?.toLowerCase() === 'okzty';

        // Check if maintenance mode is active and user is not an admin
        const maint = await api.getMaintenanceStatus();
        if (maint.active && !userIsAdmin) {
          setLoginErr('System is currently under maintenance. Only administrators can sign in.');
          setLoginSubmitting(false);
          return;
        }

        localStorage.setItem('synced-username', res.username);
        // Save password for auto-fill if "Remember me" is checked
        if (rememberMe) {
          localStorage.setItem('synced-saved-password', loginPassVal);
          localStorage.setItem('synced-remember-me', 'true');
        } else {
          localStorage.removeItem('synced-saved-password');
          localStorage.setItem('synced-remember-me', 'false');
        }
        // Cache user profile
        if (profileRes) {
          localStorage.setItem('synced-profile', JSON.stringify({
            username: profileRes.username,
            pfpType: profileRes.pfpType,
            pfpValue: profileRes.pfpValue,
            isAdmin: !!profileRes.isAdmin
          }));
        } else if (res.username?.toLowerCase() === 'okzty') {
          localStorage.setItem('synced-profile', JSON.stringify({
            username: 'OkzTy',
            pfpType: 'initials',
            pfpValue: 'O',
            isAdmin: true
          }));
        }
        const s = await api.getSettings(res.username);
        if (s) {
          if (s.theme) {
            document.documentElement.setAttribute('data-theme', s.theme);
            setThemeState(s.theme);
          }
          if (s.language) {
            setLanguageState(s.language);
          }
          if (s.bridge) {
            setBridgeConfig(s.bridge);
          }
        }
        localStorage.setItem('synced-user-id', String(res.userId || ''));
        if (res.licenseKey) {
          localStorage.setItem('synced-license-key', res.licenseKey);
        }
        if (res.productsMap) {
          const mapStr = typeof res.productsMap === 'string' ? res.productsMap : JSON.stringify(res.productsMap);
          localStorage.setItem('synced-products-map', mapStr);
        } else {
          localStorage.setItem('synced-products-map', '{}');
        }
        // Fire-and-forget session data save — don't block login on specs/IP lookups
        (async () => {
          try {
            const [specsRes, ipRes] = await Promise.all([api.getLocalSpecs(), api.getLocalIP()]);
            await api.saveSessionData(res.username, {
              action: 'login',
              ip: ipRes?.ip || '',
              specs: specsRes?.data || {},
              bridge: s?.bridge || bridgeConfig
            });
          } catch (sessionErr) {
            console.warn('Failed to save login session data:', sessionErr);
          }
        })();
        setIsLoggedIn(true);
        window.dispatchEvent(new Event('storage'));
      } else {
        setLoginErr(res?.error || 'Invalid username or password');
      }
    } catch (err) {
      setLoginErr('Connection error: ' + err.message);
    } finally {
      setLoginSubmitting(false);
    }
  };

  const handleRegisterOnLock = async (e) => {
    e.preventDefault();
    if (!regUser.trim() || !regPass) {
      setRegErr('Username and password are required');
      return;
    }
    setRegErr('');
    setRegSubmitting(true);
    try {
      const res = await api.registerUser(regUser.trim(), regPass, '0000', ''); // Default PIN '0000'
      if (res && res.success) {
        const createdUsername = regUser.trim();
        try {
          const [specsRes, ipRes] = await Promise.all([api.getLocalSpecs(), api.getLocalIP()]);
          await api.saveSessionData(createdUsername, {
            action: 'account-created',
            ip: ipRes?.ip || '',
            specs: specsRes?.data || {},
            bridge: bridgeConfig
          });
        } catch (sessionErr) {
          console.warn('Failed to save account creation session data:', sessionErr);
        }
        // Auto-login after registration — no license key needed
        localStorage.setItem('synced-username', createdUsername);
        setIsLoggedIn(true);
        window.dispatchEvent(new Event('storage'));
      } else {
        setRegErr(res?.error || 'Registration failed');
      }
    } catch (err) {
      setRegErr('Registration error: ' + err.message);
    } finally {
      setRegSubmitting(false);
    }
  };

  // Safe debug helper: log out without wiping setup or database state.
  useEffect(() => {
    window.logoutSynced = () => {
      localStorage.removeItem('synced-username');
      localStorage.removeItem('synced-user-id');
      localStorage.removeItem('synced-profile');
      window.location.reload();
    };
  }, []);

  const refreshBridge = async () => {
    if (!bridgeConfig.ip) return false;
    try {
      const result = await api.getBridgeStatus(bridgeConfig);
      setBridgeOnline(result.success);
      return result.success;
    } catch {
      setBridgeOnline(false);
      return false;
    }
  };

  // Periodically check bridge status when setup is done
  useEffect(() => {
    if (!setupComplete || !bridgeConfig.ip) return;

    refreshBridge();
    const interval = setInterval(refreshBridge, 15000);
    return () => clearInterval(interval);
  }, [setupComplete, bridgeConfig]);

  const getIsAdmin = () => {
    try {
      const cached = localStorage.getItem('synced-profile');
      if (cached) {
        const parsed = JSON.parse(cached);
        return !!parsed.isAdmin;
      }
    } catch { }
    return false;
  };

  if (isLoggedIn && maintenanceActive && !getIsAdmin()) {
    return (
      <div className="setup-overlay animate-fade-in" style={{
        background: 'radial-gradient(circle at center, #111029 0%, #050508 100%)',
        backdropFilter: 'blur(24px)',
        zIndex: 99999,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center'
      }}>
        {/* Draggable Titlebar for Frameless Window */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: '40px',
            display: 'flex',
            justifyContent: 'flex-end',
            alignItems: 'center',
            paddingRight: '10px',
            WebkitAppRegion: 'drag',
            zIndex: 9999
          }}
        >
          <div className="window-controls" style={{ WebkitAppRegion: 'no-drag' }}>
            <button className="window-btn" onClick={handleMinimize} title="Minimize">─</button>
            <button className="window-btn" onClick={handleMaximize} title="Maximize">□</button>
            <button className="window-btn close" onClick={handleClose} title="Close">✕</button>
          </div>
        </div>

        <div className="setup-container glass-card" style={{
          maxWidth: 460,
          padding: '40px 32px',
          textAlign: 'center',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5), 0 0 40px rgba(108, 92, 231, 0.1)'
        }}>
          {/* Rotating gear animation */}
          <div style={{ position: 'relative', width: 72, height: 72, margin: '0 auto 20px auto', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{
              position: 'absolute',
              width: '100%',
              height: '100%',
              borderRadius: '50%',
              border: '2px dashed var(--accent-primary)',
              animation: 'spin 15s linear infinite'
            }} />
            <div style={{ fontSize: 36 }}>🛠️</div>
          </div>

          <h2 className="setup-title" style={{ margin: '0 0 8px 0', fontSize: 24, fontWeight: 800, color: 'var(--text-primary)' }}>
            Maintenance in Progress
          </h2>
          <p className="setup-desc" style={{ marginBottom: 20, fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
            Synced is currently undergoing scheduled systems maintenance. We will return shortly.
          </p>

          <div style={{
            background: 'rgba(0, 0, 0, 0.2)',
            border: '1px solid var(--border-color)',
            borderRadius: 8,
            padding: 12,
            marginBottom: 20,
            fontSize: 12,
            color: 'var(--text-muted)'
          }}>
            🔐 Only administrative user accounts are permitted login access at this time.
          </div>

          <button
            className="btn btn-secondary"
            onClick={() => {
              localStorage.removeItem('synced-username');
              localStorage.removeItem('synced-user-id');
              localStorage.removeItem('synced-profile');
              window.location.reload();
            }}
            style={{ width: '100%', padding: '10px 14px', fontSize: 13, fontWeight: 600 }}
          >
            ← Sign in as Administrator
          </button>
        </div>
        <style>{`
          @keyframes spin {
            100% { transform: rotate(360deg); }
          }
        `}</style>
      </div>
    );
  }

  if (!isOnline) {
    return (
      <div className="setup-overlay" style={{ backdropFilter: 'blur(20px)', zIndex: 99999 }}>
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: '40px',
            display: 'flex',
            justifyContent: 'flex-end',
            alignItems: 'center',
            paddingRight: '10px',
            WebkitAppRegion: 'drag',
            zIndex: 9999
          }}
        >
          <div className="window-controls" style={{ WebkitAppRegion: 'no-drag' }}>
            <button className="window-btn" onClick={handleMinimize} title="Minimize">
              ─
            </button>
            <button className="window-btn" onClick={handleMaximize} title="Maximize">
              □
            </button>
            <button className="window-btn close" onClick={handleClose} title="Close">
              ✕
            </button>
          </div>
        </div>
        <div className="setup-container glass-card" style={{ maxWidth: 450, padding: 32, textAlign: 'center' }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🌐</div>
          <h2 className="setup-title" style={{ margin: '0 0 8px 0', fontSize: 24, fontWeight: 700 }}>Connection Required</h2>
          <p className="setup-desc" style={{ marginBottom: 16, fontSize: 14, color: 'var(--text-secondary)' }}>
            Synced runs in Always-Online mode to synchronize user profiles and licenses.
          </p>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--danger)', fontWeight: 600 }}>
            No internet connection detected. Please connect to the internet to continue.
          </p>
        </div>
      </div>
    );
  }

  if (showSplash) {
    return (
      <div className={`startup-splash ${splashFading ? 'fade-out' : ''}`}>
        <video
          className="startup-video"
          src={startupAnimation}
          autoPlay
          muted
          playsInline
          onEnded={() => setSplashFading(true)}
        />
        <div className="startup-vignette" />
        <div className="startup-brand">
          <div className="startup-orb">S</div>
          <div>
            <h1>Synced</h1>
            <p>Dual-PC command center initializing</p>
          </div>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="setup-overlay">
        {/* Draggable Titlebar for Frameless Window */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: '40px',
            display: 'flex',
            justifyContent: 'flex-end',
            alignItems: 'center',
            paddingRight: '10px',
            WebkitAppRegion: 'drag',
            zIndex: 9999
          }}
        >
          {/* Window Controls (must exclude from drag) */}
          <div className="window-controls" style={{ WebkitAppRegion: 'no-drag' }}>
            <button className="window-btn" onClick={handleMinimize} title="Minimize">
              ─
            </button>
            <button className="window-btn" onClick={handleMaximize} title="Maximize">
              □
            </button>
            <button className="window-btn close" onClick={handleClose} title="Close">
              ✕
            </button>
          </div>
        </div>
        <div className="setup-loading">
          <div className="setup-spinner"></div>
          <p>Loading Synced...</p>
        </div>
      </div>
    );
  }

  // Update Block Overlay (Force update if available)
  if (updateInfo) {
    return (
      <div className="setup-overlay" style={{ backdropFilter: 'blur(20px)', zIndex: 9999 }}>
        {/* Draggable Titlebar for Frameless Window */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: '40px',
            display: 'flex',
            justifyContent: 'flex-end',
            alignItems: 'center',
            paddingRight: '10px',
            WebkitAppRegion: 'drag',
            zIndex: 9999
          }}
        >
          {/* Window Controls (must exclude from drag) */}
          <div className="window-controls" style={{ WebkitAppRegion: 'no-drag' }}>
            <button className="window-btn" onClick={handleMinimize} title="Minimize">
              ─
            </button>
            <button className="window-btn" onClick={handleMaximize} title="Maximize">
              □
            </button>
            <button className="window-btn close" onClick={handleClose} title="Close">
              ✕
            </button>
          </div>
        </div>
        <div className="setup-container glass-card" style={{ maxWidth: 450, padding: 32, textAlign: 'center' }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🚀</div>
          <h2 className="setup-title" style={{ margin: '0 0 8px 0', fontSize: 24, fontWeight: 700 }}>Update Required</h2>
          <p className="setup-desc" style={{ marginBottom: 24, fontSize: 14, color: 'var(--text-secondary)' }}>
            A new version of Synced (v{updateInfo.latestVersion}) is available. You must install the latest version from GitHub to continue using the software.
          </p>

          <div style={{
            background: 'rgba(0,0,0,0.2)',
            borderRadius: 8,
            padding: 16,
            textAlign: 'left',
            marginBottom: 24,
            maxHeight: 120,
            overflowY: 'auto',
            border: '1px solid var(--border-color)'
          }}>
            <h5 style={{ margin: '0 0 6px 0', fontSize: 13, color: 'var(--text-primary)', fontWeight: 600 }}>
              Release Notes (v{updateInfo.latestVersion}):
            </h5>
            <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'pre-wrap' }}>
              {updateInfo.body || 'No release notes provided.'}
            </p>
          </div>

          {updateInfo.installing ? (
            <div style={{ width: '100%', textAlign: 'center' }}>
              <div style={{ fontSize: 36, marginBottom: 12 }}>✅</div>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 6 }}>
                Installation Complete!
              </div>
              <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)' }}>
                Synced is restarting with the new version. Please wait...
              </p>
            </div>
          ) : updating ? (
            <div style={{ width: '100%', textAlign: 'left' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 6, color: 'var(--text-primary)' }}>
                <span>Downloading update installer...</span>
                <span className="text-mono" style={{ fontWeight: 600 }}>{updateProgress}%</span>
              </div>
              <div style={{ background: '#27272a', borderRadius: 10, height: 8, width: '100%', overflow: 'hidden' }}>
                <div style={{
                  background: 'linear-gradient(90deg, #10b981, #22c55e)',
                  height: '100%',
                  width: `${updateProgress}%`,
                  transition: 'width 0.1s ease-out'
                }}></div>
              </div>
              <p style={{ margin: '8px 0 0 0', fontSize: 11, color: 'var(--text-muted)' }}>
                Synced will automatically close and run the update installer once the download completes.
              </p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <button
                className="btn btn-primary"
                onClick={handleStartUpdate}
                style={{ width: '100%', padding: '12px', fontSize: 14, fontWeight: 600 }}
              >
                ⚡ Download & Update Automatically
              </button>
              <p style={{ margin: '4px 0 0 0', fontSize: 11, color: 'var(--text-muted)', textAlign: 'center' }}>
                You must update to continue using Synced.
              </p>
              {updateError && (
                <p style={{ color: 'var(--danger)', fontSize: 12, margin: '8px 0 0 0' }}>{updateError}</p>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  // Show Setup Wizard if not completed
  if (!setupComplete) {
    return <SetupWizard onComplete={handleSetupComplete} language={language} setLanguage={setLanguageState} theme={theme} setTheme={setThemeState} />;
  }

  // Show Login Screen if setup is complete but user is logged out
  if (setupComplete && !isLoggedIn) {
    return (
      <div className="setup-overlay">
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: '40px',
            display: 'flex',
            justifyContent: 'flex-end',
            alignItems: 'center',
            paddingRight: '10px',
            WebkitAppRegion: 'drag',
            zIndex: 9999
          }}
        >
          <div className="window-controls" style={{ WebkitAppRegion: 'no-drag' }}>
            <button className="window-btn" onClick={handleMinimize} title="Minimize">─</button>
            <button className="window-btn" onClick={handleMaximize} title="Maximize">□</button>
            <button className="window-btn close" onClick={handleClose} title="Close">✕</button>
          </div>
        </div>

        <div className="setup-container" style={{ maxWidth: 420, padding: 0 }}>
          {loginMode === 'login' ? (
            <div className="setup-step-license text-center" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, padding: 32 }}>
              <div className="setup-logo-big" style={{ marginBottom: 8 }}>
                <div className="setup-logo-icon-big">S</div>
                <h1 className="setup-logo-text-big">Synced</h1>
              </div>
              <p className="setup-desc" style={{ marginBottom: 8 }}>
                Sign in to your account
              </p>

              {maintenanceActive && (
                <div style={{
                  background: 'rgba(239, 68, 68, 0.1)',
                  border: '1px solid rgba(239, 68, 68, 0.2)',
                  color: '#ef4444',
                  padding: '10px 12px',
                  borderRadius: 6,
                  fontSize: 11,
                  marginBottom: 8,
                  textAlign: 'left',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  fontWeight: 500,
                  width: '100%'
                }}>
                  <span>⚠️</span>
                  <span>System is under maintenance. Only administrators can sign in.</span>
                </div>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, width: '100%', maxWidth: 340 }}>
                <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div className="input-group" style={{ margin: 0 }}>
                    <label className="input-label">Username</label>
                    <input
                      type="text"
                      className="input"
                      value={loginUserVal}
                      onChange={(e) => setLoginUserVal(e.target.value)}
                      required
                      autoFocus
                      style={{ background: 'var(--bg-input)', border: '1px solid var(--border-color)', borderRadius: 8, color: 'var(--text-primary)' }}
                    />
                  </div>

                  <div className="input-group" style={{ margin: 0 }}>
                    <label className="input-label">Password</label>
                    <input
                      type="password"
                      className="input"
                      value={loginPassVal}
                      onChange={(e) => setLoginPassVal(e.target.value)}
                      required
                      style={{ background: 'var(--bg-input)', border: '1px solid var(--border-color)', borderRadius: 8, color: 'var(--text-primary)' }}
                    />
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '4px 0', userSelect: 'none' }}>
                    <span style={{ fontSize: 13, color: 'var(--text-secondary)', fontWeight: 500 }}>
                      {language === 'fr' ? 'Se souvenir de moi' : 'Remember me'}
                    </span>
                    <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={rememberMe}
                        onChange={(e) => setRememberMe(e.target.checked)}
                        style={{ display: 'none' }}
                      />
                      <div 
                        style={{
                          width: '38px',
                          height: '20px',
                          borderRadius: '10px',
                          background: rememberMe ? '#10b981' : 'var(--bg-input)',
                          border: '1px solid var(--border-color)',
                          position: 'relative',
                          transition: 'all 0.2s ease',
                        }}
                      >
                        <div 
                          style={{
                            width: '14px',
                            height: '14px',
                            borderRadius: '50%',
                            background: '#fff',
                            position: 'absolute',
                            top: '2px',
                            left: rememberMe ? '20px' : '2px',
                            transition: 'all 0.2s ease',
                            boxShadow: '0 1px 3px rgba(0,0,0,0.4)'
                          }}
                        />
                      </div>
                    </label>
                  </div>

                  {loginErr && (
                    <p style={{ color: 'var(--danger)', fontSize: 12, margin: '4px 0 0 0', fontWeight: 500 }}>{loginErr}</p>
                  )}

                  <button
                    type="submit"
                    className="btn btn-primary"
                    style={{ width: '100%', height: 44, fontWeight: 600, fontSize: 14 }}
                    disabled={loginSubmitting}
                  >
                    {loginSubmitting ? 'Logging in...' : '🔑 Sign In'}
                  </button>
                </form>

                <div className="setup-divider" style={{ margin: '0' }}>
                  <span>or continue with</span>
                </div>

                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={handleDiscordLogin}
                  disabled={discordLoggingIn}
                  style={{
                    width: '100%', height: 44, fontWeight: 600, fontSize: 13,
                    background: discordLoggingIn ? 'var(--bg-input)' : 'linear-gradient(135deg, #5865F2, #4752C4)',
                    color: '#fff', border: 'none', borderRadius: 8,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                    transition: 'all 0.2s ease',
                  }}
                >
                  {discordLoggingIn ? (
                    <><span style={{ display: 'inline-block', animation: 'spin 1s linear infinite' }}>⏳</span> Connecting...</>
                  ) : (
                    <>
                      <svg width="18" height="18" viewBox="0 0 127.14 96.36" fill="white"><path d="M107.7,8.07A105.15,105.15,0,0,0,81.47,0a72.06,72.06,0,0,0-3.36,6.83A97.68,97.68,0,0,0,49,6.83,72.37,72.37,0,0,0,45.64,0,105.89,105.89,0,0,0,19.39,8.09C2.79,32.65-1.71,56.6.54,80.21h0A105.73,105.73,0,0,0,32.71,96.36,77.7,77.7,0,0,0,39.6,85.25a68.42,68.42,0,0,1-10.85-5.18c.91-.66,1.8-1.34,2.66-2a75.57,75.57,0,0,0,64.32,0c.87.71,1.76,1.39,2.66,2a68.75,68.75,0,0,1-10.87,5.19,77,77,0,0,0,6.89,11.1A105.25,105.25,0,0,0,126.6,80.22h0C129.24,56.6,122.84,32.65,107.7,8.07ZM42.45,65.69C36.18,65.69,31,60,31,53s5-12.74,11.43-12.74S54,46,53.89,53,48.84,65.69,42.45,65.69Zm42.24,0C78.41,65.69,73.25,60,73.25,53s5-12.74,11.44-12.74C96.23,40.25,101,46,100.88,53,100.88,60,96.23,65.69,84.69,65.69Z" /></svg>
                      Sign in with Discord
                    </>
                  )}
                </button>

                <p style={{ margin: '4px 0 0 0', fontSize: 12, color: 'var(--text-secondary)', textAlign: 'center' }}>
                  Don't have an account?{' '}
                  <span onClick={() => { setLoginMode('register'); setRegErr(''); }} style={{ color: 'var(--primary)', cursor: 'pointer', fontWeight: 600 }}>Create Account</span>
                </p>
              </div>
            </div>
          ) : (
            <div className="setup-step-license text-center" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, padding: 32 }}>
              <div className="setup-logo-big" style={{ marginBottom: 8 }}>
                <div className="setup-logo-icon-big">S</div>
                <h1 className="setup-logo-text-big">Synced</h1>
              </div>
              <p className="setup-desc" style={{ marginBottom: 8 }}>
                Create your account
              </p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, width: '100%', maxWidth: 340 }}>
                <form onSubmit={handleRegisterOnLock} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div className="input-group" style={{ margin: 0 }}>
                    <label className="input-label">Username</label>
                    <input
                      type="text"
                      className="input"
                      value={regUser}
                      onChange={(e) => setRegUser(e.target.value)}
                      required
                      autoFocus
                      style={{ background: 'var(--bg-input)', border: '1px solid var(--border-color)', borderRadius: 8, color: 'var(--text-primary)' }}
                    />
                  </div>

                  <div className="input-group" style={{ margin: 0 }}>
                    <label className="input-label">Password</label>
                    <input
                      type="password"
                      className="input"
                      value={regPass}
                      onChange={(e) => setRegPass(e.target.value)}
                      required
                      style={{ background: 'var(--bg-input)', border: '1px solid var(--border-color)', borderRadius: 8, color: 'var(--text-primary)' }}
                    />
                  </div>

                  {regErr && (
                    <p style={{ color: regErr.includes('✓') ? 'var(--success)' : 'var(--danger)', fontSize: 12, margin: '4px 0 0 0', fontWeight: 500 }}>{regErr}</p>
                  )}

                  <button
                    type="submit"
                    className="btn btn-primary"
                    style={{ width: '100%', height: 44, fontWeight: 600, fontSize: 14 }}
                    disabled={regSubmitting}
                  >
                    {regSubmitting ? 'Registering...' : '📝 Create Account'}
                  </button>
                </form>

                <div className="setup-divider" style={{ margin: '0' }}>
                  <span>or continue with</span>
                </div>

                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={handleDiscordRegister}
                  disabled={discordLoggingIn}
                  style={{
                    width: '100%', height: 44, fontWeight: 600, fontSize: 13,
                    background: discordLoggingIn ? 'var(--bg-input)' : 'linear-gradient(135deg, #5865F2, #4752C4)',
                    color: '#fff', border: 'none', borderRadius: 8,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                    transition: 'all 0.2s ease',
                  }}
                >
                  {discordLoggingIn ? (
                    <><span style={{ display: 'inline-block', animation: 'spin 1s linear infinite' }}>⏳</span> Connecting...</>
                  ) : (
                    <>
                      <svg width="18" height="18" viewBox="0 0 127.14 96.36" fill="white"><path d="M107.7,8.07A105.15,105.15,0,0,0,81.47,0a72.06,72.06,0,0,0-3.36,6.83A97.68,97.68,0,0,0,49,6.83,72.37,72.37,0,0,0,45.64,0,105.89,105.89,0,0,0,19.39,8.09C2.79,32.65-1.71,56.6.54,80.21h0A105.73,105.73,0,0,0,32.71,96.36,77.7,77.7,0,0,0,39.6,85.25a68.42,68.42,0,0,1-10.85-5.18c.91-.66,1.8-1.34,2.66-2a75.57,75.57,0,0,0,64.32,0c.87.71,1.76,1.39,2.66,2a68.75,68.75,0,0,1-10.87,5.19,77,77,0,0,0,6.89,11.1A105.25,105.25,0,0,0,126.6,80.22h0C129.24,56.6,122.84,32.65,107.7,8.07ZM42.45,65.69C36.18,65.69,31,60,31,53s5-12.74,11.43-12.74S54,46,53.89,53,48.84,65.69,42.45,65.69Zm42.24,0C78.41,65.69,73.25,60,73.25,53s5-12.74,11.44-12.74C96.23,40.25,101,46,100.88,53,100.88,60,96.23,65.69,84.69,65.69Z" /></svg>
                      Sign up with Discord
                    </>
                  )}
                </button>

                <p style={{ margin: '4px 0 0 0', fontSize: 12, color: 'var(--text-secondary)', textAlign: 'center' }}>
                  Already have an account?{' '}
                  <span onClick={() => { setLoginMode('login'); setLoginErr(''); }} style={{ color: 'var(--primary)', cursor: 'pointer', fontWeight: 600 }}>Sign In</span>
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  const glassOpacity = customization?.glassOpacity ?? 0.7;
  const glassBlur = customization?.glassBlur ?? 16;
  const borderRadius = customization?.borderRadius ?? 8;
  const glowEffects = customization?.glowEffects ?? true;
  const animationSpeed = customization?.animationSpeed ?? 0.3;
  const terminalFontSize = customization?.terminalFontSize ?? 14;

  const styleOverrides = `
    :root {
      --glass-opacity: ${glassOpacity} !important;
      --glass-blur: ${glassBlur}px !important;
      --radius-lg: ${borderRadius}px !important;
      --radius-md: ${Math.max(0, borderRadius - 4)}px !important;
      --radius-sm: ${Math.max(0, borderRadius - 8)}px !important;
      --transition-normal: ${animationSpeed}s ease !important;
      --transition-fast: ${animationSpeed * 0.6}s ease !important;
      --transition-slow: ${animationSpeed * 1.6}s ease !important;
      --terminal-font-size: ${terminalFontSize}px !important;
    }
    
    .glass-card, .sidebar, .header {
      background: rgba(10, 10, 18, var(--glass-opacity)) !important;
      backdrop-filter: blur(${glassBlur}px) saturate(180%) !important;
      -webkit-backdrop-filter: blur(${glassBlur}px) saturate(180%) !important;
    }

    ${!glowEffects ? `
      .glass-card, .sidebar, .header {
        box-shadow: 0 4px 20px rgba(0,0,0,0.3) !important;
        border-color: var(--border-color) !important;
      }
      .glass-card:hover {
        box-shadow: 0 6px 24px rgba(0,0,0,0.4) !important;
        border-color: var(--border-color) !important;
        transform: translateY(-1px) !important;
      }
      .btn-primary {
        box-shadow: none !important;
      }
      .btn-primary:hover {
        box-shadow: none !important;
      }
      .input:focus {
        box-shadow: none !important;
        border-color: var(--accent-primary) !important;
      }
    ` : `
      .glass-card {
        box-shadow: var(--shadow-card), 0 0 12px rgba(108, 92, 231, 0.03) !important;
      }
      .glass-card:hover {
        box-shadow: var(--shadow-card), 0 0 20px rgba(108, 92, 231, 0.2) !important;
      }
    `}

    .terminal-output, .terminal-input-row input {
      font-size: var(--terminal-font-size) !important;
      font-family: 'JetBrains Mono', 'Fira Code', monospace !important;
    }
  `;

  // Show Dashboard
  return (
    <>
      <style>{styleOverrides}</style>
      <Layout
        bridgeOnline={bridgeOnline}
        theme={theme}
        setTheme={setThemeState}
        language={language}
        mainHostname={mainHostname}
        bridgeHostname={bridgeHostname}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
      >
        <div className="animate-fade-in" key={location.pathname}>
          <ErrorBoundary>
            <Routes>
              <Route path="/" element={<Dashboard bridgeConfig={bridgeConfig} bridgeOnline={bridgeOnline} refreshBridge={refreshBridge} language={language} searchQuery={searchQuery} />} />
              <Route path="/dma" element={isServiceInMaintenance('dma') ? <ServiceMaintenanceNotice serviceName="DMA Console" language={language} /> : <DMA language={language} searchQuery={searchQuery} />} />
              <Route path="/external" element={isServiceInMaintenance('internal') ? <ServiceMaintenanceNotice serviceName="External Client" language={language} /> : <ExternalCheat language={language} searchQuery={searchQuery} />} />
              <Route path="/internal" element={isServiceInMaintenance('internal') ? <ServiceMaintenanceNotice serviceName="Internal Client" language={language} /> : <InternalCheat language={language} searchQuery={searchQuery} />} />
              <Route path="/scripts" element={isServiceInMaintenance('script') ? <ServiceMaintenanceNotice serviceName="Scripting Console" language={language} /> : <Scripting language={language} searchQuery={searchQuery} />} />
              <Route path="/ai" element={isServiceInMaintenance('ai_assistant') ? <ServiceMaintenanceNotice serviceName="AI Assistant" language={language} /> : <AIAssistant bridgeConfig={bridgeConfig} language={language} mainHostname={mainHostname} bridgeHostname={bridgeHostname} searchQuery={searchQuery} />} />
              <Route path="/processes" element={isServiceInMaintenance('bridge') ? <ServiceMaintenanceNotice serviceName="Second PC Bridge (Processes)" language={language} /> : <Processes bridgeConfig={bridgeConfig} bridgeOnline={bridgeOnline} language={language} bridgeHostname={bridgeHostname} searchQuery={searchQuery} />} />
              <Route path="/terminal" element={isServiceInMaintenance('bridge') ? <ServiceMaintenanceNotice serviceName="Second PC Bridge (Terminal)" language={language} /> : <Terminal bridgeConfig={bridgeConfig} bridgeOnline={bridgeOnline} language={language} mainHostname={mainHostname} bridgeHostname={bridgeHostname} searchQuery={searchQuery} />} />
              <Route path="/files" element={isServiceInMaintenance('bridge') ? <ServiceMaintenanceNotice serviceName="Second PC Bridge (File Transfer)" language={language} /> : <Files bridgeConfig={bridgeConfig} bridgeOnline={bridgeOnline} language={language} mainHostname={mainHostname} bridgeHostname={bridgeHostname} searchQuery={searchQuery} />} />
              <Route path="/settings" element={<Settings bridgeConfig={bridgeConfig} setBridgeConfig={setBridgeConfig} bridgeOnline={bridgeOnline} theme={theme} setTheme={setThemeState} language={language} setLanguage={setLanguageState} mainHostname={mainHostname} bridgeHostname={bridgeHostname} searchQuery={searchQuery} customization={customization} setCustomization={setCustomization} />} />
              <Route path="/profile" element={<Profile language={language} searchQuery={searchQuery} />} />
              <Route path="/admin" element={<AdminPanel language={language} searchQuery={searchQuery} />} />
            </Routes>
          </ErrorBoundary>
        </div>
      </Layout>
    </>
  );
}

function ServiceMaintenanceNotice({ serviceName, language }) {
  return (
    <div className="page-container animate-fade-in" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '60vh', textAlign: 'center', padding: 20 }}>
      <div style={{ fontSize: 64, marginBottom: 20, animation: 'float 3s ease-in-out infinite' }}>🛠️</div>
      <h2 style={{ fontSize: 24, fontWeight: 800, color: 'var(--text-primary)', marginBottom: 10 }}>
        {serviceName} {language === 'fr' ? 'en Maintenance' : 'under Maintenance'}
      </h2>
      <p style={{ fontSize: 13, color: 'var(--text-muted)', maxWidth: 440, lineHeight: 1.6, margin: '0 0 20px 0' }}>
        {language === 'fr' 
          ? `Ce service fait l'objet d'une maintenance planifiée. Veuillez revenir plus tard. Les administrateurs peuvent toujours y accéder.` 
          : `This service is currently undergoing scheduled maintenance. Please check back later. Administrators still have access.`}
      </p>
      <button className="btn btn-secondary" onClick={() => window.location.hash = '#/'} style={{ padding: '8px 16px', fontSize: 13 }}>
        {language === 'fr' ? 'Retour au Tableau de bord' : 'Back to Dashboard'}
      </button>
    </div>
  );
}

export default function App() {
  const [fatalError, setFatalError] = React.useState(null);

  React.useEffect(() => {
    // Global handler for uncaught render errors
    const originalOnError = window.onerror;
    window.onerror = (msg, url, line, col, err) => {
      console.error('[Global] Uncaught error:', msg, err);
      setFatalError(err || new Error(String(msg)));
      return true; // prevent default handling
    };

    // Global handler for unhandled promise rejections
    const onRejection = (event) => {
      console.error('[Global] Unhandled rejection:', event.reason);
      setFatalError(event.reason || new Error('Unhandled Promise rejection'));
    };
    window.addEventListener('unhandledrejection', onRejection);

    return () => {
      window.onerror = originalOnError;
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, []);

  if (fatalError) {
    return (
      <div style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'radial-gradient(circle at center, #1a1a2e 0%, #0a0a14 100%)',
        fontFamily: "'Inter', system-ui, sans-serif",
        zIndex: 999999,
      }}>
        <ErrorBoundary fatal>
          <div>Recovering...</div>
        </ErrorBoundary>
      </div>
    );
  }

  return (
    <Router>
      <ErrorBoundary fatal>
        <AppContent />
      </ErrorBoundary>
    </Router>
  );
}
