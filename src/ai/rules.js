// ═══════════════════════════════════════════════════════════════════════
// LUKAS Automation Rules Agent
// Event-driven conditional automation engine.
// Rules: IF <condition> THEN <command>
// Evaluates on every sensor update, device state change, or time event.
// Persists to IndexedDB.
// ═══════════════════════════════════════════════════════════════════════

import lukasDB from './database.js';

// Supported condition operators
const OPERATORS = {
  GT:       (a, b) => Number(a) > Number(b),
  LT:       (a, b) => Number(a) < Number(b),
  GTE:      (a, b) => Number(a) >= Number(b),
  LTE:      (a, b) => Number(a) <= Number(b),
  EQ:       (a, b) => String(a).toLowerCase() === String(b).toLowerCase(),
  NEQ:      (a, b) => String(a).toLowerCase() !== String(b).toLowerCase(),
  CONTAINS: (a, b) => String(a).toLowerCase().includes(String(b).toLowerCase()),
  BETWEEN:  (a, b, c) => Number(a) >= Number(b) && Number(a) <= Number(c),
};

class LukasRulesAgent {
  constructor() {
    this._rules       = new Map();   // id → rule
    this._ruleHistory = [];          // last 100 rule firings
    this._maxHistory  = 100;
    this._cooldowns   = new Map();   // id → last fired timestamp

    // External hooks
    this.onFireCommand = null;   // (command, rule) => void
    this.diag          = null;
    this.supervisor    = null;

    // Minimum time between repeat firings of the same rule (ms)
    this.COOLDOWN_MS = 60000; // 1 minute
  }

  // ─── Rule Management ──────────────────────────────────────────────────────

  /**
   * Add a new automation rule.
   * @param {object} opts
   * @param {string}  opts.name           e.g. "Auto AC when hot"
   * @param {string}  opts.username
   * @param {object}  opts.condition      { sensor, operator, value, value2? }
   *                                      sensor: 'temperature' | 'humidity' | 'device:livingRoomLight.on' | 'time.hour'
   * @param {string}  opts.action         Command string to fire, e.g. "Turn on AC"
   * @param {boolean} [opts.enabled]      Default true
   * @param {number}  [opts.cooldownMs]   Override default cooldown
   * @returns {string} rule ID
   */
  async addRule({ name, username, condition, action, enabled = true, cooldownMs = null }) {
    const id = `rule_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const rule = {
      id, name, username, condition, action,
      enabled,
      cooldownMs: cooldownMs ?? this.COOLDOWN_MS,
      createdAt: Date.now(),
      fireCount: 0,
      lastFiredAt: null
    };

    this._rules.set(id, rule);
    await lukasDB.saveRule(rule);
    this._log(`Rule added: "${name}"`);
    return id;
  }

  async updateRule(id, updates) {
    const rule = this._rules.get(id);
    if (!rule) return false;
    Object.assign(rule, updates);
    await lukasDB.saveRule(rule);
    return true;
  }

  async deleteRule(id) {
    this._rules.delete(id);
    await lukasDB.deleteRule(id);
    this._log(`Rule deleted: ${id}`);
  }

  async setRuleEnabled(id, enabled) {
    return this.updateRule(id, { enabled });
  }

  listRules(username = null) {
    const all = [...this._rules.values()];
    return username ? all.filter(r => r.username === username) : all;
  }

  // ─── Rule Evaluation ──────────────────────────────────────────────────────

  /**
   * Evaluate all rules against current sensor / state data.
   * Call this whenever: temperature changes, device state changes, time ticks.
   *
   * @param {object} sensorData  e.g. { temperature: 32, humidity: 60, time: { hour: 14, minute: 30 } }
   * @param {object} deviceStates  e.g. { livingRoomLight: { on: true, brightness: 80 } }
   */
  async evaluate(sensorData = {}, deviceStates = {}) {
    for (const [id, rule] of this._rules.entries()) {
      if (!rule.enabled) continue;

      // Check cooldown
      const lastFired = this._cooldowns.get(id) || 0;
      if (Date.now() - lastFired < rule.cooldownMs) continue;

      try {
        const conditionMet = this._evaluateCondition(rule.condition, sensorData, deviceStates);
        if (conditionMet) {
          await this._fireRule(rule);
        }
      } catch (e) {
        this._log(`Rule "${rule.name}" evaluation error: ${e.message}`, 'warn');
      }
    }
  }

  _evaluateCondition(condition, sensorData, deviceStates) {
    if (!condition || !condition.sensor || !condition.operator) return false;

    // Resolve sensor value
    let actualValue;
    const sensor = condition.sensor;

    if (sensor.startsWith('device:')) {
      // e.g. "device:livingRoomLight.on"
      const [, rest] = sensor.split('device:');
      const [devId, prop] = rest.split('.');
      actualValue = deviceStates[devId]?.[prop];
    } else if (sensor.startsWith('time.')) {
      const timeProp = sensor.split('.')[1];
      actualValue = new Date()[`get${timeProp.charAt(0).toUpperCase() + timeProp.slice(1)}`]?.();
    } else {
      actualValue = sensorData[sensor];
    }

    if (actualValue === undefined) return false;

    const op = condition.operator.toUpperCase();
    const fn = OPERATORS[op];
    if (!fn) return false;

    if (op === 'BETWEEN') {
      return fn(actualValue, condition.value, condition.value2);
    }
    return fn(actualValue, condition.value);
  }

  async _fireRule(rule) {
    this._cooldowns.set(rule.id, Date.now());
    rule.fireCount++;
    rule.lastFiredAt = Date.now();
    await lukasDB.saveRule(rule);

    const entry = {
      ruleId: rule.id,
      ruleName: rule.name,
      action: rule.action,
      firedAt: new Date().toISOString()
    };
    this._ruleHistory.push(entry);
    if (this._ruleHistory.length > this._maxHistory) this._ruleHistory.shift();

    this._log(`Rule fired: "${rule.name}" → "${rule.action}"`);

    if (this.supervisor) {
      this.supervisor.logAgentAction('rules',
        `Rule "${rule.name}" triggered: "${rule.action}"`, 'info', entry);
    }

    if (this.onFireCommand) {
      this.onFireCommand(rule.action, rule);
    }
  }

  // ─── Natural Language Rule Parsing ────────────────────────────────────────

  /**
   * Parse a natural language rule into a structured rule object.
   * Examples:
   *   "if temperature is above 30 then turn on AC"
   *   "when bedroom light is off turn off AC"
   *   "if time is after 10pm turn off living room light"
   */
  parseRuleFromText(input, username) {
    const lower = input.toLowerCase();

    // Extract condition part and action part
    const ifThenMatch = lower.match(/^(?:if|when)\s+(.+?)\s+(?:then\s+)?(.+)$/);
    if (!ifThenMatch) return null;

    let [, conditionText, actionText] = ifThenMatch;

    // Parse operator
    let operator = 'GT';
    let value;
    let sensor;

    const tempMatch = conditionText.match(/temperature\s+(?:is\s+)?(?:above|over|greater than|>)\s*(\d+)/);
    const tempBelowMatch = conditionText.match(/temperature\s+(?:is\s+)?(?:below|under|less than|<)\s*(\d+)/);
    const humMatch = conditionText.match(/humidity\s+(?:is\s+)?(?:above|over|>)\s*(\d+)/);

    if (tempMatch) {
      sensor = 'temperature'; operator = 'GT'; value = tempMatch[1];
    } else if (tempBelowMatch) {
      sensor = 'temperature'; operator = 'LT'; value = tempBelowMatch[1];
    } else if (humMatch) {
      sensor = 'humidity'; operator = 'GT'; value = humMatch[1];
    } else {
      return null; // Could not parse condition
    }

    return {
      name: input.slice(0, 80),
      username,
      condition: { sensor, operator, value },
      action: actionText.trim(),
      enabled: true
    };
  }

  // ─── Persistence ──────────────────────────────────────────────────────────

  async loadFromDB(username = null) {
    try {
      const all = username
        ? await lukasDB.getRules(username)
        : await lukasDB.getAll('rules');
      for (const rule of all) {
        this._rules.set(rule.id, rule);
      }
      console.log(`[Rules] Loaded ${all.length} rules from DB.`);
    } catch (e) {
      console.error('[Rules] Failed to load rules:', e);
    }
  }

  // ─── Built-in Default Rules ───────────────────────────────────────────────

  async installDefaultRules(username) {
    const existing = await lukasDB.getRules(username);
    if (existing.length > 0) return; // Already installed

    const defaults = [
      {
        name: 'Auto-lock at night',
        username,
        condition: { sensor: 'time.hours', operator: 'EQ', value: '23' },
        action: 'Enable lockdown mode',
        enabled: false,
        cooldownMs: 82800000  // 23h cooldown
      },
      {
        name: 'Morning routine trigger',
        username,
        condition: { sensor: 'time.hours', operator: 'EQ', value: '7' },
        action: 'Activate morning routine',
        enabled: false,
        cooldownMs: 82800000
      }
    ];

    for (const rule of defaults) {
      await this.addRule(rule);
    }
    console.log('[Rules] Default rules installed.');
  }

  // ─── Utility ──────────────────────────────────────────────────────────────

  _log(msg, level = 'info') {
    console.log(`[Rules] ${msg}`);
    if (this.diag) this.diag.logToTerminal(`[RULES] ${msg}`, level);
  }

  getFireHistory(n = 20) {
    return this._ruleHistory.slice(-n);
  }

  getStatus() {
    const enabled = [...this._rules.values()].filter(r => r.enabled).length;
    return {
      totalRules: this._rules.size,
      enabledRules: enabled,
      recentFirings: this.getFireHistory(5)
    };
  }
}

export default LukasRulesAgent;
