import React from 'react';
import { NavLink, useLocation, Link } from 'react-router-dom';
import { ROUTES, APP_NAME } from '../../utils/constants';
import { translations } from '../../utils/translations';
import { api } from '../../utils/api';

export default function Layout({ 
  children, 
  bridgeOnline, 
  theme, 
  setTheme, 
  language = 'en', 
  mainHostname = 'Main PC', 
  bridgeHostname = 'Secondary PC',
  searchQuery = '',
  setSearchQuery = () => {}
}) {
  const location = useLocation();
  const t = (key) => translations[language]?.[key] || translations['en']?.[key] || key;

  const PAGE_TITLES = {
    '/': t('dashboard'),
    '/dma': 'DMA',
    '/external': 'External',
    '/internal': 'Internal',
    '/scripts': 'Scripting',
    '/ai': t('aiAssistant'),
    '/processes': t('processManager'),
    '/terminal': t('terminal'),
    '/files': t('fileTransfer'),
    '/settings': t('settings'),
    '/profile': t('profileSettings')
  };

  const pageTitle = PAGE_TITLES[location.pathname] || t('dashboard');

  const getSearchResults = () => {
    if (!searchQuery) return [];
    const q = searchQuery.toLowerCase();
    const results = [];

    const sections = [
      { name: 'Dashboard', path: '/', desc: 'View live PC specs and system monitoring gauges', icon: '🖥️' },
      { name: 'DMA Cheating', path: '/dma', desc: 'DMA tools, firmware, and configuration guides', icon: '📡' },
      { name: 'External Cheating', path: '/external', desc: 'External process tools, overlays, memory scanners', icon: '🔍' },
      { name: 'Internal Cheating', path: '/internal', desc: 'DLL injection, hooking, and memory manipulation', icon: '💉' },
      { name: 'Scripting', path: '/scripts', desc: 'KryoK Rust script and automation tools', icon: '⚡' },
      { name: 'AI Assistant', path: '/ai', desc: 'Interact with your local AI assistant model', icon: '🤖' },
      { name: 'Settings', path: '/settings', desc: 'Configure language, color themes, startup, and AI', icon: '⚙️' },
      { name: 'User Profile', path: '/profile', desc: 'Change initials, upload custom avatar, and reset credentials', icon: '👤' },
    ];

    if (profile?.isAdmin) {
      sections.push({ name: 'Admin Panel', path: '/admin', desc: 'Manage user databases and generate license keys', icon: '🛡️' });
    }

    sections.forEach(s => {
      if (s.name.toLowerCase().includes(q) || s.desc.toLowerCase().includes(q)) {
        results.push({ type: 'page', title: s.name, subtitle: s.desc, icon: s.icon, path: s.path });
      }
    });

    const settingsSub = [
      { name: 'App Language', path: '/settings', desc: 'Toggle app text language between English and French', icon: '🌐' },
      { name: 'Color Themes', path: '/settings', desc: 'Select between dark, light, sapphire, emerald, and ruby themes', icon: '🎨' },
      { name: 'AI Model Selection', path: '/settings', desc: 'Set local AI model configuration and API endpoint', icon: '🤖' },
      { name: 'Launch on Windows Boot', path: '/settings', desc: 'Configure app launch on startup setting', icon: '⚙️' },
      { name: 'Bridge Startup Task', path: '/settings', desc: 'Manage remote secondary PC startup task', icon: '📡' },
    ];

    settingsSub.forEach(s => {
      if (s.name.toLowerCase().includes(q) || s.desc.toLowerCase().includes(q)) {
        results.push({ type: 'setting', title: s.name, subtitle: s.desc, icon: s.icon, path: s.path });
      }
    });

    return results;
  };

  const handleMinimize = () => window.synced?.window?.minimize();
  const handleMaximize = () => window.synced?.window?.maximize();
  const handleClose = () => window.synced?.window?.close();

  const handleLogout = () => {
    const username = localStorage.getItem('synced-username') || profile?.username;
    if (username) {
      // Fire and forget session logging
      (async () => {
        try {
          const [specsRes, ipRes] = await Promise.all([api.getLocalSpecs(), api.getLocalIP()]);
          await api.saveSessionData(username, {
            action: 'logout',
            ip: ipRes?.ip || '',
            specs: specsRes?.data || {}
          });
        } catch (err) {
          console.warn('Failed to save logout session data:', err);
        }
      })();
    }
    
    localStorage.removeItem('synced-username');
    localStorage.removeItem('synced-user-id');
    localStorage.removeItem('synced-profile');
    window.dispatchEvent(new Event('storage'));
    window.location.reload();
  };

  const [profile, setProfile] = React.useState({ username: 'Admin', pfpType: 'initials', pfpValue: 'A' });

  const [ping, setPing] = React.useState(0);
  React.useEffect(() => {
    let active = true;
    const measurePing = async () => {
      const start = performance.now();
      try {
        await fetch('http://clients3.google.com/generate_204', { method: 'HEAD', mode: 'no-cors' });
        const end = performance.now();
        if (active) setPing(Math.round(end - start));
      } catch (e) {
        if (active) setPing(-1);
      }
    };
    measurePing();
    const interval = setInterval(measurePing, 15000);

    async function loadProfile() {
      try {
        const activeUser = localStorage.getItem('synced-username') || 'Admin';
        const dbProfile = await api.getUserProfile(activeUser);
        if (dbProfile) {
          setProfile(dbProfile);
          localStorage.setItem('synced-profile', JSON.stringify(dbProfile));
        } else {
          const localProfile = localStorage.getItem('synced-profile');
          if (localProfile) {
            try {
              setProfile(JSON.parse(localProfile));
            } catch {
              localStorage.removeItem('synced-profile');
            }
          }
        }
      } catch {
        const localProfile = localStorage.getItem('synced-profile');
        if (localProfile) {
          try {
            setProfile(JSON.parse(localProfile));
          } catch {
            localStorage.removeItem('synced-profile');
          }
        }
      }
    }
    loadProfile();

    window.addEventListener('storage', loadProfile);
    window.addEventListener('profile-updated', loadProfile);
    return () => {
      active = false;
      clearInterval(interval);
      window.removeEventListener('storage', loadProfile);
      window.removeEventListener('profile-updated', loadProfile);
    };
  }, []);

  return (
    <div className="app-layout">
      {/* Sidebar */}
      <aside className="sidebar">
        <div className="sidebar-logo">
          <div className="sidebar-logo-icon">S</div>
          <span className="sidebar-logo-text">{APP_NAME}</span>
        </div>

        <nav className="sidebar-nav">
          <div className="nav-section-label">{t('navigation')}</div>
          {ROUTES.filter(route => route.path !== '/settings').map((route) => {
            let label = route.label;
            if (route.path === '/') label = t('dashboard');
            else if (route.path === '/ai') label = t('aiAssistant');
            else if (route.path === '/processes') label = t('processManager');
            else if (route.path === '/terminal') label = t('terminal');
            else if (route.path === '/files') label = t('fileTransfer');

            return (
              <NavLink
                key={route.path}
                to={route.path}
                className={({ isActive }) =>
                  `nav-item ${isActive ? 'active' : ''}`
                }
              >
                <span className="nav-icon">{route.icon}</span>
                <span>{label}</span>
              </NavLink>
            );
          })}
          {profile?.isAdmin && (
            <NavLink
              to="/admin"
              className={({ isActive }) =>
                `nav-item ${isActive ? 'active' : ''}`
              }
            >
              <span className="nav-icon">🛡️</span>
              <span>Admin Panel</span>
            </NavLink>
          )}

          <div style={{ marginTop: 'auto', paddingTop: 12 }}>
            <NavLink
              to="/settings"
              className={({ isActive }) =>
                `nav-item ${isActive ? 'active' : ''}`
              }
            >
              <span className="nav-icon">⚙️</span>
              <span>{t('settings')}</span>
            </NavLink>
          </div>
        </nav>

        <div className="sidebar-status">
          <div className="status-row">
            <span className={`status-dot online`}></span>
            <span className="pc-name">{mainHostname}</span>
            <span>{t('online')}</span>
          </div>
          <div className="status-row">
            <span className={`status-dot ${bridgeOnline ? 'online' : 'offline'}`}></span>
            <span className="pc-name">{bridgeOnline ? bridgeHostname : t('secondaryPC')}</span>
            <span>{bridgeOnline ? t('online') : t('offline')}</span>
          </div>
        </div>
      </aside>

      {/* Header */}
      <header className="header">
        <div className="header-left">
          <h1 className="header-title">{pageTitle}</h1>
        </div>

        <div className="header-right">
          <div className="header-search" style={{ position: 'relative' }}>
            <span className="header-search-icon">🔍</span>
            <input 
              type="text" 
              placeholder={t('searchPlaceholder')} 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <div className="glass-card search-results-dropdown" style={{
                position: 'absolute',
                top: 'calc(100% + 8px)',
                right: 0,
                width: 320,
                maxHeight: 400,
                overflowY: 'auto',
                zIndex: 1000,
                padding: 12,
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
                boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.4), 0 8px 10px -6px rgba(0, 0, 0, 0.4)',
                border: '1px solid var(--border-color)',
                textAlign: 'left',
                borderRadius: 8
              }}>
                <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--text-muted)', fontWeight: 600, paddingBottom: 4, borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>App Search</span>
                  <button onClick={() => setSearchQuery('')} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 10 }}>Clear</button>
                </div>
                {getSearchResults().map((res, i) => (
                  <Link 
                    key={i} 
                    to={res.path} 
                    onClick={() => setSearchQuery('')} 
                    style={{ 
                      display: 'flex', 
                      alignItems: 'center', 
                      gap: 12, 
                      padding: 8, 
                      borderRadius: 6, 
                      cursor: 'pointer', 
                      textDecoration: 'none',
                      transition: 'background 0.2s'
                    }}
                    className="search-result-item"
                  >
                    <span style={{ fontSize: 16 }}>{res.icon}</span>
                    <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>{res.title}</span>
                      <span style={{ fontSize: 10, color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{res.subtitle}</span>
                    </div>
                  </Link>
                ))}
                {getSearchResults().length === 0 && (
                  <div style={{ padding: '16px 0', textAlign: 'center', fontSize: 11, color: 'var(--text-muted)' }}>
                    No app sections found matching "{searchQuery}"
                  </div>
                )}
              </div>
            )}
          </div>



          <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px', background: 'rgba(255,255,255,0.03)', borderRadius: 20, border: '1px solid rgba(255,255,255,0.05)', fontSize: 10, fontWeight: 700, color: 'var(--text-muted)' }} title="Server Latency">
            <span style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: ping < 0 ? 'var(--danger)' : ping < 100 ? 'var(--success)' : ping < 250 ? 'var(--warning)' : 'var(--danger)', boxShadow: `0 0 6px ${ping < 0 ? 'var(--danger)' : ping < 100 ? 'var(--success)' : ping < 250 ? 'var(--warning)' : 'var(--danger)'}` }} />
            <span id="ping-indicator">{ping < 0 ? 'ERR' : `${ping}ms`}</span>
          </div>

          <Link
            to="/profile"
            style={{
              width: 32,
              height: 32,
              borderRadius: 'var(--radius-md)',
              background: 'var(--accent-gradient)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: profile?.pfpType === 'emoji' ? 18 : 13,
              fontWeight: 700,
              color: '#fff',
              cursor: 'pointer',
              textDecoration: 'none',
              overflow: 'hidden',
              boxShadow: '0 0 10px rgba(168, 85, 247, 0.2)'
            }}
            title={t('profile')}
          >
            {profile?.pfpType === 'emoji' ? (
              profile.pfpValue
            ) : profile?.pfpType === 'base64' || profile?.pfpType === 'url' ? (
              <img src={profile.pfpValue} alt="Pfp" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              (profile?.username || 'U')[0]?.toUpperCase()
            )}
          </Link>

          <button
            className="btn btn-secondary"
            onClick={handleLogout}
            title="Log out"
            style={{ height: 32, padding: '0 10px', fontSize: 12, fontWeight: 700 }}
          >
            Logout
          </button>

          {/* Window Controls */}
          <div className="window-controls">
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
      </header>

      {/* Main Content */}
      <main className="main-content">
        {children}
      </main>
    </div>
  );
}
