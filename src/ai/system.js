// ═══════════════════════════════════════════════════════════════════════
// LUKAS System Control Agent
// Controls the host OS: launch apps, run scripts, get system info,
// control windows, open files, run terminal commands (sandboxed).
// Works in Electron via IPC. Degrades gracefully in browser mode.
// ═══════════════════════════════════════════════════════════════════════

class LukasSystemAgent {
  constructor() {
    this._isElectron = typeof window !== 'undefined' && !!window.__ELECTRON__;
    this._commandHistory = [];
    this._maxHistory = 100;

    // Track last system info (cached)
    this._lastSystemInfo = null;
    this._sysInfoCacheMs = 30000;
    this._lastSysInfoAt  = 0;
  }

  // ─── Application Control ──────────────────────────────────────────────────

  /**
   * Open a URL or application.
   * In Electron: uses system exec. In browser: uses window.open.
   * @param {string} target  URL, app name, or file path
   */
  async openApplication(target) {
    this._log(`Opening: ${target}`);

    // Browser-safe: open URL in new tab
    if (target.startsWith('http://') || target.startsWith('https://')) {
      window.open(target, '_blank', 'noopener,noreferrer');
      return { success: true, method: 'browser_open', target };
    }

    // Electron: execute via /api/system-exec
    try {
      const resp = await fetch('/api/system-exec', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'open', target })
      });
      const data = await resp.json();
      return data;
    } catch {
      return { success: false, error: 'System exec not available in browser mode.' };
    }
  }

  /**
   * Run a shell command (sandboxed to an allowlist in Electron).
   * @param {string} command
   * @param {boolean} capture  Whether to return stdout
   */
  async runCommand(command, capture = false) {
    this._commandHistory.push({ command, ts: Date.now() });
    if (this._commandHistory.length > this._maxHistory) this._commandHistory.shift();

    try {
      const resp = await fetch('/api/system-exec', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'exec', command, capture })
      });
      return await resp.json();
    } catch {
      return { success: false, error: 'Not available in browser mode.' };
    }
  }

  /**
   * Open a file with its default application.
   * @param {string} filePath  Absolute path
   */
  async openFile(filePath) {
    return this.openApplication(filePath);
  }

  /**
   * Take a screenshot and save to the LUKAS config directory.
   */
  async takeScreenshot() {
    try {
      const resp = await fetch('/api/system-exec', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'screenshot' })
      });
      return await resp.json();
    } catch {
      return { success: false, error: 'Screenshot requires Electron.' };
    }
  }

  // ─── System Information ───────────────────────────────────────────────────

  /**
   * Get real-time system info: CPU, RAM, disk, network.
   * Cached for 30 seconds to avoid excessive polling.
   */
  async getSystemInfo() {
    if (this._lastSystemInfo && (Date.now() - this._lastSysInfoAt) < this._sysInfoCacheMs) {
      return this._lastSystemInfo;
    }

    try {
      const resp = await fetch('/api/system-info');
      if (resp.ok) {
        const data = await resp.json();
        this._lastSystemInfo = data;
        this._lastSysInfoAt  = Date.now();
        return data;
      }
    } catch { /* fallback */ }

    // Fallback: browser-available metrics
    const info = await this._getBrowserSystemInfo();
    this._lastSystemInfo = info;
    this._lastSysInfoAt  = Date.now();
    return info;
  }

  async _getBrowserSystemInfo() {
    const info = {
      platform: navigator.platform || 'Unknown',
      userAgent: navigator.userAgent,
      language: navigator.language,
      cores: navigator.hardwareConcurrency || 1,
      online: navigator.onLine,
      memory: null,
      storage: null
    };

    // Memory (Chrome only)
    if (performance.memory) {
      info.memory = {
        used:   Math.round(performance.memory.usedJSHeapSize / 1048576),
        total:  Math.round(performance.memory.totalJSHeapSize / 1048576),
        limit:  Math.round(performance.memory.jsHeapSizeLimit / 1048576),
        unit: 'MB'
      };
    }

    // Storage estimate
    if (navigator.storage?.estimate) {
      try {
        const est = await navigator.storage.estimate();
        info.storage = {
          used:  Math.round((est.usage || 0) / 1048576),
          quota: Math.round((est.quota || 0) / 1048576),
          unit: 'MB'
        };
      } catch { /* ignore */ }
    }

    return info;
  }

  // ─── Natural Language Command Parsing ─────────────────────────────────────

  /**
   * Parse a system control command from natural language.
   * @param {string} input
   * @returns {{ action: string, target?: string } | null}
   */
  parseSystemCommand(input) {
    const lower = input.toLowerCase();

    // Open application / website
    const openMatch = lower.match(/^(?:open|launch|start)\s+(.+)$/);
    if (openMatch) {
      const target = openMatch[1].trim();
      const urlMap = {
        'youtube':  'https://youtube.com',
        'gmail':    'https://mail.google.com',
        'github':   'https://github.com',
        'maps':     'https://maps.google.com',
        'weather':  'https://weather.com',
        'netflix':  'https://netflix.com',
        'spotify':  'https://open.spotify.com',
        'wikipedia':'https://wikipedia.org',
        'translate':'https://translate.google.com',
        'calendar': 'https://calendar.google.com',
      };
      const url = urlMap[target] || (target.includes('.') ? `https://${target}` : null);
      if (url) return { action: 'open_url', target: url };
      return { action: 'open_app', target };
    }

    // Screenshot
    if (lower.includes('screenshot') || lower.includes('screen capture')) {
      return { action: 'screenshot' };
    }

    // System info
    if (lower.match(/system info|system status|cpu usage|ram usage|memory usage|disk usage/)) {
      return { action: 'system_info' };
    }

    return null;
  }

  /**
   * Execute a parsed system command.
   */
  async executeSystemCommand(parsed) {
    if (!parsed) return null;
    switch (parsed.action) {
      case 'open_url':
      case 'open_app':
        return this.openApplication(parsed.target);
      case 'screenshot':
        return this.takeScreenshot();
      case 'system_info':
        return this.getSystemInfo();
      case 'exec':
        return this.runCommand(parsed.command);
      default:
        return { success: false, error: 'Unknown system action.' };
    }
  }

  // ─── Utility ──────────────────────────────────────────────────────────────

  _log(msg) {
    console.log(`[SystemAgent] ${msg}`);
  }

  getCommandHistory(n = 20) {
    return this._commandHistory.slice(-n);
  }

  isElectronMode() {
    return this._isElectron;
  }
}

export default LukasSystemAgent;
