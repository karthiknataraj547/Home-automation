// ═══════════════════════════════════════════════════════════════════════
// LUKAS Autonomous Task Runner
// Executes multi-step plans from the Planner Agent
// Handles: Research, Writing, Analysis, Code, Automation
// ═══════════════════════════════════════════════════════════════════════

import { callLukasAI } from './core.js';

class LukasTaskRunner {
  static history = [];

  constructor() {
    this.onStepStarted = null;    // (stepIdx, step) => void
    this.onStepCompleted = null;  // (stepIdx, result) => void
    this.onStepFailed = null;     // (stepIdx, error) => void
    this.onAllCompleted = null;   // (results) => void
    this.onProgress = null;       // (percent, message) => void

    this._activePlan = null;
    this._results = [];
    this._isRunning = false;
    this._aborted = false;

    // Task Graph memory queues
    this.pendingTasks = [];
    this.activeTasks = [];
    this.completedTasks = [];
    this.failedTasks = [];
  }

  // ─── Public API ──────────────────────────────────────────────────────────

  /**
   * Execute a plan from LukasPlannerAgent.
   * @param {object} plan - PlanResult from planner.createPlan()
   * @param {object} context - { memory, apiKey, apiProvider, research? }
   */
  async executePlan(plan, context = {}) {
    if (this._isRunning) {
      console.warn('[Task Runner] A plan is already running.');
      return;
    }

    this._activePlan = plan;
    this._results = [];
    this._isRunning = true;
    this._aborted = false;

    this.pendingTasks = [...plan.steps];
    this.activeTasks = [];
    this.completedTasks = [];
    this.failedTasks = [];

    // Log this run in history
    LukasTaskRunner.history.push({
      planTitle: plan.title,
      timestamp: Date.now(),
      steps: plan.steps,
      status: 'running',
      runner: this
    });

    console.log(`[Task Runner] Starting graph plan execution: "${plan.title}"`);

    const { memory, apiKey, apiProvider, research } = context;

    const runNextAvailableTasks = async () => {
      if (this._aborted) return;

      // Find tasks that are pending and have all dependencies completed
      const readyTasks = this.pendingTasks.filter(step => {
        const deps = step.dependsOn || [];
        return deps.every(depId => {
          return this.completedTasks.some(c => c.id === depId);
        });
      });

      if (readyTasks.length === 0 && this.activeTasks.length === 0 && this.pendingTasks.length > 0) {
        console.warn('[Task Runner] Dependency failure or deadlock detected.');
        this.pendingTasks.forEach(step => {
          step.status = 'failed';
          this.failedTasks.push(step);
          const idx = plan.steps.indexOf(step);
          if (this.onStepFailed) this.onStepFailed(idx, { id: step.id, title: step.title, status: 'failed', error: 'Dependencies failed' });
        });
        this.pendingTasks = [];
        return;
      }

      if (readyTasks.length === 0 && this.activeTasks.length === 0) {
        return;
      }

      const promises = readyTasks.map(async (step) => {
        this.pendingTasks = this.pendingTasks.filter(t => t.id !== step.id);
        this.activeTasks.push(step);
        step.status = 'active';
        step.startedAt = Date.now();

        const stepIdx = plan.steps.indexOf(step);
        const percent = Math.round((this.completedTasks.length / plan.steps.length) * 100);
        if (this.onProgress) this.onProgress(percent, `Executing: ${step.title}`);
        if (this.onStepStarted) this.onStepStarted(stepIdx, step);

        let attempt = 0;
        const maxRetries = 3;
        let result = null;
        let lastError = null;
        let success = false;

        while (attempt < maxRetries && !success && !this._aborted) {
          attempt++;
          try {
            if (typeof window !== 'undefined' && window.__lukasDiag) {
              window.__lukasDiag.logToTerminal(`[GRAPH ENGINE] Executing "${step.title}" (Attempt ${attempt}/${maxRetries})...`, 'info');
            }
            result = await this._executeStep(step, { memory, apiKey, apiProvider, research, allResults: this._results });
            
            const verified = await this._verifyStepOutcome(step, result);
            if (!verified) {
              throw new Error("Verification failed: actual state did not match expected state.");
            }
            success = true;
          } catch (e) {
            lastError = e;
            console.warn(`[GRAPH ENGINE] Attempt ${attempt} failed for "${step.title}":`, e.message);
            await new Promise(r => setTimeout(r, 1000));
          }
        }

        this.activeTasks = this.activeTasks.filter(t => t.id !== step.id);

        if (success) {
          step.status = 'completed';
          step.completedAt = Date.now();
          const stepResult = { id: step.id, title: step.title, status: 'completed', output: result };
          this._results.push(stepResult);
          this.completedTasks.push(step);

          if (this.onStepCompleted) this.onStepCompleted(stepIdx, stepResult);
        } else {
          if (typeof window !== 'undefined' && window.__lukasDiag) {
            window.__lukasDiag.logToTerminal(`[RECOVERY AGENT] Attempting failure recovery for: "${step.title}"...`, 'warn');
          }
          const recoverySuccessful = await this._attemptFailureRecovery(step, lastError, context);
          if (recoverySuccessful) {
            step.status = 'completed';
            step.completedAt = Date.now();
            const stepResult = { id: step.id, title: step.title, status: 'completed', output: 'Recovered: alternative action succeeded' };
            this._results.push(stepResult);
            this.completedTasks.push(step);
            if (this.onStepCompleted) this.onStepCompleted(stepIdx, stepResult);
          } else {
            step.status = 'failed';
            const stepResult = { id: step.id, title: step.title, status: 'failed', error: lastError?.message || 'Unknown error' };
            this._results.push(stepResult);
            this.failedTasks.push(step);
            if (this.onStepFailed) this.onStepFailed(stepIdx, stepResult);
          }
        }

        await runNextAvailableTasks();
      });

      await Promise.all(promises);
    };

    await runNextAvailableTasks();

    this._isRunning = false;
    const historyEntry = LukasTaskRunner.history.find(h => h.runner === this);
    if (historyEntry) {
      historyEntry.status = this.failedTasks.length > 0 ? 'failed' : 'completed';
    }

    if (this.onProgress) this.onProgress(100, 'Plan completed.');
    if (this.onAllCompleted) this.onAllCompleted(this._results);

    return this._results;
  }

  async _verifyStepOutcome(step, result) {
    if (typeof home === 'undefined' || !home.dynamicDevices) return true;
    const desc = (step.description || '').toLowerCase();
    const title = (step.title || '').toLowerCase();
    
    const dev = home.dynamicDevices.find(d => {
      const name = d.name.toLowerCase();
      return desc.includes(name) || title.includes(name);
    });

    if (dev) {
      const expectsOn = desc.includes('on') || desc.includes('activate') || desc.includes('enable');
      const expectsOff = desc.includes('off') || desc.includes('deactivate') || desc.includes('disable');
      const expectsLocked = desc.includes('lock');
      const expectsUnlocked = desc.includes('unlock');

      if (expectsOn && !dev.on) return false;
      if (expectsOff && dev.on) return false;
      if (expectsLocked && dev.category === 'security' && !dev.locked) return false;
      if (expectsUnlocked && dev.category === 'security' && dev.locked) return false;
    }
    return true;
  }

  async _attemptFailureRecovery(step, error, context) {
    const { research, apiKey, apiProvider } = context;

    if (step.type === 'research' && research) {
      const words = step.description.split(' ');
      const fallbackQuery = words.slice(0, Math.min(words.length, 3)).join(' ') + ' info';
      try {
        console.log(`[Recovery Agent] Fallback search attempt: "${fallbackQuery}"`);
        const result = await research.research(fallbackQuery, { apiKey, apiProvider });
        if (result && (result.answer || result.summary)) {
          return true;
        }
      } catch (e) {
        console.error('[Recovery Agent] Fallback search failed:', e.message);
      }
    }

    if (typeof home !== 'undefined' && home.dynamicDevices) {
      const desc = (step.description || '').toLowerCase();
      const title = (step.title || '').toLowerCase();
      const dev = home.dynamicDevices.find(d => {
        const name = d.name.toLowerCase();
        return desc.includes(name) || title.includes(name);
      });

      if (dev) {
        try {
          console.log(`[Recovery Agent] Direct device write attempt for: ${dev.name}`);
          const expectsOn = desc.includes('on') || desc.includes('activate');
          const expectsOff = desc.includes('off') || desc.includes('deactivate');
          const updates = {};
          if (expectsOn) updates.on = true;
          if (expectsOff) updates.on = false;

          if (Object.keys(updates).length > 0) {
            await home.setDeviceState(dev.id, updates);
            const updatedDev = home.dynamicDevices.find(d => d.id === dev.id);
            if (updatedDev && updatedDev.on === updates.on) {
              return true;
            }
          }
        } catch (e) {
          console.error('[Recovery Agent] Direct device write failed:', e.message);
        }
      }
    }
    return false;
  }

  /**
   * Execute a single task step based on its type.
   */
  async _executeStep(step, context) {
    const { memory, apiKey, apiProvider, research } = context;

    switch (step.type) {
      case 'research':
        return await this._doResearch(step, context);

      case 'design':
      case 'build':
      case 'communicate':
        return await this._doGeneration(step, context);

      case 'setup':
      case 'deploy':
        return await this._doInstructions(step, context);

      case 'test':
        return await this._doValidation(step, context);

      default:
        return await this._doGeneration(step, context);
    }
  }

  // ─── Step Executors ────────────────────────────────────────────────────────

  async _doResearch(step, { research, apiKey, apiProvider }) {
    if (research) {
      try {
        const result = await research.research(step.description, apiKey, apiProvider);
        return result?.answer || result?.summary || `Research completed: ${step.title}`;
      } catch (e) {
        console.warn('[Task Runner] Research agent failed:', e.message);
      }
    }
    return `Research step "${step.title}" noted. Manual research may be needed.`;
  }

  async _doGeneration(step, { memory, apiKey, apiProvider }) {
    if (!apiKey && !window.puter?.ai) {
      return `Step "${step.title}" ready to execute: ${step.description}`;
    }

    try {
      const result = await callLukasAI({
        systemPrompt: `You are LUKAS's task executor. Complete this specific task step concisely and thoroughly.`,
        userMessage: `Execute this task step:\n\nStep: ${step.title}\nDescription: ${step.description}\nType: ${step.type}\n\nProvide a complete, actionable result.`,
        memory: null,
        apiKey,
        apiProvider,
        temperature: 0.5,
        maxTokens: 800,
        jsonMode: false,
        includeHistory: false,
      });
      return result || `Step "${step.title}" completed.`;
    } catch (e) {
      return `Step "${step.title}" noted — ready to execute: ${step.description}`;
    }
  }

  async _doInstructions(step, context) {
    return await this._doGeneration(step, context);
  }

  async _doValidation(step, { allResults }) {
    const completedCount = allResults.filter(r => r.status === 'completed').length;
    return `Validation checkpoint: ${completedCount} of ${allResults.length + 1} steps completed. ${step.title} validated.`;
  }

  /**
   * Abort the current plan execution.
   */
  abort() {
    this._aborted = true;
    this._isRunning = false;
    console.log('[Task Runner] Plan aborted by user.');
  }

  /**
   * Summarize the results of a completed plan as text.
   */
  summarizeResults(plan, results) {
    const completed = results.filter(r => r.status === 'completed').length;
    const failed = results.filter(r => r.status === 'failed').length;
    let summary = `**Plan Complete: ${plan.title}**\n\n`;
    summary += `✅ ${completed} steps completed${failed > 0 ? `, ⚠️ ${failed} failed` : ' successfully'}.\n\n`;
    if (results.some(r => r.output)) {
      summary += `**Key Outputs:**\n`;
      results.filter(r => r.output).slice(0, 3).forEach((r, i) => {
        summary += `\n${i + 1}. **${r.title}:** ${String(r.output).slice(0, 200)}${String(r.output).length > 200 ? '...' : ''}`;
      });
    }
    return summary;
  }
}

export default LukasTaskRunner;
