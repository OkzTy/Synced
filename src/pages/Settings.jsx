import React, { useState, useEffect, useRef } from 'react';
import { THEMES, setTheme as applyTheme } from '../utils/themes';
import { APP_NAME, APP_VERSION } from '../utils/constants';
import { api } from '../utils/api';
import { translations } from '../utils/translations';

export default function Settings({ 
  bridgeConfig, 
  setBridgeConfig, 
  bridgeOnline,
  theme, 
  setTheme, 
  language, 
  setLanguage, 
  mainHostname, 
  bridgeHostname,
  searchQuery = '',
  customization = {},
  setCustomization = () => {}
}) {
  const t = (key) => translations[language]?.[key] || translations['en']?.[key] || key;

  const glassOpacity = customization?.glassOpacity ?? 0.7;
  const glassBlur = customization?.glassBlur ?? 16;
  const borderRadius = customization?.borderRadius ?? 8;
  const glowEffects = customization?.glowEffects ?? true;
  const animationSpeed = customization?.animationSpeed ?? 0.3;
  const terminalFontSize = customization?.terminalFontSize ?? 14;

  const [localBridge, setLocalBridge] = useState({ ...(bridgeConfig || {}) });
  const [testResult, setTestResult] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [aiStatus, setAiStatus] = useState(null);
  const [aiEndpoint, setAiEndpoint] = useState('http://localhost:11434');
  const [availableModels, setAvailableModels] = useState([]);
  const [selectedModel, setSelectedModel] = useState('dolphin-llama3');
  
  const [launchAtStartup, setLaunchAtStartup] = useState(false);
  const [bridgeStartup, setBridgeStartup] = useState(false);
  const [licenseKey, setLicenseKey] = useState('');
  const [deactivating, setDeactivating] = useState(false);
  const [showAdvancedBridge, setShowAdvancedBridge] = useState(false);

  // Cross-Linking states
  const [localBridgeEnabled, setLocalBridgeEnabled] = useState(false);
  const [generatedCode, setGeneratedCode] = useState('');
  const [enablingBridge, setEnablingBridge] = useState(false);
  const [enableBridgeResult, setEnableBridgeResult] = useState(null);
  const [githubToken, setGithubToken] = useState('');
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [updateStatus, setUpdateStatus] = useState(null);

  // Undo States & Ref
  const [undoState, setUndoState] = useState(null); // { secondsLeft: 20, baseline: { ... } }
  const undoTimerRef = useRef(null);
  const timeoutRef = useRef(null);

  const showResult = (status, delay = 3000) => {
    setTestResult(status);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      setTestResult(null);
      timeoutRef.current = null;
    }, delay);
  };

  // Sync localBridge with bridgeConfig props when they change in parent App.jsx
  useEffect(() => {
    setLocalBridge({ ...(bridgeConfig || {}) });
  }, [bridgeConfig]);

  // Clean up undo timer on unmount
  useEffect(() => {
    return () => {
      if (undoTimerRef.current) {
        clearInterval(undoTimerRef.current);
      }
    };
  }, []);

  // Helper to capture a snapshot of current settings
  const captureCurrentSettings = () => {
    return {
      language,
      theme,
      launchAtStartup,
      bridgeStartup,
      customization: customization ? { ...customization } : {},
      localBridge: localBridge ? { ...localBridge } : {},
      aiEndpoint,
      selectedModel,
      githubToken
    };
  };

  // Helper to apply settings snapshot back
  const applySettingsObject = async (settings) => {
    if (settings.language !== language) setLanguage(settings.language);
    if (settings.theme !== theme) {
      applyTheme(settings.theme);
      setTheme(settings.theme);
    }
    setLaunchAtStartup(settings.launchAtStartup);
    setBridgeStartup(settings.bridgeStartup);
    setCustomization(settings.customization);
    setLocalBridge(settings.localBridge);
    setBridgeConfig(settings.localBridge);
    setAiEndpoint(settings.aiEndpoint);
    setSelectedModel(settings.selectedModel);
    setGithubToken(settings.githubToken);

    const username = localStorage.getItem('synced-username');
    // Save configuration to disk
    await api.saveSettings({
      theme: settings.theme,
      bridge: settings.localBridge,
      ai: { endpoint: settings.aiEndpoint, model: settings.selectedModel },
      customization: settings.customization,
      githubToken: settings.githubToken,
      language: settings.language
    }, username);

    // Revert startup registry and scheduled task
    await api.setStartup(settings.launchAtStartup);
    if (settings.localBridge.ip) {
      const cmd = settings.bridgeStartup 
        ? 'Enable-ScheduledTask -TaskName "SyncedBridge"' 
        : 'Disable-ScheduledTask -TaskName "SyncedBridge"';
      await api.executeOnBridge(settings.localBridge, cmd);
    }
  };

  // Setting change wrapper for Undo action
  const handleSettingChange = (updateFn) => {
    if (!undoState) {
      const baseline = captureCurrentSettings();
      setUndoState({
        secondsLeft: 20,
        baseline
      });
      
      if (undoTimerRef.current) clearInterval(undoTimerRef.current);
      undoTimerRef.current = setInterval(() => {
        setUndoState((prev) => {
          if (!prev) return null;
          if (prev.secondsLeft <= 1) {
            clearInterval(undoTimerRef.current);
            undoTimerRef.current = null;
            return null;
          }
          return {
            ...prev,
            secondsLeft: prev.secondsLeft - 1
          };
        });
      }, 1000);
    } else {
      setUndoState((prev) => {
        if (!prev) return null;
        return {
          ...prev,
          secondsLeft: 20
        };
      });
    }
    updateFn();
  };

  const handleUndo = async () => {
    if (undoState?.baseline) {
      await applySettingsObject(undoState.baseline);
    }
    if (undoTimerRef.current) {
      clearInterval(undoTimerRef.current);
      undoTimerRef.current = null;
    }
    setUndoState(null);
  };

  const matchesQuery = (title, desc = '') => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return title.toLowerCase().includes(q) || desc.toLowerCase().includes(q);
  };

  useEffect(() => {
    // Load license key from local storage config
    const configStr = localStorage.getItem('synced-config');
    if (configStr) {
      try {
        const parsed = JSON.parse(configStr);
        setLicenseKey(parsed.licenseKey || '');
      } catch (e) {
        console.warn('Failed to parse local storage config:', e);
      }
    }

    // Load Electron settings & startup
    async function loadConfig() {
      try {
        const username = localStorage.getItem('synced-username');
        const s = await api.getSettings(username);
        if (s) {
          if (s.ai) {
            setAiEndpoint(s.ai.endpoint || 'http://localhost:11434');
            setSelectedModel(s.ai.model || 'dolphin-llama3');
          }
          setGithubToken(s.githubToken || '');
        }
      } catch (e) {
        console.warn('Failed to load settings in Settings page:', e);
      }
      
      try {
        const startup = await api.getStartup();
        setLaunchAtStartup(startup === true);
      } catch (e) {
        console.warn('Failed to load startup settings:', e);
        setLaunchAtStartup(false);
      }

      // Check secondary PC startup bridge status
      try {
        await checkBridgeStartupStatus();
      } catch (e) {
        console.warn('Failed checkBridgeStartupStatus:', e);
      }

      // Check if local bridge is enabled
      try {
        const details = await api.getLocalBridgeDetails();
        if (details && details.token) {
          setLocalBridgeEnabled(true);
        } else {
          setLocalBridgeEnabled(false);
        }
      } catch (e) {
        console.warn('Failed to load local bridge details:', e);
      }
    }
    
    loadConfig();
    checkAIStatus();
  }, []);

  async function checkBridgeStartupStatus() {
    if (!bridgeConfig || !bridgeConfig.ip) return;
    try {
      // Check if scheduled task exists and is enabled
      const res = await api.executeOnBridge(
        bridgeConfig,
        '(Get-ScheduledTask -TaskName "SyncedBridge" -ErrorAction SilentlyContinue).State'
      );
      if (res.success && res.data?.output) {
        const out = res.data.output.trim();
        setBridgeStartup(out === 'Ready' || out === 'Running');
      }
    } catch (e) {
      console.warn('Failed to fetch bridge scheduled task status:', e);
    }
  }

  async function checkAIStatus() {
    try {
      const result = await api.getAIStatus();
      if (result?.success && result?.data) {
        setAiStatus(result.data);
        setAvailableModels(result.data.availableModels || []);
        if (result.data.model) {
          setSelectedModel(result.data.model);
        }
      } else {
        setAiStatus({ status: 'offline', modelInstalled: false, model: selectedModel, availableModels: [] });
      }
    } catch (e) {
      console.warn('Failed to check AI status:', e);
      setAiStatus({ status: 'offline', modelInstalled: false, model: selectedModel, availableModels: [] });
    }
  }

  function handleThemeChange(themeId) {
    applyTheme(themeId);
    setTheme(themeId);
    saveAllSettings(themeId, localBridge, aiEndpoint, selectedModel, customization);
  }

  async function testConnection() {
    setTestResult('testing');
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    try {
      const result = await api.getBridgeStatus(localBridge);
      showResult(result.success ? 'success' : 'failed');
      if (result.success) {
        // Update bridge startup check on success
        const taskRes = await api.executeOnBridge(
          localBridge,
          '(Get-ScheduledTask -TaskName "SyncedBridge" -ErrorAction SilentlyContinue).State'
        );
        if (taskRes.success && taskRes.data?.output) {
          const out = taskRes.data.output.trim();
          setBridgeStartup(out === 'Ready' || out === 'Running');
        }
      }
    } catch {
      showResult('failed');
    }
  }

  async function scanNetwork() {
    setScanning(true);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    try {
      const result = await api.scanNetwork();
      if (result?.data?.found?.length > 0) {
        const found = result.data.found[0];
        setLocalBridge((prev) => ({ ...prev, ip: found.ip, port: found.port }));
        showResult('found');
      } else {
        showResult('notfound');
      }
    } catch {
      showResult('failed');
    }
    setScanning(false);
  }

  function saveBridgeConfig() {
    setBridgeConfig(localBridge);
    const configStr = localStorage.getItem('synced-config');
    if (configStr) {
      try {
        const parsed = JSON.parse(configStr);
        parsed.bridge = localBridge;
        localStorage.setItem('synced-config', JSON.stringify(parsed));
      } catch (e) {}
    }
    saveAllSettings(theme, localBridge, aiEndpoint, selectedModel, customization);
    showResult('saved', 2000);
  }

  async function handleStartupToggle(val) {
    setLaunchAtStartup(val);
    await api.setStartup(val);
  }

  async function handleBridgeStartupToggle(val) {
    if (!bridgeConfig || !bridgeConfig.ip) {
      alert('Configure and save bridge connection first!');
      return;
    }
    setBridgeStartup(val);
    try {
      const cmd = val 
        ? 'Enable-ScheduledTask -TaskName "SyncedBridge"' 
        : 'Disable-ScheduledTask -TaskName "SyncedBridge"';
      const res = await api.executeOnBridge(bridgeConfig, cmd);
      if (!res.success) {
        alert('Failed to update startup task: ' + (res.data?.error || 'Access denied. Run bridge as Admin.'));
        setBridgeStartup(!val);
      }
    } catch (e) {
      alert('Error updating startup task: ' + e.message);
      setBridgeStartup(!val);
    }
  }

  function handleCustomizationChange(updatedFields) {
    const nextCustomization = {
      glassOpacity,
      glassBlur,
      borderRadius,
      glowEffects,
      animationSpeed,
      terminalFontSize,
      ...updatedFields
    };
    setCustomization(nextCustomization);
    saveAllSettings(theme, localBridge, aiEndpoint, selectedModel, nextCustomization);
  }

  function saveAllSettings(t, bridge, aiEnd, aiMod, cust = customization, gitToken = githubToken, lang = language) {
    const username = localStorage.getItem('synced-username');
    api.saveSettings({
      theme: t,
      bridge,
      ai: { endpoint: aiEnd, model: aiMod },
      customization: cust,
      githubToken: gitToken,
      language: lang
    }, username);
  }

  function handleGithubTokenChange(val) {
    setGithubToken(val);
    saveAllSettings(theme, localBridge, aiEndpoint, selectedModel, customization, val);
  }

  async function handleDeactivateLicense() {
    const confirmMsg = t('deactivateWarning');
    if (!window.confirm(confirmMsg)) return;

    setDeactivating(true);
    try {
      if (licenseKey) {
        const res = await api.deactivateLicense(licenseKey);
        if (!res.success) {
          console.warn('Deactivation on server failed:', res.error);
        }
      }
    } catch (e) {
      console.warn('Error deactivating license on server:', e);
    } finally {
      setDeactivating(false);
      localStorage.removeItem('synced-username');
      localStorage.removeItem('synced-user-id');
      localStorage.removeItem('synced-profile');
      window.location.reload();
    }
  }

  const maskLicenseKey = (key) => {
    if (!key) return 'N/A';
    if (key.length <= 12) return key;
    return key.substring(0, 10) + '-XXXX-XXXX';
  };

  const formatCode = (code) => {
    if (!code || code.length !== 6) return code;
    return code.substring(0, 3) + '-' + code.substring(3);
  };

  async function handleUnlink() {
    if (!window.confirm(t('confirmUnlink'))) return;
    try {
      const res = await api.unlinkPC();
      if (res.success) {
        const clearedBridge = { ip: '', port: 8765, token: '' };
        setBridgeConfig(clearedBridge);
        setLocalBridge(clearedBridge);
        
        const configStr = localStorage.getItem('synced-config');
        if (configStr) {
          try {
            const parsed = JSON.parse(configStr);
            parsed.bridge = clearedBridge;
            localStorage.setItem('synced-config', JSON.stringify(parsed));
          } catch (e) {
            console.error('Failed to update localStorage after unlink:', e);
          }
        }
        alert(t('unlinkSuccess'));
      } else {
        alert('Failed to unlink: ' + (res.error || 'Unknown error'));
      }
    } catch (e) {
      alert('Error unlinking PC: ' + e.message);
    }
  }

  async function handleGenerateSyncCode() {
    try {
      const code = await api.generateSyncCode(licenseKey);
      if (code) {
        setGeneratedCode(code);
      } else {
        alert(t('generateCodeFailed'));
      }
    } catch (e) {
      alert('Error generating Sync Code: ' + e.message);
    }
  }

  async function handleEnableLocalBridge() {
    setEnablingBridge(true);
    setEnableBridgeResult(null);
    try {
      const res = await api.enableLocalBridge(localBridge.port || 8765);
      if (res.success) {
        setEnableBridgeResult('success');
        setLocalBridgeEnabled(true);
      } else {
        setEnableBridgeResult('failed');
      }
    } catch (e) {
      console.error('Failed to enable local bridge:', e);
      setEnableBridgeResult('failed');
    } finally {
      setEnablingBridge(false);
    }
  }

  async function handleManualUpdateCheck() {
    setCheckingUpdate(true);
    setUpdateStatus(null);
    try {
      const res = await api.checkUpdate();
      if (res?.updateAvailable) {
        setUpdateStatus({
          type: 'success',
          text: `Update available: v${res.latestVersion}! Restart Synced or click update prompt.`
        });
      } else if (res?.error) {
        setUpdateStatus({
          type: 'danger',
          text: `Check failed: ${res.error}`
        });
      } else {
        setUpdateStatus({
          type: 'info',
          text: 'Synced is up to date.'
        });
      }
    } catch (e) {
      setUpdateStatus({
        type: 'danger',
        text: `Error: ${e.message}`
      });
    } finally {
      setCheckingUpdate(false);
    }
  }

  return (
    <div className="settings-grid animate-slide-up" style={{ position: 'relative', minHeight: 'calc(100vh - var(--header-height) - 40px)' }}>
      {/* Undo Keyframes Styling */}
      <style>{`
        @keyframes fadeInUp {
          from {
            opacity: 0;
            transform: translate(-50%, 20px);
          }
          to {
            opacity: 1;
            transform: translate(-50%, 0);
          }
        }
      `}</style>

      <div className="page-header">
        <h1 className="page-title">{t('settings')}</h1>
        <p className="page-subtitle">{t('settingsSubtitle')}</p>
      </div>

      {/* Language Section */}
      {matchesQuery(t('settings')) && matchesQuery('Language / Langue') && (
        <div className="glass-card settings-section">
          <h2 className="settings-section-title">🌐 Language / Langue</h2>
          <p className="settings-section-desc">Select your preferred user interface language / Choisissez votre langue</p>
          
          <div style={{ marginTop: 16 }}>
            <div className="input-group" style={{ maxWidth: 300 }}>
              <select
                className="input"
                value={language}
                onChange={(e) => {
                  const val = e.target.value;
                  handleSettingChange(() => {
                    setLanguage(val);
                    saveAllSettings(theme, localBridge, aiEndpoint, selectedModel, customization, githubToken, val);
                  });
                }}
              >
                <option value="en">English</option>
                <option value="fr">Français</option>
                <option value="ru">Русский</option>
                <option value="de">Deutsch</option>
                <option value="it">Italiano</option>
                <option value="es">Español</option>
                <option value="pt">Português</option>
                <option value="zh">中文</option>
                <option value="ja">日本語</option>
              </select>
            </div>
          </div>
        </div>
      )}

      {/* Theme Section */}
      {matchesQuery(t('themeSwatches')) && (
        <div className="glass-card settings-section">
          <h2 className="settings-section-title">🎨 {t('themeSwatches')}</h2>
          <p className="settings-section-desc">{t('themeDesc')}</p>
          <div className="themes-grid">
            {THEMES.map((themeItem) => (
              <div
                key={themeItem.id}
                className={`theme-card ${theme === themeItem.id ? 'active' : ''}`}
                onClick={() => handleSettingChange(() => handleThemeChange(themeItem.id))}
                style={{ cursor: 'pointer' }}
              >
                <div
                  className="theme-preview"
                  style={{
                    background: `linear-gradient(135deg, ${themeItem.colors[0]}, ${themeItem.colors[1]}, ${themeItem.colors[2]}, ${themeItem.colors[3]})`,
                    border: '1px solid var(--border-color)',
                  }}
                />
                <div className="theme-name">
                  {themeItem.emoji} {themeItem.name}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Startup & System Controls */}
      {matchesQuery(t('startupControl')) && (
        <div className="glass-card settings-section">
          <h2 className="settings-section-title">⚙️ {t('startupControl')}</h2>
          <p className="settings-section-desc">{t('startupDesc')}</p>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', borderBottom: '1px solid var(--border-color)' }}>
              <div>
                <h4 style={{ margin: 0, color: 'var(--text-primary)' }}>{t('launchBoot')}</h4>
                <p style={{ margin: '4px 0 0 0', fontSize: 12, color: 'var(--text-muted)' }}>{t('launchBootDesc')}</p>
              </div>
              <label className="switch" style={{ position: 'relative', display: 'inline-block', width: 46, height: 24 }}>
                <input 
                  type="checkbox" 
                  checked={launchAtStartup} 
                  onChange={(e) => {
                    const checked = e.target.checked;
                    handleSettingChange(() => handleStartupToggle(checked));
                  }}
                  style={{ opacity: 0, width: 0, height: 0 }}
                />
                <span className="sliderround" style={{
                  position: 'absolute', cursor: 'pointer', top: 0, left: 0, right: 0, bottom: 0,
                  backgroundColor: launchAtStartup ? 'var(--accent-primary)' : '#3f3f46',
                  transition: '.3s', borderRadius: 34
                }}>
                  <span style={{
                    position: 'absolute', content: '""', height: 16, width: 16, left: launchAtStartup ? 26 : 4, bottom: 4,
                    backgroundColor: 'white', transition: '.3s', borderRadius: '50%'
                  }} />
                </span>
              </label>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0' }}>
              <div>
                <h4 style={{ margin: 0, color: 'var(--text-primary)' }}>{t('startBridgeLogin')} {bridgeOnline ? bridgeHostname : t('secondaryPC')}</h4>
                <p style={{ margin: '4px 0 0 0', fontSize: 12, color: 'var(--text-muted)' }}>{t('startBridgeDesc')}</p>
              </div>
              <label className="switch" style={{ position: 'relative', display: 'inline-block', width: 46, height: 24 }}>
                <input 
                  type="checkbox" 
                  checked={bridgeStartup} 
                  onChange={(e) => {
                    const checked = e.target.checked;
                    handleSettingChange(() => handleBridgeStartupToggle(checked));
                  }}
                  style={{ opacity: 0, width: 0, height: 0 }}
                />
                <span className="sliderround" style={{
                  position: 'absolute', cursor: 'pointer', top: 0, left: 0, right: 0, bottom: 0,
                  backgroundColor: bridgeStartup ? 'var(--primary)' : '#3f3f46',
                  transition: '.3s', borderRadius: 34
                }}>
                  <span style={{
                    position: 'absolute', content: '""', height: 16, width: 16, left: bridgeStartup ? 26 : 4, bottom: 4,
                    backgroundColor: 'white', transition: '.3s', borderRadius: '50%'
                  }} />
                </span>
              </label>
            </div>
          </div>
        </div>
      )}



      {/* PC Cross-Linking Section */}
      {matchesQuery(t('crossLinking')) && (
        <>
          {bridgeConfig?.ip ? (
            <div className="glass-card settings-section">
              <h2 className="settings-section-title">🔗 {t('crossLinking')}</h2>
              <p className="settings-section-desc">{t('crossLinkingDesc')}</p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px', background: 'rgba(34, 197, 94, 0.1)', border: '1px solid rgba(34, 197, 94, 0.2)', borderRadius: 8 }}>
                  <span style={{ fontSize: 24, color: '#22c55e' }}>✓</span>
                  <div>
                    <h4 style={{ margin: 0, color: 'var(--text-primary)' }}>{t('linkedSuccess')}</h4>
                    <p style={{ margin: '4px 0 0 0', fontSize: 12, color: 'var(--text-muted)' }}>
                      {t('linkedDesc')}
                    </p>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, padding: '16px 0', borderBottom: '1px solid var(--border-color)', borderTop: '1px solid var(--border-color)' }}>
                  <div className="spec-item" style={{ border: 'none', padding: 0 }}>
                    <span className="spec-label">{t('linkedIP')}</span>
                    <span className="spec-value text-mono">{bridgeConfig.ip}</span>
                  </div>
                  <div className="spec-item" style={{ border: 'none', padding: 0 }}>
                    <span className="spec-label">{t('port')}</span>
                    <span className="spec-value text-mono">{bridgeConfig.port}</span>
                  </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
                  <button 
                    className="btn" 
                    onClick={handleUnlink}
                    style={{
                      backgroundColor: 'rgba(239, 68, 68, 0.1)',
                      color: '#f87171',
                      border: '1px solid rgba(239, 68, 68, 0.3)'
                    }}
                  >
                    🔗 {t('unlink')}
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="glass-card settings-section">
              <h2 className="settings-section-title">🔗 {t('crossLinking')}</h2>
              <p className="settings-section-desc">{t('crossLinkingDesc')}</p>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, marginTop: 16 }}>
                {/* Column 1: Enable Local Bridge */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 16, background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border-color)', borderRadius: 8 }}>
                  <h3 style={{ margin: 0, fontSize: 16, color: 'var(--text-primary)' }}>{t('linkIncoming')}</h3>
                  <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.4 }}>
                    {t('linkIncomingDesc')}
                  </p>
                  <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span className={`status-dot ${localBridgeEnabled ? 'online' : 'offline'}`} style={{ width: 8, height: 8 }}></span>
                      <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                        {localBridgeEnabled ? t('bridgeActive') : t('bridgeInactive')}
                      </span>
                    </div>
                    <button 
                      className="btn btn-secondary" 
                      onClick={handleEnableLocalBridge}
                      disabled={enablingBridge}
                      style={{ width: '100%' }}
                    >
                      {enablingBridge ? t('enabling') : t('enableRemote')}
                    </button>
                    {enableBridgeResult === 'success' && (
                      <span className="badge badge-success" style={{ textAlign: 'center' }}>✓ {t('bridgeEnabledSuccess')}</span>
                    )}
                    {enableBridgeResult === 'failed' && (
                      <span className="badge badge-danger" style={{ textAlign: 'center' }}>✕ {t('bridgeEnabledFailed')}</span>
                    )}
                  </div>
                </div>

                {/* Column 2: Generate Sync Code */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 16, background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border-color)', borderRadius: 8 }}>
                  <h3 style={{ margin: 0, fontSize: 16, color: 'var(--text-primary)' }}>{t('pairSecondary')}</h3>
                  <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.4 }}>
                    {t('pairSecondaryDesc')}
                  </p>
                  
                  {generatedCode ? (
                    <div style={{ textAlign: 'center', padding: '12px', background: 'rgba(168, 85, 247, 0.1)', border: '1px dashed var(--primary)', borderRadius: 8, margin: '10px 0' }}>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>{t('yourSyncCode')}</div>
                      <div className="text-mono" style={{ fontSize: 28, fontWeight: 700, letterSpacing: 4, color: 'var(--primary)' }}>
                        {formatCode(generatedCode)}
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>{t('waitingHandshake')}</div>
                    </div>
                  ) : (
                    <div style={{ flexGrow: 1 }} />
                  )}

                  <button 
                    className="btn btn-primary" 
                    onClick={handleGenerateSyncCode}
                    style={{ width: '100%', marginTop: 'auto' }}
                  >
                    🔑 {t('generateCode')}
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* Bridge Connection Section */}
      {matchesQuery(t('bridgeConnection')) && (
        <div className="glass-card settings-section">
          <h2 className="settings-section-title">🌉 {t('bridgeConnection')}</h2>
          <p className="settings-section-desc">Connect and sync settings with your secondary PC.</p>

          {/* Connection Status Card */}
          <div 
            style={{ 
              display: 'flex', 
              alignItems: 'center', 
              gap: 16, 
              padding: 16, 
              background: bridgeOnline ? 'rgba(34, 197, 94, 0.08)' : 'rgba(239, 68, 68, 0.08)', 
              border: `1px solid ${bridgeOnline ? 'rgba(34, 197, 94, 0.2)' : 'rgba(239, 68, 68, 0.2)'}`, 
              borderRadius: 8,
              marginBottom: 20 
            }}
          >
            <span style={{ fontSize: 24 }}>{bridgeOnline ? '🔗' : '⚠️'}</span>
            <div style={{ flex: 1 }}>
              <h4 style={{ margin: 0, color: 'var(--text-primary)', fontWeight: 600 }}>
                {bridgeOnline ? `Connected to ${bridgeHostname}` : 'Disconnected'}
              </h4>
              <p style={{ margin: '2px 0 0 0', fontSize: 12, color: 'var(--text-secondary)' }}>
                {bridgeOnline 
                  ? `Active bridge connection on ${localBridge.ip || 'configured address'}`
                  : 'Establish a link to manage processes, transfer files, and execute scripts.'}
              </p>
            </div>
            <span className={`badge ${bridgeOnline ? 'badge-success' : 'badge-danger'}`}>
              {bridgeOnline ? 'Online' : 'Offline'}
            </span>
          </div>

          {/* Setup Guide */}
          <div style={{ marginBottom: 20, padding: 14, background: 'rgba(255, 255, 255, 0.01)', border: '1px solid var(--border-color)', borderRadius: 8 }}>
            <h4 style={{ margin: '0 0 8px 0', fontSize: 13, color: 'var(--text-primary)', fontWeight: 600 }}>{t('howToLinkTitle')}</h4>
            <ol style={{ margin: 0, paddingLeft: 16, fontSize: 12, color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', gap: 6 }}>
              <li>{language === 'fr' ? <>Assurez-vous que <strong>Synced</strong> est lancé sur les deux PC et connecté au même réseau local.</> : <>Ensure <strong>Synced</strong> is running on both PCs and connected to the same local network.</>}</li>
              <li>{t('linkStep2')}</li>
              <li>{t('linkStep3')}</li>
            </ol>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="input-group">
              <label className="input-label">{t('secondaryIpAddress')}</label>
              <input
                type="text"
                className="input"
                value={localBridge.ip}
                onChange={(e) => setLocalBridge((p) => ({ ...p, ip: e.target.value }))}
                placeholder="e.g. 192.168.1.75"
                style={{ maxWidth: 350 }}
              />
            </div>

            {/* Advanced Settings Accordion Toggle */}
            <div style={{ margin: '8px 0' }}>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setShowAdvancedBridge(!showAdvancedBridge)}
                style={{ padding: '6px 12px', fontSize: 11, fontWeight: 600 }}
              >
                ⚙️ {showAdvancedBridge ? t('hideAdvancedSettingsTitle') : t('advancedSettingsTitle')}
              </button>

              {showAdvancedBridge && (
                <div 
                  className="glass-card animate-slide-up" 
                  style={{ 
                    padding: 16, 
                    marginTop: 12, 
                    display: 'grid', 
                    gridTemplateColumns: '1fr 2fr', 
                    gap: 16, 
                    background: 'rgba(0,0,0,0.1)',
                    border: '1px solid var(--border-color)'
                  }}
                >
                  <div className="input-group">
                    <label className="input-label">Port</label>
                    <input
                      type="number"
                      className="input"
                      value={localBridge.port}
                      onChange={(e) => setLocalBridge((p) => ({ ...p, port: parseInt(e.target.value) || 8765 }))}
                      placeholder="8765"
                    />
                  </div>
                  <div className="input-group">
                    <label className="input-label">{t('authSecurityToken')}</label>
                    <input
                      type="password"
                      className="input"
                      value={localBridge.token}
                      onChange={(e) => setLocalBridge((p) => ({ ...p, token: e.target.value }))}
                      placeholder="Enter bridge connection token"
                    />
                  </div>
                </div>
              )}
            </div>

            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginTop: 8 }}>
              <button className="btn btn-primary" onClick={() => handleSettingChange(() => saveBridgeConfig())} style={{ fontWeight: 600 }}>
                💾 {t('saveConnection')}
              </button>
              <button className="btn btn-secondary" onClick={testConnection} style={{ fontWeight: 600 }}>
                {testResult === 'testing' ? `⏳ ${t('connecting')}` : `🔌 ${t('testLink')}`}
              </button>
              <button className="btn btn-secondary" onClick={scanNetwork} disabled={scanning} style={{ fontWeight: 600 }}>
                {scanning ? `📡 ${t('scanning')}...` : `📡 ${t('scanNetwork')}`}
              </button>

              {testResult === 'success' && (
                <span className="badge badge-success animate-fade-in">✓ Connected</span>
              )}
              {testResult === 'failed' && (
                <span className="badge badge-danger animate-fade-in">✕ Connection Failed</span>
              )}
              {testResult === 'found' && (
                <span className="badge badge-success animate-fade-in">✓ Secondary PC Found</span>
              )}
              {testResult === 'notfound' && (
                <span className="badge badge-warning animate-fade-in">No PC Found</span>
              )}
              {testResult === 'saved' && (
                <span className="badge badge-success animate-fade-in">✓ Connection Saved</span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* AI Assistant Section */}
      {matchesQuery(t('aiAssistant')) && (
        <div className="glass-card settings-section">
          <h2 className="settings-section-title">🤖 {t('aiAssistant')}</h2>
          <p className="settings-section-desc">{t('aiSubtitle')}</p>

          <div className="settings-row">
            <div className="input-group">
              <label className="input-label">{t('selectModel')}</label>
              <select
                className="input"
                value={selectedModel}
                onChange={(e) => {
                  const modelVal = e.target.value;
                  handleSettingChange(() => {
                    setSelectedModel(modelVal);
                    saveAllSettings(theme, localBridge, aiEndpoint, modelVal);
                  });
                }}
              >
                {availableModels.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
                {availableModels.length === 0 && (
                  <option value={selectedModel}>{selectedModel}</option>
                )}
              </select>
            </div>
            
            <div className="input-group">
              <label className="input-label">{t('ollamaHost')}</label>
              <input
                type="text"
                className="input"
                value={aiEndpoint}
                onChange={(e) => {
                  const endpointVal = e.target.value;
                  handleSettingChange(() => {
                    setAiEndpoint(endpointVal);
                    saveAllSettings(theme, localBridge, endpointVal, selectedModel);
                  });
                }}
                placeholder="http://localhost:11434"
              />
            </div>
          </div>

          <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 12 }}>
            <button className="btn btn-secondary" onClick={checkAIStatus}>
              🧪 {t('testFetchModels')}
            </button>
            {aiStatus && (
              <span
                className={`badge ${aiStatus.status === 'online' ? 'badge-success' : 'badge-danger'} animate-fade-in`}
              >
                {aiStatus.status === 'online' ? (
                  <>
                    <span className="status-dot online" style={{ width: 6, height: 6 }}></span>
                    {t('aiStatusOnline')} • {availableModels.length} Models Found
                  </>
                ) : (
                  <>
                    <span className="status-dot offline" style={{ width: 6, height: 6 }}></span>
                    {t('aiStatusOffline')}
                  </>
                )}
              </span>
            )}
          </div>
        </div>
      )}

      {/* GitHub Update Token */}
      {matchesQuery(t('githubUpdater')) && (
        <div className="glass-card settings-section">
          <h2 className="settings-section-title">🚀 {t('githubUpdater')}</h2>
          <p className="settings-section-desc">{t('githubUpdaterDesc')}</p>

          <div className="input-group" style={{ marginTop: 16 }}>
            <label className="input-label">{t('githubPat')}</label>
            <input
              type="password"
              className="input"
              value={githubToken}
              onChange={(e) => {
                const tokenVal = e.target.value;
                handleSettingChange(() => handleGithubTokenChange(tokenVal));
              }}
              placeholder="ghp_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
            />
            <p style={{ margin: '6px 0 0 0', fontSize: 11, color: 'var(--text-muted)' }}>
              {t('githubHint')}
            </p>
          </div>
        </div>
      )}

      {/* Application Updates Section */}
      {matchesQuery(t('appUpdates')) && (
        <div className="glass-card settings-section">
          <h2 className="settings-section-title">🚀 {t('appUpdates')}</h2>
          <p className="settings-section-desc">{t('appUpdatesDesc')}</p>

          <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 16, flexWrap: 'wrap' }}>
            <button 
              className="btn btn-primary" 
              onClick={handleManualUpdateCheck}
              disabled={checkingUpdate}
            >
              {checkingUpdate ? `⏳ ${t('checkingUpdates')}` : `🔄 ${t('checkUpdatesBtn')}`}
            </button>
            
            {updateStatus && (
              <span className={`badge badge-${updateStatus.type} animate-fade-in`}>
                {updateStatus.text}
              </span>
            )}
          </div>
        </div>
      )}

      {/* About Section */}
      {matchesQuery('About') && (
        <div className="glass-card settings-section">
          <h2 className="settings-section-title">ℹ️ {language === 'fr' ? 'À propos' : 'About'}</h2>
          <p className="settings-section-desc">{t('appDetails')}</p>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div className="spec-item">
              <span className="spec-label">Application</span>
              <span className="spec-value gradient-text" style={{ fontWeight: 700, fontSize: 16 }}>
                {APP_NAME}
              </span>
            </div>
            <div className="spec-item">
              <span className="spec-label">Version</span>
              <span className="spec-value">{APP_VERSION}</span>
            </div>
            <div className="spec-item">
              <span className="spec-label">{t('licenseStatus')}</span>
              <span className="spec-value">{t('licenseStatusVal')}</span>
            </div>
            <div className="spec-item">
              <span className="spec-label">{t('platform')}</span>
              <span className="spec-value">Electron + React + PowerShell</span>
            </div>
          </div>
        </div>
      )}

      {/* Floating Revert (Undo) Banner */}
      {undoState && (
        <div 
          style={{
            position: 'fixed',
            bottom: '24px',
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'rgba(12, 12, 24, 0.95)',
            border: '1px solid var(--primary)',
            boxShadow: '0 0 30px rgba(168, 85, 247, 0.3)',
            borderRadius: '12px',
            padding: '16px 24px',
            display: 'flex',
            alignItems: 'center',
            gap: '16px',
            zIndex: 10000,
            backdropFilter: 'blur(10px)',
            animation: 'fadeInUp 0.3s ease-out'
          }}
        >
          <span style={{ fontSize: '18px' }}>🔄</span>
          <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)' }}>
            {language === 'fr' 
              ? `Paramètres modifiés. Annuler ? (${undoState.secondsLeft}s)` 
              : `Settings changed. Undo? (${undoState.secondsLeft}s)`}
          </span>
          <button 
            className="btn btn-primary btn-sm" 
            onClick={handleUndo}
            style={{ padding: '6px 16px', borderRadius: '6px' }}
          >
            {language === 'fr' ? 'Annuler' : 'Undo'}
          </button>
        </div>
      )}
    </div>
  );
}
