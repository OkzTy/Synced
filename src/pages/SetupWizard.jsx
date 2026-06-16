import React, { useState, useEffect } from 'react';
import { api } from '../utils/api';
import { translations } from '../utils/translations';
import { THEMES, setTheme as applyTheme } from '../utils/themes';

const STEPS = [
  { id: 'selector', title: 'Choose Mode', icon: '👋' },
  { id: 'security', title: 'Security', icon: '🔒' },
  { id: 'license', title: 'License Key', icon: '🔑' },
  { id: 'complete', title: 'Complete', icon: '✅' },
];

export default function SetupWizard({ onComplete, language, setLanguage, theme, setTheme }) {
  const t = (key) => translations[language]?.[key] || translations['en']?.[key] || key;
  
  const stepsLocalized = [
    { id: 'selector', title: language === 'fr' ? 'Sélecteur' : 'Select Mode', icon: '👋' },
    { id: 'security', title: t('accountCreationTitle'), icon: '🔒' },
    { id: 'license', title: t('setupLicenseTitle'), icon: '🔑' },
    { id: 'complete', title: t('setupCompleteTitle'), icon: '✅' },
  ];

  const [step, setStep] = useState(() => {
    const saved = localStorage.getItem('onboarding-step');
    return saved ? parseInt(saved, 10) : 0;
  });
  const [licenseKey, setLicenseKey] = useState(() => localStorage.getItem('onboarding-licenseKey') || '');
  const [licenseError, setLicenseError] = useState('');
  const [licenseValid, setLicenseValid] = useState(() => !!localStorage.getItem('onboarding-licenseKey'));
  const [licenseInfo, setLicenseInfo] = useState(() => {
    const key = localStorage.getItem('onboarding-licenseKey');
    if (key) {
      return {
        key: key,
        type: key.includes('LIFE') ? 'LIFETIME' : 'WEEK',
        isLifetime: key.includes('LIFE'),
      };
    }
    return null;
  });

  // Onboarding Mode states
  const [onboardingMode, setOnboardingMode] = useState(() => localStorage.getItem('onboarding-mode') || ''); // '', 'register', 'login'
  const [loginUsername, setLoginUsername] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [rememberMe, setRememberMe] = useState(() => localStorage.getItem('synced-remember-me') !== 'false');

  // Discord auth state
  const [discordLoading, setDiscordLoading] = useState(false);

  // Linking options
  const [linkingMode, setLinkingMode] = useState(false);
  const [syncCode, setSyncCode] = useState('');
  const [mainPcIP, setMainPcIP] = useState('');
  const [linkError, setLinkError] = useState('');
  const [linking, setLinking] = useState(false);
  const [scanning, setScanning] = useState(false);

  // Bypass Setup
  const [showBypass, setShowBypass] = useState(false);
  const [bypassIP, setBypassIP] = useState('');
  const [bypassPort, setBypassPort] = useState(8765);
  const [bypassToken, setBypassToken] = useState('');

  // Component selection
  const [installOllama, setInstallOllama] = useState(() => localStorage.getItem('onboarding-installOllama') !== 'false');
  const [installBridge, setInstallBridge] = useState(() => localStorage.getItem('onboarding-installBridge') !== 'false');

  // AI installation
  const [aiStep, setAiStep] = useState('idle'); // idle, checking, installing, pulling, done, error
  const [aiMessage, setAiMessage] = useState('');
  const [pullPercent, setPullPercent] = useState(0);

  // Bridge
  const [bridgeIP, setBridgeIP] = useState('');
  const [bridgePort, setBridgePort] = useState(8765);
  const [bridgeToken, setBridgeToken] = useState('');
  const [bridgeCommand, setBridgeCommand] = useState('');
  const [localIP, setLocalIP] = useState('192.168.1.X');
  const [copied, setCopied] = useState(false);

  // Connection test
  const [connectionStatus, setConnectionStatus] = useState('idle'); // idle, scanning, found, manual, testing, connected, failed
  const [foundDevices, setFoundDevices] = useState([]);

  // Security & Account
  const [securitySubStep, setSecuritySubStep] = useState(() => localStorage.getItem('onboarding-securitySubStep') || 'account'); // 'account' or 'pin'
  const [username, setUsername] = useState(() => localStorage.getItem('onboarding-username') || '');
  const [password, setPassword] = useState(() => localStorage.getItem('onboarding-password') || '');
  const [passwordConfirm, setPasswordConfirm] = useState(() => localStorage.getItem('onboarding-password') || '');
  const [pin, setPin] = useState(() => localStorage.getItem('onboarding-pin') || '');
  const [pinConfirm, setPinConfirm] = useState(() => localStorage.getItem('onboarding-pin') || '');
  const [pinError, setPinError] = useState('');

  useEffect(() => {
    // Get local IP for bridge command
    fetchLocalIP();

    // Listen to model pull progress from Ollama
    const unsubscribe = api.onPullProgress?.((progress) => {
      const match = progress.match(/([0-9.]+)%/);
      if (match) {
        const percent = parseFloat(match[1]);
        setAiMessage(`Downloading model: ${percent}%`);
        setPullPercent(percent);
      } else {
        setAiMessage(progress.trim());
      }
    });

    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, []);

  // Persist onboarding state variables
  useEffect(() => {
    if (step > 0) {
      localStorage.setItem('onboarding-step', step.toString());
    } else {
      localStorage.removeItem('onboarding-step');
    }
  }, [step]);

  useEffect(() => {
    if (onboardingMode) {
      localStorage.setItem('onboarding-mode', onboardingMode);
    } else {
      localStorage.removeItem('onboarding-mode');
    }
  }, [onboardingMode]);

  useEffect(() => {
    if (securitySubStep) {
      localStorage.setItem('onboarding-securitySubStep', securitySubStep);
    } else {
      localStorage.removeItem('onboarding-securitySubStep');
    }
  }, [securitySubStep]);

  useEffect(() => {
    if (username) localStorage.setItem('onboarding-username', username);
    else localStorage.removeItem('onboarding-username');

    if (password) localStorage.setItem('onboarding-password', password);
    else localStorage.removeItem('onboarding-password');

    if (pin) localStorage.setItem('onboarding-pin', pin);
    else localStorage.removeItem('onboarding-pin');

    if (licenseKey) {
      localStorage.setItem('onboarding-licenseKey', licenseKey);
    } else {
      localStorage.removeItem('onboarding-licenseKey');
    }
  }, [username, password, pin, licenseKey]);

  useEffect(() => {
    localStorage.setItem('onboarding-installOllama', installOllama ? 'true' : 'false');
    localStorage.setItem('onboarding-installBridge', installBridge ? 'true' : 'false');
  }, [installOllama, installBridge]);

  useEffect(() => {
    let active = true;
    const unsubscribe = api.onSettingsUpdated?.((settings) => {
      if (!active) return;
      if (step === 7 && settings?.bridge) {
        setBridgeIP(settings.bridge.ip || '');
        setBridgePort(settings.bridge.port || 8765);
        setBridgeToken(settings.bridge.token || '');
        setConnectionStatus('connected');
        setTimeout(() => {
          if (active) setStep(3);
        }, 2000);
      }
    });
    return () => {
      active = false;
      if (unsubscribe) unsubscribe();
    };
  }, [step]);

  async function fetchLocalIP() {
    try {
      const result = await api.getLocalIP();
      const machineInfo = await api.getMachineInfo();
      const host = machineInfo?.hostname || result?.ip || 'localhost';
      if (result?.success && result.ip) {
        setLocalIP(result.ip);
      }
      setBridgeCommand(`irm "http://${host}:9876/install" | iex`);
    } catch {
      setBridgeCommand(`irm "http://localhost:9876/install" | iex`);
    }
  }

  // ---- License Validation ----
  async function validateLicense() {
    if (!licenseKey.trim()) {
      setLicenseError('Please enter a license key');
      return;
    }
    setLicenseError('');

    // In dev mode, accept any SYNC- key format
    if (licenseKey.startsWith('SYNC-') && licenseKey.length >= 16) {
      setLicenseValid(true);
      setLicenseInfo({
        key: licenseKey,
        type: licenseKey.includes('LIFE') ? 'LIFETIME' : 'WEEK',
        isLifetime: licenseKey.includes('LIFE'),
      });
      setTimeout(() => setStep(3), 600);
      return;
    }

    // Try actual validation via Electron
    try {
      const result = await api.validateLicense?.(licenseKey);
      if (result?.valid) {
        setLicenseValid(true);
        setLicenseInfo(result);
        setTimeout(() => setStep(3), 600);
      } else {
        setLicenseError(result?.error || 'Invalid license key');
      }
    } catch {
      setLicenseError('Could not validate. Check your connection.');
    }
  }

  async function scanForMainPC() {
    setScanning(true);
    setLinkError('');
    try {
      const result = await api.scanNetwork();
      if (result?.data?.found?.length > 0) {
        const first = result.data.found[0];
        setMainPcIP(first.ip);
      } else {
        setLinkError('No Synced instances found on local network. Enter IP manually.');
      }
    } catch (e) {
      setLinkError('Scan failed: ' + e.message);
    } finally {
      setScanning(false);
    }
  }

  async function linkWithMainPC() {
    if (!syncCode.trim()) {
      setLinkError('Please enter a Sync Code');
      return;
    }
    if (!mainPcIP.trim()) {
      setLinkError('Please enter the Main PC IP Address');
      return;
    }
    setLinkError('');
    setLinking(true);

    try {
      // 1. Enable local bridge silently on this PC (so the Main PC can manage it)
      setAiMessage('Configuring local bridge service...');
      const localBridgeRes = await api.enableLocalBridge(8765);
      if (!localBridgeRes.success) {
        setLinkError('Failed to configure local bridge: ' + localBridgeRes.error);
        setLinking(false);
        return;
      }

      // 2. Fetch our own local bridge details (IP and Token) to send to the Main PC
      const localIPRes = await api.getLocalIP();
      const localIPAddr = localIPRes.ip || '127.0.0.1';
      const localBridgeDetails = await api.getLocalBridgeDetails();
      
      const payload = {
        code: syncCode.trim(),
        bridge: {
          ip: localIPAddr,
          port: localBridgeDetails.port || 8765,
          token: localBridgeDetails.token || ''
        }
      };

      // 3. Make HTTP request to Main PC to perform configuration handshake
      setAiMessage('Exchanging connection keys...');
      const response = await fetch(`http://${mainPcIP.trim()}:9876/api/link/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        setLinkError(errData.error || `Server returned status ${response.status}`);
        setLinking(false);
        return;
      }

      const result = await response.json();
      if (result.success && result.licenseKey && result.bridge) {
        // Save main PC config to local storage
        const config = {
          licenseKey: result.licenseKey,
          bridge: result.bridge, // Main PC's bridge details so we can connect back
          setupComplete: true
        };
        
        localStorage.setItem('synced-setup-complete', 'true');
        localStorage.setItem('synced-config', JSON.stringify(config));
        
        // Save settings.json natively
        await api.saveSettings?.({
          theme: 'dark',
          bridge: result.bridge,
          ai: { model: 'dolphin-llama3', endpoint: 'http://localhost:11434' },
          setupComplete: true
        });
        
        // Complete setup!
        onComplete(config);
      } else {
        setLinkError('Failed to complete link. Verify code or IP.');
        setLinking(false);
      }
    } catch (e) {
      setLinkError('Handshake failed: ' + e.message);
      setLinking(false);
    }
  }

  // ---- AI Installation ----
  async function installAI() {
    setAiStep('checking');
    setAiMessage('Checking Ollama status...');
    await delay(1000);

    try {
      const status = await api.checkOllama();
      
      if (status.installed) {
        if (!status.running) {
          setAiMessage('Ollama is installed but not running. Starting Ollama service...');
          await api.startOllama();
          await delay(4000);
          
          const status2 = await api.checkOllama();
          if (!status2.running) {
            setAiStep('error');
            setAiMessage('Ollama service failed to start automatically. Please launch Ollama manually and click Try Again.');
            return;
          }
        }
        
        setAiMessage('Ollama is running! Checking for AI models...');
        await delay(1000);
        
        const aiStatus = await api.getAIStatus();
        if (aiStatus?.data?.modelInstalled) {
          setAiMessage('AI model dolphin-llama3 is already installed! ✓');
          setAiStep('done');
          return;
        } else {
          const hasAnyDolphin = aiStatus?.data?.availableModels?.some(m => m.includes('dolphin'));
          if (hasAnyDolphin) {
            setAiMessage(`Found matching Dolphin model: ${aiStatus.data.model}! ✓`);
            setAiStep('done');
            return;
          }
          
          setAiStep('pulling');
          setAiMessage('Downloading dolphin-llama3 model...');
          setPullPercent(0);
          
          const pullResult = await api.pullModel('dolphin-llama3');
          if (pullResult.success) {
            setAiMessage('AI Model downloaded successfully! ✓');
            setAiStep('done');
          } else {
            setAiStep('error');
            setAiMessage(`Failed to download model: ${pullResult.error || 'Check internet connection.'}`);
          }
          return;
        }
      } else {
        setAiStep('installing');
        setAiMessage('Ollama is not installed on this PC. Please download and install Ollama, then try again.');
      }
    } catch (e) {
      setAiStep('error');
      setAiMessage(`Error checking Ollama status: ${e.message}`);
    }
  }

  function skipAI() {
    setAiStep('done');
    setAiMessage('AI setup skipped. You can set it up later in Settings.');
  }

  // ---- Connection ----
  async function scanForBridge() {
    setConnectionStatus('scanning');
    await delay(1500);
    try {
      const result = await api.scanNetwork();
      if (result?.data?.found?.length > 0) {
        setFoundDevices(result.data.found);
        const first = result.data.found[0];
        setBridgeIP(first.ip);
        setBridgePort(first.port);
        setConnectionStatus('found');
      } else {
        setConnectionStatus('manual');
      }
    } catch {
      setConnectionStatus('manual');
    }
  }

  async function testBridgeConnection() {
    setConnectionStatus('testing');
    await delay(1000);
    try {
      const result = await api.getBridgeStatus({ ip: bridgeIP, port: bridgePort, token: bridgeToken });
      if (result.success) {
        setConnectionStatus('connected');
      } else {
        setConnectionStatus('failed');
      }
    } catch {
      setConnectionStatus('failed');
    }
  }

  // ---- Security ----
  async function saveAccount() {
    if (!username || typeof username !== 'string' || !username.trim()) {
      setPinError('Username / ID is required');
      return;
    }
    if (!password || typeof password !== 'string' || password.length < 6) {
      setPinError('Password must be at least 6 characters');
      return;
    }
    if (password !== passwordConfirm) {
      setPinError(t('passwordsMismatch') || 'Passwords do not match');
      return;
    }
    setPinError('');

    // Register the user to SQLite database immediately
    if (onboardingMode !== 'login') {
      try {
        const userVal = username || 'Admin';
        const passVal = password || 'admin123';
        const regRes = await api.registerUser(userVal, passVal, '0000', ''); // Default PIN '0000'
        if (regRes && !regRes.success) {
          setPinError(regRes.error || 'Registration failed');
          return;
        }
        
        // Save state immediately to resume on crash
        localStorage.setItem('onboarding-username', userVal);
        localStorage.setItem('onboarding-password', passVal);
        localStorage.setItem('onboarding-pin', '0000');
        localStorage.setItem('onboarding-step', '2');
      } catch (e) {
        console.error('Failed to register user in DB:', e);
        setPinError(e.message || 'Registration failed');
        return;
      }
    }

    setStep(2); // Redirect to license key step
  }

  async function handleLoginSubmit() {
    if (!loginUsername.trim()) {
      setLoginError('Username is required');
      return;
    }
    if (!loginPassword) {
      setLoginError('Password is required');
      return;
    }
    setLoginError('');

    try {
      const res = await api.loginUser(loginUsername, loginPassword);
      if (res && res.success) {
        const s = await api.getSettings(res.username);
        setUsername(res.username);
        setPassword(loginPassword);
        
        if (s) {
          if (s.theme) {
            applyTheme(s.theme);
            setTheme?.(s.theme);
          }
          if (s.language) {
            setLanguage(s.language);
          }
          if (s.bridge) {
            setBridgeIP(s.bridge.ip || '');
            setBridgePort(s.bridge.port || 8765);
            setBridgeToken(s.bridge.token || '');
          }
          if (s.licenseKey) {
            setLicenseKey(s.licenseKey);
            setLicenseValid(true);
            setLicenseInfo({ key: s.licenseKey, type: 'LIFETIME' });
          }
        }
        
        if (rememberMe) {
          localStorage.setItem('synced-username', res.username);
          localStorage.setItem('synced-saved-password', loginPassword);
          localStorage.setItem('synced-remember-me', 'true');
        } else {
          localStorage.removeItem('synced-saved-password');
          localStorage.setItem('synced-remember-me', 'false');
        }
        
        setOnboardingMode('login');
        setStep(3);
      } else {
        let errMsg = res?.error || 'Invalid username or password';
        if (errMsg === 'User not found') {
          errMsg = language === 'fr' 
            ? "Utilisateur non trouvé. Vérifiez votre nom d'utilisateur ou créez un compte." 
            : "User not found. Check your username or register a new account.";
        } else if (errMsg === 'Invalid password') {
          errMsg = language === 'fr' 
            ? "Mot de passe incorrect. Veuillez réessayer." 
            : "Incorrect password. Please try again.";
        }
        setLoginError(errMsg);
      }
    } catch (e) {
      setLoginError('Login failed: ' + e.message);
    }
  }

  function copyCommand() {
    navigator.clipboard?.writeText(bridgeCommand);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function delay(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  async function handleDiscordAuth() {
    setDiscordLoading(true);
    try {
      const result = await api.discordLogin();
      if (result.success) {
        // Discord user info returned — fill in the account fields
        const discordName = result.username || result.globalName || 'DiscordUser';
        setUsername(discordName);
        setPassword(discordName + '_dc');
        setPasswordConfirm(discordName + '_dc');
        setPin('1234');
        setPinConfirm('1234');
        setOnboardingMode('register');
        setSecuritySubStep('pin');
        setStep(1);
        // Save some discord metadata
        localStorage.setItem('synced-discord-linked', 'true');
        localStorage.setItem('synced-discord-avatar', result.avatar || '');
        localStorage.setItem('synced-discord-id', result.discordId || '');
      } else {
        alert(result.error || 'Discord authentication failed.');
      }
    } catch (e) {
      alert('Discord auth error: ' + e.message);
    } finally {
      setDiscordLoading(false);
    }
  }

  async function handleBypass() {
    // Quick bypass - save config with bridge details and launch dashboard
    const config = {
      licenseKey: localStorage.getItem('synced-license-key') || '',
      bridge: { ip: bypassIP || '127.0.0.1', port: bypassPort || 8765, token: bypassToken || '' },
      setupComplete: true,
    };
    localStorage.setItem('synced-setup-complete', 'true');
    localStorage.setItem('synced-config', JSON.stringify(config));
    
    // Clean up onboarding state
    localStorage.removeItem('onboarding-step');
    localStorage.removeItem('onboarding-mode');
    localStorage.removeItem('onboarding-username');
    localStorage.removeItem('onboarding-password');
    localStorage.removeItem('onboarding-pin');
    localStorage.removeItem('onboarding-licenseKey');
    localStorage.removeItem('onboarding-installOllama');
    localStorage.removeItem('onboarding-installBridge');
    localStorage.removeItem('onboarding-securitySubStep');
    
    window.dispatchEvent(new Event('storage'));
    onComplete(config);
  }

  async function handleComplete() {
    const userVal = username || 'Admin';
    const passVal = password || 'admin123';
    const pinVal = pin || '1234';

    // 1. Update user license key in SQLite DB if registering a new account
    if (onboardingMode !== 'login') {
      try {
        if (licenseKey) {
          const updateRes = await api.saveUserProfile(userVal, {
            pfpType: 'initials',
            pfpValue: userVal[0].toUpperCase(),
            newUsername: userVal,
            licenseKey: licenseKey
          });
          if (updateRes && !updateRes.success) {
            console.error('Failed to update license key in DB:', updateRes.error);
          }
        }
      } catch (e) {
        console.error('Failed to update user in DB:', e);
      }
    }

    // Save setup state
    const config = {
      licenseKey: licenseKey,
      bridge: { ip: bridgeIP, port: bridgePort, token: bridgeToken },
      setupComplete: true,
    };
    localStorage.setItem('synced-username', userVal);
    localStorage.setItem('synced-setup-complete', 'true');
    localStorage.setItem('synced-config', JSON.stringify(config));

    // Save profile settings
    const profileData = {
      username: userVal,
      password: passVal,
      pin: pinVal,
      discordLinked: false,
      pfpType: 'initials',
      pfpValue: userVal[0].toUpperCase(),
    };
    localStorage.setItem('synced-profile', JSON.stringify(profileData));

    // Save settings and link with the database record
    await api.saveSettings?.({
      theme: theme || 'dark',
      bridge: { ip: bridgeIP, port: bridgePort, token: bridgeToken },
      ai: { model: 'dolphin-llama3', endpoint: 'http://localhost:11434' },
      profile: profileData,
      customization: {
        glassOpacity: 0.7,
        glassBlur: 16,
        borderRadius: 8,
        glowEffects: true,
        animationSpeed: 0.3,
        terminalFontSize: 14,
      },
    });

    localStorage.removeItem('onboarding-username');
    localStorage.removeItem('onboarding-password');
    localStorage.removeItem('onboarding-pin');
    localStorage.removeItem('onboarding-licenseKey');

    window.dispatchEvent(new Event('storage'));
    onComplete(config);
  }

  const handleMinimize = () => window.synced?.window?.minimize();
  const handleMaximize = () => window.synced?.window?.maximize();
  const handleClose = () => window.synced?.window?.close();

  const currentStep = STEPS[step];

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

      <div className="setup-container">
        {/* Progress bar */}
        <div className="setup-progress">
          {stepsLocalized.map((s, i) => (
            <div
              key={s.id}
              className={`setup-progress-step ${i < step ? 'done' : ''} ${i === step ? 'active' : ''}`}
            >
              <div className="setup-progress-dot">
                {i < step ? '✓' : s.icon}
              </div>
              <span className="setup-progress-label">{s.title}</span>
            </div>
          ))}
          <div className="setup-progress-line">
            <div
              className="setup-progress-fill"
              style={{ width: `${(step / (STEPS.length - 1)) * 100}%` }}
            />
          </div>
        </div>

        {/* Step Content */}
        <div className="setup-content animate-fade-in" key={step}>

          {/* ============ STEP 0: SELECTOR ============ */}
          {step === 0 && (
            linkingMode ? (
              <div className="setup-step-license animate-fade-in">
                <div className="setup-logo-big">
                  <div className="setup-logo-icon-big">S</div>
                  <h1 className="setup-logo-text-big">{t('linkMainTitle')}</h1>
                </div>
                <p className="setup-desc">{t('linkMainDesc')}</p>

                {linking ? (
                  <div style={{ padding: 40, textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
                    <div className="setup-spinner"></div>
                    <p style={{ color: 'var(--text-muted)' }}>{aiMessage}</p>
                  </div>
                ) : (
                  <>
                    <div className="settings-row" style={{ display: 'flex', gap: 12, marginBottom: 12, width: '100%', textAlign: 'left' }}>
                      <div className="input-group" style={{ flex: 1 }}>
                        <label className="input-label">{t('ipAddress')}</label>
                        <input
                          type="text"
                          className="input"
                          value={mainPcIP}
                          onChange={(e) => setMainPcIP(e.target.value)}
                          placeholder="e.g. 192.168.1.XX"
                        />
                      </div>
                      <button 
                        className="btn btn-secondary" 
                        onClick={scanForMainPC}
                        disabled={scanning}
                        style={{ marginTop: 24, padding: '0 16px', fontSize: 13, height: 42 }}
                      >
                        {scanning ? '...' : `📡 ${t('scanNetwork')}`}
                      </button>
                    </div>

                    <div className="input-group" style={{ marginBottom: 16, width: '100%', textAlign: 'left' }}>
                      <label className="input-label">{t('syncCodeLabel')}</label>
                      <input
                        type="text"
                        className="input"
                        value={syncCode}
                        onChange={(e) => setSyncCode(e.target.value.replace(/[^0-9]/g, ''))}
                        placeholder="e.g. 521943"
                        maxLength={6}
                      />
                    </div>

                    {linkError && (
                      <div className="setup-error animate-fade-in" style={{ marginBottom: 16 }}>{linkError}</div>
                    )}

                    <button className="btn btn-primary setup-btn-big" onClick={linkWithMainPC}>
                      🔗 {t('linkHandshakeBtn')}
                    </button>

                    <button 
                      className="btn btn-ghost" 
                      onClick={() => { setLinkingMode(false); setLinkError(''); }}
                      style={{ marginTop: 12, fontSize: 12 }}
                    >
                      ← {t('backLicenseBtn')}
                    </button>
                  </>
                )}
              </div>
            ) : onboardingMode === '' ? (
              <div className="setup-step-license text-center" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
                <div className="setup-logo-big">
                  <div className="setup-logo-icon-big">S</div>
                  <h1 className="setup-logo-text-big">Synced</h1>
                </div>
                <p className="setup-desc" style={{ marginBottom: 20 }}>
                  {language === 'fr' ? 'Choisissez une option pour démarrer' : 'Select an option to get started'}
                </p>
                
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12, width: '100%', maxWidth: 320 }}>
                  <button 
                    className="btn btn-primary setup-btn-big" 
                    onClick={() => { setOnboardingMode('register'); setStep(1); }}
                    style={{ width: '100%', height: 48, fontSize: 15 }}
                  >
                    📝 {language === 'fr' ? 'Créer un compte (S\'enregistrer)' : 'Register New Account'}
                  </button>
                  <button 
                    className="btn btn-secondary setup-btn-big" 
                    onClick={() => { setOnboardingMode('login'); setStep(1); }}
                    style={{ width: '100%', height: 48, fontSize: 15 }}
                  >
                    🔑 {language === 'fr' ? 'Se connecter à un compte existant' : 'Log In to Existing Account'}
                  </button>
                  
                  <div className="setup-divider" style={{ margin: '12px 0' }}>
                    <span>or continue with</span>
                  </div>

                  <button 
                    className="btn btn-primary" 
                    onClick={handleDiscordAuth}
                    disabled={discordLoading}
                    style={{
                      width: '100%', height: 48, fontSize: 15, fontWeight: 600,
                      background: 'linear-gradient(135deg, #5865F2, #4752C4)',
                      color: '#fff', border: 'none',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10
                    }}
                  >
                    {discordLoading ? (
                      <><div className="setup-spinner" style={{ width: 18, height: 18, borderWidth: 2 }}></div> Connecting...</>
                    ) : (
                      <><svg width="22" height="22" viewBox="0 0 127.14 96.36" fill="white"><path d="M107.7,8.07A105.15,105.15,0,0,0,81.47,0a72.06,72.06,0,0,0-3.36,6.83A97.68,97.68,0,0,0,49,6.83,72.37,72.37,0,0,0,45.64,0,105.89,105.89,0,0,0,19.39,8.09C2.79,32.65-1.71,56.6.54,80.21h0A105.73,105.73,0,0,0,32.71,96.36,77.7,77.7,0,0,0,39.6,85.25a68.42,68.42,0,0,1-10.85-5.18c.91-.66,1.8-1.34,2.66-2a75.57,75.57,0,0,0,64.32,0c.87.71,1.76,1.39,2.66,2a68.75,68.75,0,0,1-10.87,5.19,77,77,0,0,0,6.89,11.1A105.25,105.25,0,0,0,126.6,80.22h0C129.24,56.6,122.84,32.65,107.7,8.07ZM42.45,65.69C36.18,65.69,31,60,31,53s5-12.74,11.43-12.74S54,46,53.89,53,48.84,65.69,42.45,65.69Zm42.24,0C78.41,65.69,73.25,60,73.25,53s5-12.74,11.44-12.74C96.23,40.25,101,46,100.88,53,100.88,60,96.23,65.69,84.69,65.69Z"/></svg> Sign up with Discord</>
                    )}
                  </button>
                </div>
              </div>
            ) : null
          )}

          {/* ============ STEP 1: CREDENTIALS ============ */}
          {step === 1 && (
            onboardingMode === 'login' ? (
              <div className="setup-step-license animate-fade-in">
                <div className="setup-logo-big">
                  <div className="setup-logo-icon-big">S</div>
                  <h1 className="setup-logo-text-big">{language === 'fr' ? 'Connexion' : 'Log In'}</h1>
                </div>
                <p className="setup-desc">{language === 'fr' ? 'Connectez-vous à votre compte existant' : 'Log into your existing account'}</p>

                <div className="glass-card" style={{ padding: 24, maxWidth: 360, width: '100%', margin: '0 auto', textAlign: 'left' }}>
                  <div className="input-group" style={{ marginBottom: 16 }}>
                    <label className="input-label">{language === 'fr' ? 'Nom d\'utilisateur' : 'Username'}</label>
                    <input
                      type="text"
                      className="input"
                      value={loginUsername}
                      onChange={(e) => { setLoginUsername(e.target.value); setLoginError(''); }}
                      placeholder="e.g. Audre"
                      autoFocus
                    />
                  </div>
                  <div className="input-group" style={{ marginBottom: 20 }}>
                    <label className="input-label">{language === 'fr' ? 'Mot de passe' : 'Password'}</label>
                    <input
                      type="password"
                      className="input"
                      value={loginPassword}
                      onChange={(e) => { setLoginPassword(e.target.value); setLoginError(''); }}
                      placeholder="••••••••"
                      onKeyDown={(e) => e.key === 'Enter' && handleLoginSubmit()}
                    />
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, userSelect: 'none' }}>
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

                  {loginError && (
                    <div className="setup-error" style={{ marginBottom: 16, marginTop: 0 }}>{loginError}</div>
                  )}

                  <button 
                    className="btn btn-primary" 
                    onClick={handleLoginSubmit}
                    style={{ width: '100%', height: 40, fontWeight: 600 }}
                  >
                    🚀 {language === 'fr' ? 'Se connecter' : 'Log In'}
                  </button>
                </div>

                <button 
                  className="btn btn-ghost" 
                  onClick={() => { setStep(0); setOnboardingMode(''); setLoginError(''); }}
                  style={{ marginTop: 16, fontSize: 12 }}
                >
                  ← {language === 'fr' ? 'Retour' : 'Back'}
                </button>
              </div>
            ) : onboardingMode === 'register' ? (
              <div className="setup-step animate-fade-in">
                <h2 className="setup-title">🔒 {t('accountCreationTitle')}</h2>
                <p className="setup-desc">{t('accountCreationDesc')}</p>

                <div className="glass-card" style={{ padding: 24, maxWidth: 400, margin: '0 auto', textAlign: 'left' }}>
                  <div className="input-group" style={{ marginBottom: 16 }}>
                    <label className="input-label">{t('usernameLabel')}</label>
                    <input
                      type="text"
                      className="input"
                      value={username}
                      onChange={(e) => { setUsername(e.target.value); setPinError(''); }}
                      placeholder={t('usernamePlaceholder')}
                      autoFocus
                    />
                  </div>
                  <div className="input-group" style={{ marginBottom: 16 }}>
                    <label className="input-label">{t('passwordLabel')}</label>
                    <input
                      type="password"
                      className="input"
                      value={password}
                      onChange={(e) => { setPassword(e.target.value); setPinError(''); }}
                      placeholder={t('passwordPlaceholder')}
                    />
                  </div>
                  <div className="input-group" style={{ marginBottom: 20 }}>
                    <label className="input-label">{t('confirmPasswordPlaceholder')}</label>
                    <input
                      type="password"
                      className="input"
                      value={passwordConfirm}
                      onChange={(e) => { setPasswordConfirm(e.target.value); setPinError(''); }}
                      placeholder={t('confirmPasswordPlaceholder')}
                      onKeyDown={(e) => e.key === 'Enter' && saveAccount()}
                    />
                  </div>

                  {pinError && (
                    <div className="setup-error" style={{ marginBottom: 16, marginTop: 0 }}>{pinError}</div>
                  )}

                  <div className="setup-divider" style={{ margin: '16px 0' }}>
                    <span>{t('orEnterManually')}</span>
                  </div>

                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={handleDiscordAuth}
                    disabled={discordLoading}
                    style={{
                      width: '100%',
                      background: 'linear-gradient(135deg, #5865F2, #4752C4)',
                      color: '#fff',
                      border: 'none',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 8,
                      fontWeight: 600,
                      height: 40
                    }}
                  >
                    {discordLoading ? (
                      <><div className="setup-spinner" style={{ width: 16, height: 16, borderWidth: 2 }}></div> Connecting...</>
                    ) : (
                      <><span>👾</span> {t('discordPlaceholderBtn')}</>
                    )}
                  </button>
                </div>

                <div className="setup-actions" style={{ marginTop: 24 }}>
                  <button className="btn btn-ghost" onClick={() => { setStep(0); setOnboardingMode(''); setPinError(''); }}>← {t('back')}</button>
                  <button className="btn btn-primary setup-btn-big" onClick={saveAccount}>
                    {t('continue')} →
                  </button>
                </div>
              </div>
            ) : null
          )}

          {/* ============ STEP 2: LICENSE ============ */}
          {step === 2 && (
            <div className="setup-step-license animate-fade-in">
              <div className="setup-logo-big">
                <div className="setup-logo-icon-big">S</div>
                <h1 className="setup-logo-text-big">Synced</h1>
              </div>
              <p className="setup-desc">{t('setupLicenseSubtitle')}</p>

              <div className="setup-license-input-wrapper">
                <input
                  type="text"
                  className={`input setup-license-input ${licenseValid ? 'valid' : ''} ${licenseError ? 'error' : ''}`}
                  placeholder={t('setupLicensePlaceholder')}
                  value={licenseKey}
                  onChange={(e) => {
                    setLicenseKey(e.target.value.toUpperCase());
                    setLicenseError('');
                  }}
                  onKeyDown={(e) => e.key === 'Enter' && validateLicense()}
                  autoFocus
                  spellCheck={false}
                />
              </div>

              {licenseValid && (
                <div className="setup-license-valid animate-fade-in" style={{ marginTop: 8, marginBottom: 12 }}>
                  ✓ {t('setupLicenseValid')}
                </div>
              )}

              {licenseError && (
                <div className="setup-error animate-fade-in">{licenseError}</div>
              )}

              <button className="btn btn-primary setup-btn-big" onClick={validateLicense}>
                {t('activateLicenseBtn')}
              </button>

              <button 
                className="btn btn-secondary setup-btn-big" 
                onClick={() => {
                  setLicenseKey('');
                  setLicenseValid(false);
                  setLicenseInfo(null);
                  localStorage.removeItem('onboarding-licenseKey');
                  setStep(3);
                }}
                style={{ marginTop: 8 }}
              >
                {language === 'fr' ? 'Continuer sans clé' : 'Continue without key'}
              </button>

              <button 
                className="btn btn-ghost" 
                onClick={() => { setStep(1); setSecuritySubStep('pin'); }}
                style={{ marginTop: 12, fontSize: 12 }}
              >
                ← {language === 'fr' ? 'Retour' : 'Back'}
              </button>

              <p className="setup-hint" style={{ marginTop: 16 }}>
                Don't have a key? Contact the administrator.
              </p>
            </div>
          )}

          {/* ============ STEP 3: COMPLETE ============ */}
          {step === 3 && (
            <div className="setup-step setup-complete">
              <div className="setup-complete-icon">🎉</div>
              <h2 className="setup-title">Setup Complete!</h2>
              <p className="setup-desc">Synced is ready to use. Your dashboard is waiting.</p>

              <div className="setup-summary glass-card">
                <h4>Configuration Summary</h4>
                <div className="setup-summary-grid">
                  <div className="spec-item">
                    <span className="spec-label">AI Assistant</span>
                    <span className="spec-value">{aiStep === 'done' && aiMessage.includes('skipped') ? 'Skipped' : 'Installed ✓'}</span>
                  </div>
                  <div className="spec-item">
                    <span className="spec-label">Bridge</span>
                    <span className="spec-value">{bridgeIP ? `${bridgeIP}:${bridgePort}` : 'Not configured'}</span>
                  </div>
                </div>
              </div>

              <button className="btn btn-primary setup-btn-launch" onClick={handleComplete}>
                🚀 Launch Synced Dashboard
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
