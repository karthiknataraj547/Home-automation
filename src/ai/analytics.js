// ═══════════════════════════════════════════════════════════════════════
// LUKAS Analytics Agent
// Tracks command frequency, intent distribution, device usage,
// failure rates, and response latency. All persisted to IndexedDB.
// ═══════════════════════════════════════════════════════════════════════

import lukasDB from './database.js';

class LukasAnalyticsAgent {
  constructor() {
    this._buffer = [];        // In-memory event buffer
    this._flushInterval = null;
    this._FLUSH_EVERY = 10;   // Flush to DB every 10 events
  }

  // ─── Event Recording ──────────────────────────────────────────────────────

  /**
   * Record any analytics event.
   * @param {string} type     e.g. 'command', 'device_action', 'error', 'intent'
   * @param {object} data     Arbitrary event data
   * @param {string} username Current user
   */
  async record(type, data = {}, username = 'Guest') {
    const event = { type, data, username, ts: Date.now() };
    this._buffer.push(event);

    if (this._buffer.length >= this._FLUSH_EVERY) {
      await this._flush();
    }
  }

  // Convenience shortcuts
  async recordCommand(command, intent, latencyMs, success, username = 'Guest') {
    await this.record('command', { command: command.slice(0, 100), intent, latencyMs, success }, username);
  }

  async recordDeviceAction(deviceId, action, success, username = 'Guest') {
    await this.record('device_action', { deviceId, action, success }, username);
  }

  async recordError(agent, errorMsg, username = 'Guest') {
    await this.record('error', { agent, error: errorMsg.slice(0, 200) }, username);
  }

  async recordVoiceEvent(type, detail = '') {
    await this.record('voice', { subtype: type, detail });
  }

  async _flush() {
    if (this._buffer.length === 0) return;
    const toFlush = [...this._buffer];
    this._buffer = [];
    try {
      await lukasDB.bulkPut('analytics', toFlush);
    } catch (e) {
      console.warn('[Analytics] Flush failed:', e.message);
      // Put events back
      this._buffer.unshift(...toFlush);
    }
  }

  // ─── Report Generation ────────────────────────────────────────────────────

  /**
   * Generate a comprehensive analytics report.
   * @param {number} periodMs   Lookback period in ms (default: 7 days)
   */
  async getReport(periodMs = 7 * 86400000) {
    const cutoff = Date.now() - periodMs;
    const all    = await lukasDB.getAnalyticsEvents(null, 5000);
    const recent = all.filter(e => e.ts >= cutoff);

    return {
      period: `${Math.round(periodMs / 86400000)} days`,
      totalEvents: recent.length,
      commands:     this._analyzeCommands(recent),
      intents:      this._analyzeIntents(recent),
      devices:      this._analyzeDevices(recent),
      errors:       this._analyzeErrors(recent),
      voice:        this._analyzeVoice(recent),
      latency:      this._analyzeLatency(recent),
      topCommands:  this._getTopCommands(recent, 10),
      successRate:  this._getSuccessRate(recent)
    };
  }

  _analyzeCommands(events) {
    const cmds = events.filter(e => e.type === 'command');
    return {
      total: cmds.length,
      successful: cmds.filter(e => e.data.success).length,
      failed: cmds.filter(e => !e.data.success).length,
    };
  }

  _analyzeIntents(events) {
    const cmds = events.filter(e => e.type === 'command');
    const dist = {};
    for (const e of cmds) {
      const intent = e.data.intent || 'unknown';
      dist[intent] = (dist[intent] || 0) + 1;
    }
    return Object.entries(dist)
      .sort(([,a], [,b]) => b - a)
      .map(([intent, count]) => ({ intent, count }));
  }

  _analyzeDevices(events) {
    const dev = events.filter(e => e.type === 'device_action');
    const dist = {};
    for (const e of dev) {
      const id = e.data.deviceId || 'unknown';
      if (!dist[id]) dist[id] = { total: 0, success: 0, failed: 0 };
      dist[id].total++;
      if (e.data.success) dist[id].success++; else dist[id].failed++;
    }
    return dist;
  }

  _analyzeErrors(events) {
    const errs = events.filter(e => e.type === 'error');
    const dist = {};
    for (const e of errs) {
      const agent = e.data.agent || 'unknown';
      dist[agent] = (dist[agent] || 0) + 1;
    }
    return { total: errs.length, byAgent: dist };
  }

  _analyzeVoice(events) {
    const voice = events.filter(e => e.type === 'voice');
    const subtypes = {};
    for (const e of voice) {
      const st = e.data.subtype || 'unknown';
      subtypes[st] = (subtypes[st] || 0) + 1;
    }
    return { total: voice.length, subtypes };
  }

  _analyzeLatency(events) {
    const cmds = events.filter(e => e.type === 'command' && e.data.latencyMs > 0);
    if (cmds.length === 0) return { avg: 0, min: 0, max: 0, p95: 0 };
    const latencies = cmds.map(e => e.data.latencyMs).sort((a, b) => a - b);
    const avg = Math.round(latencies.reduce((s, v) => s + v, 0) / latencies.length);
    return {
      avg,
      min: latencies[0],
      max: latencies[latencies.length - 1],
      p95: latencies[Math.floor(latencies.length * 0.95)]
    };
  }

  _getTopCommands(events, n = 10) {
    const cmds = events.filter(e => e.type === 'command');
    const dist = {};
    for (const e of cmds) {
      const cmd = (e.data.command || '').toLowerCase().trim().slice(0, 60);
      dist[cmd] = (dist[cmd] || 0) + 1;
    }
    return Object.entries(dist)
      .sort(([,a], [,b]) => b - a)
      .slice(0, n)
      .map(([command, count]) => ({ command, count }));
  }

  _getSuccessRate(events) {
    const cmds = events.filter(e => e.type === 'command');
    if (cmds.length === 0) return 100;
    const success = cmds.filter(e => e.data.success).length;
    return Math.round((success / cmds.length) * 100);
  }

  // ─── Summary for Dashboard ────────────────────────────────────────────────

  async getDashboardSummary() {
    const report = await this.getReport(86400000); // 24h
    return {
      commandsToday: report.commands.total,
      successRate:   report.successRate,
      avgLatency:    report.latency.avg,
      errorsToday:   report.errors.total,
      topIntent:     report.intents[0]?.intent || 'none',
      topCommand:    report.topCommands[0]?.command || 'none'
    };
  }

  async forceFlush() {
    await this._flush();
  }
}

export default LukasAnalyticsAgent;
