/**
 * ErrorBoundary — Catches rendering errors anywhere in the children tree
 * and displays a recovery UI instead of crashing the whole app.
 * Includes window controls for the frameless Electron window.
 */
import React from 'react';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('[ErrorBoundary] Caught an error:', error, errorInfo);
    this.setState({ errorInfo });
    if (this.props.onError) {
      this.props.onError(error, errorInfo);
    }
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  handleReload = () => {
    window.location.reload();
  };

  handleResetAll = () => {
    const keep = [
      'synced-username',
      'synced-user-id',
      'synced-setup-complete',
      'synced-config',
      'synced-splash-seen',
    ];
    const saved = {};
    for (const key of keep) {
      try {
        const val = localStorage.getItem(key);
        if (val) saved[key] = val;
      } catch {}
    }
    localStorage.clear();
    for (const [key, val] of Object.entries(saved)) {
      localStorage.setItem(key, val);
    }
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      const isFatal = this.props.fatal;
      return (
        <div style={{
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: isFatal ? '100vh' : '300px',
          padding: '24px',
          background: isFatal
            ? 'radial-gradient(circle at center, #1a1a2e 0%, #0a0a14 100%)'
            : 'transparent',
          fontFamily: "'Inter', system-ui, sans-serif",
        }}>
          {/* Window Controls for frameless Electron window — always visible on fatal errors */}
          {isFatal && (
            <div style={{
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
            }}>
              <div className="window-controls" style={{ WebkitAppRegion: 'no-drag' }}>
                <button className="window-btn" onClick={() => window.synced?.window?.minimize()} title="Minimize">─</button>
                <button className="window-btn" onClick={() => window.synced?.window?.maximize()} title="Maximize">□</button>
                <button className="window-btn close" onClick={() => window.synced?.window?.close()} title="Close">✕</button>
              </div>
            </div>
          )}
          <div className="glass-card" style={{
            maxWidth: 480,
            width: '100%',
            padding: '32px 28px',
            textAlign: 'center',
            border: '1px solid rgba(239, 68, 68, 0.15)',
            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
          }}>
            <div style={{
              width: 56,
              height: 56,
              borderRadius: 16,
              background: 'rgba(239, 68, 68, 0.12)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 16px auto',
              fontSize: 28,
            }}>
              ⚠️
            </div>

            <h2 style={{
              margin: '0 0 8px 0',
              fontSize: 18,
              fontWeight: 700,
              color: 'var(--text-primary)',
            }}>
              {isFatal ? 'Application Error' : 'View Error'}
            </h2>

            <p style={{
              margin: '0 0 20px 0',
              fontSize: 13,
              color: 'var(--text-secondary)',
              lineHeight: 1.5,
            }}>
              {isFatal
                ? 'Synced encountered a critical rendering error. You can recover below.'
                : 'A rendering error occurred in this section. The rest of the app should still work.'}
            </p>

            {this.state.error && (
              <details style={{
                marginBottom: 20,
                textAlign: 'left',
                background: 'rgba(0,0,0,0.2)',
                borderRadius: 8,
                padding: 12,
                border: '1px solid var(--border-color)',
              }}>
                <summary style={{
                  cursor: 'pointer',
                  fontSize: 12,
                  fontWeight: 600,
                  color: 'var(--text-muted)',
                }}>
                  Error Details
                </summary>
                <pre style={{
                  margin: '8px 0 0 0',
                  fontSize: 11,
                  color: '#f87171',
                  whiteSpace: 'pre-wrap',
                  fontFamily: "'JetBrains Mono', monospace",
                  lineHeight: 1.4,
                  maxHeight: 200,
                  overflowY: 'auto',
                }}>
                  {this.state.error.toString()}
                  {this.state.errorInfo?.componentStack ? (
                    '\n\nComponent Stack:\n' + this.state.errorInfo.componentStack
                  ) : ''}
                </pre>
              </details>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {!isFatal && (
                <button
                  className="btn btn-primary"
                  onClick={this.handleReset}
                  style={{ width: '100%', padding: '10px 14px', fontSize: 13, fontWeight: 600 }}
                >
                  🔄 Retry View
                </button>
              )}
              <button
                className="btn btn-secondary"
                onClick={this.handleReload}
                style={{ width: '100%', padding: '10px 14px', fontSize: 13, fontWeight: 600 }}
              >
                🔄 Reload Interface
              </button>
              {isFatal && (
                <button
                  className="btn btn-secondary"
                  onClick={this.handleResetAll}
                  style={{ width: '100%', padding: '10px 14px', fontSize: 13, fontWeight: 600, color: 'var(--danger)' }}
                >
                  🗑️ Reset App State & Reload
                </button>
              )}
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
