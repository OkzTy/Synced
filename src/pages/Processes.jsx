import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../utils/api';
import { translations } from '../utils/translations';

function UsageBar({ value }) {
  const safeValue = typeof value === 'number' && !isNaN(value) ? value : 0;
  const level = safeValue > 50 ? (safeValue > 80 ? 'high' : 'medium') : '';
  return (
    <span className="usage-bar">
      <span
        className={`usage-bar-fill ${level}`}
        style={{ width: `${Math.min(safeValue, 100)}%` }}
      />
    </span>
  );
}

export default function Processes({ bridgeConfig, bridgeOnline, language = 'en', bridgeHostname = 'Secondary PC', searchQuery = '' }) {
  const t = (key) => translations[language]?.[key] || translations['en']?.[key] || key;
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      height: 'calc(100vh - 120px)',
      textAlign: 'center',
      padding: '20px'
    }}>
      <div className="glass-card" style={{ maxWidth: 480, padding: '40px 32px', border: '1px solid rgba(255,255,255,0.05)' }}>
        <div style={{ fontSize: 54, marginBottom: 20 }}>🚧</div>
        <h2 style={{ fontSize: 24, fontWeight: 700, marginBottom: 12, color: 'var(--text-primary)' }}>
          {language === 'fr' ? 'Fonctionnalité non accessible' : 'Feature Not Accessible'}
        </h2>
        <p style={{ color: 'var(--text-muted)', fontSize: 14, marginBottom: 24, lineHeight: 1.6 }}>
          {language === 'fr' 
            ? "Pour le moment, cette fonctionnalité n'est pas accessible. Elle sera disponible prochainement dans une future mise à jour." 
            : "For now, this feature is not accessible. It will be enabled in an upcoming release."}
        </p>
        <span className="badge badge-info" style={{ padding: '6px 16px', fontSize: 13, fontWeight: 700, letterSpacing: 1.5 }}>
          {language === 'fr' ? 'BIENTÔT DISPONIBLE' : 'COMING SOON'}
        </span>
      </div>
    </div>
  );

  const [processes, setProcesses] = useState([]);
  const [activeTab, setActiveTab] = useState('main');
  const [sortBy, setSortBy] = useState('cpu');
  const [sortDir, setSortDir] = useState('desc');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [totalInfo, setTotalInfo] = useState({ total: 0, running: 0 });

  const fetchProcesses = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      let res;
      if (activeTab === 'main') {
        res = await api.getLocalProcesses();
      } else {
        if (!bridgeOnline) {
          setProcesses([]);
          setTotalInfo({ total: 0, running: 0 });
          setError('Bridge is offline — cannot fetch processes');
          setLoading(false);
          return;
        }
        res = await api.getBridgeProcesses(bridgeConfig);
      }

      if (res.success) {
        const list = res.data?.list || [];
        setProcesses(list);
        setTotalInfo({
          total: res.data?.total || list.length,
          running: res.data?.running || 0,
        });
      } else {
        setProcesses([]);
        setTotalInfo({ total: 0, running: 0 });
        setError(res.error || 'Failed to fetch processes');
      }
    } catch (e) {
      console.warn('Process fetch error:', e);
      setProcesses([]);
      setError('Failed to fetch processes');
    } finally {
      setLoading(false);
    }
  }, [activeTab, bridgeConfig, bridgeOnline]);

  useEffect(() => {
    fetchProcesses();
  }, [fetchProcesses]);

  const handleSort = (column) => {
    if (sortBy === column) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(column);
      setSortDir('desc');
    }
  };

  const handleKill = async (pid, processName) => {
    if (!window.confirm(`${t('confirmKill')} "${processName}" (PID: ${pid})?`)) return;

    try {
      let res;
      if (activeTab === 'main') {
        res = await api.killLocalProcess(pid);
      } else {
        res = await api.killProcessOnBridge(bridgeConfig, pid);
      }

      if (res.success) {
        // Refresh the process list after killing
        await fetchProcesses();
      } else {
        console.warn('Kill failed:', res.error);
        // Still refresh to show current state
        await fetchProcesses();
      }
    } catch (e) {
      console.warn('Kill error:', e);
      // Refresh anyway
      await fetchProcesses();
    }
  };

  const sortedProcesses = [...processes]
    .filter((p) => {
      if (!p || !p.name) return false;
      return p.name.toLowerCase().includes(searchQuery.toLowerCase());
    })
    .sort((a, b) => {
      let aVal = a[sortBy];
      let bVal = b[sortBy];
      if (aVal == null) aVal = '';
      if (bVal == null) bVal = '';
      if (typeof aVal === 'string') aVal = aVal.toLowerCase();
      if (typeof bVal === 'string') bVal = bVal.toLowerCase();
      if (aVal < bVal) return sortDir === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });

  const getSortIcon = (col) => {
    if (sortBy !== col) return ' ↕';
    return sortDir === 'asc' ? ' ↑' : ' ↓';
  };

  const formatValue = (val) => {
    if (val == null || isNaN(val)) return '0.0';
    return Number(val).toFixed(1);
  };

  const processIcons = {
    'chrome.exe': '🌐',
    'discord.exe': '💬',
    'steam.exe': '🎮',
    'valorant.exe': '🎯',
    'obs64.exe': '📹',
    'spotify.exe': '🎵',
    'explorer.exe': '📂',
    'node.exe': '🟢',
    'code.exe': '💻',
    'svchost.exe': '⚙️',
    'nginx.exe': '🌍',
    'ollama.exe': '🤖',
    'synced-bridge.exe': '🔗',
    'msedge.exe': '🌐',
    'firefox.exe': '🦊',
    'powershell.exe': '📟',
    'cmd.exe': '📟',
    'python.exe': '🐍',
    'java.exe': '☕',
    'RuntimeBroker.exe': '⚙️',
    'SearchHost.exe': '🔍',
    'Taskmgr.exe': '📊',
  };

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">
          <span className="gradient-text">{t('processManager')}</span>
        </h1>
        <p className="page-subtitle">
          {t('processesSubtitle')}
          {totalInfo.total > 0 && (
            <span style={{ marginLeft: 12 }}>
              <span className="badge badge-info">{totalInfo.total} {t('processes')}</span>
            </span>
          )}
        </p>
      </div>

      <div className="process-toolbar">
        <div className="process-tabs">
          <button
            className={`process-tab ${activeTab === 'main' ? 'active' : ''}`}
            onClick={() => setActiveTab('main')}
          >
            🖥️ {t('mainPC')}
          </button>
          <button
            className={`process-tab ${activeTab === 'secondary' ? 'active' : ''}`}
            onClick={() => setActiveTab('secondary')}
          >
            💻 {bridgeHostname}
            {!bridgeOnline && (
              <span className="status-dot offline" style={{ marginLeft: 6 }} />
            )}
          </button>
        </div>

        <button
          className="btn btn-secondary btn-sm"
          onClick={fetchProcesses}
          disabled={loading}
          style={{ marginLeft: 'auto' }}
        >
          {loading ? '⏳' : '🔄'} {t('refresh')}
        </button>
      </div>

      {error && (
        <div
          style={{
            padding: '12px 16px',
            marginBottom: 16,
            borderRadius: 8,
            background: 'rgba(239, 68, 68, 0.1)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            color: 'var(--danger)',
            fontSize: 14,
          }}
        >
          ⚠️ {error}
        </div>
      )}

      <div className="process-table-wrapper">
        <table className="process-table">
          <thead>
            <tr>
              <th
                className={sortBy === 'name' ? 'sorted' : ''}
                onClick={() => handleSort('name')}
              >
                {t('name')}{getSortIcon('name')}
              </th>
              <th
                className={sortBy === 'pid' ? 'sorted' : ''}
                onClick={() => handleSort('pid')}
              >
                {t('pid')}{getSortIcon('pid')}
              </th>
              <th
                className={sortBy === 'cpu' ? 'sorted' : ''}
                onClick={() => handleSort('cpu')}
              >
                {t('cpuUsage')}{getSortIcon('cpu')}
              </th>
              <th
                className={sortBy === 'mem' ? 'sorted' : ''}
                onClick={() => handleSort('mem')}
              >
                {t('memUsage')}{getSortIcon('mem')}
              </th>
              <th
                className={sortBy === 'state' ? 'sorted' : ''}
                onClick={() => handleSort('state')}
              >
                {t('status')}{getSortIcon('state')}
              </th>
              <th>{t('actions')}</th>
            </tr>
          </thead>
          <tbody>
            {loading && processes.length === 0 ? (
              <tr>
                <td colSpan="6" style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
                  {t('loading')}
                </td>
              </tr>
            ) : sortedProcesses.length === 0 ? (
              <tr>
                <td colSpan="6" style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
                  {searchQuery ? t('noFilterResults') : t('noProcessesFound')}
                </td>
              </tr>
            ) : (
              sortedProcesses.map((proc) => (
                <tr key={`${proc.pid}-${proc.name}`}>
                  <td>
                    <span className="process-name">
                      <span className="process-icon">
                        {processIcons[proc.name] || '📦'}
                      </span>
                      {proc.name || 'Unknown'}
                    </span>
                  </td>
                  <td>
                    <span className="text-mono text-xs">{proc.pid ?? '--'}</span>
                  </td>
                  <td>
                    {formatValue(proc.cpu)}%
                    <UsageBar value={proc.cpu} />
                  </td>
                  <td>
                    {formatValue(proc.mem)}%
                    <UsageBar value={proc.mem} />
                  </td>
                  <td>
                    <span
                      className={`badge ${
                        proc.state === 'running' ? 'badge-success' : 'badge-warning'
                      }`}
                    >
                      {proc.state || 'unknown'}
                    </span>
                  </td>
                  <td>
                    <button
                      className="btn btn-danger btn-sm"
                      onClick={() => handleKill(proc.pid, proc.name)}
                    >
                      ✕ {t('killProcess')}
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
