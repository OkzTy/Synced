import React, { useState, useEffect, useRef } from 'react';
import { api } from '../utils/api';
import cs2Img from '../assets/cs2.jpg';
import eftRadarImg from '../assets/eft_radar.png';

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

const PRODUCTS = [
  {
    id: 'CS2',
    name: 'CS2',
    version: '1.0.0',
    type: 'Direct Memory Access',
    image: cs2Img,
    badgeColor: '#ffb703',
    fallbackFeatures: ['ESP & 2D Box', 'Aimbot with Custom Fov', 'Radar Hack Overlay', 'Weapon Configs']
  },
  {
    id: 'EFT_RADAR',
    name: 'EFT Radar',
    version: '1.0.0',
    type: 'Secondary Device Radar',
    image: eftRadarImg,
    badgeColor: '#2a9d8f',
    fallbackFeatures: ['2D/3D Web Radar Map', 'Player & Item ESP', 'Quest items visibility', 'Full Loot Filters']
  }
];

export default function DMA() {
  const [step, setStep] = useState('catalog'); // 'catalog' -> 'keycheck' -> 'ready'
  const [selectedProductId, setSelectedProductId] = useState(null);
  const [productsMetadata, setProductsMetadata] = useState([]);
  const [productsMap, setProductsMap] = useState({});
  const [keyInput, setKeyInput] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [loading, setLoading] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [hoveredProduct, setHoveredProduct] = useState(null);

  const username = localStorage.getItem('synced-username') || 'OkzTy';

  const loadData = async () => {
    try {
      const res = await api.adminGetProductsMetadata();
      setProductsMetadata(res || []);
    } catch (e) {
      console.warn('Failed to load product metadata:', e);
    }

    const mapStr = localStorage.getItem('synced-products-map') || '{}';
    try {
      setProductsMap(JSON.parse(mapStr));
    } catch (e) {
      setProductsMap({});
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const getProductMeta = (id) => {
    const found = productsMetadata.find((meta) => meta.id?.toUpperCase() === id.toUpperCase());
    const p = PRODUCTS.find((item) => item.id?.toUpperCase() === id.toUpperCase()) || {};

    let featuresList = p.fallbackFeatures || [];
    if (found?.features) {
      try {
        const parsed = typeof found.features === 'string' ? JSON.parse(found.features) : found.features;
        if (Array.isArray(parsed)) featuresList = parsed;
      } catch (e) {}
    } else if (found?.features) {
      featuresList = [found.features];
    }

    return {
      id: found?.id || p.id || id,
      name: found?.name || p.name || id,
      version: found?.version || p.version || '1.0.0',
      type: p.type || (found?.category || 'Direct Memory Access'),
      image: found?.image || p.image,
      image_scale: found?.image_scale || 1.0,
      description: found?.description || p.description || `Premium hardware-assisted cheat client for ${found?.name || p.name || id}. Features rich visualization options.`,
      status: found?.status || p.status || 'Undetected',
      price: found?.price || p.price || (id === 'CS2' ? 10 : 15),
      features: featuresList,
      badgeColor: p.badgeColor || '#ffb703',
      requirements: found?.requirements || ''
    };
  };

  const handleSelectProduct = (productId) => {
    const hasLicense = !!productsMap[productId];
    setSelectedProductId(productId);
    setErrorMsg('');
    setSuccessMsg('');
    setKeyInput('');
    if (hasLicense) {
      setStep('ready');
    } else {
      setStep('keycheck');
    }
  };

  const handleActivate = async () => {
    if (!keyInput.trim()) {
      setErrorMsg('Please enter a license key.');
      return;
    }
    setErrorMsg('');
    setSuccessMsg('');
    setLoading(true);

    try {
      const res = await api.validateProductKey(username, selectedProductId, keyInput.trim());
      if (res.success) {
        setSuccessMsg(`Successfully activated ${selectedProductId}!`);
        const updatedMap = {
          ...productsMap,
          [selectedProductId]: keyInput.trim()
        };
        localStorage.setItem('synced-products-map', JSON.stringify(updatedMap));
        setProductsMap(updatedMap);
        setKeyInput('');
        setTimeout(() => {
          setStep('ready');
        }, 1500);
      } else {
        setErrorMsg(res.error || 'Invalid product license key.');
      }
    } catch (err) {
      setErrorMsg('Error: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleLaunch = () => {
    if (launching) return;
    setLaunching(true);
    setTimeout(() => {
      setLaunching(false);
      alert(`${getProductMeta(selectedProductId)?.name} driver client initialized successfully!`);
    }, 2000);
  };

  const goBackToCatalog = () => {
    setStep('catalog');
    setSelectedProductId(null);
  };

  // ============ CATALOG VIEW ============
  if (step === 'catalog') {
    const dbDmaProducts = productsMetadata.filter(p => p.category?.toUpperCase() === 'DMA');
    const displayProducts = dbDmaProducts.length > 0 ? dbDmaProducts : PRODUCTS;

    return (
      <div className="page-container animate-fade-in">
        <div className="page-header">
          <div>
            <h2 className="page-title">DMA Console</h2>
            <p className="page-subtitle">Hardware-isolated DMA cheats and overlay tools — key required per product</p>
          </div>
        </div>

        {/* Product Grid next to each other */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
          gap: 20,
          marginTop: 8
        }}>
           {displayProducts.map((p) => {
            const meta = getProductMeta(p.id);
            const hasLicense = !!productsMap[p.id];
            const isHovered = hoveredProduct === p.id;
            const imgConfig = parseImageConfig(meta.image, meta.image_scale);

            return (
              <div
                key={p.id}
                className="glass-card"
                style={{
                  borderRadius: 12,
                  overflow: 'hidden',
                  cursor: 'pointer',
                  transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                  border: '1px solid rgba(255,255,255,0.06)',
                  background: 'rgba(255, 255, 255, 0.02)',
                  maxWidth: 240,
                }}
                onClick={() => handleSelectProduct(p.id)}
                onMouseEnter={() => {
                  setHoveredProduct(p.id);
                }}
                onMouseLeave={() => {
                  setHoveredProduct(null);
                }}
              >
                {/* Image Wrap (Reworked to occupy the entire upper area of the product card) */}
                <div
                  style={{
                    width: '100%',
                    height: 200,
                    overflow: 'hidden',
                    position: 'relative',
                    background: '#040408',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    margin: 0,
                    borderRadius: '12px 12px 0 0'
                  }}
                >
                  {imgConfig.url ? (
                    <img
                      src={imgConfig.url}
                      alt={meta.name}
                      style={{
                        width: '100%',
                        height: '100%',
                        objectFit: imgConfig.fit || 'contain',
                        objectPosition: imgConfig.position || 'center',
                        transform: `scale(${imgConfig.scale}) translate(${imgConfig.offsetX}px, ${imgConfig.offsetY}px)`,
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
                  )}
                  {/* Status badge */}
                  <span
                    style={{
                      position: 'absolute',
                      top: 12,
                      right: 12,
                      padding: '3px 8px',
                      borderRadius: 6,
                      fontSize: 9,
                      fontWeight: 700,
                      background: meta.status === 'Undetected'
                        ? 'rgba(16, 185, 129, 0.2)'
                        : 'rgba(245, 158, 11, 0.2)',
                      color: meta.status === 'Undetected' ? '#10b981' : '#f59e0b',
                      border: meta.status === 'Undetected'
                        ? '1px solid rgba(16, 185, 129, 0.3)'
                        : '1px solid rgba(245, 158, 11, 0.3)',
                      backdropFilter: 'blur(8px)',
                    }}
                  >
                    {meta.status}
                  </span>

                  {hasLicense && (
                    <span
                      style={{
                        position: 'absolute',
                        top: 12,
                        left: 12,
                        padding: '3px 8px',
                        borderRadius: 6,
                        fontSize: 9,
                        fontWeight: 700,
                        background: 'rgba(255, 183, 3, 0.2)',
                        color: '#ffb703',
                        border: '1px solid rgba(255, 183, 3, 0.4)',
                        backdropFilter: 'blur(8px)',
                      }}
                    >
                      🔑 Active
                    </span>
                  )}
                </div>

                {/* Card Info */}
                <div style={{ padding: 14 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                    <span style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-primary)' }}>
                      {p.name || meta.name}
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
                  </div>

                  <p style={{
                    fontSize: 11,
                    color: 'var(--text-muted)',
                    margin: '0 0 10px 0',
                    lineHeight: 1.4,
                    height: 32,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical'
                  }}>
                    {meta.description}
                  </p>

                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    paddingTop: 10,
                    borderTop: '1px solid rgba(255,255,255,0.04)',
                    fontSize: 10,
                    color: 'var(--text-muted)',
                  }}>
                    <span>{p.type}</span>
                    <span style={{
                      color: 'var(--accent-primary)',
                      fontWeight: 600,
                      fontSize: 11,
                    }}>
                      Launch →
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // ============ KEY CHECK ============
  if (step === 'keycheck') {
    const meta = getProductMeta(selectedProductId);
    return (
      <div className="page-container animate-fade-in">
        <div className="page-header">
          <div>
            <h2 className="page-title">DMA Console</h2>
            <p className="page-subtitle">License required to access {meta?.name}</p>
          </div>
        </div>

        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '20px 20px 40px',
          textAlign: 'center'
        }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🔑</div>
          <h3 style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 8 }}>
            License Key Required
          </h3>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', maxWidth: 380, marginBottom: 20, lineHeight: 1.6 }}>
            A valid license key is needed to launch <strong>{meta?.name}</strong>.
            Enter your key below to continue.
          </p>

          {/* Product Details Section */}
          <div className="glass-card" style={{ maxWidth: 400, width: '100%', padding: 20, marginBottom: 20, textAlign: 'left', border: '1px solid rgba(255,255,255,0.06)' }}>
            <h4 style={{ margin: '0 0 8px 0', fontSize: 14, fontWeight: 700, color: 'var(--accent-primary)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>{meta?.name} Details</span>
              <span className="badge badge-secondary" style={{ fontSize: 10, background: meta?.status === 'Undetected' ? 'rgba(16,185,129,0.2)' : 'rgba(239,68,68,0.2)', color: meta?.status === 'Undetected' ? '#10b981' : '#ef4444' }}>
                {meta?.status}
              </span>
            </h4>
            {meta?.requirements && (
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
                  {meta.requirements}
                </span>
              </div>
            )}
            <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 12, lineHeight: 1.5 }}>
              {meta?.description}
            </p>
            <div style={{ fontSize: 12, marginBottom: 12 }}>
              <strong>Price: </strong> <span style={{ color: 'var(--success)', fontWeight: 600 }}>${meta?.price}/week</span>
            </div>
            <div>
              <strong style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>Key Features:</strong>
              <ul style={{ margin: 0, paddingLeft: 16, fontSize: 11, color: 'var(--text-secondary)' }}>
                {meta?.features.map((f, i) => <li key={i}>{f}</li>)}
              </ul>
            </div>
          </div>

          <div className="glass-card" style={{ padding: 24, maxWidth: 400, width: '100%', textAlign: 'left' }}>
            <div className="input-group" style={{ marginBottom: 16 }}>
              <label className="input-label">License Key</label>
              <input
                type="text"
                className="input"
                value={keyInput}
                onChange={(e) => { setKeyInput(e.target.value.toUpperCase()); setErrorMsg(''); }}
                placeholder="SYNC-XXXX-..."
                autoFocus
                style={{ background: 'var(--bg-input)', border: '1px solid var(--border-color)', borderRadius: 8, color: 'var(--text-primary)' }}
              />
            </div>

            {errorMsg && (
              <p style={{ color: 'var(--danger)', fontSize: 12, marginBottom: 12, fontWeight: 500 }}>{errorMsg}</p>
            )}

            {successMsg && (
              <p style={{ color: 'var(--success)', fontSize: 12, marginBottom: 12, fontWeight: 500 }}>{successMsg}</p>
            )}

            <button
              className="btn btn-primary"
              onClick={handleActivate}
              disabled={loading}
              style={{ width: '100%', height: 44, fontWeight: 600, fontSize: 14 }}
            >
              {loading ? 'Validating...' : '🔓 Unlock & Continue'}
            </button>
          </div>

          <button
            className="btn btn-ghost"
            onClick={goBackToCatalog}
            style={{ marginTop: 16, fontSize: 12 }}
          >
            ← Back to Console
          </button>
        </div>
      </div>
    );
  }

  // ============ READY VIEW (Launch Screen) ============
  if (step === 'ready') {
    const meta = getProductMeta(selectedProductId);
    const imgConfig = parseImageConfig(meta?.image, meta?.image_scale);
    return (
      <div className="page-container animate-fade-in">
        <div className="page-header">
          <div>
            <h2 className="page-title">DMA Console</h2>
            <p className="page-subtitle">{meta?.name} ready to launch</p>
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
            {/* Image Wrap (contain fitting to prevent zoom cut) */}
            <div
              style={{
                width: '100%',
                height: 220,
                borderRadius: 16,
                overflow: 'hidden',
                margin: '0 auto 20px auto',
                position: 'relative',
                background: '#040408',
                boxShadow: '0 0 30px rgba(255, 107, 53, 0.15)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              <img
                src={imgConfig.url}
                alt={meta?.name}
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: imgConfig.fit || 'contain',
                  objectPosition: imgConfig.position || 'center',
                  transform: `scale(${imgConfig.scale}) translate(${imgConfig.offsetX}px, ${imgConfig.offsetY}px)`,
                }}
              />
            </div>

            <h3 style={{
              fontSize: 24,
              fontWeight: 800,
              color: 'var(--text-primary)',
              marginBottom: 6
            }}>
              {meta?.name}
            </h3>
            <span style={{
              display: 'inline-block',
              padding: '3px 10px',
              borderRadius: 12,
              fontSize: 10,
              fontWeight: 700,
              background: 'rgba(255, 107, 53, 0.15)',
              color: '#ff6b35',
              border: '1px solid rgba(255, 107, 53, 0.3)',
              marginBottom: 16
            }}>
              🎯 Live: {meta?.status}
            </span>

            {meta?.requirements && (
              <div style={{ marginBottom: 16 }}>
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
                  {meta.requirements}
                </span>
              </div>
            )}

            <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 20, lineHeight: 1.5 }}>
              {meta?.description}
            </p>

            {/* Action Buttons */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <button
                className="btn btn-primary"
                onClick={handleLaunch}
                disabled={launching}
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
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="5 3 19 12 5 21 5 3"/>
                </svg>
                {launching ? 'Launching driver...' : `Launch ${meta?.name}`}
              </button>
            </div>
          </div>

          <button
            className="btn btn-ghost"
            onClick={goBackToCatalog}
            style={{ marginTop: 16, fontSize: 12 }}
          >
            ← Back to Console
          </button>
        </div>
      </div>
    );
  }

  return null;
}
