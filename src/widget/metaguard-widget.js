/**
 * MetaGuard Web Client Widget (Vanilla JavaScript / ESM)
 * Connects to /api/agent/chat and /api/agent/computer-use with CUA visual navigation.
 */

export class MetaGuardWidget {
  constructor(options = {}) {
    this.apiBase = options.apiBase || '/api/agent';
    this.currentView = options.currentView || 'dashboard';
    this.history = [];
    this.isOpen = false;
    this.isStreaming = false;

    this.init();
  }

  init() {
    this.createDom();
    this.bindEvents();
  }

  createDom() {
    const root = document.createElement('div');
    root.id = 'metaguard-widget-root';

    root.innerHTML = `
      <div class="mg-chat-panel" id="mg-chat-panel">
        <div class="mg-header">
          <div class="mg-header-title">
            <span>🛡️ MetaGuard</span>
            <span class="mg-badge">Protected</span>
          </div>
          <button class="mg-close-btn" id="mg-close-btn">&times;</button>
        </div>
        <div class="mg-messages" id="mg-messages">
          <div class="mg-message assistant">
            Hello! I am your MetaGuard assistant. How can I help you navigate or configure your application today?
          </div>
        </div>
        <div class="mg-input-bar">
          <button class="mg-cua-btn" id="mg-cua-btn" title="Computer Use / Visual Assistance">👁️ Vision</button>
          <input type="text" class="mg-input" id="mg-input" placeholder="Type a message or command..." />
          <button class="mg-send-btn" id="mg-send-btn">Send</button>
        </div>
      </div>
      <button class="mg-launcher-btn" id="mg-launcher-btn" title="Open MetaGuard Assistant">
        🛡️
      </button>
    `;

    document.body.appendChild(root);

    this.panel = document.getElementById('mg-chat-panel');
    this.messages = document.getElementById('mg-messages');
    this.input = document.getElementById('mg-input');
    this.sendBtn = document.getElementById('mg-send-btn');
    this.cuaBtn = document.getElementById('mg-cua-btn');
    this.launcherBtn = document.getElementById('mg-launcher-btn');
    this.closeBtn = document.getElementById('mg-close-btn');
  }

  bindEvents() {
    this.launcherBtn.addEventListener('click', () => this.toggle());
    this.closeBtn.addEventListener('click', () => this.toggle());

    this.sendBtn.addEventListener('click', () => this.sendMessage());
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.sendMessage();
    });

    this.cuaBtn.addEventListener('click', () => this.triggerComputerUse());
  }

  toggle() {
    this.isOpen = !this.isOpen;
    this.panel.classList.toggle('active', this.isOpen);
    if (this.isOpen) this.input.focus();
  }

  appendMessage(role, text) {
    const msg = document.createElement('div');
    msg.className = `mg-message ${role}`;
    msg.textContent = text;
    this.messages.appendChild(msg);
    this.messages.scrollTop = this.messages.scrollHeight;
    return msg;
  }

  async sendMessage() {
    const text = this.input.value.trim();
    if (!text || this.isStreaming) return;

    this.input.value = '';
    this.appendMessage('user', text);
    this.history.push({ role: 'user', content: text });

    const assistantMsg = this.appendMessage('assistant', '');
    const typingIndicator = document.createElement('span');
    typingIndicator.className = 'mg-typing-indicator';
    assistantMsg.appendChild(typingIndicator);

    this.isStreaming = true;

    try {
      const res = await fetch(`${this.apiBase}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          history: this.history.slice(-4),
          currentView: this.currentView
        })
      });

      const data = await res.json();
      assistantMsg.removeChild(typingIndicator);

      if (res.status === 429 || data.blocked) {
        this.handleCooldownLock(data.cooldownSeconds || 30);
        assistantMsg.textContent = data.reply || 'Account temporarily locked out due to security violations.';
        return;
      }

      const replyText = data.reply || data.error || 'No response received.';
      this.typewriterStream(assistantMsg, replyText);
      this.history.push({ role: 'assistant', content: replyText });
    } catch (err) {
      assistantMsg.textContent = `Connection error: ${err.message}`;
    } finally {
      this.isStreaming = false;
    }
  }

  typewriterStream(element, text) {
    element.textContent = '';
    let idx = 0;
    const interval = setInterval(() => {
      if (idx < text.length) {
        element.textContent += text[idx++];
        this.messages.scrollTop = this.messages.scrollHeight;
      } else {
        clearInterval(interval);
      }
    }, 15);
  }

  handleCooldownLock(seconds) {
    this.input.disabled = true;
    this.sendBtn.disabled = true;

    let remaining = seconds;
    const alertBox = document.createElement('div');
    alertBox.className = 'mg-message alert';
    alertBox.textContent = `Security Lock: input disabled for ${remaining}s`;
    this.messages.appendChild(alertBox);

    const timer = setInterval(() => {
      remaining -= 1;
      alertBox.textContent = `Security Lock: input disabled for ${remaining}s`;
      if (remaining <= 0) {
        clearInterval(timer);
        this.input.disabled = false;
        this.sendBtn.disabled = false;
        alertBox.remove();
        this.input.focus();
      }
    }, 1000);
  }

  async triggerComputerUse(task = 'Assist user with screen navigation') {
    const assistantMsg = this.appendMessage('assistant', 'Capturing viewport for Computer Use inspection...');
    try {
      const screenshot = await this.captureViewport();
      const res = await fetch(`${this.apiBase}/computer-use`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          screenshot,
          task
        })
      });

      const data = await res.json();
      if (!data.success) {
        assistantMsg.textContent = `CUA Error: ${data.error || 'Failed to analyze view.'}`;
        return;
      }

      if (data.actions && data.actions.length > 0) {
        assistantMsg.textContent = `Visual inspection complete. Executing action: ${data.actions[0].type}...`;
        this.executeVisualAction(data.actions[0]);
      } else {
        assistantMsg.textContent = data.explanation || 'Visual analysis completed with no action needed.';
      }
    } catch (err) {
      assistantMsg.textContent = `CUA Capture Error: ${err.message}`;
    }
  }

  async captureViewport() {
    const canvas = document.createElement('canvas');
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    // Draw basic text representation if html2canvas is not present
    ctx.fillStyle = '#333333';
    ctx.font = '16px sans-serif';
    ctx.fillText(`Viewport: ${window.location.pathname}`, 20, 40);
    return canvas.toDataURL('image/jpeg', 0.65);
  }

  executeVisualAction(action) {
    if (action.x && action.y) {
      // Create ripple effect
      const ripple = document.createElement('div');
      ripple.className = 'mg-click-ripple';
      ripple.style.left = `${action.x}px`;
      ripple.style.top = `${action.y}px`;
      document.body.appendChild(ripple);
      setTimeout(() => ripple.remove(), 600);

      // Highlight target element if present
      const el = document.elementFromPoint(action.x, action.y);
      if (el) {
        el.classList.add('mg-spotlight-ring');
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setTimeout(() => el.classList.remove('mg-spotlight-ring'), 2500);
      }
    }
  }
}
