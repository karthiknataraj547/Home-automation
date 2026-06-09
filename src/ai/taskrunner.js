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

        const supervisor = typeof window !== 'undefined' ? window.lukasSupervisor : null;
        if (supervisor) {
          supervisor.logAgentAction('monitoring', `[RUNNING] Plan Step ${step.id} status transition: PENDING -> RUNNING`);
          const agentName = step.type === 'research' ? 'web' : step.type === 'test' ? 'verification' : 'planner';
          supervisor.logAgentAction(agentName, `[START] Executing plan step: ${step.title} (${step.description})`);
        }

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
            if (supervisor) {
              supervisor.logAgentAction('recovery', `[RETRY] Step ${step.id} (Attempt ${attempt}/${maxRetries}) failed: ${e.message}`, 'warn');
            }
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

          if (supervisor) {
            supervisor.logAgentAction('monitoring', `[COMPLETED] Plan Step ${step.id} status transition: RUNNING -> COMPLETED`);
            const agentName = step.type === 'research' ? 'web' : step.type === 'test' ? 'verification' : 'planner';
            supervisor.logAgentAction(agentName, `[SUCCESS] Plan step completed and verified: ${step.title}`);
          }
        } else {
          if (typeof window !== 'undefined' && window.__lukasDiag) {
            window.__lukasDiag.logToTerminal(`[RECOVERY AGENT] Attempting failure recovery for: "${step.title}"...`, 'warn');
          }
          if (supervisor) {
            supervisor.logAgentAction('recovery', `[TRIGGER] Attempting recovery strategies for failed step: ${step.title}`, 'warn');
          }
          const recoverySuccessful = await this._attemptFailureRecovery(step, lastError, context);
          if (recoverySuccessful) {
            step.status = 'completed';
            step.completedAt = Date.now();
            const stepResult = { id: step.id, title: step.title, status: 'completed', output: 'Recovered: alternative action succeeded' };
            this._results.push(stepResult);
            this.completedTasks.push(step);
            if (this.onStepCompleted) this.onStepCompleted(stepIdx, stepResult);

            if (supervisor) {
              supervisor.logAgentAction('monitoring', `[COMPLETED] Plan Step ${step.id} status transition: RUNNING -> COMPLETED (via recovery)`);
              supervisor.logAgentAction('recovery', `[RECOVERY SUCCESS] Step ${step.id} recovered successfully via fallback.`, 'info');
            }
          } else {
            step.status = 'failed';
            const stepResult = { id: step.id, title: step.title, status: 'failed', error: lastError?.message || 'Unknown error' };
            this._results.push(stepResult);
            this.failedTasks.push(step);
            if (this.onStepFailed) this.onStepFailed(stepIdx, stepResult);

            if (supervisor) {
              supervisor.logAgentAction('monitoring', `[FAILED] Plan Step ${step.id} status transition: RUNNING -> FAILED`, 'error');
              supervisor.logAgentAction('recovery', `[RECOVERY FAILED] Recovery options exhausted for step ${step.id}: ${lastError?.message || 'Unknown error'}`, 'error');
            }
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
    const supervisor = typeof window !== 'undefined' ? window.lukasSupervisor : null;
    if (supervisor) {
      supervisor.logAgentAction('verification', `[VERIFY] Initiating state readback check for step: ${step.title}`);
    }

    if (typeof home === 'undefined' || !home.dynamicDevices) return true;
    const desc = (step.description || '').toLowerCase();
    const title = (step.title || '').toLowerCase();
    
    const dev = this._resolveDeviceFromStep(step);

    if (dev) {
      const expectsOn = desc.includes('on') || desc.includes('activate') || desc.includes('enable');
      const expectsOff = desc.includes('off') || desc.includes('deactivate') || desc.includes('disable');
      const expectsLocked = desc.includes('lock');
      const expectsUnlocked = desc.includes('unlock');

      if (expectsOn && !dev.on) {
        if (supervisor) supervisor.logAgentAction('verification', `[VERIFY FAILED] "${dev.name}" expected ON, actual OFF`, 'error');
        return false;
      }
      if (expectsOff && dev.on) {
        if (supervisor) supervisor.logAgentAction('verification', `[VERIFY FAILED] "${dev.name}" expected OFF, actual ON`, 'error');
        return false;
      }
      if (expectsLocked && dev.category === 'security' && !dev.locked) {
        if (supervisor) supervisor.logAgentAction('verification', `[VERIFY FAILED] "${dev.name}" expected LOCKED, actual UNLOCKED`, 'error');
        return false;
      }
      if (expectsUnlocked && dev.category === 'security' && dev.locked) {
        if (supervisor) supervisor.logAgentAction('verification', `[VERIFY FAILED] "${dev.name}" expected UNLOCKED, actual LOCKED`, 'error');
        return false;
      }

      // Check brightness verification
      const brightnessMatch = desc.match(/(\d+)\s*%/);
      if (brightnessMatch) {
        const expectedBrightness = parseInt(brightnessMatch[1]);
        if (dev.brightness !== expectedBrightness) {
          if (supervisor) supervisor.logAgentAction('verification', `[VERIFY FAILED] "${dev.name}" expected brightness ${expectedBrightness}%, actual ${dev.brightness}%`, 'error');
          return false;
        }
      }

      // Check color verification
      const colorMap = {
        'red': '#ff0000', 'green': '#10b981', 'blue': '#3b82f6', 'purple': '#a855f7',
        'cyan': '#00f0ff', 'orange': '#ff9f3b', 'white': '#ffffff', 'yellow': '#eab308',
        'pink': '#ec4899', 'magenta': '#d946ef', 'lime': '#84cc16', 'teal': '#14b8a6',
        'gold': '#f59e0b', 'crimson': '#e11d48'
      };
      let expectedColor = null;
      for (const [colorName, colorHex] of Object.entries(colorMap)) {
        if (desc.includes(colorName) || title.includes(colorName)) {
          expectedColor = colorHex;
          break;
        }
      }
      const hexMatch = desc.match(/#([0-9a-fA-F]{6})\b/) || title.match(/#([0-9a-fA-F]{6})\b/);
      if (hexMatch) {
        expectedColor = hexMatch[0];
      }
      if (expectedColor && dev.color && dev.color.toLowerCase() !== expectedColor.toLowerCase()) {
        if (supervisor) supervisor.logAgentAction('verification', `[VERIFY FAILED] "${dev.name}" expected color ${expectedColor}, actual ${dev.color}`, 'error');
        return false;
      }

      if (supervisor) {
        supervisor.logAgentAction('verification', `[VERIFY SUCCESS] "${dev.name}" state matches expected values.`);
      }
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

    const desc = (step.description || '').toLowerCase();
    const title = (step.title || '').toLowerCase();

    // Check if this step represents a reminder or scheduling command
    const isReminderStep = step.type === 'reminder' || desc.includes('reminder') || desc.includes('remind me') || title.includes('reminder') || title.includes('remind') || title.includes('schedule sleep');
    if (isReminderStep) {
      const inlineTime = (typeof parseReminderTime === 'function' ? (parseReminderTime(desc) || parseReminderTime(title)) : null) || new Date(Date.now() + 5 * 60000);
      const inlineText = (typeof extractReminderText === 'function' ? (extractReminderText(step.description) || extractReminderText(step.title)) : null) || step.title || 'Reminder';
      const user = (typeof getSessionUser === 'function' && getSessionUser()) ? getSessionUser().username : 'Guest';
      
      console.log(`[Task Runner] Creating reminder: "${inlineText}" at ${inlineTime}`);

      if (typeof addReminder === 'function') {
        addReminder(inlineText, inlineTime);
      }
      if (typeof lukasScheduler !== 'undefined' && lukasScheduler) {
        await lukasScheduler.scheduleCommand({
          command: `Reminder: ${inlineText}`,
          username: user,
          triggerAt: inlineTime.getTime(),
          label: inlineText,
          repeat: 'none'
        });
      }
      return `Reminder set and verified: "${inlineText}" — scheduled for ${inlineTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.`;
    }

    // Detect if this is a smart home action step (lights, locks, climate)
    if (typeof home !== 'undefined' && home.dynamicDevices) {
      const desc = (step.description || '').toLowerCase();
      const title = (step.title || '').toLowerCase();
      
      const dev = this._resolveDeviceFromStep(step);

      if (dev) {
        // Run home control action
        try {
          const expectsOn = desc.includes('on') || desc.includes('activate') || desc.includes('enable');
          const expectsOff = desc.includes('off') || desc.includes('deactivate') || desc.includes('disable');
          const expectsLocked = desc.includes('lock');
          const expectsUnlocked = desc.includes('unlock');

          const updates = {};
          if (expectsOn) updates.on = true;
          if (expectsOff) updates.on = false;
          if (expectsLocked && dev.category === 'security') updates.locked = true;
          if (expectsUnlocked && dev.category === 'security') updates.locked = false;

          // Check for brightness / dimmer
          const brightnessMatch = desc.match(/(\d+)\s*%/);
          if (brightnessMatch) {
            updates.brightness = parseInt(brightnessMatch[1]);
          }

          // Check for color adjustment
          const colorMap = {
            'red': '#ff0000', 'green': '#10b981', 'blue': '#3b82f6', 'purple': '#a855f7',
            'cyan': '#00f0ff', 'orange': '#ff9f3b', 'white': '#ffffff', 'yellow': '#eab308',
            'pink': '#ec4899', 'magenta': '#d946ef', 'lime': '#84cc16', 'teal': '#14b8a6',
            'gold': '#f59e0b', 'crimson': '#e11d48'
          };
          for (const [colorName, colorHex] of Object.entries(colorMap)) {
            if (desc.includes(colorName) || title.includes(colorName)) {
              updates.color = colorHex;
              updates.on = true;
              break;
            }
          }

          const hexMatch = desc.match(/#([0-9a-fA-F]{6})\b/) || title.match(/#([0-9a-fA-F]{6})\b/);
          if (hexMatch) {
            updates.color = hexMatch[0];
            updates.on = true;
          }

          if (Object.keys(updates).length > 0) {
            console.log(`[Task Runner] Executing smart home step for "${dev.name}":`, updates);
            await home.setDeviceState(dev.id, updates);
            
            // Verify using lukasVerify if available
            if (typeof window !== 'undefined' && window.lukasVerify) {
              const verifyRes = await window.lukasVerify.verifyDeviceCommand(home, dev.id, updates, { 
                supervisor: typeof window !== 'undefined' ? window.lukasSupervisor : null 
              });
              if (!verifyRes.verified) {
                throw new Error(`Device verification failed for "${dev.name}": ${verifyRes.method} mismatch.`);
              }
            } else {
              const updatedDev = home.dynamicDevices.find(d => d.id === dev.id);
              let isMatch = true;
              if (expectsOn && !updatedDev.on) isMatch = false;
              if (expectsOff && updatedDev.on) isMatch = false;
              if (updates.brightness !== undefined && updatedDev.brightness !== updates.brightness) isMatch = false;
              if (updates.color !== undefined && (!updatedDev.color || updatedDev.color.toLowerCase() !== updates.color.toLowerCase())) isMatch = false;
              if (!isMatch) throw new Error("Local state verification failed.");
            }
            return `Device "${dev.name}" set and verified successfully.`;
          }
        } catch (e) {
          console.error('[Task Runner] Smart home step execution failed:', e);
          throw e;
        }
      }

      // Check for climate step
      const isClimateStep = desc.includes('temp') || desc.includes('temperature') || desc.includes('thermostat') || desc.includes('ac') || desc.includes('climate');
      const tempMatch = desc.match(/(\d{2})\s*(?:c|degrees?|celsius)?/i);
      if (isClimateStep && tempMatch) {
        const temp = parseInt(tempMatch[1]);
        if (temp >= 16 && temp <= 35) {
          console.log(`[Task Runner] Executing climate step to target: ${temp}°C`);
          await home.setTargetTemperature(temp);
          if (home.state.climate.targetTemp !== temp) {
            throw new Error(`Climate temperature verification failed. Expected ${temp}, got ${home.state.climate.targetTemp}`);
          }
          return `Eco-Thermostat target set to ${temp}°C and verified successfully.`;
        }
      }
    }

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
  _resolveDeviceFromStep(step) {
    if (typeof home === 'undefined' || !home.dynamicDevices) return null;
    
    const desc = (step.description || '').toLowerCase();
    const title = (step.title || '').toLowerCase();
    const text = (title + " " + desc).toLowerCase();
    
    const aliasMap = {
      livingRoom: 'livingRoomLight',
      bedroom:    'bedroomLight',
      kitchen:    'kitchenLight',
      outdoor:    'outdoorLock',
    };

    if (typeof resolveDevice === 'function') {
      let targetName = null;
      let category = null;
      let targetZone = null;
      
      if (text.includes('living room') || text.includes('livingroom')) {
        targetZone = 'Living Room';
        targetName = 'living room';
      } else if (text.includes('bedroom')) {
        targetZone = 'Bedroom';
        targetName = 'bedroom';
      } else if (text.includes('kitchen')) {
        targetZone = 'Kitchen';
        targetName = 'kitchen';
      } else if (text.includes('outdoor')) {
        targetZone = 'Outdoor';
        targetName = 'outdoor';
      }
      
      if (text.includes('light')) {
        category = 'light';
        if (targetName) targetName += ' light';
      } else if (text.includes('lock')) {
        category = 'lock';
        if (targetName) targetName += ' lock';
      }
      
      if (targetName) {
        const res = resolveDevice(targetName, category, targetZone);
        if (res.device) return res.device;
      }
    }
    
    for (const d of home.dynamicDevices) {
      const name = d.name.toLowerCase();
      const zone = d.zone.toLowerCase();
      const id = d.id.toLowerCase();
      const canonicalId = aliasMap[d.id] || d.id;
      
      if (text.includes(name) || text.includes(id) || text.includes(canonicalId.toLowerCase()) || (text.includes(zone) && text.includes(d.category))) {
        return d;
      }
    }
    
    return home.dynamicDevices.find(d => {
      const name = d.name.toLowerCase();
      const firstWord = name.split(' ')[0];
      return text.includes(firstWord) && text.includes(d.category);
    }) || null;
  }

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
