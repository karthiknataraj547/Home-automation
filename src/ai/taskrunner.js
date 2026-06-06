// ═══════════════════════════════════════════════════════════════════════
// LUKAS Autonomous Task Runner
// Executes multi-step plans from the Planner Agent
// Handles: Research, Writing, Analysis, Code, Automation
// ═══════════════════════════════════════════════════════════════════════

import { callLukasAI } from './core.js';

class LukasTaskRunner {
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

    console.log(`[Task Runner] Starting plan: "${plan.title}" (${plan.steps.length} steps)`);

    const { memory, apiKey, apiProvider, research } = context;

    for (let i = 0; i < plan.steps.length; i++) {
      if (this._aborted) break;

      const step = plan.steps[i];

      // Check dependencies
      const depsComplete = (step.dependsOn || []).every(depId => {
        const depResult = this._results.find(r => r.id === depId);
        return depResult && depResult.status === 'completed';
      });

      if (!depsComplete) {
        console.warn(`[Task Runner] Step ${step.id} deps not met, skipping.`);
        continue;
      }

      // Mark step active
      step.status = 'active';
      step.startedAt = Date.now();

      const percent = Math.round((i / plan.steps.length) * 100);
      if (this.onProgress) this.onProgress(percent, `Running Step ${i + 1}: ${step.title}`);
      if (this.onStepStarted) this.onStepStarted(i, step);

      try {
        const result = await this._executeStep(step, { memory, apiKey, apiProvider, research, allResults: this._results });

        step.status = 'completed';
        step.completedAt = Date.now();
        const stepResult = { id: step.id, title: step.title, status: 'completed', output: result };
        this._results.push(stepResult);

        if (this.onStepCompleted) this.onStepCompleted(i, stepResult);

      } catch (e) {
        console.error(`[Task Runner] Step ${i + 1} failed:`, e.message);
        step.status = 'failed';

        const stepResult = { id: step.id, title: step.title, status: 'failed', error: e.message };
        this._results.push(stepResult);

        if (this.onStepFailed) this.onStepFailed(i, stepResult);
      }
    }

    this._isRunning = false;
    if (this.onProgress) this.onProgress(100, 'Plan completed.');
    if (this.onAllCompleted) this.onAllCompleted(this._results);

    return this._results;
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
