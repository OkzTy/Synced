import React, { useState, useEffect, useRef } from 'react';
import { api } from '../utils/api';
import { translations } from '../utils/translations';

// SVG gauge constants
const CIRCUMFERENCE = 251.2;

function GaugeDefs() {
  return (
    <defs>
      <linearGradient id="gauge-gradient-cpu" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#6c5ce7" />
        <stop offset="100%" stopColor="#a855f7" />
      </linearGradient>
      <linearGradient id="gauge-gradient-ram" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#a855f7" />
        <stop offset="100%" stopColor="#ec4899" />
      </linearGradient>
      <linearGradient id="gauge-gradient-gpu" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#ec4899" />
        <stop offset="100%" stopColor="#f97316" />
      </linearGradient>
    </defs>
  );
}

function Gauge({ label, value, type, animated }) {
  const safeValue = typeof value === 'number' && !isNaN(value) ? Math.min(Math.max(value, 0), 100) : 0;
  const offset = CIRCUMFERENCE - (CIRCUMFERENCE * (animated ? safeValue : 0)) / 100;

  return (
    <div className="gauge-container">
      <div className="gauge-wrapper">
        <svg className="gauge-svg" viewBox="0 0 90 90" style={{ transform: 'rotate(90deg)', transformOrigin: 'center' }}>
          <GaugeDefs />
          <circle className="gauge-track" cx="45" cy="45" r="40" />
          <circle
            className={`gauge-fill ${type}`}
            cx="45"
            cy="45"
            r="40"
            strokeDasharray={CIRCUMFERENCE}
            strokeDashoffset={offset}
          />
        </svg>
        <span className="gauge-value">{Math.round(safeValue)}%</span>
      </div>
      <span className="gauge-label">{label}</span>
    </div>
  );
}

function PCCard({ title, type, specs, usage, isOnline, showActions, onShutdown, onRestart, animated, ipAddress, language, fallbackName }) {
  const t = (key) => translations[language]?.[key] || translations['en']?.[key] || key;

  // Loading state — no specs or no usage yet
  if (!specs && type === 'main') {
    return (
      <div className="pc-card glass-card">
        <div className="pc-card-header">
          <div className="pc-card-title">
            <span style={{ fontSize: 22 }}>🖥️</span>
            <div>
              <h3>{t('loading')}</h3>
              <span className="pc-type">{t('mainPC')} {ipAddress ? `• ${ipAddress}` : ''}</span>
            </div>
          </div>
          <span className="badge badge-info">
            <span className="status-dot online" />
            {t('connecting')}
          </span>
        </div>
        <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
          {t('fetchingData')}
        </div>
      </div>
    );
  }

  // Secondary PC offline
  if (type === 'secondary' && !isOnline) {
    return (
      <div className="pc-card glass-card">
        <div className="pc-card-header">
          <div className="pc-card-title">
            <span style={{ fontSize: 22 }}>💻</span>
            <div>
              <h3>{specs?.hostname || fallbackName || t('secondaryPC')}</h3>
              <span className="pc-type">{t('secondaryPC')} {ipAddress ? `• ${ipAddress}` : ''}</span>
            </div>
          </div>
          <span className="badge badge-danger">
            <span className="status-dot offline" />
            {t('offline')}
          </span>
        </div>
        <div className="pc-specs">
          <div className="spec-item">
            <span className="spec-label">{t('os')}</span>
            <span className="spec-value">--</span>
          </div>
          <div className="spec-item">
            <span className="spec-label">{t('cpu')}</span>
            <span className="spec-value">--</span>
          </div>
          <div className="spec-item">
            <span className="spec-label">{t('gpu')}</span>
            <span className="spec-value">--</span>
          </div>
          <div className="spec-item">
            <span className="spec-label">{t('ram')}</span>
            <span className="spec-value">--</span>
          </div>
        </div>
        <div className="gauges-row">
          <Gauge label={t('cpu')} value={0} type="cpu" animated={false} />
          <Gauge label={t('ram')} value={0} type="ram" animated={false} />
          <Gauge label={t('gpu')} value={0} type="gpu" animated={false} />
        </div>
      </div>
    );
  }

  // Secondary PC loading
  if (type === 'secondary' && !specs) {
    return (
      <div className="pc-card glass-card">
        <div className="pc-card-header">
          <div className="pc-card-title">
            <span style={{ fontSize: 22 }}>💻</span>
            <div>
              <h3>{t('loading')}</h3>
              <span className="pc-type">{t('secondaryPC')} {ipAddress ? `• ${ipAddress}` : ''}</span>
            </div>
          </div>
          <span className="badge badge-info">
            <span className="status-dot online" />
            {t('connecting')}
          </span>
        </div>
        <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
          {t('fetchingData')}
        </div>
      </div>
    );
  }

  // Extract usage values safely
  const cpuUsage = typeof usage?.cpu?.usage === 'number' ? usage.cpu.usage : 0;
  const ramUsage = usage?.ram?.usagePercent != null ? parseFloat(usage.ram.usagePercent) : 0;
  const gpuUsage = usage?.gpu?.[0]?.utilizationGpu != null ? Number(usage.gpu[0].utilizationGpu) : 0;

  return (
    <div className="pc-card glass-card">
      <div className="pc-card-header">
        <div className="pc-card-title">
          <span style={{ fontSize: 22 }}>{type === 'main' ? '🖥️' : '💻'}</span>
          <div>
            <h3>{specs?.hostname || fallbackName || t('unknown')}</h3>
            <span className="pc-type">{type === 'main' ? t('mainPC') : t('secondaryPC')} {ipAddress ? `• ${ipAddress}` : ''}</span>
          </div>
        </div>
        <span className={`badge ${isOnline ? 'badge-success' : 'badge-danger'}`}>
          <span className={`status-dot ${isOnline ? 'online' : 'offline'}`} />
          {isOnline ? t('online') : t('offline')}
        </span>
      </div>

      <div className="pc-specs">
        <div className="spec-item">
          <span className="spec-label">{t('os')}</span>
          <span className="spec-value">{specs?.os || specs?.osName || 'N/A'}</span>
        </div>
        <div className="spec-item">
          <span className="spec-label">{t('cpu')}</span>
          <span className="spec-value">{specs?.cpu?.brand || specs?.cpu?.model || specs?.cpuName || 'N/A'}</span>
        </div>
        <div className="spec-item">
          <span className="spec-label">{t('gpu')}</span>
          <span className="spec-value">{specs?.gpus?.[0]?.model || specs?.gpu?.model || specs?.gpuName || 'N/A'}</span>
        </div>
        <div className="spec-item">
          <span className="spec-label">{t('ram')}</span>
          <span className="spec-value">{specs?.ram?.totalGB || specs?.ramTotalGB || 'N/A'} GB</span>
        </div>
      </div>

      <div className="gauges-row">
        <Gauge label={t('cpu')} value={cpuUsage} type="cpu" animated={animated} />
        <Gauge label={t('ram')} value={Math.round(ramUsage)} type="ram" animated={animated} />
        <Gauge label={t('gpu')} value={gpuUsage} type="gpu" animated={animated} />
      </div>

      {showActions && isOnline && (
        <div className="quick-actions">
          <button className="btn btn-secondary btn-sm" onClick={onShutdown}>
            ⏻ {t('shutdown')}
          </button>
          <button className="btn btn-secondary btn-sm" onClick={onRestart}>
            🔄 {t('restart')}
          </button>
        </div>
      )}
    </div>
  );
}

export default function Dashboard({ bridgeConfig, bridgeOnline, refreshBridge, language, searchQuery = '' }) {
  const t = (key) => translations[language]?.[key] || translations['en']?.[key] || key;

  const [mainSpecs, setMainSpecs] = useState(null);
  const [mainUsage, setMainUsage] = useState(null);
  const [bridgeSpecs, setBridgeSpecs] = useState(null);
  const [bridgeUsage, setBridgeUsage] = useState(null);
  const [animated, setAnimated] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [localIP, setLocalIP] = useState('');
  const [showSecondPC, setShowSecondPC] = useState(() => localStorage.getItem('synced-show-second-pc') === 'true');
  const intervalRef = useRef(null);

  const toggleSecondPC = () => {
    const newVal = !showSecondPC;
    setShowSecondPC(newVal);
    localStorage.setItem('synced-show-second-pc', String(newVal));
  };

  // Fetch specs and IP on mount
  useEffect(() => {
    async function fetchSpecs() {
      try {
        const ms = await api.getLocalSpecs();
        if (ms.success) setMainSpecs(ms.data);
      } catch (e) {
        console.warn('Failed to fetch local specs:', e);
      }
    }
    async function fetchIP() {
      try {
        const res = await api.getLocalIP();
        if (res.ip) setLocalIP(res.ip);
      } catch (e) {
        console.warn('Failed to fetch local IP:', e);
      }
    }
    fetchSpecs();
    fetchIP();
  }, []);

  // Fetch bridge specs when config changes or bridge comes online
  useEffect(() => {
    if (!bridgeOnline || !bridgeConfig?.ip) {
      setBridgeSpecs(null);
      setBridgeUsage(null);
      return;
    }

    async function fetchBridgeData() {
      try {
        const bs = await api.getBridgeSpecs(bridgeConfig);
        if (bs.success && bs.data) {
          setBridgeSpecs(bs.data);
        }
      } catch (e) {
        console.warn('Failed to fetch bridge specs:', e);
      }
    }
    fetchBridgeData();
  }, [bridgeConfig, bridgeOnline]);

  const handleManualRefresh = async () => {
    setRefreshing(true);
    try {
      if (refreshBridge) {
        await refreshBridge();
      }
      
      const ms = await api.getLocalSpecs();
      if (ms.success) setMainSpecs(ms.data);
      
      const mu = await api.getLocalUsage();
      if (mu.success) setMainUsage(mu.data);
      
      if (bridgeConfig?.ip) {
        const bs = await api.getBridgeSpecs(bridgeConfig);
        if (bs.success && bs.data) {
          setBridgeSpecs(bs.data);
          setBridgeUsage({
            cpu: { usage: bs.data.cpu?.loadPct ?? 0 },
            ram: {
              usagePercent: bs.data.ram?.usedPct != null ? String(bs.data.ram.usedPct) : '0',
              used: bs.data.ram ? (bs.data.ram.totalGB - bs.data.ram.availableGB) : 0,
              total: bs.data.ram?.totalGB || 0,
            },
            gpu: bs.data.gpu ? [{ utilizationGpu: 0 }] : [],
          });
        }
      }
    } catch (e) {
      console.warn('Manual refresh failed:', e);
    } finally {
      setRefreshing(false);
    }
  };

  // Poll usage every 5 seconds
  useEffect(() => {
    async function fetchUsage() {
      try {
        const mu = await api.getLocalUsage();
        if (mu.success) setMainUsage(mu.data);
      } catch (e) {
        console.warn('Failed to fetch local usage:', e);
      }

      // For bridge usage, use getBridgeSpecs which returns live specs and cached performance metrics
      if (bridgeOnline && bridgeConfig?.ip) {
        try {
          const bu = await api.getBridgeSpecs(bridgeConfig);
          if (bu.success && bu.data) {
            const specsData = bu.data;
            setBridgeUsage({
              cpu: { usage: specsData.cpu?.loadPct ?? 0 },
              ram: {
                usagePercent: specsData.ram?.usedPct != null
                  ? String(specsData.ram.usedPct)
                  : '0',
                used: specsData.ram ? (specsData.ram.totalGB - specsData.ram.availableGB) : 0,
                total: specsData.ram?.totalGB || 0,
              },
              gpu: specsData.gpu ? [{ utilizationGpu: 0 }] : [],
            });
            // Update bridge specs dynamically as well
            setBridgeSpecs(specsData);
          }
        } catch (e) {
          console.warn('Failed to fetch bridge usage:', e);
        }
      }
    }

    // Initial fetch
    fetchUsage();

    // Poll every 5 seconds
    intervalRef.current = setInterval(fetchUsage, 5000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [bridgeConfig, bridgeOnline]);

  // Animate gauges from 0 after main data loads
  useEffect(() => {
    if (mainUsage) {
      const timer = setTimeout(() => setAnimated(true), 100);
      return () => clearTimeout(timer);
    }
  }, [mainUsage]);

  const handleShutdown = async () => {
    if (window.confirm(t('confirmShutdown'))) {
      try {
        await api.shutdownBridge(bridgeConfig, 'shutdown');
      } catch (e) {
        console.warn('Shutdown failed:', e);
      }
    }
  };

  const handleRestart = async () => {
    if (window.confirm(t('confirmRestart'))) {
      try {
        await api.shutdownBridge(bridgeConfig, 'restart');
      } catch (e) {
        console.warn('Restart failed:', e);
      }
    }
  };

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 className="page-title">
            <span className="gradient-text">{t('dashboard')}</span>
          </h1>
          <p className="page-subtitle">{t('dashboardSubtitle')}</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {/* Toggle Switch for Second PC */}
          <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', fontSize: '13px', color: 'var(--text-secondary)', background: 'rgba(255,255,255,0.03)', padding: '10px 14px', borderRadius: '8px', border: '1px solid var(--border-color)', userSelect: 'none', transition: 'all 0.2s ease' }}>
            <span style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px' }}>💻 {language === 'fr' ? 'Second PC' : 'Second PC'}</span>
            <div 
              onClick={(e) => { e.preventDefault(); toggleSecondPC(); }}
              style={{
                width: '36px',
                height: '20px',
                borderRadius: '10px',
                background: showSecondPC ? 'var(--primary)' : 'var(--bg-input)',
                border: '1px solid var(--border-color)',
                position: 'relative',
                transition: 'all 0.2s ease',
                cursor: 'pointer'
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
                  left: showSecondPC ? '18px' : '2px',
                  transition: 'all 0.2s ease',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.4)'
                }}
              />
            </div>
          </label>

          <button 
            className="btn btn-secondary" 
            onClick={handleManualRefresh}
            disabled={refreshing}
            style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 16px', borderRadius: '8px', fontSize: '13px', fontWeight: 600 }}
          >
            <span>🔄</span>
            <span>{refreshing ? t('refreshing') : t('refreshConnection')}</span>
          </button>
        </div>
      </div>

      <div className="dashboard-grid" style={{ gridTemplateColumns: showSecondPC ? '1fr 1fr' : '1fr' }}>
        <PCCard
          title="Main PC"
          type="main"
          specs={mainSpecs}
          usage={mainUsage}
          isOnline={true}
          showActions={false}
          animated={animated}
          ipAddress={localIP}
          language={language}
          fallbackName="Main PC"
        />
        {showSecondPC && (
          <PCCard
            title="Secondary PC"
            type="secondary"
            specs={bridgeSpecs}
            usage={bridgeUsage}
            isOnline={bridgeOnline}
            showActions={true}
            onShutdown={handleShutdown}
            onRestart={handleRestart}
            animated={animated}
            ipAddress={bridgeConfig?.ip}
            language={language}
            fallbackName="Secondary PC"
          />
        )}
      </div>

      {showSecondPC && (
        <div className="connection-bridge">
          <div className="bridge-line">
            <span className="bridge-dot" />
            <span className="bridge-label">{mainSpecs?.hostname || 'MAIN'}</span>
            <div className="bridge-dashes">
              <span className="bridge-dash" />
              <span className="bridge-dash" />
              <span className="bridge-dash" />
              <span className="bridge-dash" />
              <span className="bridge-dash" />
            </div>
            <span className="bridge-label">
              {bridgeOnline ? t('connected') : t('disconnected')}
            </span>
            <div className="bridge-dashes">
              <span className="bridge-dash" />
              <span className="bridge-dash" />
              <span className="bridge-dash" />
              <span className="bridge-dash" />
              <span className="bridge-dash" />
            </div>
            <span className="bridge-label">{bridgeSpecs?.hostname || 'BRIDGE'}</span>
            <span
              className="bridge-dot"
              style={
                !bridgeOnline
                  ? { background: 'var(--danger)', boxShadow: '0 0 10px var(--danger)' }
                  : {}
              }
            />
          </div>
        </div>
      )}
    </div>
  );
}

