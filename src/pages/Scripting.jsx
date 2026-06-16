import React, { useState, useEffect, useRef } from 'react';
import rustLogo from '../assets/rust_logo_web.png';

function parseImageConfig(imageVal, fallbackScale = 1.0) {
  if (!imageVal) {
    return { url: '', scale: fallbackScale, offsetX: 0, offsetY: 0, fit: 'cover', position: 'center' };
  }
  if (typeof imageVal === 'string' && imageVal.trim().startsWith('{')) {
    try {
      const parsed = JSON.parse(imageVal);
      return {
        url: parsed.url || '',
        scale: parsed.scale !== undefined ? Number(parsed.scale) : fallbackScale,
        offsetX: parsed.offsetX !== undefined ? Number(parsed.offsetX) : 0,
        offsetY: parsed.offsetY !== undefined ? Number(parsed.offsetY) : 0,
        fit: parsed.fit || 'cover',
        position: parsed.position || 'center'
      };
    } catch (e) {}
  }
  return {
    url: imageVal,
    scale: Number(fallbackScale || 1.0),
    offsetX: 0,
    offsetY: 0,
    fit: 'cover',
    position: 'center'
  };
}

const SCRIPT_LIST = [
  {
    id: 'kryok',
    name: 'KryoK',
    game: 'Rust',
    type: 'Rust Cheat',
    version: '2.4.1',
    size: '14.2 MB',
    target: 'ALKAD Rust (No EAC)',
    status: 'updated',
    logo: rustLogo,
  }
];

export default function Scripting() {
  const [step, setStep] = useState('catalog'); // catalog -> keycheck -> disclaimer -> ready
  const [selectedScript, setSelectedScript] = useState(null);
  const [licenseKey, setLicenseKey] = useState('');
  const [keyError, setKeyError] = useState('');
  const [countdown, setCountdown] = useState(5);
  const [countdownActive, setCountdownActive] = useState(false);
  const intervalRef = useRef(null);
  const [rustHover, setRustHover] = useState(false);

  const [productsMap, setProductsMap] = useState({});
  const [productsMetadata, setProductsMetadata] = useState([]);

  const getScriptMeta = (id) => {
    const found = productsMetadata.find(p => p.id?.toUpperCase() === id?.toUpperCase());
    const fallback = SCRIPT_LIST.find(p => p.id?.toUpperCase() === id?.toUpperCase()) || {};

    let featuresList = fallback.features || ['No recoil', 'Auto farm', 'Enemy warning'];
    if (found?.features) {
      try {
        const parsed = typeof found.features === 'string' ? JSON.parse(found.features) : found.features;
        if (Array.isArray(parsed)) featuresList = parsed;
      } catch (e) {}
    } else if (found?.features) {
      featuresList = [found.features];
    }

    return {
      id: found?.id || fallback.id || id,
      name: found?.name || fallback.name || id,
      game: fallback.game || 'Rust',
      type: fallback.type || 'Rust Cheat',
      version: found?.version || fallback.version || '1.0.0',
      size: fallback.size || '14.2 MB',
      target: fallback.target || 'ALKAD Rust (No EAC)',
      status: found?.status || fallback.status || 'Undetected',
      logo: found?.image || fallback.logo || rustLogo,
      image_scale: found?.image_scale || 1.0,
      description: found?.description || fallback.description || 'KryoK scripting system for Rust Alkad.',
      price: found?.price || fallback.price || 8,
      features: featuresList,
      requirements: found ? (found.requirements || '') : (fallback.target || '')
    };
  };

  useEffect(() => {
    const mapStr = localStorage.getItem('synced-products-map') || '{}';
    try {
      setProductsMap(JSON.parse(mapStr));
    } catch(e) {}

    async function loadMeta() {
      try {
        const res = await api.adminGetProductsMetadata();
        setProductsMetadata(res || []);
      } catch (e) {
        console.warn('Failed to load products metadata:', e);
      }
    }
    loadMeta();
  }, []);

  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  const handleSelectScript = (script) => {
    const mapStr = localStorage.getItem('synced-products-map') || '{}';
    let map = {};
    try {
      map = JSON.parse(mapStr);
    } catch(e) {}
    const existingKey = map[script.id.toUpperCase()];
    if (existingKey) {
      setLicenseKey(existingKey);
      setSelectedScript(script);
      setStep('disclaimer');
    } else {
      setSelectedScript(script);
      setStep('keycheck');
    }
  };

  const handleKeySubmit = async () => {
    if (!licenseKey.trim()) {
      setKeyError('Please enter a license key');
      return;
    }
    setKeyError('');
    try {
      const username = localStorage.getItem('synced-username') || 'OkzTy';
      const res = await api.validateProductKey(username, selectedScript.id.toUpperCase(), licenseKey.trim());
      if (res.success) {
        const mapStr = localStorage.getItem('synced-products-map') || '{}';
        let map = {};
        try {
          map = JSON.parse(mapStr);
        } catch(e) {}
        map[selectedScript.id.toUpperCase()] = licenseKey.trim();
        localStorage.setItem('synced-products-map', JSON.stringify(map));
        setProductsMap(map);
        setStep('disclaimer');
      } else {
        setKeyError(res.error || 'Invalid product key');
      }
    } catch(err) {
      setKeyError('Error: ' + err.message);
    }
  };

  const startCountdown = () => {
    setCountdownActive(true);
    setCountdown(5);
    intervalRef.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
          setCountdownActive(false);
          setStep('ready');
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  const handleDownloadAlkad = () => {
    window.open('https://forum.alkad.org/resources/rust.16/download/', '_blank');
  };

  const handleLaunchScript = async () => {
    const mapStr = localStorage.getItem('synced-products-map') || '{}';
    let map = {};
    try {
      map = JSON.parse(mapStr);
    } catch(e) {}
    const key = map[selectedScript.id.toUpperCase()];
    if (!key) {
      setStep('keycheck');
      return;
    }
    try {
      const result = await window.synced.kryok.launch(key);
      if (!result.success) {
        alert('Failed to launch script client: ' + (result.error || 'Unknown error'));
      }
    } catch (err) {
      alert('Failed to launch script client: ' + err.message);
    }
  };

  const goBackToCatalog = () => {
    setStep('catalog');
    setSelectedScript(null);
    setCountdownActive(false);
    if (intervalRef.current) clearInterval(intervalRef.current);
  };

  // ============ CATALOG VIEW ============
  if (step === 'catalog') {
    const dbScripts = productsMetadata.filter(p => p.category?.toUpperCase() === 'SCRIPTING');
    const displayScripts = dbScripts.length > 0 ? dbScripts : SCRIPT_LIST;

    return (
      <div className="page-container animate-fade-in">
        <div className="page-header">
          <div>
            <h2 className="page-title">Script Library</h2>
            <p className="page-subtitle">Browse and launch scripts — key required per script</p>
          </div>
        </div>

        {/* Script Grid */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
          gap: 16,
          marginTop: 8
        }}>
          {displayScripts.map((script) => {
            const meta = getScriptMeta(script.id);
            return (
              <div
                key={script.id}
                className="glass-card"
                style={{
                  borderRadius: 12,
                  overflow: 'hidden',
                  cursor: 'pointer',
                  transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                  border: '1px solid rgba(255,255,255,0.06)',
                }}
                onClick={() => handleSelectScript(script)}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = 'translateY(-4px)';
                  e.currentTarget.style.boxShadow = '0 12px 32px rgba(0,0,0,0.4), 0 0 24px rgba(255, 107, 53, 0.1)';
                  e.currentTarget.style.borderColor = 'rgba(255, 107, 53, 0.3)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = 'translateY(0)';
                  e.currentTarget.style.boxShadow = 'none';
                  e.currentTarget.style.borderColor = 'rgba(255,255,255,0.06)';
                }}
              >
                {/* Game Logo (Reworked to occupy the entire upper area of the script card) */}
                <div
                  style={{
                    width: '100%',
                    height: 200,
                    overflow: 'hidden',
                    position: 'relative',
                    background: '#0a0a14',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    margin: 0,
                    borderRadius: '12px 12px 0 0'
                  }}
                  onMouseEnter={() => setRustHover(true)}
                  onMouseLeave={() => setRustHover(false)}
                >
                  {(() => {
                    const imgConfig = parseImageConfig(meta.logo, meta.image_scale);
                    return imgConfig.url ? (
                      <img
                        src={imgConfig.url}
                        alt={meta.game}
                        style={{
                          width: '100%',
                          height: '100%',
                          objectFit: imgConfig.fit || 'contain',
                          objectPosition: imgConfig.position || 'center',
                          transition: 'filter 0.4s ease, transform 0.4s ease',
                          filter: rustHover ? 'blur(4px) brightness(0.6)' : 'blur(0px) brightness(1)',
                          transform: rustHover ? `scale(${imgConfig.scale * 1.05}) translate(${imgConfig.offsetX}px, ${imgConfig.offsetY}px)` : `scale(${imgConfig.scale}) translate(${imgConfig.offsetX}px, ${imgConfig.offsetY}px)`,
                        }}
                      />
                    ) : (
                      <div style={{
                        width: '100%',
                        height: '100%',
                        background: 'linear-gradient(135deg, rgba(255, 107, 53, 0.1) 0%, rgba(255, 183, 3, 0.05) 100%)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexDirection: 'column',
                        gap: 8,
                        borderBottom: '1px solid rgba(255,255,255,0.05)'
                      }}>
                        <div style={{ fontSize: 24, opacity: 0.6 }}>📦</div>
                        <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--text-secondary)', letterSpacing: '2px', opacity: 0.8 }}>SOON</span>
                      </div>
                    );
                  })()}
                  {/* Hover Overlay */}
                  <div
                    style={{
                      position: 'absolute',
                      inset: 0,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      opacity: rustHover ? 1 : 0,
                      transition: 'opacity 0.4s ease',
                      background: 'rgba(0,0,0,0.4)',
                    }}
                  >
                    <span style={{
                      fontSize: 22,
                      fontWeight: 900,
                      color: '#fff',
                      textShadow: '0 0 20px rgba(0,0,0,0.8)',
                      letterSpacing: 3,
                      textTransform: 'uppercase'
                    }}>
                      {meta.game}
                    </span>
                  </div>

                </div>

                {/* Card Info */}
                <div style={{ padding: 14 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-primary)' }}>
                      {meta.name}
                    </span>
                    <span style={{
                      fontSize: 9,
                      padding: '2px 6px',
                      borderRadius: 4,
                      background: 'rgba(255, 107, 53, 0.15)',
                      color: '#ff6b35',
                      fontWeight: 700,
                    }}>
                      v{meta.version}
                    </span>
                    <span
                      style={{
                        padding: '2px 6px',
                        borderRadius: 4,
                        fontSize: 9,
                        fontWeight: 700,
                        background: meta.status === 'updated' || meta.status === 'Undetected'
                          ? 'rgba(16, 185, 129, 0.15)'
                          : 'rgba(239, 68, 68, 0.15)',
                        color: meta.status === 'updated' || meta.status === 'Undetected' ? '#10b981' : '#ef4444',
                        border: meta.status === 'updated' || meta.status === 'Undetected'
                          ? '1px solid rgba(16, 185, 129, 0.3)'
                          : '1px solid rgba(239, 68, 68, 0.3)',
                      }}
                    >
                      {meta.status === 'updated' || meta.status === 'Undetected' ? 'Updated' : 'Outdated'}
                    </span>
                  </div>

                  <p style={{
                    fontSize: 11,
                    color: 'var(--text-muted)',
                    margin: 0,
                    lineHeight: 1.4,
                  }}>
                    {meta.type}{meta.requirements ? ` — ${meta.requirements}` : ''}
                  </p>

                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginTop: 10,
                    paddingTop: 10,
                    borderTop: '1px solid rgba(255,255,255,0.04)',
                    fontSize: 10,
                    color: 'var(--text-muted)',
                  }}>
                    <span>📦 {meta.size}</span>
                    <span style={{
                      color: 'var(--accent-primary)',
                      fontWeight: 600,
                      fontSize: 11,
                    }}>Launch →</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Empty state note */}
        {SCRIPT_LIST.length === 0 && (
          <div style={{
            textAlign: 'center',
            padding: '60px 20px',
            color: 'var(--text-muted)'
          }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>📂</div>
            <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>No scripts available</p>
            <p style={{ fontSize: 12 }}>New scripts will appear here once added.</p>
          </div>
        )}
      </div>
    );
  }

  // ============ KEY CHECK ============
  if (step === 'keycheck') {
    return (
      <div className="page-container animate-fade-in">
        <div className="page-header">
          <div>
            <h2 className="page-title">Script Library</h2>
            <p className="page-subtitle">License required to access {selectedScript?.name}</p>
          </div>
        </div>

        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '40px 20px',
          textAlign: 'center'
        }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🔑</div>
          <h3 style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 8 }}>
            License Key Required
          </h3>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', maxWidth: 380, marginBottom: 24, lineHeight: 1.6 }}>
            A valid license key is needed to launch <strong>{selectedScript?.name || 'this script'}</strong>.
            Enter your key below to continue.
          </p>

          {/* Product Info Section */}
          <div className="glass-card" style={{ maxWidth: 400, width: '100%', padding: 20, marginBottom: 20, textAlign: 'left', border: '1px solid rgba(255,255,255,0.06)' }}>
            <h4 style={{ margin: '0 0 8px 0', fontSize: 14, fontWeight: 700, color: 'var(--accent-primary)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>{getScriptMeta(selectedScript?.id).name} Details</span>
              <span className="badge badge-secondary" style={{ fontSize: 10, background: getScriptMeta(selectedScript?.id).status === 'Undetected' ? 'rgba(16,185,129,0.2)' : 'rgba(239,68,68,0.2)', color: getScriptMeta(selectedScript?.id).status === 'Undetected' ? '#10b981' : '#ef4444' }}>
                {getScriptMeta(selectedScript?.id).status}
              </span>
            </h4>
            {getScriptMeta(selectedScript?.id).requirements && (
              <div style={{ marginBottom: 12 }}>
                <span style={{
                  display: 'inline-block',
                  padding: '4px 12px',
                  borderRadius: 12,
                  fontSize: 10,
                  fontWeight: 700,
                  background: 'rgba(255, 107, 53, 0.15)',
                  color: '#ff6b35',
                  border: '1px solid rgba(255, 107, 53, 0.3)',
                }}>
                  {getScriptMeta(selectedScript?.id).requirements}
                </span>
              </div>
            )}
            <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 12, lineHeight: 1.5 }}>
              {getScriptMeta(selectedScript?.id).description}
            </p>
            <div style={{ fontSize: 12, marginBottom: 12 }}>
              <strong>Price: </strong> <span style={{ color: 'var(--success)', fontWeight: 600 }}>${getScriptMeta(selectedScript?.id).price}/week</span>
            </div>
            <div>
              <strong style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>Key Features:</strong>
              <ul style={{ margin: 0, paddingLeft: 16, fontSize: 11, color: 'var(--text-secondary)' }}>
                {getScriptMeta(selectedScript?.id).features.map((f, i) => <li key={i}>{f}</li>)}
              </ul>
            </div>
          </div>

          <div className="glass-card" style={{ padding: 24, maxWidth: 400, width: '100%', textAlign: 'left' }}>
            <div className="input-group" style={{ marginBottom: 16 }}>
              <label className="input-label">License Key</label>
              <input
                type="text"
                className="input"
                value={licenseKey}
                onChange={(e) => { setLicenseKey(e.target.value.toUpperCase()); setKeyError(''); }}
                placeholder="SYNC-XXXX-..."
                autoFocus
                style={{ background: 'var(--bg-input)', border: '1px solid var(--border-color)', borderRadius: 8, color: 'var(--text-primary)' }}
              />
            </div>

            {keyError && (
              <p style={{ color: 'var(--danger)', fontSize: 12, marginBottom: 12, fontWeight: 500 }}>{keyError}</p>
            )}

            <button
              className="btn btn-primary"
              onClick={handleKeySubmit}
              style={{ width: '100%', height: 44, fontWeight: 600, fontSize: 14 }}
            >
              🔓 Unlock & Continue
            </button>

            <div style={{
              marginTop: 16,
              paddingTop: 16,
              borderTop: '1px solid var(--border-color)',
              textAlign: 'center'
            }}>
              <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
                Don't have a license key?
              </p>
              <button
                className="btn btn-secondary"
                onClick={() => window.open('https://kryok-shop.synced.io', '_blank')}
                style={{
                  width: '100%',
                  height: 40,
                  fontWeight: 600,
                  fontSize: 13,
                  background: 'linear-gradient(135deg, #10b981, #059669)',
                  color: '#fff',
                  border: 'none',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'linear-gradient(135deg, #14c98b, #059669)';
                  e.currentTarget.style.boxShadow = '0 4px 15px rgba(16, 185, 129, 0.3)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'linear-gradient(135deg, #10b981, #059669)';
                  e.currentTarget.style.boxShadow = 'none';
                }}
              >
                🛒 Purchase License — kryok-shop.synced.io
              </button>
            </div>
          </div>

          <button
            className="btn btn-ghost"
            onClick={goBackToCatalog}
            style={{ marginTop: 16, fontSize: 12 }}
          >
            ← Back to Library
          </button>
        </div>
      </div>
    );
  }

  // ============ DISCLAIMER (with countdown) ============
  if (step === 'disclaimer' && !countdownActive && intervalRef.current === null) {
    return (
      <div className="page-container animate-fade-in">
        <div className="page-header">
          <div>
            <h2 className="page-title">Script Library</h2>
            <p className="page-subtitle">{selectedScript?.name} — {selectedScript?.game}</p>
          </div>
        </div>

        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '30px 20px 60px',
          textAlign: 'center'
        }}>
          {/* Logo */}
          {(() => {
            const meta = getScriptMeta(selectedScript?.id);
            const imgConfig = parseImageConfig(meta.logo, meta.image_scale);
            return (
              <div style={{
                width: 120,
                height: 120,
                borderRadius: 16,
                overflow: 'hidden',
                marginBottom: 20,
                boxShadow: '0 0 30px rgba(255, 107, 53, 0.15)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: '#0a0a14'
              }}>
                <img
                  src={imgConfig.url}
                  alt={selectedScript?.game}
                  style={{
                    width: '100%',
                    height: '100%',
                    objectFit: imgConfig.fit || 'contain',
                    objectPosition: imgConfig.position || 'center',
                    transform: `scale(${imgConfig.scale}) translate(${imgConfig.offsetX}px, ${imgConfig.offsetY}px)`,
                  }}
                />
              </div>
            );
          })()}

          <h3 style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-primary)', marginBottom: 2 }}>
            {selectedScript?.name}
          </h3>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 4 }}>
            {selectedScript?.type} — v{selectedScript?.version}
          </p>
          {getScriptMeta(selectedScript?.id).requirements && (
            <span style={{
              display: 'inline-block',
              padding: '3px 10px',
              borderRadius: 12,
              fontSize: 10,
              fontWeight: 700,
              background: 'rgba(255, 107, 53, 0.15)',
              color: '#ff6b35',
              border: '1px solid rgba(255, 107, 53, 0.3)',
              marginBottom: 24
            }}>
              🎯 {getScriptMeta(selectedScript?.id).requirements}
            </span>
          )}

          {/* BIG DISCLAIMER */}
          <div className="glass-card" style={{
            maxWidth: 540,
            width: '100%',
            padding: 24,
            border: '1px solid rgba(239, 68, 68, 0.3)',
            background: 'rgba(239, 68, 68, 0.05)',
            marginBottom: 24,
            textAlign: 'left'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <span style={{ fontSize: 24 }}>⚠️</span>
              <h4 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#ef4444' }}>
                DETECTION DISCLAIMER
              </h4>
            </div>

            <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.7 }}>
              <p style={{ margin: '0 0 10px 0' }}>
                <strong style={{ color: '#ef4444' }}>KryoK</strong> is designed exclusively for 
                <strong style={{ color: '#ff6b35' }}> ALKAD Rust</strong> — the pirated version of Rust 
                that <strong>does not have Easy Anti-Cheat (EAC)</strong>.
              </p>

              <div style={{
                background: 'rgba(239, 68, 68, 0.1)',
                borderLeft: '3px solid #ef4444',
                padding: '10px 14px',
                margin: '12px 0',
                borderRadius: '0 6px 6px 0'
              }}>
                <p style={{ margin: '0 0 6px 0', fontWeight: 700, color: '#ef4444', fontSize: 13 }}>
                  🚨 REAL RUST (STEAM) USERS — READ THIS
                </p>
                <p style={{ margin: 0, fontSize: 12, color: 'var(--text-secondary)' }}>
                  KryoK <strong>will technically work</strong> on the legitimate Steam version of Rust, 
                  however it has been <strong style={{ color: '#ef4444' }}>DETECTED since February 20, 2025</strong>. 
                  Using it on the official Rust client <strong>will result in a ban</strong>.
                </p>
              </div>

              <p style={{ margin: '0 0 10px 0' }}>
                <strong>By proceeding, you acknowledge:</strong>
              </p>
              <ul style={{ margin: '0 0 0 18px', padding: 0 }}>
                <li style={{ marginBottom: 4 }}>You understand this is detected on real Rust since Feb 20, 2025</li>
                <li style={{ marginBottom: 4 }}>You accept full responsibility for any account bans on the real Rust client</li>
                <li style={{ marginBottom: 4 }}>This script is intended for ALKAD Rust (no anticheat) only</li>
                <li style={{ marginBottom: 4 }}>The developers are not liable for any bans or penalties incurred</li>
              </ul>
            </div>
          </div>

          <p style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 12, textAlign: 'center', maxWidth: 400 }}>
            Click the button below and wait 5 seconds to confirm you understand the risks
          </p>

          <button
            className="btn btn-primary"
            onClick={startCountdown}
            style={{
              width: '100%',
              maxWidth: 400,
              height: 48,
              fontWeight: 700,
              fontSize: 15,
              background: 'linear-gradient(135deg, #ef4444, #dc2626)',
              border: 'none',
              boxShadow: '0 4px 20px rgba(239, 68, 68, 0.3)'
            }}
          >
            I Understand — Show {selectedScript?.name}
          </button>

          <button
            className="btn btn-ghost"
            onClick={goBackToCatalog}
            style={{ marginTop: 12, fontSize: 12 }}
          >
            ← Back to Library
          </button>
        </div>
      </div>
    );
  }

  // ============ COUNTDOWN ACTIVE ============
  if (countdownActive) {
    return (
      <div className="page-container animate-fade-in">
        <div className="page-header">
          <div>
            <h2 className="page-title">Script Library</h2>
            <p className="page-subtitle">Confirming disclaimer acceptance</p>
          </div>
        </div>

        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '80px 20px',
          textAlign: 'center'
        }}>
          {(() => {
            const meta = getScriptMeta(selectedScript?.id);
            const imgConfig = parseImageConfig(meta.logo, meta.image_scale);
            return (
              <div style={{
                width: 120,
                height: 120,
                borderRadius: 16,
                overflow: 'hidden',
                marginBottom: 20,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: '#0a0a14',
                boxShadow: '0 0 30px rgba(255, 107, 53, 0.15)'
              }}>
                <img
                  src={imgConfig.url}
                  alt={selectedScript?.game}
                  style={{
                    width: '100%',
                    height: '100%',
                    objectFit: imgConfig.fit || 'contain',
                    objectPosition: imgConfig.position || 'center',
                    transform: `scale(${imgConfig.scale}) translate(${imgConfig.offsetX}px, ${imgConfig.offsetY}px)`,
                  }}
                />
              </div>
            );
          })()}
          <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16 }}>
            You have acknowledged the risks. Accessing in...
          </p>
          <div style={{
            width: 80,
            height: 80,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 36,
            fontWeight: 900,
            color: 'var(--accent-primary)',
            background: 'rgba(0,0,0,0.2)',
            borderRadius: 16,
            border: '2px solid var(--accent-primary)',
            letterSpacing: 4
          }}>
            {countdown}
          </div>
        </div>
      </div>
    );
  }

  // ============ READY — Launch Screen ============
  if (step === 'ready') {
    return (
      <div className="page-container animate-fade-in">
        <div className="page-header">
          <div>
            <h2 className="page-title">Script Library</h2>
            <p className="page-subtitle">{selectedScript?.name} ready to launch</p>
          </div>
        </div>

        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '30px 20px'
        }}>
          <div className="glass-card" style={{
            maxWidth: 480,
            width: '100%',
            padding: 32,
            textAlign: 'center',
            border: '1px solid rgba(255, 107, 53, 0.2)',
          }}>
            {(() => {
              const meta = getScriptMeta(selectedScript?.id);
              const imgConfig = parseImageConfig(meta.logo, meta.image_scale);
              return (
                <div
                  style={{
                    width: 180,
                    height: 180,
                    borderRadius: 16,
                    overflow: 'hidden',
                    margin: '0 auto 20px auto',
                    position: 'relative',
                    transition: 'all 0.4s cubic-bezier(0.4, 0, 0.2, 1)',
                    cursor: 'default',
                    boxShadow: '0 0 30px rgba(255, 107, 53, 0.15)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: '#0a0a14'
                  }}
                  onMouseEnter={(e) => {
                    const img = e.currentTarget.querySelector('img');
                    const overlay = e.currentTarget.querySelector('.rust-overlay');
                    if (img) img.style.filter = 'blur(6px) grayscale(0.3)';
                    if (overlay) overlay.style.opacity = '1';
                  }}
                  onMouseLeave={(e) => {
                    const img = e.currentTarget.querySelector('img');
                    const overlay = e.currentTarget.querySelector('.rust-overlay');
                    if (img) img.style.filter = 'blur(0px) grayscale(0)';
                    if (overlay) overlay.style.opacity = '0';
                  }}
                >
                  <img
                    src={imgConfig.url}
                    alt={selectedScript?.game}
                    style={{
                      width: '100%',
                      height: '100%',
                      objectFit: imgConfig.fit || 'contain',
                      objectPosition: imgConfig.position || 'center',
                      transition: 'filter 0.4s ease, transform 0.4s ease',
                      transform: `scale(${imgConfig.scale}) translate(${imgConfig.offsetX}px, ${imgConfig.offsetY}px)`
                    }}
                  />
              <div
                className="rust-overlay"
                style={{
                  position: 'absolute',
                  inset: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  opacity: 0,
                  transition: 'opacity 0.4s ease',
                  background: 'rgba(0,0,0,0.5)',
                  borderRadius: 16,
                  backdropFilter: 'blur(2px)',
                }}
              >
                <span style={{
                  fontSize: 26,
                  fontWeight: 900,
                  color: '#fff',
                  textShadow: '0 0 20px rgba(255, 107, 53, 0.8)',
                  letterSpacing: 2,
                  textTransform: 'uppercase'
                }}>
                  {selectedScript?.game}
                </span>
              </div>
            </div>
              );
            })()}

            <h3 style={{
              fontSize: 24,
              fontWeight: 800,
              color: 'var(--text-primary)',
              marginBottom: 2,
              background: 'linear-gradient(135deg, #ff6b35, #ff8c42)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}>
              {selectedScript?.name}
            </h3>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 4 }}>
              {selectedScript?.game} Cheat Script — v{selectedScript?.version}
            </p>

            {getScriptMeta(selectedScript?.id).requirements && (
              <span style={{
                display: 'inline-block',
                padding: '4px 12px',
                borderRadius: 12,
                fontSize: 10,
                fontWeight: 700,
                background: 'rgba(255, 107, 53, 0.15)',
                color: '#ff6b35',
                border: '1px solid rgba(255, 107, 53, 0.3)',
                marginBottom: 20
              }}>
                {getScriptMeta(selectedScript?.id).requirements}
              </span>
            )}

            {/* Disclaimer mini bar */}
            <div style={{
              background: 'rgba(239, 68, 68, 0.08)',
              border: '1px solid rgba(239, 68, 68, 0.2)',
              borderRadius: 8,
              padding: '10px 14px',
              marginBottom: 20,
              textAlign: 'left',
              fontSize: 11,
              color: 'var(--text-secondary)',
              lineHeight: 1.5
            }}>
              <span style={{ color: '#ef4444', fontWeight: 700 }}>⚠ Detected on real Rust since Feb 20, 2025.</span>
              {' '}For ALKAD Rust (no anticheat) only. Real Rust usage = ban risk.
            </div>

            {/* Action Buttons */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <button
                className="btn btn-primary"
                onClick={handleLaunchScript}
                style={{
                  width: '100%',
                  height: 48,
                  fontWeight: 700,
                  fontSize: 14,
                  background: 'linear-gradient(135deg, #ff6b35, #e85d2c)',
                  border: 'none',
                  boxShadow: '0 4px 20px rgba(255, 107, 53, 0.3)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 10,
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'linear-gradient(135deg, #ff7a4a, #f06a38)';
                  e.currentTarget.style.boxShadow = '0 6px 25px rgba(255, 107, 53, 0.5)';
                  e.currentTarget.style.transform = 'translateY(-1px)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'linear-gradient(135deg, #ff6b35, #e85d2c)';
                  e.currentTarget.style.boxShadow = '0 4px 20px rgba(255, 107, 53, 0.3)';
                  e.currentTarget.style.transform = 'translateY(0)';
                }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="5 3 19 12 5 21 5 3"/>
                </svg>
                Launch KryoK
              </button>

              <button
                className="btn btn-secondary"
                onClick={handleDownloadAlkad}
                style={{
                  width: '100%',
                  height: 40,
                  fontWeight: 600,
                  fontSize: 12,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
                  <polyline points="7 10 12 15 17 10"/>
                  <line x1="12" y1="15" x2="12" y2="3"/>
                </svg>
                Download ALKAD Rust Client
              </button>
            </div>
          </div>

          <button
            className="btn btn-ghost"
            onClick={goBackToCatalog}
            style={{ marginTop: 16, fontSize: 12 }}
          >
            ← Back to Library
          </button>
        </div>
      </div>
    );
  }

  return null;
}
