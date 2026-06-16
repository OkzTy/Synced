// Global State
let currentTab = 'dashboard';
let secondaryConnected = false;
let config = {
  token: 'AY2009DAN#',
  mainIp: '',
  secondaryIp: '',
  aiGpu: true,
  aiLayers: 33
};

// On Page Load
document.addEventListener('DOMContentLoaded', () => {
  // Start clock
  setInterval(updateClock, 1000);
  updateClock();

  // Load configuration from server
  loadConfig();

  // Start polling system status
  setInterval(pollStatus, 3000);
  pollStatus();

  // Load Discord archive
  loadDiscordThreads();
  selectDiscordChannel('welcome-rules');
});

// Update Header Clock
function updateClock() {
  const now = new Date();
  const timeStr = now.toTimeString().split(' ')[0];
  document.getElementById('time-display').textContent = timeStr;
}

// Tab Switching Logic
function switchTab(tabId) {
  document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));

  document.getElementById(`tab-${tabId}`).classList.add('active');
  document.getElementById(`nav-${tabId}`).classList.add('active');

  currentTab = tabId;

  // Set page titles
  const titles = {
    'dashboard': { t: 'System Dashboard', s: 'Real-time resource monitoring and machine administration' },
    'ai-agent': { t: 'Agentic AI Assistant', s: 'Uncensored local helper that executes operations on both PCs' },
    'discord': { t: 'Discord FAQ Archive', s: 'Browse and search our support archive database' }
  };

  document.getElementById('page-title').textContent = titles[tabId].t;
  document.getElementById('page-subtitle').textContent = titles[tabId].s;
}

// Poll Server for hardware stats
async function pollStatus() {
  try {
    const res = await fetch('/api/status', {
      headers: { 'Authorization': `Bearer ${config.token}` }
    });
    if (!res.ok) throw new Error('Status fetch failed');
    const data = await res.json();

    // 1. Update Main PC Stats
    if (data.main) {
      document.getElementById('main-hostname').textContent = data.main.hostname || '...';
      document.getElementById('main-ip').textContent = data.main.ipAddress || '...';
      document.getElementById('main-os').textContent = data.main.osName || '...';
      document.getElementById('main-cpu').textContent = data.main.cpuName || '...';
      document.getElementById('main-gpu').textContent = data.main.gpuName || '...';

      // RAM
      const ramPercent = data.main.ramUsagePercent || 0;
      document.getElementById('main-ram-fill').style.width = `${ramPercent}%`;
      document.getElementById('main-ram-percent').textContent = `${ramPercent}%`;
      document.getElementById('main-ram-text').textContent = `${data.main.ramUsedGB} / ${data.main.ramTotalGB} GB`;

      // Disk (primary C:)
      if (data.main.disks && data.main.disks.length > 0) {
        const d = data.main.disks[0];
        document.getElementById('main-disk-fill').style.width = `${d.usagePercent}%`;
        document.getElementById('main-disk-percent').textContent = `${d.usagePercent}%`;
        document.getElementById('main-disk-text').textContent = `${d.usedGB} / ${d.totalGB} GB`;
      }
      
      // Update setup command on Main PC card using its actual IP
      if (!config.mainIp && data.main.ipAddress) {
        config.mainIp = data.main.ipAddress;
        updateSetupCommandLine();
      }
    }

    // 2. Update Secondary PC Stats
    const secDot = document.getElementById('secondary-dot');
    const secLabel = document.getElementById('secondary-label-indicator');
    const secBadge = document.getElementById('secondary-status-badge');
    const secConnectedView = document.getElementById('secondary-connected-view');
    const secOfflineView = document.getElementById('secondary-offline-view');

    if (data.secondary && data.secondary.hostname) {
      secondaryConnected = true;
      secDot.className = 'indicator-dot secondary online';
      secLabel.textContent = 'Secondary PC (Online)';
      secBadge.className = 'status-badge online';
      secBadge.textContent = 'Online';

      secOfflineView.style.display = 'none';
      secConnectedView.style.display = 'block';

      // Update secondary fields
      document.getElementById('secondary-hostname').textContent = data.secondary.hostname;
      document.getElementById('secondary-ip').textContent = data.secondary.ipAddress;
      document.getElementById('secondary-os').textContent = data.secondary.osName;
      document.getElementById('secondary-cpu').textContent = data.secondary.cpuName;
      document.getElementById('secondary-gpu').textContent = data.secondary.gpuName;

      // RAM
      const sRamPercent = data.secondary.ramUsagePercent || 0;
      document.getElementById('secondary-ram-fill').style.width = `${sRamPercent}%`;
      document.getElementById('secondary-ram-percent').textContent = `${sRamPercent}%`;
      document.getElementById('secondary-ram-text').textContent = `${data.secondary.ramUsedGB} / ${data.secondary.ramTotalGB} GB`;

      // Disk
      if (data.secondary.disks && data.secondary.disks.length > 0) {
        const d = data.secondary.disks[0];
        document.getElementById('secondary-disk-fill').style.width = `${d.usagePercent}%`;
        document.getElementById('secondary-disk-percent').textContent = `${d.usagePercent}%`;
        document.getElementById('secondary-disk-text').textContent = `${d.usedGB} / ${d.totalGB} GB`;
      }
    } else {
      secondaryConnected = false;
      secDot.className = 'indicator-dot secondary offline';
      secLabel.textContent = 'Secondary PC (Offline)';
      secBadge.className = 'status-badge offline';
      secBadge.textContent = 'Offline';

      secConnectedView.style.display = 'none';
      secOfflineView.style.display = 'block';
      
      updateSetupCommandLine();
    }

    // 3. Update AI Server Indicator
    const aiBadge = document.getElementById('ai-engine-status-badge');
    if (data.aiActive) {
      aiBadge.className = 'ai-status-indicator online';
      aiBadge.innerHTML = '<span class="indicator-dot online"></span> Local Server Active';
    } else {
      aiBadge.className = 'ai-status-indicator offline';
      aiBadge.innerHTML = '<span class="indicator-dot red"></span> Local Server Inactive';
    }

  } catch (err) {
    console.error('Error polling status:', err);
  }
}

// Compute and display setup powershell command
function updateSetupCommandLine() {
  const port = window.location.port || '7225';
  const ip = config.mainIp || window.location.hostname || '192.168.1.100';
  const cmd = `irm http://${ip}:${port}/setup | iex`;
  document.getElementById('powershell-setup-cmd').textContent = cmd;
}

// Copy setup command to clipboard
function copySetupCommand() {
  const cmd = document.getElementById('powershell-setup-cmd').textContent;
  navigator.clipboard.writeText(cmd).then(() => {
    showToast('Powershell setup command copied!', 'success');
  }).catch(() => {
    showToast('Failed to copy command automatically.', 'error');
  });
}

// Configuration load/save
async function loadConfig() {
  try {
    const res = await fetch('/api/config');
    if (res.ok) {
      const data = await res.json();
      config = { ...config, ...data };
      
      // Populate settings fields
      document.getElementById('settings-token').value = config.token;
      document.getElementById('settings-main-ip').value = config.mainIp;
      document.getElementById('settings-secondary-ip').value = config.secondaryIp;
      document.getElementById('settings-ai-gpu').checked = config.aiGpu;
      document.getElementById('settings-ai-layers').value = config.aiLayers;

      updateSetupCommandLine();
    }
  } catch (err) {
    console.error('Failed to load config:', err);
  }
}

async function saveSettings() {
  config.token = document.getElementById('settings-token').value;
  config.mainIp = document.getElementById('settings-main-ip').value;
  config.secondaryIp = document.getElementById('settings-secondary-ip').value;
  config.aiGpu = document.getElementById('settings-ai-gpu').checked;
  config.aiLayers = parseInt(document.getElementById('settings-ai-layers').value) || 33;

  try {
    const res = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config)
    });

    if (res.ok) {
      showToast('Settings saved successfully!', 'success');
      toggleSettings(false);
      updateSetupCommandLine();
      pollStatus();
    } else {
      showToast('Error saving settings.', 'error');
    }
  } catch (err) {
    showToast('Failed to connect to server.', 'error');
  }
}

function toggleSettings(show) {
  document.getElementById('settings-drawer').style.display = show ? 'flex' : 'none';
}

// Trigger PC Power action
async function triggerPower(pc, action) {
  const confirmMsg = `Are you sure you want to trigger ${action} on the ${pc === 'main' ? 'Gaming' : 'Secondary'} PC?`;
  if (!confirm(confirmMsg)) return;

  try {
    const res = await fetch(`/api/power/${action}?pc=${pc}`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${config.token}` }
    });
    if (res.ok) {
      showToast(`Command sent: ${action} on ${pc} PC.`, 'success');
    } else {
      const errData = await res.json();
      showToast(`Power error: ${errData.error || 'Unknown error'}`, 'error');
    }
  } catch (err) {
    showToast('Network error triggering power action.', 'error');
  }
}

// Start local AI server via backend
async function startLocalAiServer() {
  const btn = document.getElementById('btn-start-ai');
  btn.disabled = true;
  btn.textContent = '⚡ Launching background llama-server...';
  
  try {
    const res = await fetch('/api/ai/start', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${config.token}` }
    });
    const data = await res.json();
    if (res.ok && data.ok) {
      showToast('Local AI server started!', 'success');
    } else {
      showToast(`AI Init error: ${data.error || 'Check model file'}`, 'error');
    }
  } catch (e) {
    showToast('Failed to start AI server.', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '🚀 Auto-Initialize Local Server';
    pollStatus();
  }
}

// Send Message in Agentic Chat
async function sendChatMessage() {
  const input = document.getElementById('chat-input');
  const msg = input.value.trim();
  if (!msg) return;

  input.value = '';
  
  // Append user message
  const chatContainer = document.getElementById('ai-chat-messages');
  appendMessage('user', 'User', msg);
  
  // Create placeholder for assistant response
  const agentMessageDiv = appendPlaceholderMessage('assistant', 'System Agent');
  const contentDiv = agentMessageDiv.querySelector('.bubble-content');
  
  // Show thinking indicator
  const loader = document.getElementById('agent-thinking-indicator');
  const loaderText = document.getElementById('agent-thinking-text');
  loader.style.display = 'flex';
  loaderText.textContent = 'Agent is analyzing request...';

  try {
    // We use Server-Sent Events (SSE) to stream the agent's progress step-by-step
    const url = `/api/ai/agent?message=${encodeURIComponent(msg)}&token=${encodeURIComponent(config.token)}`;
    const eventSource = new EventSource(url);

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        
        if (data.type === 'thought') {
          // Render thought block (mini-Antigravity log)
          loaderText.textContent = data.content;
          appendThoughtBlock(contentDiv, 'thought', `Thought: ${data.content}`);
        }
        else if (data.type === 'tool_call') {
          appendThoughtBlock(contentDiv, 'tool-call', `🔨 Tool Call: ${data.tool}(${JSON.stringify(data.parameters)})`);
        }
        else if (data.type === 'tool_output') {
          appendThoughtBlock(contentDiv, 'tool-output', `💾 Tool Output:\n${data.output}`);
        }
        else if (data.type === 'answer') {
          // Render final answer chunks
          if (contentDiv.querySelector('.agent-final-text')) {
            contentDiv.querySelector('.agent-final-text').innerHTML += formatMarkdown(data.content);
          } else {
            const txtSpan = document.createElement('div');
            txtSpan.className = 'agent-final-text';
            txtSpan.style.marginTop = '12px';
            txtSpan.style.borderTop = '1px dashed var(--border-glass)';
            txtSpan.style.paddingTop = '8px';
            txtSpan.innerHTML = formatMarkdown(data.content);
            contentDiv.appendChild(txtSpan);
          }
          chatContainer.scrollTop = chatContainer.scrollHeight;
        }
        else if (data.type === 'error') {
          appendThoughtBlock(contentDiv, 'tool-call', `❌ Error: ${data.content}`);
          eventSource.close();
          loader.style.display = 'none';
        }
        else if (data.type === 'done') {
          eventSource.close();
          loader.style.display = 'none';
          showToast('Agent run completed!', 'success');
        }
      } catch (err) {
        console.error('Error parsing SSE event:', err);
      }
    };

    eventSource.onerror = (err) => {
      console.error('SSE Error:', err);
      eventSource.close();
      loader.style.display = 'none';
      
      const txtSpan = document.createElement('div');
      txtSpan.style.color = 'var(--accent-red)';
      txtSpan.textContent = '⚠️ Connection to local AI server closed or failed. Make sure your local AI server is started.';
      contentDiv.appendChild(txtSpan);
    };

  } catch (err) {
    loader.style.display = 'none';
    showToast('Failed to initiate AI loop.', 'error');
  }
}

// Helpers for Chat bubbles
function appendMessage(role, name, content) {
  const container = document.getElementById('ai-chat-messages');
  const now = new Date();
  const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  
  const div = document.createElement('div');
  div.className = `chat-bubble ${role}`;
  div.innerHTML = `
    <div class="bubble-header">
      <span class="avatar-icon">${role === 'user' ? '👤' : '🤖'}</span>
      <span class="sender-name">${name}</span>
      <span class="timestamp">${timeStr}</span>
    </div>
    <div class="bubble-content">${formatMarkdown(content)}</div>
  `;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
  return div;
}

function appendPlaceholderMessage(role, name) {
  const container = document.getElementById('ai-chat-messages');
  const now = new Date();
  const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  
  const div = document.createElement('div');
  div.className = `chat-bubble ${role}`;
  div.innerHTML = `
    <div class="bubble-header">
      <span class="avatar-icon">${role === 'user' ? '👤' : '🤖'}</span>
      <span class="sender-name">${name}</span>
      <span class="timestamp">${timeStr}</span>
    </div>
    <div class="bubble-content"></div>
  `;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
  return div;
}

function appendThoughtBlock(parentDiv, type, text) {
  const block = document.createElement('div');
  block.className = `agent-thought-block ${type}`;
  block.textContent = text;
  parentDiv.appendChild(block);
  
  const chatContainer = document.getElementById('ai-chat-messages');
  chatContainer.scrollTop = chatContainer.scrollHeight;
}

// Simple markdown formatter
function formatMarkdown(text) {
  if (!text) return '';
  // Escape HTML
  let escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  // Code blocks: ```powershell ... ```
  escaped = escaped.replace(/```([a-zA-Z]*)\n([\s\S]*?)```/gm, (match, lang, code) => {
    return `<pre><code class="language-${lang}">${code.trim()}</code></pre>`;
  });

  // Inline code: `code`
  escaped = escaped.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Bold: **text**
  escaped = escaped.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

  // Line breaks
  return escaped.replace(/\n/g, '<br>');
}

// Discord Archive functions
let discordThreads = [];

async function loadDiscordThreads() {
  try {
    const res = await fetch('/api/discord/threads');
    if (res.ok) {
      discordThreads = await res.json();
      renderDiscordFeed(discordThreads);
    }
  } catch (e) {
    console.error('Failed to load discord archive:', e);
  }
}

function renderDiscordFeed(threads) {
  const list = document.getElementById('discord-messages-list');
  list.innerHTML = '';

  if (threads.length === 0) {
    list.innerHTML = `
      <div class="setup-container" style="margin-top: 50px;">
        <span style="font-size: 48px;">🔍</span>
        <h3>No matches found</h3>
        <p class="text-secondary">Try searching for keywords like 'sunshine', 'ports', 'lag', 'ai' or 'audio'</p>
      </div>
    `;
    return;
  }

  threads.forEach(thread => {
    // Render Thread header card
    const headerDiv = document.createElement('div');
    headerDiv.style.borderBottom = '1px solid rgba(255,255,255,0.05)';
    headerDiv.style.paddingBottom = '14px';
    headerDiv.style.marginTop = '10px';
    headerDiv.innerHTML = `
      <h3 style="font-family: var(--font-display); color: #fff; margin-bottom: 4px;"># ${thread.title}</h3>
      <div style="display: flex; gap: 6px;">
        ${thread.tags.map(t => `<span class="pc-role-badge secondary" style="font-size: 8px;">${t}</span>`).join('')}
      </div>
    `;
    list.appendChild(headerDiv);

    // Render thread messages
    thread.messages.forEach(msg => {
      const msgDiv = document.createElement('article');
      msgDiv.className = 'discord-msg-card';
      msgDiv.style.margin = '16px 0';
      msgDiv.innerHTML = `
        <div class="discord-msg-avatar ${msg.avatar}">${msg.author[0]}</div>
        <div class="discord-msg-body">
          <div class="discord-msg-header">
            <span class="discord-msg-author">${msg.author}</span>
            <span class="discord-msg-time">${msg.timestamp}</span>
          </div>
          <div class="discord-msg-content">${formatMarkdown(msg.content)}</div>
        </div>
      `;
      list.appendChild(msgDiv);
    });
  });
}

function selectDiscordChannel(channel) {
  document.querySelectorAll('.discord-channel').forEach(el => {
    if (el.textContent.includes(channel)) el.classList.add('active');
    else el.classList.remove('active');
  });

  document.getElementById('discord-current-channel').textContent = channel;
  document.getElementById('discord-search-input').value = '';

  // Filter threads by tag matching channel name
  const filtered = discordThreads.filter(t => 
    channel === 'welcome-rules' || t.tags.includes(channel.replace('-setup', '').replace('-troubleshooting', '').replace('-debug', ''))
  );
  renderDiscordFeed(filtered);
}

async function searchDiscordArchive() {
  const query = document.getElementById('discord-search-input').value.trim();
  if (!query) {
    // Revert to current channel filter
    const channel = document.getElementById('discord-current-channel').textContent;
    selectDiscordChannel(channel);
    return;
  }

  try {
    const res = await fetch(`/api/discord/search?query=${encodeURIComponent(query)}`);
    if (res.ok) {
      const data = await res.json();
      renderDiscordFeed(data);
    }
  } catch (e) {
    console.error('Discord search error:', e);
  }
}

function clearDiscordSearch() {
  document.getElementById('discord-search-input').value = '';
  const channel = document.getElementById('discord-current-channel').textContent;
  selectDiscordChannel(channel);
}

// Toast Helper
function showToast(msg, type = 'success') {
  const toast = document.getElementById('toast');
  const text = document.getElementById('toast-message');
  
  text.textContent = msg;
  toast.className = `toast-visible`;
  toast.style.borderColor = type === 'success' ? 'var(--accent-green)' : 'var(--accent-red)';
  toast.style.boxShadow = type === 'success' ? '0 0 15px rgba(0, 250, 154, 0.15)' : '0 0 15px rgba(255, 59, 48, 0.15)';

  setTimeout(() => {
    toast.className = 'toast-hidden';
  }, 4000);
}
