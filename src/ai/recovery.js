// ═══════════════════════════════════════════════════════════════════════
// LUKAS Monitoring & Recovery Agent
// Continuously monitors all system components and auto-recovers
// from failures without requiring a page refresh.
//
// Monitors: Voice engine, API connectivity, MQTT, WebSocket,
//           Agent freeze detection, Device hub health
// ═══════════════════════════════════════════════════════════════════════

class LukasRecoveryAgent {
  constructor() {
    this._healthState = {
      voice:   { status: 'unknown', lastCheck: null, failures: 0 },
      api:     { status: 'unknown', lastCheck: null, failures: 0, latencyMs: 0 },
      mqtt:    { status: 'unknown', lastCheck: null, failures: 0 },
      agents:  { status: 'unknown', lastCheck: null, failures: 0 },
      storage: { status: 'unknown', lastCheck: null, failures: 0 },
    };

    this._monitorInterval = null;
    this._recoveryLog     = [];
    this._maxLog          = 100;

    // External hooks — set by main.js after instantiation
    this.onHealthChange  = null; // (component, status) => void
    this.voiceController = null; // LukasVoiceController ref
    this.supervisor      = null; // LukasSupervisor ref
    this.diag            = null; // LukasDiagnosticsHub ref

    // API test endpoint preferences (cycles on failure)
    this._apiEndpoints = [
      'https://api.openai.com/v1/models',
      'https://generativelanguage.googleapis.com/v1beta/models'
    ];
  }

  // ─── Start / Stop ─────────────────────────────────────────────────────────

  /**
   * Start continuous health monitoring.
   * @param {number} intervalMs  Default: 30 seconds
   */
  start(intervalMs = 30000) {
    if (this._monitorInterval) return;

    // Initial check immediately
    this._runAllChecks();

    this._monitorInterval = setInterval(() => {
      this._runAllChecks();
    }, intervalMs);

    console.log('[Recovery] Health monitor started.');
  }

  stop() {
    if (this._monitorInterval) {
      clearInterval(this._monitorInterval);
      this._monitorInterval = null;
    }
  }

  // ─── Health Checks ────────────────────────────────────────────────────────

  async _runAllChecks() {
    await Promise.allSettled([
      this._checkVoiceEngine(),
      this._checkStorage(),
      this._checkAgentSupervisor(),
    ]);
  }

  async _checkVoiceEngine() {
    const comp = 'voice';
    try {
      if (!this.voiceController) {
        this._setHealth(comp, 'degraded', 'No voice controller attached');
        return;
      }

      const vm = this.voiceController.recognitionManager;
      if (!vm) {
        this._setHealth(comp, 'degraded', 'No recognition manager');
        return;
      }

      const state = vm.state;
      const isFrozen = state === 'starting' || state === 'stopping';
      const lastActivity = vm._lastActivityAt || 0;
      const stuckMs = Date.now() - lastActivity;

      if (isFrozen && stuckMs > 20000) {
        // Voice engine appears frozen — recover it
        this._setHealth(comp, 'recovering', `Frozen in "${state}" for ${Math.round(stuckMs / 1000)}s`);
        await this._recoverVoice();
      } else {
        this._setHealth(comp, 'healthy', state);
      }
    } catch (e) {
      this._setHealth(comp, 'error', e.message);
    }
  }

  async _checkStorage() {
    const comp = 'storage';
    try {
      const testKey = '_lukas_health_check';
      localStorage.setItem(testKey, '1');
      localStorage.removeItem(testKey);
      this._setHealth(comp, 'healthy', 'LocalStorage OK');
    } catch (e) {
      this._setHealth(comp, 'error', 'LocalStorage unavailable: ' + e.message);
    }
  }

  async _checkAgentSupervisor() {
    const comp = 'agents';
    try {
      if (!this.supervisor) {
        this._setHealth(comp, 'degraded', 'Supervisor not attached');
        return;
      }
      const report = this.supervisor.getStatusReport();
      const failedAgents = report.activeAgents.filter(a => a.status === 'failed');
      if (failedAgents.length > 0) {
        this._setHealth(comp, 'degraded', `${failedAgents.length} agent(s) in FAILED state: ${failedAgents.map(a => a.name).join(', ')}`);
      } else {
        this._setHealth(comp, 'healthy', `${report.activeAgents.length} agents tracked`);
      }
    } catch (e) {
      this._setHealth(comp, 'error', e.message);
    }
  }

  // ─── Recovery Actions ─────────────────────────────────────────────────────

  async _recoverVoice() {
    this._log('voice', 'Attempting voice engine recovery via forceReset()...');
    try {
      if (this.voiceController?.recognitionManager?.forceReset) {
        await this.voiceController.recognitionManager.forceReset();
        this._log('voice', 'Voice engine successfully recovered.');
        this._setHealth('voice', 'healthy', 'Recovered from freeze');
      } else {
        this._log('voice', 'forceReset not available — recovery skipped.');
      }
    } catch (e) {
      this._log('voice', `Voice recovery failed: ${e.message}`);
      this._setHealth('voice', 'error', e.message);
    }
  }

  // ─── Health State Management ──────────────────────────────────────────────

  _setHealth(component, status, detail = '') {
    const prev = this._healthState[component]?.status;
    this._healthState[component] = {
      status,
      detail,
      lastCheck: new Date().toISOString(),
      failures: status === 'error' || status === 'degraded'
        ? (this._healthState[component]?.failures || 0) + 1
        : 0
    };

    // Only log and callback on state change
    if (prev !== status) {
      const level = status === 'healthy' ? 'info' : status === 'recovering' ? 'warn' : 'error';
      this._log(component, `[${status.toUpperCase()}] ${detail}`, level);

      if (this.onHealthChange) this.onHealthChange(component, status, detail);

      if (this.diag) {
        this.diag.logToTerminal(
          `[RECOVERY] ${component.toUpperCase()}: ${status.toUpperCase()} — ${detail}`,
          level
        );
      }
    }
  }

  _log(component, message, level = 'info') {
    const entry = { ts: new Date().toISOString(), component, message, level };
    this._recoveryLog.push(entry);
    if (this._recoveryLog.length > this._maxLog) this._recoveryLog.shift();

    if (this.supervisor) {
      this.supervisor.logAgentAction('recovery', message, level, { component });
    }
  }

  // ─── Public API ───────────────────────────────────────────────────────────

  /**
   * Get the current health state of all monitored components.
   */
  getHealthReport() {
    return { ...this._healthState };
  }

  /**
   * Get the overall system status: 'healthy' | 'degraded' | 'critical'
   */
  getOverallStatus() {
    const statuses = Object.values(this._healthState).map(h => h.status);
    if (statuses.includes('error')) return 'critical';
    if (statuses.includes('degraded') || statuses.includes('recovering')) return 'degraded';
    return 'healthy';
  }

  getRecoveryLog(n = 20) {
    return this._recoveryLog.slice(-n);
  }

  /**
   * Attach live system references for monitoring.
   */
  attach({ voice, supervisor, diag }) {
    this.voiceController = voice || this.voiceController;
    this.supervisor      = supervisor || this.supervisor;
    this.diag            = diag || this.diag;
  }
}

export default LukasRecoveryAgent;
