// ═══════════════════════════════════════════════════════════════════════
// LUKAS Notification Agent
// Multi-channel notification delivery:
//   • Browser Notifications (Web Notifications API)
//   • Voice alerts (speaks through LukasVoiceController)
//   • Terminal log entries (LukasDiagnosticsHub)
//   • Electron tray notifications (via /api/notify)
//   • In-app toast overlays
// ═══════════════════════════════════════════════════════════════════════

import lukasDB from './database.js';

const PRIORITY = {
  LOW:      'low',
  NORMAL:   'normal',
  HIGH:     'high',
  CRITICAL: 'critical'
};

class LukasNotificationAgent {
  constructor() {
    this._queue      = [];      // Pending notifications
    this._history    = [];      // Last 100 delivered
    this._maxHistory = 100;
    this._permission = 'default';

    // External hooks
    this.voiceController = null;  // LukasVoiceController
    this.diag            = null;  // LukasDiagnosticsHub
    this.supervisor      = null;  // LukasSupervisor

    // Toast container (created on first use)
    this._toastContainer = null;

    // Request browser notification permission
    this._requestPermission();
  }

  // ─── Permission ───────────────────────────────────────────────────────────

  async _requestPermission() {
    if (!('Notification' in window)) return;
    if (Notification.permission === 'granted') {
      this._permission = 'granted';
    } else if (Notification.permission !== 'denied') {
      const result = await Notification.requestPermission();
      this._permission = result;
    } else {
      this._permission = 'denied';
    }
  }

  // ─── Primary Notification Method ─────────────────────────────────────────

  /**
   * Send a notification through all appropriate channels.
   * @param {string} title
   * @param {string} body
   * @param {string} priority   'low' | 'normal' | 'high' | 'critical'
   * @param {object} options    { speak, toast, browser, icon, agent }
   */
  async notify(title, body, priority = PRIORITY.NORMAL, options = {}) {
    const {
      speak   = priority === PRIORITY.HIGH || priority === PRIORITY.CRITICAL,
      toast   = true,
      browser = priority !== PRIORITY.LOW,
      icon    = '/favicon.ico',
      agent   = 'notification'
    } = options;

    const entry = {
      title, body, priority,
      ts: Date.now(),
      delivered: []
    };

    // 1. Terminal log
    if (this.diag) {
      const level = priority === PRIORITY.CRITICAL ? 'error'
                  : priority === PRIORITY.HIGH     ? 'warn'
                  : 'info';
      this.diag.logToTerminal(`[NOTIFY] ${title}: ${body}`, level);
      entry.delivered.push('terminal');
    }

    // 2. Browser notification
    if (browser && this._permission === 'granted') {
      try {
        new Notification(title, {
          body,
          icon,
          badge: '/favicon.ico',
          tag: `lukas-${Date.now()}`
        });
        entry.delivered.push('browser');
      } catch (e) {
        console.warn('[Notify] Browser notification failed:', e.message);
      }
    }

    // 3. Voice alert
    if (speak && this.voiceController) {
      const message = priority === PRIORITY.CRITICAL
        ? `CRITICAL ALERT: ${title}. ${body}`
        : `${title}. ${body}`;
      this.voiceController.speak(message);
      entry.delivered.push('voice');
    }

    // 4. In-app toast
    if (toast) {
      this._showToast(title, body, priority);
      entry.delivered.push('toast');
    }

    // 5. Electron tray (fire-and-forget)
    if (priority === PRIORITY.HIGH || priority === PRIORITY.CRITICAL) {
      this._sendElectronNotification(title, body).catch(() => {});
      entry.delivered.push('electron');
    }

    // 6. Save to DB
    try {
      await lukasDB.saveNotification(title, body, priority);
    } catch { /* non-critical */ }

    // History
    this._history.push(entry);
    if (this._history.length > this._maxHistory) this._history.shift();

    if (this.supervisor) {
      this.supervisor.logAgentAction(agent,
        `Notification: "${title}" — channels: ${entry.delivered.join(', ')}`, 'info');
    }

    return entry;
  }

  // ─── Convenience Methods ──────────────────────────────────────────────────

  async notifyDeviceFailure(deviceName, error) {
    return this.notify(
      `Device Error: ${deviceName}`,
      `Failed to execute command: ${error}`,
      PRIORITY.HIGH,
      { agent: 'home' }
    );
  }

  async notifyTaskComplete(planTitle, successCount, totalCount) {
    const allOk = successCount === totalCount;
    return this.notify(
      allOk ? `✓ Plan Complete: ${planTitle}` : `⚠ Plan Partial: ${planTitle}`,
      allOk ? `All ${totalCount} steps completed successfully.`
            : `${successCount}/${totalCount} steps completed. ${totalCount - successCount} failed.`,
      allOk ? PRIORITY.NORMAL : PRIORITY.HIGH,
      { agent: 'planner', speak: !allOk }
    );
  }

  async notifyAgentAlarm(agentName, issue) {
    return this.notify(
      `Agent Alert: ${agentName.toUpperCase()}`,
      issue,
      PRIORITY.HIGH,
      { agent: 'supervisor' }
    );
  }

  async notifyScheduledCommand(label, command) {
    return this.notify(
      `⏰ Scheduled: ${label}`,
      `Executing: "${command}"`,
      PRIORITY.NORMAL,
      { speak: true, agent: 'scheduler' }
    );
  }

  async notifyReminder(label) {
    return this.notify(
      `🔔 Reminder`,
      label,
      PRIORITY.HIGH,
      { speak: true, agent: 'scheduler' }
    );
  }

  // ─── Toast Overlay ────────────────────────────────────────────────────────

  _showToast(title, body, priority) {
    try {
      if (!this._toastContainer) {
        this._toastContainer = document.createElement('div');
        this._toastContainer.id = 'lukasToastContainer';
        Object.assign(this._toastContainer.style, {
          position: 'fixed', bottom: '24px', right: '24px',
          zIndex: '99999', display: 'flex', flexDirection: 'column',
          gap: '10px', pointerEvents: 'none', maxWidth: '340px'
        });
        document.body.appendChild(this._toastContainer);
      }

      const colors = {
        [PRIORITY.LOW]:      { bg: 'rgba(30,30,50,0.95)', border: '#334155' },
        [PRIORITY.NORMAL]:   { bg: 'rgba(15,23,42,0.97)', border: '#00f0ff' },
        [PRIORITY.HIGH]:     { bg: 'rgba(30,10,10,0.97)', border: '#f59e0b' },
        [PRIORITY.CRITICAL]: { bg: 'rgba(50,5,5,0.98)',   border: '#ef4444' },
      };
      const c = colors[priority] || colors[PRIORITY.NORMAL];

      const toast = document.createElement('div');
      Object.assign(toast.style, {
        background: c.bg,
        border: `1px solid ${c.border}`,
        borderLeft: `4px solid ${c.border}`,
        borderRadius: '8px',
        padding: '12px 16px',
        boxShadow: `0 4px 24px ${c.border}44`,
        pointerEvents: 'auto',
        animation: 'lukas-toast-in 0.3s ease',
        cursor: 'pointer',
        backdropFilter: 'blur(8px)'
      });

      toast.innerHTML = `
        <div style="color:${c.border};font-size:0.7rem;font-weight:700;font-family:monospace;margin-bottom:4px;letter-spacing:1px">
          ${title.toUpperCase()}
        </div>
        <div style="color:#cbd5e1;font-size:0.78rem;line-height:1.4">${body}</div>
      `;

      // Inject animation keyframe once
      if (!document.getElementById('lukas-toast-styles')) {
        const style = document.createElement('style');
        style.id = 'lukas-toast-styles';
        style.textContent = `
          @keyframes lukas-toast-in  { from { opacity:0; transform:translateX(100%); } to { opacity:1; transform:translateX(0); } }
          @keyframes lukas-toast-out { from { opacity:1; transform:translateX(0); } to { opacity:0; transform:translateX(100%); } }
        `;
        document.head.appendChild(style);
      }

      toast.addEventListener('click', () => toast.remove());
      this._toastContainer.appendChild(toast);

      // Auto-dismiss
      const duration = priority === PRIORITY.CRITICAL ? 8000 : priority === PRIORITY.HIGH ? 5000 : 3500;
      setTimeout(() => {
        toast.style.animation = 'lukas-toast-out 0.3s ease forwards';
        setTimeout(() => toast.remove(), 300);
      }, duration);

    } catch (e) {
      console.warn('[Notify] Toast render failed:', e.message);
    }
  }

  // ─── Electron Notification ────────────────────────────────────────────────

  async _sendElectronNotification(title, body) {
    try {
      await fetch('/api/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, body })
      });
    } catch { /* not in Electron or no endpoint */ }
  }

  // ─── History & Status ─────────────────────────────────────────────────────

  getHistory(n = 20) {
    return this._history.slice(-n);
  }

  async getUnread() {
    return lukasDB.getUnreadNotifications();
  }
}

export { PRIORITY };
export default LukasNotificationAgent;
