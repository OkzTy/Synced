import React from 'react';

export default function ExternalCheat() {
  return (
    <div className="page-container animate-fade-in">
      <div className="page-header">
        <div>
          <h2 className="page-title">External Cheating</h2>
          <p className="page-subtitle">External processes, overlays, and memory tools</p>
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
        <div style={{
          fontSize: 64,
          marginBottom: 20,
          animation: 'float 3s ease-in-out infinite'
        }}>
          🔧
        </div>
        <h3 style={{
          fontSize: 22,
          fontWeight: 700,
          color: 'var(--text-primary)',
          marginBottom: 8
        }}>Coming Soon</h3>
        <p style={{
          fontSize: 13,
          color: 'var(--text-muted)',
          maxWidth: 400,
          lineHeight: 1.6
        }}>
          External cheat tools are being reworked. 
          New overlays, memory scanners, and process tools coming in the next update.
        </p>
      </div>
      <style>{`
        @keyframes float {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-10px); }
        }
      `}</style>
    </div>
  );
}
