import React, { useState, useRef, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { api } from '../utils/api';
import { translations } from '../utils/translations';

const MOCK_HISTORY_MAIN = [
  { type: 'cmd', text: '$ systeminfo | findstr /B /C:"OS Name" /C:"OS Version"' },
  { type: 'output', text: 'OS Name:                   Microsoft Windows 11 Pro\nOS Version:                10.0.26100 N/A Build 26100' },
  { type: 'cmd', text: '$ Get-Process | Sort-Object CPU -Descending | Select -First 5' },
  { type: 'output', text: 'Handles  NPM(K)    PM(K)      WS(K)     CPU(s)     Id  ProcessName\n-------  ------    -----      -----     ------     --  -----------\n  1842      98   852340     865420   2,845.23   1234  chrome\n   956      45   462080     474520   1,234.56   5678  obs64\n   724      38   524288     536870     987.45   9012  Code\n   612      32   390144     401408     456.78   2345  Discord\n   445      28   215040     220160     234.12   3456  steam' },
  { type: 'cmd', text: '$ ping 192.168.1.75 -n 4' },
  { type: 'output', text: 'Pinging 192.168.1.75 with 32 bytes of data:\nReply from 192.168.1.75: bytes=32 time<1ms TTL=128\nReply from 192.168.1.75: bytes=32 time<1ms TTL=128\nReply from 192.168.1.75: bytes=32 time<1ms TTL=128\nReply from 192.168.1.75: bytes=32 time=1ms TTL=128' },
];

const MOCK_HISTORY_SECONDARY = [
  { type: 'cmd', text: '$ hostname' },
  { type: 'output', text: 'ATLAS' },
  { type: 'cmd', text: '$ Get-NetIPAddress -AddressFamily IPv4 | Select IPAddress, InterfaceAlias' },
  { type: 'output', text: 'IPAddress       InterfaceAlias\n---------       --------------\n192.168.1.75    Ethernet\n127.0.0.1       Loopback Pseudo-Interface 1' },
  { type: 'cmd', text: '$ Get-Service synced-bridge | Format-List' },
  { type: 'output', text: 'Name           : synced-bridge\nDisplayName    : Synced Bridge Service\nStatus         : Running\nStartType      : Automatic' },
];

const MOCK_RESPONSES = {
  'whoami': 'ALTERA\\Audre',
  'hostname': 'ALTERA',
  'date': new Date().toString(),
  'cls': '',
  'clear': '',
  'help': 'Available commands: whoami, hostname, date, cls, clear, help, ipconfig, dir, echo',
  'ipconfig': 'Windows IP Configuration\n\nEthernet adapter Ethernet:\n   IPv4 Address. . . . . : 192.168.1.50\n   Subnet Mask . . . . . : 255.255.255.0\n   Default Gateway . . . : 192.168.1.1',
  'dir': ' Volume in drive C has no label.\n Directory of C:\\Users\\Audre\n\n06/12/2025  03:45 PM    <DIR>          Desktop\n06/12/2025  03:45 PM    <DIR>          Documents\n06/12/2025  03:45 PM    <DIR>          Downloads\n               0 File(s)              0 bytes\n               3 Dir(s)  845,234,176,000 bytes free',
};

function TerminalPane({ name, isOnline, initialHistory, pcType, bridgeConfig, prefill, language }) {
  const t = (key) => translations[language]?.[key] || translations['en']?.[key] || key;
  const [history, setHistory] = useState(initialHistory);
  const [inputValue, setInputValue] = useState('');
  const [commandHistory, setCommandHistory] = useState([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [executing, setExecuting] = useState(false);
  const outputRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (prefill) {
      setInputValue(prefill);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [prefill]);

  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [history]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    const cmd = inputValue.trim();
    if (!cmd || executing) return;

    setCommandHistory((prev) => [...prev, cmd]);
    setHistoryIndex(-1);

    if (cmd === 'cls' || cmd === 'clear') {
      setHistory([]);
      setInputValue('');
      return;
    }

    const newEntry = { type: 'cmd', text: `$ ${cmd}` };
    setHistory((prev) => [...prev, newEntry]);
    setInputValue('');
    setExecuting(true);

    let output = '';
    let isError = false;

    try {
      if (pcType === 'main') {
        const res = await api.execLocal(cmd);
        if (res.success) {
          output = res.output || '';
          if (res.error) {
            output += '\n' + res.error;
          }
        } else {
          output = res.error || 'Command execution failed';
          isError = true;
        }
      } else {
        if (!isOnline) {
          output = language === 'fr' ? 'Le pont est hors ligne — impossible d\'exécuter la commande' : 'Bridge is offline — cannot execute command';
          isError = true;
        } else {
          const res = await api.executeOnBridge(bridgeConfig, cmd);
          if (res.success) {
            output = res.data?.output || '';
            if (res.data?.error) {
              output += '\n' + res.data.error;
            }
            if (res.data?.exitCode !== 0) {
              isError = true;
            }
          } else {
            output = res.error || 'Failed to execute command on secondary PC';
            isError = true;
          }
        }
      }
    } catch (err) {
      output = `Error: ${err.message}`;
      isError = true;
    }

    setHistory((prev) => [
      ...prev,
      { type: isError ? 'error' : 'output', text: output || ' ' },
    ]);
    setExecuting(false);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (commandHistory.length === 0) return;
      const newIndex = historyIndex === -1
        ? commandHistory.length - 1
        : Math.max(0, historyIndex - 1);
      setHistoryIndex(newIndex);
      setInputValue(commandHistory[newIndex]);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyIndex === -1) return;
      const newIndex = historyIndex + 1;
      if (newIndex >= commandHistory.length) {
        setHistoryIndex(-1);
        setInputValue('');
      } else {
        setHistoryIndex(newIndex);
        setInputValue(commandHistory[newIndex]);
      }
    }
  };

  return (
    <div className="terminal-pane">
      <div className="terminal-header">
        <div className="terminal-header-left">
          <div className="terminal-dots">
            <span className="terminal-dot red" />
            <span className="terminal-dot yellow" />
            <span className="terminal-dot green" />
          </div>
          <span>{name}</span>
        </div>
        <span className={`status-dot ${isOnline ? 'online' : 'offline'}`} />
      </div>

      <div className="terminal-output" ref={outputRef} onClick={() => inputRef.current?.focus()}>
        {history.map((entry, i) => (
          <div
            key={i}
            className={
              entry.type === 'cmd'
                ? 'cmd-line'
                : entry.type === 'error'
                ? 'cmd-error'
                : entry.type === 'success'
                ? 'cmd-success'
                : 'cmd-output'
            }
            style={{ whiteSpace: 'pre-wrap', marginBottom: entry.type === 'cmd' ? 0 : 8 }}
          >
            {entry.text}
          </div>
        ))}
      </div>

      <form className="terminal-input-row" onSubmit={handleSubmit}>
        <span className="terminal-prompt">$</span>
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={language === 'fr' ? 'Saisir une commande...' : 'Type a command...'}
          autoFocus={false}
        />
      </form>
    </div>
  );
}

export default function Terminal({ bridgeConfig, bridgeOnline, language, mainHostname, bridgeHostname }) {
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

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">
          <span className="gradient-text">{t('terminal')}</span>
        </h1>
        <p className="page-subtitle">{t('terminalSubtitle')}</p>
      </div>

      <div className="terminal-grid">
        <TerminalPane
          name={`${mainHostname} — ${t('mainPC')}`}
          isOnline={true}
          initialHistory={MOCK_HISTORY_MAIN}
          pcType="main"
          bridgeConfig={bridgeConfig}
          prefill={target === 'main' ? runCommand : ''}
          language={language}
        />
        <TerminalPane
          name={`${bridgeHostname} — ${t('secondaryPC')}`}
          isOnline={bridgeOnline}
          initialHistory={MOCK_HISTORY_SECONDARY}
          pcType="secondary"
          bridgeConfig={bridgeConfig}
          prefill={target === 'secondary' ? runCommand : ''}
          language={language}
        />
      </div>
    </div>
  );
}
