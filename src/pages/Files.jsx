import React, { useState, useEffect } from 'react';
import { api } from '../utils/api';
import { translations } from '../utils/translations';

export default function Files({ bridgeConfig, bridgeOnline, language, mainHostname, bridgeHostname, searchQuery = '' }) {
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

  // Fetch local files (Main PC)
  useEffect(() => {
    async function fetchLeftFiles() {
      setLeftLoading(true);
      setLeftError(null);
      try {
        const res = await api.listDir(leftPath);
        if (res.success) {
          setLeftFiles(res.data || []);
          if (res.path && leftPath !== res.path) {
            setLeftPath(res.path);
          }
        } else {
          setLeftError(res.error || 'Failed to list directory');
        }
      } catch (e) {
        setLeftError('Failed to load local filesystem');
      } finally {
        setLeftLoading(false);
      }
    }
    fetchLeftFiles();
  }, [leftPath]);

  // Fetch remote files (Secondary PC via Bridge)
  useEffect(() => {
    async function fetchRightFiles() {
      if (!bridgeOnline) {
        setRightFiles([]);
        setRightError('Bridge is offline');
        return;
      }
      setRightLoading(true);
      setRightError(null);
      try {
        const res = await api.listBridgeDir(bridgeConfig, rightPath);
        if (res.success) {
          setRightFiles(res.data || []);
          if (res.path && rightPath !== res.path) {
            setRightPath(res.path);
          }
        } else {
          setRightError(res.error || 'Failed to list directory');
        }
      } catch (e) {
        setRightError('Failed to load bridge filesystem');
      } finally {
        setRightLoading(false);
      }
    }
    fetchRightFiles();
  }, [rightPath, bridgeOnline, bridgeConfig]);

  const handleTransfer = async (direction) => {
    const selectedFile = direction === 'right' 
      ? leftFiles[leftSelected] 
      : rightFiles[rightSelected];
    
    if (!selectedFile) return;

    alert(t('comingSoon'));
  };

  const getFileIcon = (file) => {
    if (file.type === 'folder') return '📁';
    const ext = file.name.split('.').pop()?.toLowerCase();
    const icons = {
      exe: '⚙️', txt: '📄', json: '📋', png: '🖼️', jpg: '🖼️',
      mp4: '🎬', mp3: '🎵', zip: '📦', pdf: '📕', md: '📝',
      js: '📜', py: '🐍', html: '🌐', css: '🎨',
    };
    return icons[ext] || '📄';
  };

  const handleBreadcrumbClick = (side, index) => {
    const currentPath = side === 'left' ? leftPath : rightPath;
    const setter = side === 'left' ? setLeftPath : setRightPath;
    
    const segments = currentPath.split(/[/\\]/).filter(Boolean);
    let newPath = segments.slice(0, index + 1).join('\\');
    
    // Add trailing slash for drive letter on Windows (e.g. C:\)
    if (segments[0].endsWith(':') && index === 0) {
      newPath += '\\';
    }
    setter(newPath);
  };

  const handleFileClick = (side, index, file) => {
    const pathVal = side === 'left' ? leftPath : rightPath;
    const pathSetter = side === 'left' ? setLeftPath : setRightPath;
    const selectedVal = side === 'left' ? leftSelected : rightSelected;
    const selectedSetter = side === 'left' ? setLeftSelected : setRightSelected;

    if (selectedVal === index) {
      // Double-click action
      if (file.type === 'folder') {
        if (file.name === '..') {
          // Go up a directory
          const segments = pathVal.split(/[/\\]/).filter(Boolean);
          if (segments.length > 1) {
            let parent = segments.slice(0, -1).join('\\');
            if (segments.length === 2 && segments[0].endsWith(':')) {
              parent += '\\';
            }
            pathSetter(parent);
          }
        } else {
          pathSetter(file.path);
        }
        selectedSetter(null);
      }
    } else {
      selectedSetter(index);
    }
  };

  function FilePane({ 
    title, 
    pcIcon, 
    files, 
    pathString, 
    selected, 
    onSelect, 
    onBreadcrumb, 
    isOnline, 
    loading, 
    error 
  }) {
    const segments = pathString.split(/[/\\]/).filter(Boolean);
    const isRoot = segments.length <= 1;

    // Filter files if search query is active
    const filteredFiles = files.filter((file) => {
      if (!searchQuery) return true;
      return file.name.toLowerCase().includes(searchQuery.toLowerCase());
    });

    // Insert virtual '..' to go up a folder
    const displayFiles = isRoot || error 
      ? filteredFiles 
      : [{ name: '..', type: 'folder', path: '..' }, ...filteredFiles];

    // Adjust selected index if '..' is prepended
    const adjustedSelected = !isRoot && selected !== null ? selected + 1 : selected;

    return (
      <div className="file-pane">
        <div className="file-pane-header">
          <div className="file-pane-title">
            <span>{pcIcon}</span>
            <span>{title}</span>
          </div>
          <span className={`status-dot ${isOnline ? 'online' : 'offline'}`} />
        </div>

        <div className="file-breadcrumb">
          {segments.map((segment, i) => (
            <React.Fragment key={i}>
              {i > 0 && <span style={{ color: 'var(--text-muted)', margin: '0 2px' }}>›</span>}
              <span className="breadcrumb-segment" onClick={() => onBreadcrumb(i)}>{segment}</span>
            </React.Fragment>
          ))}
          {segments.length === 0 && <span style={{ color: 'var(--text-muted)' }}>Loading path...</span>}
        </div>

        <div className="file-list">
          {loading && (
            <div className="file-list-status">
              <span className="spinner" style={{ marginRight: 8 }} /> {language === 'fr' ? 'Chargement des fichiers...' : 'Loading files...'}
            </div>
          )}
          
          {error && !loading && (
            <div className="file-list-status error">
              ❌ {error}
            </div>
          )}

          {!loading && !error && displayFiles.map((file, i) => {
            const isDotDot = file.name === '..';
            const realIndex = isDotDot ? null : (isRoot ? i : i - 1);
            const isSelected = adjustedSelected === i;

            return (
              <div
                key={i}
                className={`file-item ${isSelected ? 'selected' : ''}`}
                onClick={() => onSelect(realIndex, file)}
                style={{ opacity: isDotDot ? 0.7 : 1 }}
              >
                <span className="file-icon">{getFileIcon(file)}</span>
                <span className="file-name">{file.name}</span>
                <span className="file-size">{file.size || '—'}</span>
                <span className="file-date">{file.modified || ''}</span>
              </div>
            );
          })}

          {!loading && !error && displayFiles.length === 0 && (
            <div className="file-list-status text-muted">
              {language === 'fr' ? 'Le dossier est vide' : 'Folder is empty'}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">
          <span className="gradient-text">{t('fileTransfer')}</span>
        </h1>
        <p className="page-subtitle">{t('filesSubtitle')}</p>
      </div>

      <div className="files-grid">
        <FilePane
          title={`${mainHostname} — ${t('mainPC')}`}
          pcIcon="🖥️"
          files={leftFiles}
          pathString={leftPath}
          selected={leftSelected}
          onSelect={(i, file) => handleFileClick('left', i, file)}
          onBreadcrumb={(i) => handleBreadcrumbClick('left', i)}
          isOnline={true}
          loading={leftLoading}
          error={leftError}
        />

        <div className="transfer-controls">
          <button
            className="transfer-btn"
            onClick={() => handleTransfer('right')}
            disabled={leftSelected === null || transferring !== null}
            title="Transfer to secondary PC →"
          >
            →
          </button>
          <button
            className="transfer-btn"
            onClick={() => handleTransfer('left')}
            disabled={rightSelected === null || transferring !== null}
            title="← Transfer to main PC"
          >
            ←
          </button>
        </div>

        <FilePane
          title={`${bridgeHostname} — ${t('secondaryPC')}`}
          pcIcon="💻"
          files={rightFiles}
          pathString={rightPath}
          selected={rightSelected}
          onSelect={(i, file) => handleFileClick('right', i, file)}
          onBreadcrumb={(i) => handleBreadcrumbClick('right', i)}
          isOnline={bridgeOnline}
          loading={rightLoading}
          error={rightError}
        />
      </div>
    </div>
  );
}
