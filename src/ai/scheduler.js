// ═══════════════════════════════════════════════════════════════════════
// LUKAS Scheduler Agent
// Manages timed commands, reminders, recurring routines, and
// conditional triggers. Fires processCommand() at scheduled times.
// Persists to IndexedDB so schedules survive app restarts.
// ═══════════════════════════════════════════════════════════════════════

import lukasDB from './database.js';

class LukasSchedulerAgent {
  constructor() {
    this._schedules  = new Map();   // id → scheduleEntry
    this._tickTimer  = null;
    this._loaded     = false;

    // External hook — set by main.js
    this.onFireCommand = null;   // (command, schedule) => void  (calls processCommand)
    this.diag          = null;   // LukasDiagnosticsHub
    this.supervisor    = null;   // LukasSupervisor
  }

  // ─── Lifecycle ────────────────────────────────────────────────────────────

  async start() {
    await this._loadFromDB();
    this._startTick();
    console.log(`[Scheduler] Started with ${this._schedules.size} active schedules.`);
  }

  stop() {
    if (this._tickTimer) { clearInterval(this._tickTimer); this._tickTimer = null; }
  }

  // ─── Schedule Management ─────────────────────────────────────────────────

  /**
   * Add a new scheduled command.
   * @param {object} opts
   * @param {string}  opts.command      The LUKAS command to fire (e.g. "Turn off lights")
   * @param {string}  opts.username     Owner of this schedule
   * @param {Date|number} opts.triggerAt  When to fire (Date or ms timestamp)
   * @param {string}  [opts.repeat]     'none' | 'daily' | 'weekly' | 'hourly'
   * @param {string}  [opts.label]      Human-readable label (e.g. "Morning alarm")
   * @param {object}  [opts.condition]  { sensor, operator, value } for conditional rules
   * @returns {string} schedule ID
   */
  async scheduleCommand({ command, username, triggerAt, repeat = 'none', label = '', condition = null }) {
    const id = `sched_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const entry = {
      id,
      command,
      username,
      triggerAt: triggerAt instanceof Date ? triggerAt.getTime() : triggerAt,
      repeat,
      label: label || command,
      condition,
      enabled: true,
      createdAt: Date.now(),
      lastFiredAt: null,
      fireCount: 0
    };

    this._schedules.set(id, entry);
    await lukasDB.saveSchedule(entry);

    this._log(`Scheduled: "${entry.label}" at ${new Date(entry.triggerAt).toLocaleString()} [${repeat}]`);
    return id;
  }

  /**
   * Cancel a schedule by ID.
   */
  async cancelSchedule(id) {
    this._schedules.delete(id);
    await lukasDB.deleteSchedule(id);
    this._log(`Cancelled schedule: ${id}`);
  }

  /**
   * Enable or disable a schedule.
   */
  async setEnabled(id, enabled) {
    const entry = this._schedules.get(id);
    if (!entry) return false;
    entry.enabled = enabled;
    await lukasDB.saveSchedule(entry);
    return true;
  }

  /**
   * List all schedules for a user.
   */
  listSchedules(username = null) {
    const all = [...this._schedules.values()];
    return username ? all.filter(s => s.username === username) : all;
  }

  // ─── Natural Language Parsing ─────────────────────────────────────────────

  /**
   * Parse a natural language scheduling request into a schedule object.
   * Examples: "remind me at 8am", "every morning at 7am turn on lights",
   *           "remind me in 30 minutes", "schedule alarm at 9pm"
   * @param {string} input
   * @param {string} username
   * @returns {{ command: string, triggerAt: number, repeat: string, label: string } | null}
   */
  parseScheduleFromText(input, username) {
    const now = new Date();
    let triggerAt = null;
    let repeat    = 'none';
    let command   = input;
    let label     = '';

    const lower = input.toLowerCase();

    // "in X minutes/hours"
    const inMatch = lower.match(/in\s+(\d+)\s*(minute|minutes|min|hour|hours|hr|second|seconds|sec)/);
    if (inMatch) {
      const n = parseInt(inMatch[1]);
      const unit = inMatch[2];
      const ms = unit.startsWith('hour') || unit.startsWith('hr') ? n * 3600000
               : unit.startsWith('second') || unit.startsWith('sec') ? n * 1000
               : n * 60000;
      triggerAt = now.getTime() + ms;
      command = input.replace(/remind me/i, '').replace(inMatch[0], '').trim();
      label = `Reminder in ${n} ${unit}`;
    }

    // "at HH:MM" or "at Xam/pm"
    const atMatch = lower.match(/at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
    if (!triggerAt && atMatch) {
      let hour   = parseInt(atMatch[1]);
      const min  = atMatch[2] ? parseInt(atMatch[2]) : 0;
      const ampm = atMatch[3];
      if (ampm === 'pm' && hour !== 12) hour += 12;
      if (ampm === 'am' && hour === 12) hour = 0;
      const target = new Date(now);
      target.setHours(hour, min, 0, 0);
      if (target <= now) target.setDate(target.getDate() + 1); // next occurrence
      triggerAt = target.getTime();
      label = `Scheduled at ${hour}:${String(min).padStart(2, '0')}`;
    }

    // Repeat detection
    if (lower.includes('every day') || lower.includes('daily') || lower.includes('every morning') || lower.includes('every night')) {
      repeat = 'daily';
    } else if (lower.includes('every week') || lower.includes('weekly')) {
      repeat = 'weekly';
    } else if (lower.includes('every hour') || lower.includes('hourly')) {
      repeat = 'hourly';
    }

    // Extract the actual command from "remind me to X at Y"
    const remindMatch = input.match(/remind\s+me\s+to\s+(.+?)\s+(?:at|in|every)/i);
    if (remindMatch) command = remindMatch[1];

    if (!triggerAt) return null;

    return { command: command || input, username, triggerAt, repeat, label };
  }

  // ─── Tick Engine ──────────────────────────────────────────────────────────

  _startTick() {
    if (this._tickTimer) return;
    this._tickTimer = setInterval(() => this._tick(), 15000); // check every 15s
  }

  async _tick() {
    const now = Date.now();
    for (const [id, entry] of this._schedules.entries()) {
      if (!entry.enabled) continue;
      if (now < entry.triggerAt) continue;

      // Fire the command
      this._fireSchedule(entry);

      // Update next trigger time based on repeat mode
      if (entry.repeat === 'daily') {
        entry.triggerAt += 86400000;
        entry.lastFiredAt = now;
        entry.fireCount++;
        await lukasDB.saveSchedule(entry);
      } else if (entry.repeat === 'weekly') {
        entry.triggerAt += 604800000;
        entry.lastFiredAt = now;
        entry.fireCount++;
        await lukasDB.saveSchedule(entry);
      } else if (entry.repeat === 'hourly') {
        entry.triggerAt += 3600000;
        entry.lastFiredAt = now;
        entry.fireCount++;
        await lukasDB.saveSchedule(entry);
      } else {
        // One-shot — remove after firing
        entry.lastFiredAt = now;
        entry.fireCount++;
        entry.enabled = false;
        await lukasDB.saveSchedule(entry);
        this._schedules.delete(id);
      }
    }
  }

  _fireSchedule(entry) {
    this._log(`Firing scheduled command: "${entry.label}" → "${entry.command}"`);

    if (this.supervisor) {
      this.supervisor.logAgentAction('scheduler',
        `Firing: "${entry.label}" → "${entry.command}"`, 'info', { scheduleId: entry.id });
    }

    if (this.onFireCommand) {
      this.onFireCommand(entry.command, entry);
    } else {
      console.warn('[Scheduler] No onFireCommand handler set — command not executed.');
    }
  }

  // ─── Persistence ──────────────────────────────────────────────────────────

  async _loadFromDB() {
    try {
      const all = await lukasDB.getAll('schedules');
      for (const entry of all) {
        if (entry.enabled) {
          this._schedules.set(entry.id, entry);
        }
      }
      this._loaded = true;
    } catch (e) {
      console.error('[Scheduler] Failed to load schedules from DB:', e);
    }
  }

  // ─── Utility ──────────────────────────────────────────────────────────────

  _log(msg) {
    console.log(`[Scheduler] ${msg}`);
    if (this.diag) this.diag.logToTerminal(`[SCHEDULER] ${msg}`, 'info');
  }

  getStatus() {
    const active   = [...this._schedules.values()].filter(s => s.enabled);
    const upcoming = active.sort((a, b) => a.triggerAt - b.triggerAt).slice(0, 5);
    return {
      totalSchedules: this._schedules.size,
      activeSchedules: active.length,
      upcomingCommands: upcoming.map(s => ({
        label: s.label,
        command: s.command,
        triggerAt: new Date(s.triggerAt).toLocaleString(),
        repeat: s.repeat
      }))
    };
  }
}

export default LukasSchedulerAgent;
