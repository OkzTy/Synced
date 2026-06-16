import React, { useState, useEffect } from 'react';
import { api } from '../utils/api';
import { translations } from '../utils/translations';

export function parseImageConfig(imageVal, fallbackScale = 1.0) {
  if (!imageVal) {
    return { url: '', scale: fallbackScale, offsetX: 0, offsetY: 0, fit: 'contain', position: 'center' };
  }
  if (typeof imageVal === 'string' && imageVal.trim().startsWith('{')) {
    try {
      const parsed = JSON.parse(imageVal);
      return {
        url: parsed.url || '',
        scale: parsed.scale !== undefined ? Number(parsed.scale) : fallbackScale,
        offsetX: parsed.offsetX !== undefined ? Number(parsed.offsetX) : 0,
        offsetY: parsed.offsetY !== undefined ? Number(parsed.offsetY) : 0,
        fit: parsed.fit || 'contain',
        position: parsed.position || 'center'
      };
    } catch (e) {
      // Fallback in case of JSON parse error
    }
  }
  return {
    url: imageVal,
    scale: Number(fallbackScale || 1.0),
    offsetX: 0,
    offsetY: 0,
    fit: 'contain',
    position: 'center'
  };
}

export default function AdminPanel({ language, searchQuery = '' }) {
  const t = (key) => translations[language]?.[key] || translations['en']?.[key] || key;

  const [bridgeStatuses, setBridgeStatuses] = useState({});

  const formatPCInfo = (deviceInfoStr, type = 'main') => {
    if (!deviceInfoStr) return null;
    try {
      const config = JSON.parse(deviceInfoStr);
      let data = null;
      if (type === 'main') {
        data = config.mainSpecs || (!config.specs ? config : null);
      } else {
        data = config.specs;
      }
      
      if (!data) return null;
      
      const cpu = data.cpu?.brand || data.cpu?.model || data.cpuName || 'Unknown CPU';
      const ram = data.ram?.totalGB ? `${data.ram.totalGB} GB` : (data.ramTotalGB ? `${data.ramTotalGB} GB` : 'Unknown RAM');
      const gpu = data.gpus?.[0]?.model || data.gpu?.model || data.gpuName || (data.gpus && data.gpus.length > 0 ? data.gpus[0].model : 'Unknown GPU');
      const os = data.os || data.osName || 'Unknown OS';
      const hostname = data.hostname || 'Unknown Host';
      
      return {
        hostname,
        specs: `${cpu} | ${gpu} | ${ram} | ${os}`
      };
    } catch (e) {
      return null;
    }
  };

  const [activeTab, setActiveTab] = useState('users'); // 'users' or 'licenses'
  const [imageConfigs, setImageConfigs] = useState({});

  const getImageConfig = (pId, dbImageVal, dbScaleVal) => {
    if (imageConfigs[pId]) return imageConfigs[pId];
    return parseImageConfig(dbImageVal, dbScaleVal || 1.0);
  };

  const updateImageConfig = (pId, dbImageVal, dbScaleVal, key, val) => {
    const current = getImageConfig(pId, dbImageVal, dbScaleVal);
    setImageConfigs(prev => ({
      ...prev,
      [pId]: {
        ...current,
        [key]: val
      }
    }));
  };
  const [activeKeyDropdown, setActiveKeyDropdown] = useState(null);
  const [expandedUserId, setExpandedUserId] = useState(null);
  const [users, setUsers] = useState([]);
  const [keys, setKeys] = useState([]);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (activeTab !== 'licenses') return;
    const interval = setInterval(() => {
      setTick(t => t + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [activeTab]);

  // Connection History Logs & Maintenance states
  const [expandedUserTrail, setExpandedUserTrail] = useState({});
  const [maintenanceMode, setMaintenanceMode] = useState(false);
  const [maintLoading, setMaintLoading] = useState(false);
  const [maintenanceServices, setMaintenanceServices] = useState({
    ai_assistant: false,
    dma: false,
    internal: false,
    script: false,
    bridge: false
  });

  useEffect(() => {
    async function fetchMaint() {
      try {
        const status = await api.getMaintenanceStatus();
        setMaintenanceMode(!!status.active);
        if (status.services) {
          setMaintenanceServices({
            ai_assistant: !!status.services.ai_assistant,
            dma: !!status.services.dma,
            internal: !!status.services.internal,
            script: !!status.services.script,
            bridge: !!status.services.bridge
          });
        }
      } catch (e) {
        console.warn('Failed to load maintenance status:', e);
      }
    }
    fetchMaint();
  }, []);

  const handleToggleMaintenance = async (val) => {
    setMaintLoading(true);
    try {
      const res = await api.setMaintenanceStatus({
        active: val,
        services: maintenanceServices
      });
      if (res.success) {
        setMaintenanceMode(val);
        showToast(`Global maintenance mode successfully ${val ? 'enabled' : 'disabled'}!`, 'success');
      } else {
        showToast(res.error || 'Failed to toggle maintenance mode', 'danger');
      }
    } catch (e) {
      showToast('Error: ' + e.message, 'danger');
    } finally {
      setMaintLoading(false);
    }
  };

  const handleToggleServiceMaintenance = async (serviceKey, val) => {
    setMaintLoading(true);
    try {
      const updatedServices = {
        ...maintenanceServices,
        [serviceKey]: val
      };
      const res = await api.setMaintenanceStatus({
        active: maintenanceMode,
        services: updatedServices
      });
      if (res.success) {
        setMaintenanceServices(updatedServices);
        showToast(`Service maintenance updated successfully!`, 'success');
      } else {
        showToast(res.error || 'Failed to update service maintenance status', 'danger');
      }
    } catch (e) {
      showToast('Error: ' + e.message, 'danger');
    } finally {
      setMaintLoading(false);
    }
  };

  const handleToggleExpand = async (userId, username) => {
    if (expandedUserId === userId) {
      setExpandedUserId(null);
    } else {
      setExpandedUserId(userId);
      if (!expandedUserTrail[userId]) {
        try {
          const res = await api.getUserAuditTrail(username, 50);
          setExpandedUserTrail((prev) => ({ ...prev, [userId]: res }));
        } catch (e) {
          console.warn('Failed to load user trail for expanded view:', e);
        }
      }
    }
  };

  // Audit log states
  const [auditEvents, setAuditEvents] = useState({});
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditFilter, setAuditFilter] = useState('all');
  const [auditUserFilter, setAuditUserFilter] = useState('');
  const [selectedUserTrail, setSelectedUserTrail] = useState(null);
  const [userTrailData, setUserTrailData] = useState(null);
  const [localSearch, setLocalSearch] = useState('');

  const filteredUsers = users.filter((user) => {
    const q = localSearch || searchQuery;
    if (!q) return true;
    const query = q.toLowerCase();
    const usernameMatch = user.username?.toLowerCase().includes(query);
    const licenseMatch = user.license_key?.toLowerCase().includes(query);
    const discordMatch = user.discord_id?.toLowerCase().includes(query);
    return usernameMatch || licenseMatch || discordMatch;
  });

  const filteredKeys = keys.filter((k) => {
    const q = localSearch || searchQuery;
    if (!q) return true;
    const query = q.toLowerCase();
    return k.key?.toLowerCase().includes(query) || k.type?.toLowerCase().includes(query);
  });

  // Asynchronously check connection to the secondary PC bridges for online users
  useEffect(() => {
    users.forEach((user) => {
      if (user.device_info && user.isOnline) {
        try {
          const config = JSON.parse(user.device_info);
          if (config.ip && config.port && config.token) {
            api.getBridgeStatus({ ip: config.ip, port: config.port, token: config.token })
              .then((res) => {
                setBridgeStatuses((prev) => ({ ...prev, [user.id]: !!res.success }));
              })
              .catch(() => {
                setBridgeStatuses((prev) => ({ ...prev, [user.id]: false }));
              });
          }
        } catch {}
      }
    });
  }, [users]);
  
  // License key generation form states
  const [keyType, setKeyType] = useState('WEEK'); // 'TRIAL', 'WEEK', 'MONTH', 'LIFETIME'
  const [customDuration, setCustomDuration] = useState('');
  const [maxUsers, setMaxUsers] = useState(1);
  const [customPrefix, setCustomPrefix] = useState('');
  const [keyProduct, setKeyProduct] = useState('');
  const [productsMetadata, setProductsMetadata] = useState([]);
  const [prodMetaLoading, setProdMetaLoading] = useState(false);

  // Create account form states
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [cUsername, setCUsername] = useState('');
  const [cPassword, setCPassword] = useState('');
  const [cLicenseKey, setCLicenseKey] = useState('');
  const [cIsAdmin, setCIsAdmin] = useState(false);

  const handleCreateUser = async (e) => {
    e.preventDefault();
    if (!cUsername.trim() || !cPassword) {
      showToast('Username and Password are required', 'danger');
      return;
    }
    try {
      const res = await api.adminCreateUser(cUsername.trim(), cPassword, '0000', cLicenseKey, cIsAdmin);
      if (res.success) {
        showToast(`Account ${cUsername} created successfully`, 'success');
        setCUsername('');
        setCPassword('');
        setCLicenseKey('');
        setCIsAdmin(false);
        setShowCreateForm(false);
        loadUsers();
      } else {
        showToast(res.error || 'Failed to create account', 'danger');
      }
    } catch (err) {
      showToast('Error: ' + err.message, 'danger');
    }
  };

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };



  const loadUsers = async () => {
    setLoading(true);
    try {
      const res = await api.adminGetUsers();
      setUsers(res || []);
    } catch (e) {
      showToast('Failed to load users', 'danger');
    } finally {
      setLoading(false);
    }
  };

  const loadKeys = async () => {
    setLoading(true);
    try {
      const res = await api.adminGetKeys();
      setKeys(res || []);
    } catch (e) {
      showToast('Failed to load license keys', 'danger');
    } finally {
      setLoading(false);
    }
  };

  const loadProductsMetadata = async () => {
    setProdMetaLoading(true);
    try {
      const res = await api.adminGetProductsMetadata();
      setProductsMetadata(res || []);
    } catch (e) {
      showToast('Failed to load products metadata', 'danger');
    } finally {
      setProdMetaLoading(false);
    }
  };

  const getProductMeta = (productId) => {
    const found = productsMetadata.find(p => p.id?.toUpperCase() === productId.toUpperCase());
    if (found) {
      let features = found.features;
      if (typeof features === 'string') {
        try {
          features = JSON.parse(features);
        } catch(e) {}
      }
      return {
        description: found.description || '',
        status: found.status || 'Undetected',
        price: found.price || 0,
        features: Array.isArray(features) ? features.join(', ') : (features || ''),
        image: found.image || '',
        image_scale: found.image_scale || 1.0,
        version: found.version || '1.0.0',
        requirements: found.requirements || ''
      };
    }
    if (productId === 'CS2') {
      return { description: 'CS2 DMA product with premium visual esp.', status: 'Undetected', price: 10, features: 'ESP, Aimbot, Radar, Web overlay', image: '', image_scale: 1.0, version: '1.0.0', requirements: '' };
    } else if (productId === 'EFT_RADAR') {
      return { description: 'EFT 2D/3D Map Radar for secondary devices.', status: 'Undetected', price: 15, features: 'Loot ESP, Player ESP, Web overlay, 2D/3D View', image: '', image_scale: 1.0, version: '1.0.0', requirements: '' };
    } else {
      return { description: 'KryoK scripting system for Rust Alkad.', status: 'Undetected', price: 8, features: 'No recoil, Auto farm, Enemy warning', image: '', image_scale: 1.0, version: '2.4.1', requirements: '🔥 ALKAD Rust (No EAC)' };
    }
  };

  const handleUpdateProduct = async (e, productId) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const description = formData.get('description');
    const status = formData.get('status');
    const price = Number(formData.get('price'));
    const version = formData.get('version');
    const requirements = formData.get('requirements');
    const featuresRaw = formData.get('features');
    const features = featuresRaw.split(',').map(f => f.trim()).filter(Boolean);

    const prod = productsMetadata.find(p => p.id === productId) || {};
    const name = prod.name || productId;
    const category = prod.category || 'DMA';

    const imgCfg = imageConfigs[productId] || parseImageConfig(prod.image, prod.image_scale || 1.0);
    const serializedImage = JSON.stringify(imgCfg);

    try {
      const res = await api.adminUpdateProductMetadata(productId, description, status, price, features, serializedImage, imgCfg.scale, name, category, version, requirements);
      if (res.success) {
        showToast(`Product ${name} metadata updated!`, 'success');
        loadProductsMetadata();
      } else {
        showToast(res.error || 'Failed to update product metadata', 'danger');
      }
    } catch (err) {
      showToast('Error: ' + err.message, 'danger');
    }
  };

  useEffect(() => {
    if (activeTab === 'users') {
      loadUsers();
    } else if (activeTab === 'licenses') {
      loadKeys();
    } else if (activeTab === 'audit') {
      loadAuditEvents();
    } else if (activeTab === 'products') {
      loadProductsMetadata();
    }
  }, [activeTab]);

  const loadAuditEvents = async () => {
    setAuditLoading(true);
    try {
      const tableFilter = auditFilter === 'all' ? undefined : auditFilter;
      const res = await api.getAllAuditEvents(500, { table: tableFilter });
      setAuditEvents(res || {});
    } catch (e) {
      showToast('Failed to load audit logs', 'danger');
    } finally {
      setAuditLoading(false);
    }
  };

  const loadUserTrail = async (username) => {
    setSelectedUserTrail(username);
    try {
      const res = await api.getUserAuditTrail(username, 100);
      setUserTrailData(res);
    } catch (e) {
      showToast('Failed to load user trail', 'danger');
    }
  };

  useEffect(() => {
    if (activeTab === 'audit' && auditFilter) {
      loadAuditEvents();
    }
  }, [auditFilter]);

  const handleDeleteUser = async (userId, username) => {
    if (username === 'OkzTy') {
      showToast('Cannot delete primary admin account', 'danger');
      return;
    }
    if (!window.confirm(`Are you sure you want to delete user: ${username}?`)) return;

    try {
      const res = await api.adminDeleteUser(userId);
      if (res.success) {
        showToast(`User ${username} deleted successfully`, 'success');
        loadUsers();
      } else {
        showToast(res.error || 'Failed to delete user', 'danger');
      }
    } catch (e) {
      showToast('Error: ' + e.message, 'danger');
    }
  };

  const handleCreateKey = async () => {
    try {
      const res = await api.adminCreateKey({
        type: keyType,
        durationDays: customDuration ? parseInt(customDuration, 10) : null,
        maxUsers: maxUsers ? parseInt(maxUsers, 10) : 1,
        customPrefix: customPrefix || null,
        product: keyProduct || null
      });
      if (res.success) {
        showToast(`Successfully created key: ${res.data?.key}!`, 'success');
        setCustomDuration('');
        setMaxUsers(1);
        setCustomPrefix('');
        setKeyProduct('');
        loadKeys();
      } else {
        showToast(res.error || 'Failed to generate key', 'danger');
      }
    } catch (e) {
      showToast('Error: ' + e.message, 'danger');
    }
  };

  const [confirmModal, setConfirmModal] = useState({ show: false, title: '', message: '', onConfirm: null });

  const showConfirm = (title, message, onConfirm) => {
    setConfirmModal({ show: true, title, message, onConfirm });
  };

  const handleRevokeKey = (keyString) => {
    showConfirm(
      'Revoke License Key',
      `Are you sure you want to revoke license key: ${keyString}?`,
      async () => {
        try {
          const res = await api.adminRevokeKey(keyString);
          if (res.success) {
            showToast('License key revoked', 'success');
            loadKeys();
          } else {
            showToast(res.error || 'Failed to revoke key', 'danger');
          }
        } catch (e) {
          showToast('Error: ' + e.message, 'danger');
        }
      }
    );
  };

  const handleResetKeyHWID = (keyString) => {
    showConfirm(
      'Reset License Key HWID',
      `Are you sure you want to reset HWID lock for license key: ${keyString}? This will allow it to be bound to a different machine/account.`,
      async () => {
        try {
          const res = await api.adminResetKeyHWID(keyString);
          if (res.success) {
            showToast('License key HWID reset successfully!', 'success');
            loadKeys();
          } else {
            showToast(res.error || 'Failed to reset HWID', 'danger');
          }
        } catch (e) {
          showToast('Error: ' + e.message, 'danger');
        }
      }
    );
  };

  const handleDeleteKey = (keyString) => {
    showConfirm(
      'Delete License Key',
      `Are you sure you want to permanently DELETE license key: ${keyString}? This action cannot be undone.`,
      async () => {
        try {
          const res = await api.adminDeleteKey(keyString);
          if (res.success) {
            showToast('License key permanently deleted', 'success');
            loadKeys();
          } else {
            showToast(res.error || 'Failed to delete key', 'danger');
          }
        } catch (e) {
          showToast('Error: ' + e.message, 'danger');
        }
      }
    );
  };

  return (
    <div className="settings-grid animate-slide-up" style={{ maxWidth: 1250, margin: '0 auto' }}>
      <div className="page-header">
        <h1 className="page-title">🛡️ Admin Control Panel</h1>
        <p className="page-subtitle">Centralized user database authority and license code generation.</p>
      </div>

      {toast && (
        <div 
          className={`badge badge-${toast.type} animate-fade-in`} 
          style={{ 
            position: 'fixed', 
            top: 24, 
            right: 24, 
            zIndex: 10000, 
            padding: '12px 20px', 
            borderRadius: 8, 
            fontSize: 14, 
            fontWeight: 600,
            boxShadow: '0 4px 20px rgba(0,0,0,0.3)'
          }}
        >
          {toast.message}
        </div>
      )}

      {/* Tabs Menu */}
      <div className="process-toolbar" style={{ marginBottom: 20 }}>
        <div className="process-tabs">
          <button
            className={`process-tab ${activeTab === 'users' ? 'active' : ''}`}
            onClick={() => setActiveTab('users')}
          >
            👥 Accounts database ({users.length})
          </button>
          <button
            className={`process-tab ${activeTab === 'licenses' ? 'active' : ''}`}
            onClick={() => setActiveTab('licenses')}
          >
            🔑 Generated Keys ({keys.length})
          </button>
          <button
            className={`process-tab ${activeTab === 'audit' ? 'active' : ''}`}
            onClick={() => setActiveTab('audit')}
          >
            📋 Audit Logs
          </button>
          <button
            className={`process-tab ${activeTab === 'products' ? 'active' : ''}`}
            onClick={() => setActiveTab('products')}
          >
            📦 Products metadata
          </button>
          <button
            className={`process-tab ${activeTab === 'system' ? 'active' : ''}`}
            onClick={() => setActiveTab('system')}
          >
            ⚙️ System Settings
          </button>
        </div>
        
        <button
          className="btn btn-secondary btn-sm"
          onClick={activeTab === 'users' ? loadUsers : activeTab === 'licenses' ? loadKeys : activeTab === 'audit' ? loadAuditEvents : () => {}}
          disabled={loading}
          style={{ marginLeft: 'auto' }}
        >
          {loading ? '⏳' : '🔄'} Refresh
        </button>

        {activeTab === 'users' && (
          <button
            className="btn btn-primary btn-sm"
            onClick={() => setShowCreateForm(!showCreateForm)}
            style={{ marginLeft: 12, display: 'inline-flex', alignItems: 'center', gap: 4 }}
          >
            ➕ Create Account
          </button>
        )}
      </div>

      {activeTab === 'users' && showCreateForm && (
        <form onSubmit={handleCreateUser} className="glass-card" style={{ padding: 20, marginBottom: 20, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16, alignItems: 'flex-end' }}>
          <div className="input-group" style={{ margin: 0 }}>
            <label className="input-label" style={{ fontSize: 11 }}>Username</label>
            <input type="text" className="input" style={{ height: 34, fontSize: 12, background: 'var(--bg-input)', border: '1px solid var(--border-color)', borderRadius: 8, color: 'var(--text-primary)' }} value={cUsername} onChange={(e) => setCUsername(e.target.value)} required />
          </div>
          <div className="input-group" style={{ margin: 0 }}>
            <label className="input-label" style={{ fontSize: 11 }}>Password</label>
            <input type="password" className="input" style={{ height: 34, fontSize: 12, background: 'var(--bg-input)', border: '1px solid var(--border-color)', borderRadius: 8, color: 'var(--text-primary)' }} value={cPassword} onChange={(e) => setCPassword(e.target.value)} required />
          </div>
          <div className="input-group" style={{ margin: 0 }}>
            <label className="input-label" style={{ fontSize: 11 }}>License Key (Optional)</label>
            <input type="text" className="input" style={{ height: 34, fontSize: 12, background: 'var(--bg-input)', border: '1px solid var(--border-color)', borderRadius: 8, color: 'var(--text-primary)' }} value={cLicenseKey} onChange={(e) => setCLicenseKey(e.target.value.toUpperCase())} placeholder="SYNC-XXXX-..." />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, height: 34 }}>
            <input type="checkbox" id="cIsAdmin" checked={cIsAdmin} onChange={(e) => setCIsAdmin(e.target.checked)} style={{ cursor: 'pointer' }} />
            <label htmlFor="cIsAdmin" style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', cursor: 'pointer' }}>Admin Account</label>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="submit" className="btn btn-primary" style={{ height: 34, fontSize: 12, flex: 1, fontWeight: 600 }}>Create</button>
            <button type="button" className="btn btn-secondary" style={{ height: 34, fontSize: 12, fontWeight: 500 }} onClick={() => setShowCreateForm(false)}>Cancel</button>
          </div>
        </form>
      )}

      {/* Users View */}
      {activeTab === 'users' && (
        <div className="process-table-wrapper">
          <table className="process-table">
            <thead>
              <tr>
                <th>Username</th>
                <th>Status</th>
                <th>Bound License</th>
                <th>Last Login</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredUsers.map((user) => {
                const isExpanded = expandedUserId === user.id;
                // Determine status
                let statusText = 'OFFLINE';
                let statusColor = 'var(--text-muted)';
                if (user.isOnline) {
                  statusText = 'ONLINE';
                  statusColor = 'var(--success)';
                }

                return (
                  <React.Fragment key={user.id}>
                    <tr 
                      onClick={() => setExpandedUserId(isExpanded ? null : user.id)}
                      style={{ 
                        cursor: 'pointer', 
                        background: isExpanded ? 'rgba(255,255,255,0.03)' : 'transparent',
                        transition: 'background 0.2s ease'
                      }}
                    >
                      <td style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <div style={{
                          width: 32, height: 32, borderRadius: 16,
                          background: 'linear-gradient(135deg, var(--accent-primary), var(--accent-secondary))',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: 14, fontWeight: 700, color: '#fff', overflow: 'hidden'
                        }}>
                          {user.pfp_type === 'initials' || !user.pfp_type ? (
                            <div style={{ width: '100%', height: '100%', background: `linear-gradient(135deg, hsl(${Math.abs(user.username.charCodeAt(0) * 20 % 360)}, 70%, 50%), hsl(${Math.abs(user.username.charCodeAt(user.username.length - 1) * 20 % 360)}, 70%, 30%))`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 'bold' }}>
                              {user.username?.[0]?.toUpperCase() || '?'}
                            </div>
                          ) : (user.pfp_type === 'base64' || user.pfp_type === 'url') ? (
                            <img src={user.pfp_value} style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={(e) => { e.target.style.display='none'; e.target.parentNode.innerHTML = `<div style="width: 100%; height: 100%; background: linear-gradient(135deg, #6366f1, #3b82f6); display: flex; align-items: center; justify-content: center; color: white; font-weight: bold;">${user.username?.[0]?.toUpperCase() || '?'}</div>`; }} />
                          ) : (
                            <img src={`/assets/pfps/${user.pfp_type}.png`} style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={(e) => { e.target.style.display='none'; e.target.parentNode.innerHTML = `<div style="width: 100%; height: 100%; background: linear-gradient(135deg, #6366f1, #3b82f6); display: flex; align-items: center; justify-content: center; color: white; font-weight: bold;">${user.username?.[0]?.toUpperCase() || '?'}</div>`; }} />
                          )}
                        </div>
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ fontWeight: 600 }}>{user.username}</span>
                            <span 
                              className={`badge ${user.is_admin ? 'badge-success' : 'badge-secondary'}`}
                              style={{ 
                                fontSize: 9, 
                                padding: '2px 6px', 
                                fontWeight: 600,
                                background: user.is_admin ? 'rgba(34, 197, 94, 0.2)' : 'rgba(148, 163, 184, 0.2)',
                                border: user.is_admin ? '1px solid rgba(34, 197, 94, 0.4)' : '1px solid rgba(148, 163, 184, 0.4)',
                                color: user.is_admin ? '#22c55e' : '#94a3b8'
                              }}
                            >
                              {user.is_admin ? '🛡️ Admin' : '👤 User'}
                            </span>
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{user.id}</div>
                        </div>
                      </td>
                      <td>
                        <span style={{ color: statusColor, fontWeight: 600 }}>{statusText}</span>
                      </td>
                      <td>
                        <span className="text-mono text-xs" style={{ opacity: 0.8 }}>
                          {user.license_key || 'no liscnece key'}
                        </span>
                      </td>
                      <td style={{ fontSize: 12 }}>{user.last_login || 'Never'}</td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button
                            className="btn btn-danger btn-sm"
                            onClick={() => handleDeleteUser(user.id, user.username)}
                            disabled={user.username === 'OkzTy'}
                            style={user.username === 'OkzTy' ? { opacity: 0.5, cursor: 'not-allowed', padding: '4px 8px' } : { padding: '4px 8px' }}
                          >
                            ✕
                          </button>
                        </div>
                      </td>
                    </tr>

                    {isExpanded && (
                      <tr style={{ background: 'rgba(255,255,255,0.015)' }}>
                        <td colSpan="5" style={{ padding: '16px 20px', borderTop: 'none' }}>
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16 }}>

                            {/* Monitoring Overview */}
                            <div className="glass-card" style={{ padding: 12, border: '1px solid rgba(255,255,255,0.05)', background: 'rgba(255,255,255,0.02)' }}>
                              <h4 style={{ margin: '0 0 10px 0', fontSize: 12, color: 'var(--accent-primary)', fontWeight: 700 }}>📡 Monitoring Overview</h4>
                              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 10 }}>
                                <div style={{ background: 'var(--bg-card)', borderRadius: 8, padding: 8, textAlign: 'center' }}>
                                  <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--success)' }}>{user.loginCount || 0}</div>
                                  <div style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Logins</div>
                                </div>
                                <div style={{ background: 'var(--bg-card)', borderRadius: 8, padding: 8, textAlign: 'center' }}>
                                  <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--danger)' }}>{user.failedLogins || 0}</div>
                                  <div style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Failed</div>
                                </div>
                                <div style={{ background: 'var(--bg-card)', borderRadius: 8, padding: 8, textAlign: 'center' }}>
                                  <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--warning)' }}>{user.logoutCount || 0}</div>
                                  <div style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Logouts</div>
                                </div>
                              </div>
                              <div style={{ fontSize: 11, display: 'flex', flexDirection: 'column', gap: 4, opacity: 0.85 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                  <strong>Public IP:</strong> <span className="text-mono" style={{ fontSize: 10 }}>{user.latest_ip || user.lastIp || 'N/A'}</span>
                                </div>
                                {user.latest_geo && (
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2, marginBottom: 2 }}>
                                    <strong>Location:</strong> <span style={{ fontSize: 10 }}>{user.latest_geo.city}, {user.latest_geo.country}</span>
                                    <button 
                                      className="btn btn-secondary btn-sm" 
                                      style={{ fontSize: 9, padding: '2px 6px', height: 'auto', background: 'rgba(255,255,255,0.1)' }}
                                      onClick={(e) => { e.stopPropagation(); window.open(`https://www.google.com/maps/search/?api=1&query=${user.latest_geo.lat},${user.latest_geo.lon}`, '_blank'); }}
                                    >
                                      📍 Map
                                    </button>
                                  </div>
                                )}
                                <div><strong>Local IP:</strong> <span className="text-mono" style={{ fontSize: 10 }}>{user.lastLocalIp || 'N/A'}</span></div>
                                <div><strong>MAC:</strong> <span className="text-mono" style={{ fontSize: 10 }}>{user.lastMac || 'N/A'}</span></div>
                                <div><strong>Hostname:</strong> {user.latestHostname || 'N/A'}</div>
                                <div><strong>First Login:</strong> {user.first_login ? new Date(user.first_login).toLocaleString() : 'Never'}</div>
                                <div><strong>Last Login:</strong> {user.last_login ? new Date(user.last_login).toLocaleString() : 'Never'}</div>
                                <div><strong>Last Logout:</strong> {user.last_logout ? new Date(user.last_logout).toLocaleString() : 'Never'}</div>
                                <div><strong>Sessions:</strong> {user.totalSessions || 0}</div>
                              </div>
                            </div>

                            {/* Device Specs */}
                            <div className="glass-card" style={{ padding: 12, border: '1px solid rgba(255,255,255,0.05)', background: 'rgba(255,255,255,0.02)' }}>
                              <h4 style={{ margin: '0 0 10px 0', fontSize: 12, color: 'var(--accent-secondary)', fontWeight: 700 }}>🖥️ Device Specs</h4>
                              {(user.latestCpu || user.device_info) ? (
                                <div style={{ fontSize: 11, display: 'flex', flexDirection: 'column', gap: 4, opacity: 0.85 }}>
                                  <div><strong>CPU:</strong> {user.latestCpu || 'N/A'}</div>
                                  <div><strong>GPU:</strong> {user.latestGpu || 'N/A'}</div>
                                  <div><strong>RAM:</strong> {user.latestRam || 'N/A'}</div>
                                  <div><strong>OS:</strong> {user.latestOs || 'N/A'}</div>
                                  <div><strong>Hostname:</strong> {user.latestHostname || 'N/A'}</div>
                                  <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={user.hwid}>
                                    <strong>HWID:</strong> <span className="text-mono" style={{ fontSize: 10 }}>{user.hwid || 'N/A'}</span>
                                  </div>
                                </div>
                              ) : (
                                <span style={{ opacity: 0.5, fontSize: 11 }}>No device data yet — will populate on next login</span>
                              )}
                            </div>

                            {/* Profile & Preferences */}
                            <div className="glass-card" style={{ padding: 12, border: '1px solid rgba(255,255,255,0.05)', background: 'rgba(255,255,255,0.02)' }}>
                              <h4 style={{ margin: '0 0 10px 0', fontSize: 12, color: 'var(--text-primary)', fontWeight: 700 }}>👤 Profile & Preferences</h4>
                              <div style={{ fontSize: 11, display: 'flex', flexDirection: 'column', gap: 4, opacity: 0.85 }}>
                                <div><strong>Role:</strong> {user.is_admin ? '🛡️ Admin' : '👤 User'}</div>
                                <div><strong>Theme:</strong> {user.theme || 'dark'}</div>
                                <div><strong>Language:</strong> {user.language || 'en'}</div>
                                <div><strong>Discord:</strong> {user.discord_id ? '✅ Linked' : '❌ Not linked'}</div>
                                <div><strong>Created:</strong> {user.created_at ? new Date(user.created_at).toLocaleString() : '—'}</div>
                                <div><strong>License:</strong> <span className="text-mono" style={{ fontSize: 10 }}>{user.license_key || 'None'}</span></div>
                                <div style={{ marginTop: 4 }}>
                                  <strong>Product Keys:</strong>
                                  <div style={{ paddingLeft: 8, fontSize: 10, display: 'flex', flexDirection: 'column', gap: 2, marginTop: 2 }}>
                                    {(() => {
                                      let map = {};
                                      try {
                                        if (user.products_map) map = JSON.parse(user.products_map);
                                      } catch (e) {}
                                      return (
                                        <>
                                          <div>CS2: <span className="text-mono" style={{ color: 'var(--accent-primary)' }}>{map.CS2 || 'None'}</span></div>
                                          <div>EFT Radar: <span className="text-mono" style={{ color: 'var(--success)' }}>{map.EFT_RADAR || 'None'}</span></div>
                                          <div>KryoK: <span className="text-mono" style={{ color: 'var(--warning)' }}>{map.KRYOK || 'None'}</span></div>
                                        </>
                                      );
                                    })()}
                                  </div>
                                </div>
                                <div style={{ marginTop: 6, borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: 6 }}>
                                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <div>
                                      <strong>Password:</strong> <span style={{ fontSize: 12, fontWeight: '500', color: 'var(--accent-secondary)', marginLeft: 6 }}>{user.plain_password || 'N/A'}</span>
                                    </div>
                                    {user.plain_password && (
                                      <button 
                                        className="btn btn-secondary btn-xs"
                                        style={{ fontSize: 9, padding: '2px 6px', height: 'auto', background: 'rgba(255,255,255,0.1)' }}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          navigator.clipboard.writeText(user.plain_password);
                                          showToast('Password copied!', 'success');
                                        }}
                                      >
                                        Copy
                                      </button>
                                    )}
                                  </div>
                                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
                                    <div>
                                      <strong>PIN:</strong> <span style={{ fontSize: 12, fontWeight: '500', color: 'var(--accent-secondary)', marginLeft: 6 }}>{user.plain_pin || 'N/A'}</span>
                                    </div>
                                    {user.plain_pin && (
                                      <button 
                                        className="btn btn-secondary btn-xs"
                                        style={{ fontSize: 9, padding: '2px 6px', height: 'auto', background: 'rgba(255,255,255,0.1)' }}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          navigator.clipboard.writeText(user.plain_pin);
                                          showToast('PIN copied!', 'success');
                                        }}
                                      >
                                        Copy
                                      </button>
                                    )}
                                  </div>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
                                  <button
                                    className="btn btn-secondary btn-sm"
                                    style={{ fontSize: 10, padding: '4px 10px', fontWeight: 600 }}
                                    onClick={async (e) => {
                                      e.stopPropagation();
                                      if (user.username === 'OkzTy' && user.is_admin) {
                                        showToast('Cannot demote primary admin', 'danger');
                                        return;
                                      }
                                      try {
                                        const newAdminStatus = !user.is_admin;
                                        const res = await api.adminSetUserAdminStatus(user.id, newAdminStatus);
                                        if (res.success) {
                                          showToast(`Role updated for ${user.username}`, 'success');
                                          loadUsers();
                                        } else {
                                          showToast(res.error || 'Failed to update role', 'danger');
                                        }
                                      } catch (err) {
                                        showToast('Error: ' + err.message, 'danger');
                                      }
                                    }}
                                  >
                                    {user.is_admin ? 'Demote to User' : 'Promote to Admin'}
                                  </button>
                                </div>
                              </div>
                            </div>

                            {/* Secondary PC Details */}
                            <div className="glass-card" style={{ padding: 12, border: '1px solid rgba(255,255,255,0.05)', background: 'rgba(255,255,255,0.02)' }}>
                              <h4 style={{ margin: '0 0 10px 0', fontSize: 12, color: 'var(--text-primary)', fontWeight: 700 }}>📡 Secondary PC</h4>
                              {user.secondary_device ? (
                                <div style={{ fontSize: 11, display: 'flex', flexDirection: 'column', gap: 4, opacity: 0.85 }}>
                                  <div><strong>Host:</strong> {user.secondary_device.hostname}</div>
                                  <div><strong>Specs:</strong> {user.secondary_device.specs}</div>
                                  <div><strong>Bridge:</strong> <span className={`badge ${bridgeStatuses[user.id] ? 'badge-success' : 'badge-danger'}`} style={{ fontSize: 9, padding: '1px 5px' }}>{bridgeStatuses[user.id] ? 'ONLINE' : 'OFFLINE'}</span></div>
                                </div>
                              ) : (
                                <span style={{ opacity: 0.5, fontSize: 11 }}>No secondary PC linked</span>
                              )}
                            </div>

                            {/* License Key Management */}
                             <div className="glass-card" style={{ padding: 12, border: '1px solid rgba(255,255,255,0.05)', background: 'rgba(255,255,255,0.02)', display: 'flex', flexDirection: 'column', gap: 8 }}>
                               <h4 style={{ margin: '0 0 4px 0', fontSize: 12, color: 'var(--text-primary)', fontWeight: 600 }}>🔑 Product Keys Management</h4>
                               <p style={{ margin: 0, fontSize: 10, color: 'var(--text-muted)' }}>Bind or update individual keys per cheat.</p>
                               {['CS2', 'EFT_RADAR', 'KRYOK'].map((prod) => {
                                 let map = {};
                                 try {
                                   if (user.products_map) map = JSON.parse(user.products_map);
                                 } catch (e) {}
                                 const currentKey = map[prod] || '';
                                 return (
                                   <div key={prod} style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 2 }}>
                                     <span style={{ fontSize: 10, fontWeight: 700, width: 70, color: prod === 'CS2' ? 'var(--accent-primary)' : prod === 'EFT_RADAR' ? 'var(--success)' : 'var(--warning)' }}>{prod === 'EFT_RADAR' ? 'EFT' : prod}:</span>
                                     <input 
                                       type="text" 
                                       className="input" 
                                       placeholder="SYNC-XXXX-..."
                                       id={`assign-key-${user.username}-${prod}`}
                                       defaultValue={currentKey}
                                       style={{ fontSize: 10, height: 26, flex: 1, padding: '0 6px', background: 'var(--bg-input)', border: '1px solid var(--border-color)', borderRadius: 4, color: 'var(--text-primary)' }}
                                     />
                                     <button 
                                       className="btn btn-primary" 
                                       style={{ fontSize: 10, padding: '0 8px', height: 26, fontWeight: 600 }}
                                       onClick={async (e) => {
                                         e.stopPropagation();
                                         const keyInput = document.getElementById(`assign-key-${user.username}-${prod}`);
                                         const key = keyInput?.value?.trim();
                                         try {
                                           const res = await api.adminAssignProductKey(user.username, prod, key);
                                           if (res.success) {
                                             showToast(`Key for ${prod} updated for ${user.username}`, 'success');
                                             loadUsers();
                                           } else {
                                             showToast(res.error || `Failed to update ${prod} key`, 'danger');
                                           }
                                         } catch (err) {
                                           showToast('Error: ' + err.message, 'danger');
                                         }
                                       }}
                                     >
                                       Save
                                     </button>
                                   </div>
                                 );
                               })}
                             </div>

                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
              {filteredUsers.length === 0 && (
                <tr>
                  <td colSpan="5" style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
                    No users found in database.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Licenses View */}
      {activeTab === 'licenses' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Key Generator Card */}
          <div className="glass-card settings-section" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16, alignItems: 'flex-end', overflow: 'visible' }}>
            <div className="input-group" style={{ margin: 0, position: 'relative' }}>
              <label className="input-label">Select License Tier</label>
              <div 
                className="input" 
                style={{ background: 'var(--bg-input)', border: '1px solid var(--border-color)', borderRadius: 8, height: 38, padding: '0 10px', color: 'var(--text-primary)', width: '100%', display: 'flex', alignItems: 'center', cursor: 'pointer', position: 'relative' }}
                onClick={(e) => {
                  const t = e.currentTarget.nextElementSibling;
                  t.style.display = t.style.display === 'none' ? 'block' : 'none';
                }}
              >
                {keyType === 'TRIAL' ? 'Trial (1 Day)' : keyType === 'WEEK' ? 'Weekly (7 Days)' : keyType === 'MONTH' ? 'Monthly (30 Days)' : 'Lifetime'}
                <span style={{ marginLeft: 'auto', fontSize: 10 }}>▼</span>
              </div>
              <div style={{ display: 'none', position: 'absolute', top: '100%', left: 0, right: 0, background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: 8, zIndex: 100, marginTop: 4, overflow: 'hidden', boxShadow: '0 8px 16px rgba(0,0,0,0.4)' }}>
                {['TRIAL', 'WEEK', 'MONTH', 'LIFETIME'].map(t => (
                  <div 
                    key={t}
                    style={{ padding: '10px 14px', cursor: 'pointer', borderBottom: '1px solid var(--border-color)', fontSize: 13, background: keyType === t ? 'rgba(255,255,255,0.05)' : 'transparent' }}
                    onClick={(e) => { setKeyType(t); e.currentTarget.parentElement.style.display = 'none'; }}
                    onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
                    onMouseLeave={(e) => e.currentTarget.style.background = keyType === t ? 'rgba(255,255,255,0.05)' : 'transparent'}
                  >
                    {t === 'TRIAL' ? 'Trial (1 Day)' : t === 'WEEK' ? 'Weekly (7 Days)' : t === 'MONTH' ? 'Monthly (30 Days)' : 'Lifetime'}
                  </div>
                ))}
              </div>
            </div>

            <div className="input-group" style={{ margin: 0, position: 'relative' }}>
              <label className="input-label">Select Product</label>
              <div 
                className="input" 
                style={{ background: 'var(--bg-input)', border: '1px solid var(--border-color)', borderRadius: 8, height: 38, padding: '0 10px', color: 'var(--text-primary)', width: '100%', display: 'flex', alignItems: 'center', cursor: 'pointer', position: 'relative' }}
                onClick={(e) => {
                  const t = e.currentTarget.nextElementSibling;
                  t.style.display = t.style.display === 'none' ? 'block' : 'none';
                }}
              >
                {keyProduct === '' ? 'Global (All Products)' : keyProduct === 'CS2' ? 'CS2 (DMA)' : keyProduct === 'EFT_RADAR' ? 'EFT Radar (DMA)' : 'KryoK (Scripting)'}
                <span style={{ marginLeft: 'auto', fontSize: 10 }}>▼</span>
              </div>
              <div style={{ display: 'none', position: 'absolute', top: '100%', left: 0, right: 0, background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: 8, zIndex: 100, marginTop: 4, overflow: 'hidden', boxShadow: '0 8px 16px rgba(0,0,0,0.4)' }}>
                {[
                  { value: '', label: 'Global (All Products)' },
                  { value: 'CS2', label: 'CS2 (DMA)' },
                  { value: 'EFT_RADAR', label: 'EFT Radar (DMA)' },
                  { value: 'KRYOK', label: 'KryoK (Scripting)' }
                ].map(p => (
                  <div 
                    key={p.value}
                    style={{ padding: '10px 14px', cursor: 'pointer', borderBottom: '1px solid var(--border-color)', fontSize: 13, background: keyProduct === p.value ? 'rgba(255,255,255,0.05)' : 'transparent' }}
                    onClick={(e) => { setKeyProduct(p.value); e.currentTarget.parentElement.style.display = 'none'; }}
                    onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
                    onMouseLeave={(e) => e.currentTarget.style.background = keyProduct === p.value ? 'rgba(255,255,255,0.05)' : 'transparent'}
                  >
                    {p.label}
                  </div>
                ))}
              </div>
            </div>
            
            <div className="input-group" style={{ margin: 0 }}>
              <label className="input-label">Custom Duration (Days)</label>
              <input 
                type="number" 
                className="input" 
                placeholder={keyType === 'LIFETIME' ? 'None (Lifetime)' : 'Use Tier Default'}
                disabled={keyType === 'LIFETIME'}
                value={customDuration}
                onChange={(e) => setCustomDuration(e.target.value)}
                style={{ background: 'var(--bg-input)', border: '1px solid var(--border-color)', borderRadius: 8, height: 38, padding: '0 10px', color: 'var(--text-primary)', width: '100%' }}
              />
            </div>

            <div className="input-group" style={{ margin: 0 }}>
              <label className="input-label">Max Allowed Users</label>
              <input 
                type="number" 
                className="input" 
                min={1}
                value={maxUsers}
                onChange={(e) => setMaxUsers(e.target.value)}
                style={{ background: 'var(--bg-input)', border: '1px solid var(--border-color)', borderRadius: 8, height: 38, padding: '0 10px', color: 'var(--text-primary)', width: '100%' }}
              />
            </div>

            <div className="input-group" style={{ margin: 0 }}>
              <label className="input-label">Custom Prefix (Optional)</label>
              <input 
                type="text" 
                className="input" 
                placeholder="e.g. PARTNER"
                value={customPrefix}
                onChange={(e) => setCustomPrefix(e.target.value)}
                style={{ background: 'var(--bg-input)', border: '1px solid var(--border-color)', borderRadius: 8, height: 38, padding: '0 10px', color: 'var(--text-primary)', width: '100%' }}
              />
            </div>

            <button 
              className="btn btn-primary" 
              onClick={handleCreateKey}
              style={{ height: 38, padding: '0 24px', fontWeight: 600, width: '100%' }}
            >
              ⚡ Generate
            </button>
          </div>

          {/* Keys Table */}
          <div className="process-table-wrapper" style={{ overflow: 'visible' }}>
            <table className="process-table">
              <thead>
                <tr>
                  <th>License Code</th>
                  <th>Product</th>
                  <th>Tier</th>
                  <th>Limit</th>
                  <th>Time Remaining</th>
                  <th>Status</th>
                  <th>HWID Lock</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredKeys.map((k) => {
                  const isActive = !!k.is_active;
                  let timeRemaining = 'N/A';
                  let expirationDate = k.expires_at ? new Date(k.expires_at) : null;
                  
                  if (!expirationDate && k.activated_at && k.duration_days) {
                     expirationDate = new Date(new Date(k.activated_at).getTime() + (k.duration_days * 24 * 60 * 60 * 1000));
                  }

                  const hasExpired = expirationDate && expirationDate < new Date();
                  const status = !isActive ? 'Revoked' : hasExpired ? 'Expired' : (k.activated_at ? 'Active' : 'Unused');
                  const statusColor = status === 'Active' ? 'var(--success)' : status === 'Unused' ? 'var(--warning)' : 'var(--danger)';
                  
                  if (isActive && expirationDate && !hasExpired) {
                    const ms = expirationDate - new Date();
                    const days = Math.floor(ms / (1000 * 60 * 60 * 24));
                    const hours = Math.floor((ms % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
                    const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
                    const seconds = Math.floor((ms % (1000 * 60)) / 1000);
                    timeRemaining = `${days}d ${hours}h ${minutes}m ${seconds}s`;
                  } else if (k.type === 'LIFETIME' || (!expirationDate && !k.duration_days)) {
                    timeRemaining = 'Lifetime';
                  } else if (hasExpired) {
                    timeRemaining = '0d 0h (Expired)';
                  } else if (!k.activated_at && k.duration_days) {
                    timeRemaining = `${k.duration_days}d (Unused)`;
                  }

                  return (
                    <tr key={k.key}>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span className="text-mono" style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                            {k.key}
                          </span>
                          <button 
                            onClick={() => { navigator.clipboard.writeText(k.key); showToast('Key copied to clipboard!', 'success'); }}
                            style={{ background: 'rgba(255,255,255,0.08)', border: 'none', borderRadius: 4, color: '#fff', cursor: 'pointer', padding: '4px 6px', fontSize: 10, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                            title="Copy Key"
                          >
                            📋 Copy
                          </button>
                        </div>
                      </td>
                      <td style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent-secondary)' }}>
                        {k.product || 'GLOBAL'}
                      </td>
                      <td>
                        <span className="badge badge-info">{k.type}</span>
                      </td>
                      <td style={{ fontSize: 12 }}>
                        {k.max_users ? `${k.max_users} accounts` : '1 account'}
                      </td>
                      <td style={{ fontSize: 12, fontWeight: 600, color: timeRemaining.includes('Expired') ? 'var(--danger)' : 'var(--accent-primary)' }}>
                        {timeRemaining}
                      </td>
                      <td>
                        <span className={`badge ${k.is_active ? 'badge-success' : 'badge-danger'}`} style={{ color: statusColor, background: 'rgba(255,255,255,0.05)' }}>
                          {status}
                        </span>
                      </td>
                      <td style={{ fontSize: 11, opacity: 0.6 }} className="text-mono">
                        {k.hwid ? k.hwid.substring(0, 16) + '...' : 'Unbound'}
                      </td>
                      <td style={{ overflow: 'visible' }}>
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                          <button 
                            className="btn btn-sm"
                            disabled={!!k.activated_at || !k.is_active}
                            onClick={async () => {
                              try {
                                const res = await api.adminManuallyActivateKey(k.key);
                                if (res.success) {
                                  showToast('Key activated successfully!', 'success');
                                  loadKeys();
                                } else {
                                  showToast(res.error || 'Failed to activate key', 'danger');
                                }
                              } catch(err) {
                                showToast(err.message, 'danger');
                              }
                            }}
                            style={{ 
                              height: 28, 
                              fontSize: 11, 
                              fontWeight: 700, 
                              background: (k.activated_at || !k.is_active) ? 'rgba(255,255,255,0.05)' : 'rgba(46, 196, 182, 0.15)',
                              color: (k.activated_at || !k.is_active) ? 'rgba(255,255,255,0.3)' : '#2ec4b6',
                              border: (k.activated_at || !k.is_active) ? '1px solid rgba(255,255,255,0.05)' : '1px solid rgba(46, 196, 182, 0.3)',
                              cursor: (k.activated_at || !k.is_active) ? 'not-allowed' : 'pointer',
                              padding: '0 8px'
                            }}
                          >
                            🔓 Activer
                          </button>
                          
                          <button 
                            className="btn btn-sm"
                            disabled={!k.is_active}
                            onClick={() => handleRevokeKey(k.key)}
                            style={{ 
                              height: 28, 
                              fontSize: 11, 
                              fontWeight: 700, 
                              background: !k.is_active ? 'rgba(255,255,255,0.05)' : 'rgba(255, 107, 53, 0.15)',
                              color: !k.is_active ? 'rgba(255,255,255,0.3)' : '#ff6b35',
                              border: !k.is_active ? '1px solid rgba(255,255,255,0.05)' : '1px solid rgba(255, 107, 53, 0.3)',
                              cursor: !k.is_active ? 'not-allowed' : 'pointer',
                              padding: '0 8px'
                            }}
                          >
                            🚫 Révoquer
                          </button>

                          <button 
                            className="btn btn-danger btn-sm"
                            onClick={() => handleDeleteKey(k.key)}
                            style={{ 
                              height: 28, 
                              fontSize: 11, 
                              fontWeight: 700, 
                              padding: '0 8px',
                              background: 'rgba(239, 68, 68, 0.15)',
                              color: '#ef4444',
                              border: '1px solid rgba(239, 68, 68, 0.3)'
                            }}
                          >
                            🗑️ Supprimer
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {filteredKeys.length === 0 && (
                  <tr>
                    <td colSpan="8" style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
                      No generated keys. Click "Generate" to create some.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* AUDIT LOGS TAB                                                */}
      {/* ============================================================ */}
      {activeTab === 'audit' && (
        <div className="glass-card settings-section" style={{ padding: 24 }}>
          <h3 style={{ margin: '0 0 16px 0', fontSize: 18, fontWeight: 700 }}>📋 Audit & Activity Logs</h3>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 16px 0' }}>
            Every login, logout, account creation, profile change, and device snapshot is logged here for company monitoring.
          </p>

          {/* Filters */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
            {[
              { key: 'all', label: '🗂️ All' },
              { key: 'auth', label: '🔐 Auth' },
              { key: 'account', label: '👤 Account' },
              { key: 'change', label: '✏️ Changes' },
              { key: 'sessions', label: '💻 Sessions' },
              { key: 'snapshots', label: '📊 Devices' },
            ].map(f => (
              <button
                key={f.key}
                className={`btn btn-sm ${auditFilter === f.key ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setAuditFilter(f.key)}
                style={{ fontSize: 11, padding: '4px 10px' }}
              >
                {f.label}
              </button>
            ))}

            <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>User:</span>
              <select
                value={auditUserFilter}
                onChange={(e) => {
                  setAuditUserFilter(e.target.value);
                  if (e.target.value) loadUserTrail(e.target.value);
                  else { setSelectedUserTrail(null); setUserTrailData(null); }
                }}
                style={{ fontSize: 11, padding: '4px 8px', borderRadius: 6, background: 'var(--bg-input)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}
              >
                <option value="">All Users</option>
                {users.map(u => <option key={u.id} value={u.username}>{u.username}</option>)}
              </select>
            </div>
          </div>

          {auditLoading && <p style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 32 }}>Loading audit data...</p>}

          {/* Per-User Trail */}
          {selectedUserTrail && userTrailData && (
            <div className="glass-card" style={{ padding: 16, marginBottom: 16, border: '1px solid var(--border-accent)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <h4 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>🔍 Trail for: {selectedUserTrail}</h4>
                <button className="btn btn-secondary btn-sm" onClick={() => { setSelectedUserTrail(null); setUserTrailData(null); setAuditUserFilter(''); }} style={{ fontSize: 10 }}>✕ Close</button>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
                <div style={{ background: 'var(--bg-card)', borderRadius: 8, padding: 12, textAlign: 'center' }}>
                  <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--accent-primary)' }}>{userTrailData.events?.length || 0}</div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Events</div>
                </div>
                <div style={{ background: 'var(--bg-card)', borderRadius: 8, padding: 12, textAlign: 'center' }}>
                  <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--success)' }}>{userTrailData.sessions?.length || 0}</div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Sessions</div>
                </div>
                <div style={{ background: 'var(--bg-card)', borderRadius: 8, padding: 12, textAlign: 'center' }}>
                  <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--warning)' }}>{userTrailData.snapshots?.length || 0}</div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Snapshots</div>
                </div>
              </div>

              {/* Recent device snapshot */}
              {userTrailData.snapshots?.length > 0 && (() => {
                const snap = userTrailData.snapshots[0];
                return (
                  <div style={{ background: 'var(--bg-card)', borderRadius: 8, padding: 12, marginBottom: 12, fontSize: 12 }}>
                    <div style={{ fontWeight: 700, marginBottom: 6, color: 'var(--accent-secondary)' }}>📊 Latest Device Snapshot</div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
                      <span style={{ color: 'var(--text-muted)' }}>Hostname:</span><span>{snap.hostname || '—'}</span>
                      <span style={{ color: 'var(--text-muted)' }}>IP:</span><span>{snap.ip || '—'}</span>
                      <span style={{ color: 'var(--text-muted)' }}>OS:</span><span>{snap.os || '—'}</span>
                      <span style={{ color: 'var(--text-muted)' }}>CPU:</span><span>{snap.cpu || '—'}</span>
                      <span style={{ color: 'var(--text-muted)' }}>GPU:</span><span>{snap.gpu || '—'}</span>
                      <span style={{ color: 'var(--text-muted)' }}>RAM:</span><span>{snap.ram || '—'}</span>
                      <span style={{ color: 'var(--text-muted)' }}>When:</span><span>{snap.timestamp ? new Date(snap.timestamp).toLocaleString() : '—'}</span>
                    </div>
                  </div>
                );
              })()}

              {/* Event timeline */}
              <div style={{ maxHeight: 300, overflowY: 'auto' }}>
                {(userTrailData.events || []).map((ev, i) => {
                  const typeColors = { auth: '#3b82f6', account: '#a855f7', change: '#f59e0b' };
                  const typeIcons = { auth: '🔐', account: '👤', change: '✏️' };
                  return (
                    <div key={i} style={{ display: 'flex', gap: 10, padding: '8px 0', borderBottom: '1px solid var(--border-subtle)', fontSize: 12 }}>
                      <span style={{ fontSize: 14 }}>{typeIcons[ev._table] || '📌'}</span>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 600, color: typeColors[ev._table] || 'var(--text-primary)' }}>
                           {ev.event_type || ev.change_type || ev.action || 'event'}
                        </div>
                        <div style={{ color: 'var(--text-muted)', fontSize: 10 }}>
                          {ev.timestamp ? new Date(ev.timestamp).toLocaleString() : '—'}
                          {ev.ip ? ` • IP: ${ev.ip}` : ''}
                          {ev.hostname ? ` • ${ev.hostname}` : ''}
                          {ev.reason ? ` • ${ev.reason}` : ''}
                          {ev.category ? ` • ${ev.category}` : ''}
                        </div>
                      </div>
                    </div>
                  );
                })}
                {(!userTrailData.events || userTrailData.events.length === 0) && (
                  <p style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 20, fontSize: 12 }}>No events found for this user.</p>
                )}
              </div>
            </div>
          )}

          {/* Global event feed */}
          {!selectedUserTrail && !auditLoading && (
            <div style={{ maxHeight: 500, overflowY: 'auto' }}>
              {(() => {
                const allRows = [];
                const addRows = (arr, type, icon) => {
                  (arr || []).forEach(ev => {
                    const row = { ...ev, _type: type, _icon: icon };
                    if (auditUserFilter && ev.username?.toLowerCase() !== auditUserFilter.toLowerCase()) return;
                    allRows.push(row);
                  });
                };
                addRows(auditEvents.authEvents, 'Auth', '🔐');
                addRows(auditEvents.accountEvents, 'Account', '👤');
                addRows(auditEvents.changeEvents, 'Change', '✏️');
                addRows(auditEvents.sessions, 'Session', '💻');
                addRows(auditEvents.snapshots, 'Device', '📊');
                allRows.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

                if (allRows.length === 0) {
                  return <p style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 40, fontSize: 12 }}>No audit events yet. Events appear when users log in, log out, change settings, etc.</p>;
                }

                return allRows.slice(0, 200).map((ev, i) => {
                  const typeColors = { Auth: '#3b82f6', Account: '#a855f7', Change: '#f59e0b', Session: '#22c55e', Device: '#06b6d4' };
                  let details = '';
                  try {
                    const json = ev.data_json || ev.specs_json;
                    if (json) {
                      const parsed = JSON.parse(json);
                      const keys = Object.keys(parsed).slice(0, 4);
                      details = keys.map(k => `${k}: ${typeof parsed[k] === 'object' ? '…' : String(parsed[k]).substring(0, 40)}`).join(' | ');
                    }
                  } catch {}

                  return (
                    <div key={`${ev._type}-${i}`} style={{
                      display: 'flex', gap: 10, padding: '10px 0', borderBottom: '1px solid var(--border-subtle)', fontSize: 12, alignItems: 'flex-start'
                    }}>
                      <span style={{ fontSize: 14, marginTop: 2 }}>{ev._icon}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                          <span className="badge" style={{
                            fontSize: 9, padding: '2px 6px',
                            background: `${typeColors[ev._type]}22`, color: typeColors[ev._type],
                            border: `1px solid ${typeColors[ev._type]}44`, borderRadius: 4
                          }}>{ev._type}</span>
                          <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>
                            {ev.event_type || ev.change_type || ev.action || ev._type}
                          </span>
                          {ev.success !== undefined && (
                            <span className={`badge ${ev.success ? 'badge-success' : 'badge-danger'}`} style={{ fontSize: 9, padding: '1px 5px' }}>
                              {ev.success ? '✓ OK' : '✗ FAIL'}
                            </span>
                          )}
                        </div>
                        <div style={{ color: 'var(--text-muted)', fontSize: 10, marginTop: 2 }}>
                          <strong>{ev.username || '—'}</strong>
                          {ev.timestamp ? ` • ${new Date(ev.timestamp).toLocaleString()}` : ''}
                          {ev.ip ? ` • IP: ${ev.ip}` : ''}
                          {ev.hostname ? ` • ${ev.hostname}` : ''}
                          {ev.hwid ? ` • HWID: ${ev.hwid.substring(0, 12)}…` : ''}
                          {ev.reason ? ` • ${ev.reason}` : ''}
                          {ev.category ? ` • ${ev.category}` : ''}
                        </div>
                        {ev.cpu && (
                          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
                            {ev.cpu}{ev.gpu ? ` | ${ev.gpu}` : ''}{ev.ram ? ` | ${ev.ram}` : ''}{ev.os ? ` | ${ev.os}` : ''}
                          </div>
                        )}
                        {details && (
                          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2, opacity: 0.7, fontFamily: 'monospace' }}>
                            {details}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                });
              })()}
            </div>
          )}
        </div>
      )}

      {/* Products View */}
      {activeTab === 'products' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Form to create new product */}
          <div className="glass-card settings-section" style={{ padding: 24 }}>
            <h3 style={{ margin: '0 0 16px 0', fontSize: 16, fontWeight: 700 }}>➕ Add New Product</h3>
            <form onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              const pId = f.get('pId').toUpperCase();
              const pName = f.get('pName');
              const pCat = f.get('pCategory');
              const pDesc = f.get('pDesc');
              const pPrice = Number(f.get('pPrice'));
              const pVersion = f.get('pVersion') || '1.0.0';
              const pRequirements = f.get('pRequirements') || '';
              const pFeatures = f.get('pFeatures').split(',').map(x => x.trim()).filter(Boolean);
              
              try {
                const res = await api.adminUpdateProductMetadata(pId, pDesc, 'Undetected', pPrice, pFeatures, '', 1.0, pName, pCat, pVersion, pRequirements);
                if (res.success) {
                  showToast(`Product ${pName} created successfully!`, 'success');
                  e.target.reset();
                  loadProductsMetadata();
                } else {
                  showToast(res.error || 'Failed to create product', 'danger');
                }
              } catch(err) {
                showToast(err.message, 'danger');
              }
            }}
            style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, alignItems: 'flex-end' }}>
              <div className="input-group" style={{ margin: 0 }}>
                <label className="input-label">Product ID (Unique Key)</label>
                <input type="text" name="pId" className="input" placeholder="e.g. CS2, EFT_RADAR" required style={{ height: 34, fontSize: 11 }} />
              </div>
              <div className="input-group" style={{ margin: 0 }}>
                <label className="input-label">Product Name</label>
                <input type="text" name="pName" className="input" placeholder="e.g. CS2 Premium" required style={{ height: 34, fontSize: 11 }} />
              </div>
              <div className="input-group" style={{ margin: 0 }}>
                <label className="input-label">Category</label>
                <select name="pCategory" className="input" style={{ height: 34, fontSize: 11 }}>
                  <option value="DMA">DMA (Hardware Cheats)</option>
                  <option value="Scripting">Scripting (Internal Cheats)</option>
                </select>
              </div>
              <div className="input-group" style={{ margin: 0 }}>
                <label className="input-label">Version</label>
                <input type="text" name="pVersion" className="input" placeholder="e.g. 1.0.0" defaultValue="1.0.0" required style={{ height: 34, fontSize: 11 }} />
              </div>
              <div className="input-group" style={{ margin: 0, gridColumn: 'span 2' }}>
                <label className="input-label">System Requirements (Optional)</label>
                <input type="text" name="pRequirements" className="input" placeholder="e.g. 🔥 Windows 10/11 Only (leave empty to hide)" style={{ height: 34, fontSize: 11 }} />
              </div>
              <div className="input-group" style={{ margin: 0, gridColumn: 'span 3' }}>
                <label className="input-label">Description</label>
                <input type="text" name="pDesc" className="input" placeholder="Short description..." required style={{ height: 34, fontSize: 11 }} />
              </div>
              <div className="input-group" style={{ margin: 0 }}>
                <label className="input-label">Price ($ / week)</label>
                <input type="number" name="pPrice" className="input" min={0} defaultValue={10} required style={{ height: 34, fontSize: 11 }} />
              </div>
              <div className="input-group" style={{ margin: 0, gridColumn: 'span 2' }}>
                <label className="input-label">Key Features (comma-separated)</label>
                <input type="text" name="pFeatures" className="input" placeholder="Feature 1, Feature 2..." required style={{ height: 34, fontSize: 11 }} />
              </div>
              <button className="btn btn-primary" type="submit" style={{ height: 34, fontWeight: 700, fontSize: 12, gridColumn: 'span 3' }}>⚡ Create Product</button>
            </form>
          </div>

          <div className="glass-card settings-section" style={{ padding: 24 }}>
            <h3 style={{ margin: '0 0 8px 0', fontSize: 18, fontWeight: 700 }}>📦 Product Information & Live Control</h3>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 20px 0' }}>
              Update descriptions, features list, pricing, and live status of each product shown to customers.
            </p>

            {prodMetaLoading ? (
              <p style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 32 }}>Loading products metadata...</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
                {['DMA', 'Scripting'].map((cat) => {
                  const list = productsMetadata.filter(p => (p.category || 'DMA') === cat);
                  return (
                    <div key={cat} style={{ borderBottom: '1px solid var(--border-color)', paddingBottom: 16 }}>
                      <h4 style={{ fontSize: 14, fontWeight: 800, color: 'var(--accent-secondary)', textTransform: 'uppercase', marginBottom: 12 }}>{cat} Products</h4>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16 }}>
                        {list.map((p) => {
                          const meta = getProductMeta(p.id);
                          return (
                            <form 
                              key={p.id} 
                              onSubmit={(e) => handleUpdateProduct(e, p.id)} 
                              className="glass-card" 
                              style={{ padding: 20, border: '1px solid rgba(255,255,255,0.06)', background: 'rgba(0,0,0,0.1)' }}
                            >
                              <h4 style={{ margin: '0 0 16px 0', fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <span>{p.name || p.id}</span>
                                <div style={{ display: 'flex', gap: 6 }}>
                                  <span className="badge badge-secondary" style={{ fontSize: 9 }}>{p.id}</span>
                                  <button 
                                    type="button" 
                                    className="btn btn-danger btn-xs" 
                                    style={{ fontSize: 8, padding: '2px 4px', height: 'auto' }}
                                    onClick={async () => {
                                      if (!window.confirm(`Delete product ${p.id}?`)) return;
                                      const res = await api.adminDeleteProduct(p.id);
                                      if (res.success) {
                                        showToast(`Product ${p.id} deleted`, 'success');
                                        loadProductsMetadata();
                                      }
                                    }}
                                  >
                                    ✕
                                  </button>
                                </div>
                              </h4>

                              <div className="input-group" style={{ marginBottom: 12 }}>
                                <label className="input-label">Description</label>
                                <textarea 
                                  name="description" 
                                  defaultValue={meta.description} 
                                  className="input" 
                                  style={{ height: 60, fontSize: 12, background: 'var(--bg-input)', border: '1px solid var(--border-color)', borderRadius: 8, color: 'var(--text-primary)', padding: '6px 10px', resize: 'vertical', width: '100%', display: 'block' }}
                                  required 
                                />
                              </div>

                              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                                <div className="input-group" style={{ margin: 0 }}>
                                  <label className="input-label">Live Status</label>
                                  <select 
                                    name="status" 
                                    defaultValue={meta.status} 
                                    className="input" 
                                    style={{ height: 38, fontSize: 12, background: 'var(--bg-input)', border: '1px solid var(--border-color)', borderRadius: 8, color: 'var(--text-primary)', width: '100%', display: 'block' }}
                                  >
                                    <option value="Undetected">🟢 Undetected</option>
                                    <option value="Use at Own Risk">🟡 Use at Own Risk</option>
                                    <option value="Detected">🔴 Detected</option>
                                    <option value="Maintenance">🚨 Maintenance</option>
                                    <option value="Testing">🔵 Testing</option>
                                  </select>
                                </div>

                                <div className="input-group" style={{ margin: 0 }}>
                                  <label className="input-label">Price ($ / week)</label>
                                  <input 
                                    type="number" 
                                    name="price" 
                                    defaultValue={meta.price} 
                                    className="input" 
                                    style={{ height: 38, fontSize: 12, background: 'var(--bg-input)', border: '1px solid var(--border-color)', borderRadius: 8, color: 'var(--text-primary)', width: '100%', display: 'block' }}
                                    min={0}
                                    step={0.01}
                                    required 
                                  />
                                </div>
                              </div>

                              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                                <div className="input-group" style={{ margin: 0 }}>
                                  <label className="input-label">Product Version</label>
                                  <input 
                                    type="text" 
                                    name="version" 
                                    defaultValue={meta.version} 
                                    className="input" 
                                    placeholder="e.g. 1.0.0"
                                    style={{ height: 38, fontSize: 12, background: 'var(--bg-input)', border: '1px solid var(--border-color)', borderRadius: 8, color: 'var(--text-primary)', width: '100%', display: 'block' }}
                                    required 
                                  />
                                </div>

                                <div className="input-group" style={{ margin: 0 }}>
                                  <label className="input-label">System Requirements (Optional)</label>
                                  <input 
                                    type="text" 
                                    name="requirements" 
                                    defaultValue={meta.requirements} 
                                    className="input" 
                                    placeholder="e.g. 🔥 Windows 10/11 Only"
                                    style={{ height: 38, fontSize: 12, background: 'var(--bg-input)', border: '1px solid var(--border-color)', borderRadius: 8, color: 'var(--text-primary)', width: '100%', display: 'block' }}
                                  />
                                </div>
                              </div>

                              {(() => {
                                const imgCfg = getImageConfig(p.id, p.image, p.image_scale);
                                return (
                                  <>
                                    <div className="input-group" style={{ marginBottom: 12 }}>
                                      <label className="input-label">Product Image Source</label>
                                      <div style={{ display: 'flex', gap: 8 }}>
                                        <input 
                                          type="text" 
                                          value={imgCfg.url} 
                                          onChange={(e) => updateImageConfig(p.id, p.image, p.image_scale, 'url', e.target.value)}
                                          className="input" 
                                          placeholder="https://... or base64 data"
                                          style={{ height: 38, fontSize: 12, background: 'var(--bg-input)', border: '1px solid var(--border-color)', borderRadius: 8, color: 'var(--text-primary)', flex: 1 }}
                                        />
                                        <button
                                          type="button"
                                          className="btn btn-secondary"
                                          onClick={async () => {
                                            const res = await api.adminSelectProductImage();
                                            if (res.success && res.base64) {
                                              updateImageConfig(p.id, p.image, p.image_scale, 'url', res.base64);
                                            } else if (res.error && res.error !== 'Cancelled') {
                                              showToast('Error: ' + res.error, 'danger');
                                            }
                                          }}
                                          style={{ height: 38, padding: '0 12px', fontSize: 11, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}
                                        >
                                          📁 Browse...
                                        </button>
                                      </div>
                                    </div>

                                    {/* Advanced Layout Grid */}
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                                      <div className="input-group" style={{ margin: 0 }}>
                                        <label className="input-label">Object Fit</label>
                                        <select 
                                          value={imgCfg.fit} 
                                          onChange={(e) => updateImageConfig(p.id, p.image, p.image_scale, 'fit', e.target.value)}
                                          className="input" 
                                          style={{ height: 38, fontSize: 11, background: 'var(--bg-input)', border: '1px solid var(--border-color)', borderRadius: 8, color: 'var(--text-primary)', width: '100%' }}
                                        >
                                          <option value="contain">Contain (Fit inside)</option>
                                          <option value="cover">Cover (Fill space)</option>
                                          <option value="fill">Fill (Stretch)</option>
                                        </select>
                                      </div>

                                      <div className="input-group" style={{ margin: 0 }}>
                                        <label className="input-label">Position</label>
                                        <select 
                                          value={imgCfg.position} 
                                          onChange={(e) => updateImageConfig(p.id, p.image, p.image_scale, 'position', e.target.value)}
                                          className="input" 
                                          style={{ height: 38, fontSize: 11, background: 'var(--bg-input)', border: '1px solid var(--border-color)', borderRadius: 8, color: 'var(--text-primary)', width: '100%' }}
                                        >
                                          <option value="center">Center</option>
                                          <option value="top">Top</option>
                                          <option value="bottom">Bottom</option>
                                          <option value="left">Left</option>
                                          <option value="right">Right</option>
                                        </select>
                                      </div>
                                    </div>

                                    {/* Slider scale */}
                                    <div className="input-group" style={{ marginBottom: 12 }}>
                                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                                        <label className="input-label" style={{ margin: 0 }}>Scale (Zoom)</label>
                                        <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--accent-primary)' }}>
                                          {parseFloat(imgCfg.scale).toFixed(2)}x
                                        </span>
                                      </div>
                                      <input 
                                        type="range" 
                                        min="0.5" 
                                        max="2.5" 
                                        step="0.05"
                                        value={imgCfg.scale} 
                                        onChange={(e) => updateImageConfig(p.id, p.image, p.image_scale, 'scale', Number(e.target.value))}
                                        style={{ width: '100%', accentColor: 'var(--accent-primary)', cursor: 'pointer' }}
                                      />
                                    </div>

                                    {/* Sliders offset X and Y */}
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
                                      <div className="input-group" style={{ margin: 0 }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                                          <label className="input-label" style={{ margin: 0 }}>Offset X</label>
                                          <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-muted)' }}>{imgCfg.offsetX}px</span>
                                        </div>
                                        <input 
                                          type="range" 
                                          min="-100" 
                                          max="100" 
                                          step="1"
                                          value={imgCfg.offsetX} 
                                          onChange={(e) => updateImageConfig(p.id, p.image, p.image_scale, 'offsetX', Number(e.target.value))}
                                          style={{ width: '100%', accentColor: 'var(--accent-secondary)', cursor: 'pointer' }}
                                        />
                                      </div>

                                      <div className="input-group" style={{ margin: 0 }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                                          <label className="input-label" style={{ margin: 0 }}>Offset Y</label>
                                          <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-muted)' }}>{imgCfg.offsetY}px</span>
                                        </div>
                                        <input 
                                          type="range" 
                                          min="-100" 
                                          max="100" 
                                          step="1"
                                          value={imgCfg.offsetY} 
                                          onChange={(e) => updateImageConfig(p.id, p.image, p.image_scale, 'offsetY', Number(e.target.value))}
                                          style={{ width: '100%', accentColor: 'var(--accent-secondary)', cursor: 'pointer' }}
                                        />
                                      </div>
                                    </div>

                                    {/* Live Preview Container (Reflecting new full-width card banner layout) */}
                                    <div style={{
                                      marginBottom: 16,
                                      background: '#040408',
                                      borderRadius: '12px 12px 0 0',
                                      width: '100%',
                                      maxWidth: 240,
                                      height: 200,
                                      margin: '0 auto 16px auto',
                                      display: 'flex',
                                      alignItems: 'center',
                                      justifyContent: 'center',
                                      overflow: 'hidden',
                                      border: '1px solid rgba(255,255,255,0.04)',
                                      position: 'relative'
                                    }}>
                                      {imgCfg.url ? (
                                        <img 
                                          src={imgCfg.url}
                                          alt="Preview"
                                          style={{
                                            width: '100%',
                                            height: '100%',
                                            objectFit: imgCfg.fit,
                                            objectPosition: imgCfg.position,
                                            transform: `scale(${imgCfg.scale}) translate(${imgCfg.offsetX}px, ${imgCfg.offsetY}px)`,
                                            transition: 'transform 0.05s ease'
                                          }}
                                          onError={(e) => { e.target.style.opacity = 0.3; }}
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
                                          gap: 8
                                        }}>
                                          <div style={{ fontSize: 24, opacity: 0.6 }}>📦</div>
                                          <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--text-secondary)', letterSpacing: '2px', opacity: 0.8 }}>SOON</span>
                                        </div>
                                      )}
                                    </div>
                                  </>
                                );
                              })()}

                              <div className="input-group" style={{ marginBottom: 16 }}>
                                <label className="input-label">Key Features (comma-separated)</label>
                                <input 
                                  type="text" 
                                  name="features" 
                                  defaultValue={meta.features} 
                                  className="input" 
                                  placeholder="Feature 1, Feature 2..."
                                  style={{ height: 38, fontSize: 12, background: 'var(--bg-input)', border: '1px solid var(--border-color)', borderRadius: 8, color: 'var(--text-primary)', width: '100%', display: 'block' }}
                                  required 
                                />
                              </div>

                              <button 
                                type="submit" 
                                className="btn btn-primary" 
                                style={{ width: '100%', height: 36, fontWeight: 600, fontSize: 12 }}
                              >
                                💾 Save changes
                              </button>
                            </form>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* System Settings View */}
      {activeTab === 'system' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div className="glass-card settings-section" style={{ padding: 24 }}>
            <h3 style={{ margin: '0 0 16px 0', fontSize: 18, fontWeight: 700 }}>⚙️ System Settings & Policies</h3>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 20px 0' }}>
              Configure global application status, access policies, and maintenance behaviors.
            </p>

            <div className="glass-card" style={{ padding: 20, border: '1px solid rgba(255, 255, 255, 0.05)', background: 'rgba(255,255,255,0.01)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <h4 style={{ margin: '0 0 4px 0', fontSize: 14, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
                  🛠️ Global Maintenance Mode
                  {maintLoading && <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--text-muted)' }}>(updating...)</span>}
                </h4>
                <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)', maxWidth: 500 }}>
                  Temporarily lock out all standard users from accessing Synced. Only accounts marked as Admin will be allowed to log in and use the application.
                </p>
              </div>
              
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: maintenanceMode ? 'var(--danger)' : 'var(--text-muted)' }}>
                  {maintenanceMode ? 'ACTIVE' : 'INACTIVE'}
                </span>
                <label className="switch" style={{ position: 'relative', display: 'inline-block', width: 44, height: 24 }}>
                  <input 
                    type="checkbox" 
                    checked={maintenanceMode} 
                    onChange={(e) => handleToggleMaintenance(e.target.checked)}
                    style={{ opacity: 0, width: 0, height: 0 }}
                  />
                  <span style={{
                    position: 'absolute',
                    cursor: 'pointer',
                    top: 0, left: 0, right: 0, bottom: 0,
                    backgroundColor: maintenanceMode ? '#ef4444' : '#27272a',
                    borderRadius: 24,
                    transition: '0.3s',
                    boxShadow: maintenanceMode ? '0 0 8px rgba(239, 68, 68, 0.4)' : 'none'
                  }}>
                    <span style={{
                      position: 'absolute',
                      content: '""',
                      height: 18, width: 18,
                      left: maintenanceMode ? 22 : 3,
                      bottom: 3,
                      backgroundColor: '#fff',
                      borderRadius: '50%',
                      transition: '0.3s'
                    }} />
                  </span>
                </label>
              </div>
            </div>

            {/* Service-specific maintenance toggles */}
            <div style={{ marginTop: 20, paddingLeft: 12, borderLeft: '2px solid rgba(255, 255, 255, 0.05)', display: 'flex', flexDirection: 'column', gap: 14 }}>
              <h5 style={{ margin: '0 0 4px 0', fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}>Service-Specific Maintenance Controls</h5>
              
              {[
                { key: 'ai_assistant', label: '🤖 AI Assistant', desc: 'Blocks access to the Ollama AI Assistant page (/ai)' },
                { key: 'dma', label: '🔌 DMA Console', desc: 'Blocks access to the Direct Memory Access catalogue page (/dma)' },
                { key: 'internal', label: '🎯 Internal / External Clients', desc: 'Blocks access to Internal & External client pages (/internal, /external)' },
                { key: 'script', label: '📜 Scripting Console', desc: 'Blocks access to the KryoK scripting dashboard (/scripts)' },
                { key: 'bridge', label: '🌉 Second PC Bridge (Bridge)', desc: 'Blocks access to remote bridge functions (Files, Processes, Terminal)' }
              ].map((service) => {
                const isActive = !!maintenanceServices[service.key];
                return (
                  <div key={service.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: 'rgba(255, 255, 255, 0.01)', border: '1px solid rgba(255, 255, 255, 0.03)', borderRadius: 8 }}>
                    <div>
                      <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{service.label}</span>
                      <p style={{ margin: '2px 0 0 0', fontSize: 11, color: 'var(--text-muted)' }}>{service.desc}</p>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ fontSize: 11, fontWeight: 600, color: isActive ? 'var(--warning)' : 'var(--text-muted)' }}>
                        {isActive ? 'MAINTENANCE' : 'ACTIVE'}
                      </span>
                      <label className="switch" style={{ position: 'relative', display: 'inline-block', width: 38, height: 20 }}>
                        <input 
                          type="checkbox" 
                          checked={isActive} 
                          onChange={(e) => handleToggleServiceMaintenance(service.key, e.target.checked)}
                          style={{ opacity: 0, width: 0, height: 0 }}
                        />
                        <span style={{
                          position: 'absolute',
                          cursor: 'pointer',
                          top: 0, left: 0, right: 0, bottom: 0,
                          backgroundColor: isActive ? 'var(--warning)' : '#27272a',
                          borderRadius: 20,
                          transition: '0.3s'
                        }}>
                          <span style={{
                            position: 'absolute',
                            content: '""',
                            height: 14, width: 14,
                            left: isActive ? 20 : 3,
                            bottom: 3,
                            backgroundColor: '#fff',
                            borderRadius: '50%',
                            transition: '0.3s'
                          }} />
                        </span>
                      </label>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Discord API Config database save form */}
          <div className="glass-card settings-section" style={{ padding: 24 }}>
            <h3 style={{ margin: '0 0 8px 0', fontSize: 18, fontWeight: 700 }}>💬 Discord Application API Credentials</h3>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 20px 0' }}>
              Configure Discord OAuth Client ID and Secret to link accounts and handle Rich Presence status updates. Saved globally in Database.
            </p>
            <DiscordConfigForm showToast={showToast} />
          </div>
        </div>
      )}
      {/* Modale de confirmation personnalisée */}
      {confirmModal.show && (
        <div style={{
          position: 'fixed',
          top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0, 0, 0, 0.7)',
          backdropFilter: 'blur(4px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 20000,
          animation: 'fade-in 0.2s ease'
        }}>
          <div className="glass-card animate-slide-up" style={{
            maxWidth: 400,
            width: '90%',
            padding: 24,
            border: '1px solid rgba(255,255,255,0.08)',
            boxShadow: '0 20px 40px rgba(0,0,0,0.5)',
            textAlign: 'center'
          }}>
            <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 12, color: 'var(--text-primary)' }}>
              {confirmModal.title}
            </h3>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 24, lineHeight: 1.5 }}>
              {confirmModal.message}
            </p>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
              <button
                className="btn btn-secondary"
                onClick={() => setConfirmModal({ show: false, title: '', message: '', onConfirm: null })}
                style={{ minWidth: 100, height: 38, fontWeight: 600 }}
              >
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={() => {
                  if (confirmModal.onConfirm) confirmModal.onConfirm();
                  setConfirmModal({ show: false, title: '', message: '', onConfirm: null });
                }}
                style={{ minWidth: 100, height: 38, fontWeight: 700, background: 'linear-gradient(135deg, #ef4444, #dc2626)', border: 'none' }}
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function DiscordConfigForm({ showToast }) {
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');

  useEffect(() => {
    api.adminGetDiscordConfig().then(cfg => {
      if (cfg) {
        setClientId(cfg.clientId || '');
        setClientSecret(cfg.clientSecret || '');
      }
    });
  }, []);

  return (
    <form onSubmit={async (e) => {
      e.preventDefault();
      try {
        const res = await api.adminSaveDiscordConfig({ clientId, clientSecret });
        if (res.success) {
          showToast('Discord credentials saved successfully!', 'success');
        } else {
          showToast(res.error || 'Failed to save discord config', 'danger');
        }
      } catch(err) {
        showToast(err.message, 'danger');
      }
    }}
    style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="input-group" style={{ margin: 0 }}>
        <label className="input-label">Discord Client ID</label>
        <input 
          type="text" 
          className="input" 
          value={clientId} 
          onChange={(e) => setClientId(e.target.value)} 
          placeholder="e.g. 123456789012345678" 
          required 
          style={{ height: 38, background: 'var(--bg-input)', border: '1px solid var(--border-color)', borderRadius: 8, color: 'var(--text-primary)', width: '100%' }}
        />
      </div>
      <div className="input-group" style={{ margin: 0 }}>
        <label className="input-label">Discord Client Secret</label>
        <input 
          type="password" 
          className="input" 
          value={clientSecret} 
          onChange={(e) => setClientSecret(e.target.value)} 
          placeholder="e.g. aBcDeFgH1234..." 
          required 
          style={{ height: 38, background: 'var(--bg-input)', border: '1px solid var(--border-color)', borderRadius: 8, color: 'var(--text-primary)', width: '100%' }}
        />
      </div>
      <button type="submit" className="btn btn-primary" style={{ height: 38, fontWeight: 700, width: 200, alignSelf: 'flex-start' }}>💾 Save API Config</button>
    </form>
  );
}
