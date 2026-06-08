// ═══════════════════════════════════════════════════════════════════════
// LUKAS Supervisor Agent (AI Governor)
// Sits above the Master Agent and monitors every agent, every task,
// every response, and every device action.
//
// Responsibilities:
//   • Track active agents & their state transitions
//   • Validate AI responses for hallucinated success claims
//   • Score responses across accuracy/execution/reasoning/confidence
//   • Verify device states and multi-task plan completion
//   • Route structured JSON logs to Electron or LocalStorage fallback
// ═══════════════════════════════════════════════════════════════════════

class LukasSupervisor {
  constructor() {
    // Registry of all agents currently being tracked
    this._agents = {};        // { agentName: { status, lastAction, startedAt } }
    this._sessionLogs = [];   // In-memory log buffer (exported to file/LS)
    this._commandAudit = [];  // Full audit trail for the current command lifecycle

    // Hallucination detection patterns — phrases that claim success
    this._successPhrases = [
      'successfully', 'turned on', 'turned off', 'is now on', 'is now off',
      'has been activated', 'has been deactivated', 'command sent',
      'done', 'completed', 'executed', 'all done', 'lights are on',
      'lights are off', 'temperature set', 'ac is on', 'ac is off',
      'fan is on', 'fan is off', 'lock engaged', 'lock disengaged',
      'i have turned', 'i have set', 'i have switched'
    ];

    // Confident failure signals from task steps
    this._failurePhrases = [
      'failed', 'error', 'could not', 'unable to', 'timed out',
      'unreachable', 'no response', 'device offline', 'not found'
    ];
  }

  // ─── Agent Lifecycle Tracking ──────────────────────────────────────────────

  /**
   * Register or update a tracked agent.
   * @param {string} agentName  e.g. 'master', 'planner', 'home', 'research'
   * @param {string} status     e.g. 'idle', 'running', 'completed', 'failed'
   * @param {string} action     Human-readable description of the current action
   */
  trackAgent(agentName, status, action = '') {
    this._agents[agentName] = {
      status,
      lastAction: action,
      updatedAt: Date.now()
    };
    this.logAgentAction(agentName, `[${status.toUpperCase()}] ${action}`);
  }

  /**
   * Get the current state of all tracked agents.
   * @returns {object}
   */
  getAgentRegistry() {
    return { ...this._agents };
  }

  // ─── Structured Agent Logging ──────────────────────────────────────────────

  /**
   * Log a structured JSON entry for a named agent.
   * Routes to /api/write-agent-log (Electron) or LocalStorage (fallback).
   * @param {string} agentName  e.g. 'supervisor', 'master', 'planner'
   * @param {string} message    Log message text
   * @param {string} level      'info' | 'warn' | 'error' | 'debug'
   * @param {object} meta       Optional extra metadata
   */
  logAgentAction(agentName, message, level = 'info', meta = {}) {
    const entry = {
      ts: new Date().toISOString(),
      agent: agentName,
      level,
      message,
      ...meta
    };

    this._sessionLogs.push(entry);
    if (this._sessionLogs.length > 2000) {
      this._sessionLogs.shift();
    }

    // Fire-and-forget async write — does not block the AI pipeline
    this._writeLog(agentName, entry).catch(() => {});
  }

  async _writeLog(agentName, entry) {
    try {
      const resp = await fetch('/api/write-agent-log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent: agentName, entry })
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    } catch {
      // Offline/static fallback: append to LocalStorage ring buffer
      const key = `lukas_agent_log_${agentName}`;
      try {
        const existing = JSON.parse(localStorage.getItem(key) || '[]');
        existing.push(entry);
        if (existing.length > 500) existing.splice(0, existing.length - 500);
        localStorage.setItem(key, JSON.stringify(existing));
      } catch { /* Storage full — discard */ }
    }
  }

  /**
   * Retrieve in-memory session logs, optionally filtered by agent name.
   * @param {string|null} agentFilter  e.g. 'planner', or null for all
   * @returns {Array<object>}
   */
  getSessionLogs(agentFilter = null) {
    if (!agentFilter) return [...this._sessionLogs];
    return this._sessionLogs.filter(l => l.agent === agentFilter);
  }

  // ─── Command Audit Trail ──────────────────────────────────────────────────

  /**
   * Begin tracking a new command lifecycle.
   * @param {string} rawCommand  The original user input
   * @param {string} source      'voice' | 'user'
   */
  beginCommandAudit(rawCommand, source) {
    this._commandAudit = [];
    const entry = { phase: 'RECEIVED', command: rawCommand, source, ts: Date.now() };
    this._commandAudit.push(entry);
    this.logAgentAction('supervisor', `Command received [${source}]: "${rawCommand}"`, 'info', { rawCommand });
  }

  /**
   * Record a pipeline phase transition in the current command audit.
   * @param {string} phase   e.g. 'ROUTE', 'PLAN', 'EXECUTE', 'VALIDATE', 'RESPOND'
   * @param {object} detail  Any extra detail object
   */
  auditPhase(phase, detail = {}) {
    this._commandAudit.push({ phase, ts: Date.now(), ...detail });
  }

  /**
   * Return the current command audit trail.
   * @returns {Array<object>}
   */
  getCommandAudit() {
    return [...this._commandAudit];
  }

  // ─── Response Scoring ──────────────────────────────────────────────────────

  /**
   * Score a synthesized AI response across multiple quality dimensions.
   *
   * @param {string} userCommand     The original user input
   * @param {string} aiResponse      The AI's final response text
   * @param {Array}  executionResults Array of task step results from LukasTaskRunner
   *                                  (optional; used for hallucination detection)
   * @returns {{
   *   accuracy: number,
   *   execution: number,
   *   reasoning: number,
   *   confidence: number,
   *   hallucination_risk: number,
   *   issues: string[],
   *   overall: number,
   *   verdict: 'PASS' | 'WARN' | 'FAIL'
   * }}
   */
  scoreResponse(userCommand, aiResponse, executionResults = []) {
    const issues = [];
    let accuracy    = 100;
    let execution   = 100;
    let reasoning   = 100;
    let confidence  = 100;
    let hallRisk    = 0;

    const lowerResp = (aiResponse || '').toLowerCase().trim();
    const lowerCmd  = (userCommand || '').toLowerCase().trim();

    // ── 1. Basic length / completeness ─────────────────────────────────
    if (!aiResponse || aiResponse.length < 8) {
      accuracy   -= 40; reasoning -= 30; confidence -= 30;
      issues.push('Response is empty or too short.');
    }
    if (aiResponse.endsWith('...') || aiResponse.includes('...\n')) {
      reasoning  -= 15;
      issues.push('Response appears cut off or incomplete.');
    }

    // ── 2. Robotic / AI disclaimer phrases ────────────────────────────
    const badPhrases = [
      'as an ai', 'as a language model', 'i cannot search', 'i don\'t have access to the internet',
      'do not have real-time', 'knowledge cutoff', 'as an assistant', 'i am unable to'
    ];
    for (const p of badPhrases) {
      if (lowerResp.includes(p)) {
        accuracy   -= 15;
        confidence -= 10;
        issues.push(`Contains AI limitation disclaimer: "${p}"`);
      }
    }

    // ── 3. Relevance check ────────────────────────────────────────────
    const stopWords = new Set(['what', 'when', 'where', 'please', 'tell', 'show', 'about', 'is', 'the', 'a', 'an', 'and', 'can', 'you']);
    const inputWords  = new Set(lowerCmd.split(/\s+/).filter(w => w.length > 3 && !stopWords.has(w)));
    const outputWords = new Set(lowerResp.split(/\s+/));
    const overlap     = [...inputWords].filter(w => outputWords.has(w)).length;
    if (overlap === 0 && inputWords.size > 2) {
      accuracy  -= 20;
      reasoning -= 15;
      issues.push('Response does not address keywords from the user command.');
    }

    // ── 4. Execution result analysis ──────────────────────────────────
    if (executionResults && executionResults.length > 0) {
      const failedSteps = executionResults.filter(r => r.status === 'failed' || r.status === 'error');
      const totalSteps  = executionResults.length;
      const failRatio   = failedSteps.length / totalSteps;

      if (failRatio > 0) {
        execution  -= Math.round(failRatio * 60);
        confidence -= Math.round(failRatio * 30);
        issues.push(`${failedSteps.length}/${totalSteps} plan steps failed.`);
      }

      // ── 5. Hallucination Detection ────────────────────────────────
      // If any step failed AND the response claims success → hallucination
      if (failedSteps.length > 0) {
        const claimsSuccess = this._successPhrases.some(p => lowerResp.includes(p));
        const acknowledgesFail = this._failurePhrases.some(p => lowerResp.includes(p));

        if (claimsSuccess && !acknowledgesFail) {
          hallRisk  = Math.min(100, 40 + failedSteps.length * 20);
          accuracy  -= 30;
          confidence -= 25;
          issues.push(
            `HALLUCINATION DETECTED: Response claims success but ${failedSteps.length} step(s) failed. ` +
            `Failed steps: ${failedSteps.map(s => s.title || s.id).join(', ')}`
          );
        }
      }
    }

    // ── 6. Clamp all scores ───────────────────────────────────────────
    accuracy    = Math.max(0, Math.min(100, accuracy));
    execution   = Math.max(0, Math.min(100, execution));
    reasoning   = Math.max(0, Math.min(100, reasoning));
    confidence  = Math.max(0, Math.min(100, confidence));
    hallRisk    = Math.max(0, Math.min(100, hallRisk));

    const overall = Math.round((accuracy + execution + reasoning + confidence) / 4);
    const verdict = overall >= 75 && hallRisk < 30 ? 'PASS'
                  : overall >= 50 || hallRisk < 60 ? 'WARN'
                  : 'FAIL';

    return {
      accuracy,
      execution,
      reasoning,
      confidence,
      hallucination_risk: hallRisk,
      issues,
      overall,
      verdict
    };
  }

  // ─── Response Validation & Refinement ────────────────────────────────────

  /**
   * Validate an AI response. Returns the score object.
   * If hallucination is detected, logs a supervisor warning.
   *
   * @param {string} rawCommand
   * @param {string} aiResponse
   * @param {Array}  executionResults
   * @returns {object} The score result from scoreResponse()
   */
  validateResponse(rawCommand, aiResponse, executionResults = []) {
    const score = this.scoreResponse(rawCommand, aiResponse, executionResults);

    if (score.verdict === 'FAIL' || score.hallucination_risk >= 30) {
      this.logAgentAction(
        'supervisor',
        `[GOVERNOR ALERT] Response validation FAILED — Hallucination risk: ${score.hallucination_risk}%. Issues: ${score.issues.join(' | ')}`,
        'error',
        { score, command: rawCommand }
      );
    } else if (score.verdict === 'WARN') {
      this.logAgentAction(
        'supervisor',
        `[GOVERNOR WARNING] Response quality suboptimal — Overall: ${score.overall}%. Issues: ${score.issues.join(' | ')}`,
        'warn',
        { score }
      );
    } else {
      this.logAgentAction(
        'supervisor',
        `[GOVERNOR OK] Response validated — Overall: ${score.overall}%. Hallucination risk: ${score.hallucination_risk}%.`,
        'info',
        { score }
      );
    }

    this.auditPhase('VALIDATE', { score });
    return score;
  }

  // ─── Device State Verification ────────────────────────────────────────────

  /**
   * Verify that a device actually changed to the expected state.
   * Compares the live AutomationHub state against the expected value.
   *
   * @param {object} automationHub   Reference to LukasAutomationHub instance
   * @param {string} deviceName      e.g. 'Living Room Light'
   * @param {string} expectedState   e.g. 'on' | 'off' | 'locked' | 'unlocked'
   * @returns {{ verified: boolean, actual: string, expected: string }}
   */
  verifyDeviceState(automationHub, deviceName, expectedState) {
    try {
      const devices = automationHub.getDeviceStates ? automationHub.getDeviceStates() : {};
      const deviceKey = Object.keys(devices).find(k => k.toLowerCase().includes(deviceName.toLowerCase()));
      const actual = deviceKey ? String(devices[deviceKey]).toLowerCase() : 'unknown';
      const verified = actual === expectedState.toLowerCase();

      this.logAgentAction(
        'supervisor',
        `[DEVICE VERIFY] "${deviceName}": expected="${expectedState}", actual="${actual}" → ${verified ? '✓ MATCH' : '✗ MISMATCH'}`,
        verified ? 'info' : 'warn',
        { deviceName, expectedState, actual, verified }
      );

      return { verified, actual, expected: expectedState };
    } catch (err) {
      this.logAgentAction('supervisor', `[DEVICE VERIFY ERROR] ${deviceName}: ${err.message}`, 'error');
      return { verified: false, actual: 'error', expected: expectedState };
    }
  }

  // ─── Multi-Task Completion Verification ───────────────────────────────────

  /**
   * Verify that all steps in a planner result are completed.
   * Raises an alert for any step that is still pending or failed.
   *
   * @param {object} plan      Plan object from LukasPlannerAgent
   * @param {Array}  results   Results array from LukasTaskRunner.executePlan()
   * @returns {{ allCompleted: boolean, completedCount: number, failedCount: number, pendingCount: number }}
   */
  verifyMultiTaskCompletion(plan, results) {
    const steps        = plan.steps || [];
    const totalSteps   = steps.length;
    const completedCnt = results.filter(r => r.status === 'completed').length;
    const failedCnt    = results.filter(r => r.status === 'failed' || r.status === 'error').length;
    const pendingCnt   = totalSteps - completedCnt - failedCnt;
    const allCompleted = completedCnt === totalSteps;

    const summary = `Tasks: ${completedCnt}/${totalSteps} completed, ${failedCnt} failed, ${pendingCnt} pending.`;
    this.logAgentAction(
      'supervisor',
      `[TASK VERIFY] "${plan.title || plan.objective || 'Plan'}" — ${summary}`,
      allCompleted ? 'info' : (failedCnt > 0 ? 'error' : 'warn'),
      { planTitle: plan.title, totalSteps, completedCnt, failedCnt, pendingCnt }
    );

    this.auditPhase('TASK_VERIFY', { allCompleted, completedCnt, failedCnt, pendingCnt });

    return { allCompleted, completedCount: completedCnt, failedCount: failedCnt, pendingCount: pendingCnt };
  }

  // ─── Build a Refinement Prompt ────────────────────────────────────────────

  /**
   * Build a corrective re-generation prompt for a hallucinated response.
   *
   * @param {string} originalCommand    The user's original command
   * @param {string} badResponse        The AI's flawed/hallucinated response
   * @param {Array}  executionResults   Task runner results
   * @param {object} scoreResult        Output of scoreResponse()
   * @returns {string}                  A corrective system prompt string
   */
  buildRefinementPrompt(originalCommand, badResponse, executionResults, scoreResult) {
    const failedSummary = executionResults
      .filter(r => r.status === 'failed' || r.status === 'error')
      .map(r => `- Step "${r.title}": ${r.error || 'Unknown error'}`)
      .join('\n') || '(no failures)';

    return `You are LUKAS, an advanced AI Operating System.
Your previous response was flagged by the internal Supervisor Agent (AI Governor).

[SUPERVISOR AUDIT]
Hallucination Risk: ${scoreResult.hallucination_risk}%
Overall Quality: ${scoreResult.overall}%
Flagged Issues:
${scoreResult.issues.map(i => `- ${i}`).join('\n')}

[FAILED EXECUTION STEPS]
${failedSummary}

[USER COMMAND]
"${originalCommand}"

[YOUR PREVIOUS RESPONSE — DO NOT REPEAT THIS]
"${badResponse.slice(0, 400)}..."

INSTRUCTION:
Re-generate your response. You MUST:
1. Acknowledge any failures honestly. DO NOT claim success for failed tasks.
2. Describe exactly what was attempted and what succeeded or failed.
3. Offer a clear path forward or alternative action for any failed steps.
4. Maintain LUKAS Nexus personality — professional, direct, no generic AI disclaimers.
5. Keep the response concise (under 3 sentences for simple tasks, under 8 for complex ones).`;
  }

  // ─── Diagnostics Report ──────────────────────────────────────────────────

  /**
   * Build a summary report of the supervisor's current state.
   * @returns {object}
   */
  getStatusReport() {
    return {
      activeAgents: Object.entries(this._agents).map(([name, state]) => ({
        name, ...state
      })),
      sessionLogCount: this._sessionLogs.length,
      commandAuditDepth: this._commandAudit.length,
      lastAuditPhase: this._commandAudit.length > 0
        ? this._commandAudit[this._commandAudit.length - 1].phase
        : 'NONE'
    };
  }
}

export default LukasSupervisor;
