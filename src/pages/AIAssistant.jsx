import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../utils/api';
import { translations } from '../utils/translations';

function parseMessageContent(text) {
  const parts = [];
  const codeBlockRegex = /```(\w+)?\n([\s\S]*?)```/g;
  let lastIndex = 0;
  let match;

  while ((match = codeBlockRegex.exec(text)) !== null) {
    // Text before code block
    if (match.index > lastIndex) {
      parts.push({ type: 'text', content: text.slice(lastIndex, match.index) });
    }
    parts.push({ type: 'code', language: match[1] || '', content: match[2].trim() });
    lastIndex = match.index + match[0].length;
  }

  // Remaining text
  if (lastIndex < text.length) {
    parts.push({ type: 'text', content: text.slice(lastIndex) });
  }

  return parts;
}

function CodeBlock({ language, content, onRunCommand, mainHostname, bridgeHostname, appLanguage }) {
  const [copied, setCopied] = useState(false);
  const [showRunOptions, setShowRunOptions] = useState(false);
  const t = (key) => translations[appLanguage]?.[key] || translations['en']?.[key] || key;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
      const ta = document.createElement('textarea');
      ta.value = content;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const isExecutable = !language || ['powershell', 'pwsh', 'cmd', 'shell', 'bash'].includes(language.toLowerCase());

  return (
    <pre style={{ position: 'relative' }}>
      <div style={{ position: 'absolute', right: 8, top: 8, display: 'flex', gap: 6, zIndex: 10 }}>
        <button className="code-copy-btn" onClick={handleCopy} style={{ padding: '3px 8px', fontSize: 11 }}>
          {copied ? `✓ ${t('copied')}` : `📋 ${t('copy')}`}
        </button>
        {isExecutable && onRunCommand && (
          <div style={{ position: 'relative' }}>
            <button 
              className="code-copy-btn" 
              onClick={() => setShowRunOptions(!showRunOptions)}
              style={{ 
                padding: '3px 8px', 
                fontSize: 11, 
                background: 'rgba(108, 92, 231, 0.2)', 
                border: '1px solid rgba(108, 92, 231, 0.4)',
                color: '#a855f7'
              }}
            >
              ⚡ {t('runOn')} ▾
            </button>
            {showRunOptions && (
              <div 
                className="glass-card" 
                style={{ 
                  position: 'absolute', 
                  right: 0, 
                  top: '100%', 
                  marginTop: 4, 
                  display: 'flex', 
                  flexDirection: 'column', 
                  gap: 4, 
                  padding: 6, 
                  minWidth: 140, 
                  boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
                  zIndex: 20
                }}
              >
                <button 
                  className="code-copy-btn" 
                  onClick={() => { onRunCommand(content, 'main'); setShowRunOptions(false); }}
                  style={{ width: '100%', textAlign: 'left', display: 'block', padding: '4px 8px', margin: 0 }}
                >
                  🖥️ {t('runOn')} {mainHostname}
                </button>
                <button 
                  className="code-copy-btn" 
                  onClick={() => { onRunCommand(content, 'secondary'); setShowRunOptions(false); }}
                  style={{ width: '100%', textAlign: 'left', display: 'block', padding: '4px 8px', margin: 0 }}
                >
                  💻 {t('runOn')} {bridgeHostname}
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {language && (
        <span style={{ fontSize: 10, color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>
          {language}
        </span>
      )}
      <code>{content}</code>
    </pre>
  );
}

function MessageBubble({ message, onRunCommand, mainHostname, bridgeHostname, appLanguage }) {
  const parts = parseMessageContent(message.content);

  return (
    <div className={`ai-message ${message.role}`}>
      <div className={`ai-avatar ${message.role === 'user' ? 'user-avatar' : 'ai-avatar-icon'}`}>
        {message.role === 'user' ? 'U' : '🤖'}
      </div>
      <div className="ai-bubble">
        {parts.map((part, i) =>
          part.type === 'code' ? (
            <CodeBlock 
              key={i} 
              language={part.language} 
              content={part.content} 
              onRunCommand={onRunCommand}
              mainHostname={mainHostname}
              bridgeHostname={bridgeHostname}
              appLanguage={appLanguage}
            />
          ) : (
            <span key={i} style={{ whiteSpace: 'pre-wrap' }}>{part.content}</span>
          )
        )}
      </div>
    </div>
  );
}

function TypingIndicator() {
  return (
    <div className="ai-message assistant">
      <div className="ai-avatar ai-avatar-icon">🤖</div>
      <div className="ai-bubble">
        <div className="typing-indicator">
          <span className="typing-dot" />
          <span className="typing-dot" />
          <span className="typing-dot" />
        </div>
      </div>
    </div>
  );
}

export default function AIAssistant({ bridgeConfig, language = 'en', mainHostname = 'Main PC', bridgeHostname = 'Secondary PC' }) {
  const t = (key) => translations[language]?.[key] || translations['en']?.[key] || key;

  const initialMessages = [
    {
      role: 'assistant',
      content: language === 'fr' 
        ? `Bonjour ! Je suis votre assistant IA Synced. Je peux vous aider à résoudre les problèmes, à gérer vos PC et à répondre aux questions sur votre système.\n\nQue puis-je faire pour vous aujourd'hui ?`
        : `Hello! I'm your AI assistant for Synced. I can help you troubleshoot issues, manage your PCs, and answer questions about your system.\n\nWhat can I help you with today?`,
    }
  ];

  const [messages, setMessages] = useState(initialMessages);
  const [inputValue, setInputValue] = useState('');
  const [isThinking, setIsThinking] = useState(false);
  const [aiStatus, setAiStatus] = useState(null);
  const [startingOllama, setStartingOllama] = useState(false);
  const [ollamaCheck, setOllamaCheck] = useState({ installed: true, running: true });
  const [pullingModel, setPullingModel] = useState(false);
  const [pullProgress, setPullProgress] = useState(0);
  const messagesEndRef = useRef(null);
  const navigate = useNavigate();

  const checkStatus = async () => {
    try {
      const check = await api.checkOllama();
      setOllamaCheck(check);
      
      const res = await api.getAIStatus();
      if (res?.success) {
        setAiStatus(res.data);
      } else {
        setAiStatus({ status: 'offline', modelInstalled: false, model: 'dolphin-llama3', availableModels: [] });
      }
    } catch (e) {
      setAiStatus({ status: 'offline', modelInstalled: false, model: 'dolphin-llama3', availableModels: [] });
    }
  };

  useEffect(() => {
    checkStatus();
    // Poll AI status every 8 seconds to dynamically check if Ollama comes online
    const interval = setInterval(checkStatus, 8000);
    return () => clearInterval(interval);
  }, []);

  const handleStartOllama = async () => {
    setStartingOllama(true);
    try {
      const res = await api.startOllama();
      if (res?.success) {
        // Wait 4 seconds for daemon initiation, then check status
        await new Promise((r) => setTimeout(r, 4000));
        await checkStatus();
      } else {
        alert('Failed to launch Ollama daemon.');
      }
    } catch (e) {
      alert('Error launching Ollama: ' + e.message);
    } finally {
      setStartingOllama(false);
    }
  };

  const handlePullModel = async () => {
    setPullingModel(true);
    setPullProgress(0);
    const unsubscribe = api.onPullProgress((percent) => {
      setPullProgress(percent);
    });
    try {
      const res = await api.pullModel(aiStatus?.model || 'dolphin-llama3');
      if (res?.success) {
        await checkStatus();
      } else {
        alert('Failed to download model.');
      }
    } catch (e) {
      alert('Error downloading model: ' + e.message);
    } finally {
      if (unsubscribe) unsubscribe();
      setPullingModel(false);
    }
  };

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isThinking]);

  const handleSend = async () => {
    const text = inputValue.trim();
    if (!text || isThinking) return;

    const userMessage = { role: 'user', content: text };
    setMessages((prev) => [...prev, userMessage]);
    setInputValue('');
    setIsThinking(true);

    try {
      const response = await api.chatWithAI(text, [...messages, userMessage]);
      if (response.success) {
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', content: response.data.message },
        ]);
      } else {
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', content: `Error: ${response.error || 'Failed to get response.'}` },
        ]);
      }
    } catch (e) {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: 'Sorry, I encountered an error. Please try again.' },
      ]);
    } finally {
      setIsThinking(false);
    }
  };

  const handleRunCommand = (command, target) => {
    navigate('/terminal', { state: { runCommand: command, target } });
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="ai-container">
      <div className="ai-status-bar">
        <span className={`status-dot ${aiStatus?.status === 'online' && aiStatus?.modelInstalled ? 'online' : 'offline'}`} />
        <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{t('aiAssistant')}</span>
        <span style={{ color: 'var(--text-muted)' }}>•</span>
        <span style={{ color: 'var(--text-secondary)' }}>
          {aiStatus?.model || 'Loading...'}
        </span>
        {ollamaCheck && ollamaCheck.installed && !ollamaCheck.running && (
          <button 
            className="btn btn-secondary btn-sm" 
            onClick={handleStartOllama} 
            disabled={startingOllama}
            style={{ marginLeft: 12, padding: '2px 8px', fontSize: 10, height: 22, display: 'inline-flex', alignItems: 'center', gap: 4 }}
          >
            ⚡ {startingOllama ? 'Waking...' : 'Wake Ollama'}
          </button>
        )}
        <span style={{ marginLeft: 'auto' }}>
          <span className={`badge ${aiStatus?.status === 'online' && aiStatus?.modelInstalled ? 'badge-success' : 'badge-warning'}`}>
            {aiStatus?.status === 'online' && aiStatus?.modelInstalled ? '● Ready' : '○ Offline'}
          </span>
        </span>
      </div>

      <div className="ai-messages">
        {/* Case 1: Ollama not installed */}
        {ollamaCheck && !ollamaCheck.installed ? (
          <div className="glass-card animate-slide-up" style={{ padding: 32, margin: '60px auto', maxWidth: 450, textAlign: 'center', border: '1px solid rgba(239, 68, 68, 0.15)' }}>
            <div style={{ fontSize: 54, marginBottom: 16 }}>🤖</div>
            <h3 style={{ margin: '0 0 10px 0', color: 'var(--text-primary)', fontWeight: 600 }}>AI Assistant Not Installed</h3>
            <p style={{ margin: '0 0 24px 0', fontSize: 13, color: 'var(--text-muted)', lineHeight: '1.5' }}>
              Synced AI Assistant requires Ollama to be installed on your PC. Would you like to open the download page to install it now?
            </p>
            <div style={{ display: 'flex', gap: 12 }}>
              <button className="btn btn-primary" onClick={() => api.openOllamaDownload()} style={{ flex: 1, padding: 12, fontWeight: 600 }}>
                📥 Download Ollama
              </button>
              <button className="btn btn-secondary" onClick={() => navigate('/')} style={{ padding: 12 }}>
                Cancel
              </button>
            </div>
          </div>
        ) : /* Case 2: Ollama installed but offline */
        ollamaCheck && ollamaCheck.installed && !ollamaCheck.running ? (
          <div className="glass-card animate-slide-up" style={{ padding: 32, margin: '60px auto', maxWidth: 450, textAlign: 'center', border: '1px solid rgba(239, 68, 68, 0.15)' }}>
            <div style={{ fontSize: 54, marginBottom: 16 }}>🤖</div>
            <h3 style={{ margin: '0 0 10px 0', color: 'var(--text-primary)', fontWeight: 600 }}>Ollama Service Offline</h3>
            <p style={{ margin: '0 0 24px 0', fontSize: 13, color: 'var(--text-muted)', lineHeight: '1.5' }}>
              Ollama is installed on your PC but is currently not running. Click below to start the service.
            </p>
            <button className="btn btn-primary" onClick={handleStartOllama} disabled={startingOllama} style={{ width: '100%', padding: 12, fontWeight: 600 }}>
              {startingOllama ? '⏳ Launching Ollama...' : '🚀 Start Ollama Service'}
            </button>
          </div>
        ) : /* Case 3: Ollama online but model not installed */
        aiStatus?.status === 'online' && !aiStatus?.modelInstalled ? (
          <div className="glass-card animate-slide-up" style={{ padding: 32, margin: '60px auto', maxWidth: 450, textAlign: 'center', border: '1px solid rgba(239, 68, 68, 0.15)' }}>
            <div style={{ fontSize: 54, marginBottom: 16 }}>📥</div>
            <h3 style={{ margin: '0 0 10px 0', color: 'var(--text-primary)', fontWeight: 600 }}>AI Model Required</h3>
            <p style={{ margin: '0 0 24px 0', fontSize: 13, color: 'var(--text-muted)', lineHeight: '1.5' }}>
              The model "{aiStatus?.model || 'dolphin-llama3'}" is not installed in Ollama yet. Click the button below to download the model (~4.7 GB).
            </p>
            {pullingModel ? (
              <div style={{ width: '100%', textAlign: 'left' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 6, color: 'var(--text-primary)' }}>
                  <span>Downloading AI model...</span>
                  <span className="text-mono" style={{ fontWeight: 600 }}>{pullProgress}%</span>
                </div>
                <div style={{ background: '#27272a', borderRadius: 10, height: 8, width: '100%', overflow: 'hidden' }}>
                  <div style={{ 
                    background: 'linear-gradient(90deg, #10b981, #22c55e)', 
                    height: '100%', 
                    width: `${pullProgress}%`, 
                    transition: 'width 0.1s ease-out' 
                  }}></div>
                </div>
              </div>
            ) : (
              <button className="btn btn-primary" onClick={handlePullModel} style={{ width: '100%', padding: 12, fontWeight: 600 }}>
                ⚡ Download & Install Model
              </button>
            )}
          </div>
        ) : (
          /* Case 4: Ollama online and model downloaded */
          messages.map((msg, i) => (
            <MessageBubble 
              key={i} 
              message={msg} 
              onRunCommand={handleRunCommand}
              mainHostname={mainHostname}
              bridgeHostname={bridgeHostname}
              appLanguage={language}
            />
          ))
        )}
        {isThinking && <TypingIndicator />}
        <div ref={messagesEndRef} />
      </div>

      <div className="ai-input-area">
        <input
          className="input"
          type="text"
          placeholder={aiStatus?.status === 'online' && aiStatus?.modelInstalled ? t('askAnything') : "Start Ollama service to begin chatting..."}
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isThinking || aiStatus?.status !== 'online' || !aiStatus?.modelInstalled}
        />
        <button
          className="btn btn-primary"
          onClick={handleSend}
          disabled={isThinking || !inputValue.trim() || aiStatus?.status !== 'online' || !aiStatus?.modelInstalled}
          style={{ minWidth: 80 }}
        >
          {isThinking ? '...' : '➤ Send'}
        </button>
      </div>
    </div>
  );
}
