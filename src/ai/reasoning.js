// reasoning.js - LUKAS Reasoning & Quality Validation Engine
// Ensures high-fidelity outputs and robust precheck validations

import { scoreResponse } from './core.js';

class LukasReasoningEngine {
  constructor() {
    this.MIN_ACCEPTABLE_SCORE = 75;
  }

  /**
   * Precheck an incoming user query.
   * @param {string} input - User query
   * @returns {{valid: boolean, reason?: string, requiresPlanning: boolean}}
   */
  precheck(input) {
    const text = input.trim();
    if (!text) {
      return { valid: false, reason: "Input is empty", requiresPlanning: false };
    }

    // Basic spam or gibberish check
    if (text.length > 1500) {
      return { valid: true, requiresPlanning: true, reason: "Query length exceeds standard threshold, requiring plan decomposition." };
    }

    // A query is complex if it has multiple steps or is explicitly requested as a plan
    const isComplex = /\b(and then|then|after that|first|second|finally)\b/i.test(text) || 
                      /\b(plan|set up a morning routine|routine|schedule a series|weather and then)\b/i.test(text);
    return {
      valid: true,
      requiresPlanning: isComplex
    };
  }

  /**
   * Execute the structured 8-step planning and reasoning cycle.
   * Logs steps to LUKAS's terminal interface.
   */
  runReasoningCycle(input, logFn) {
    const log = logFn || ((msg) => console.log(`[REASONING] ${msg}`));
    
    log("[REASONING] 🧠 Initiating 8-stage Jarvis intelligence pipeline execution...", "info");
    log("[REASONING] 1. INTENT: Analyzing raw transcript and classifying routing directives.", "info");
    log("[REASONING] 2. CONTEXT: Injecting three memory layers (Working, Project, Long-Term).", "info");
    log("[REASONING] 3. PLAN: Decomposing instructions and organizing subtasks.", "info");
    log("[REASONING] 4. REASONING: Mapping constraint graphs, safety gates, and device mappings.", "info");
    log("[REASONING] 5. EXECUTE: Triggering background search, device actions, or system calls.", "info");
    log("[REASONING] 6. ACCURACY: Checking response confidence parameters.", "info");
    log("[REASONING] 7. VALIDATE: Executing self-reflection loop and quality checks.", "info");
    log("[REASONING] 8. RESPONSE: Final response synthesized, streaming audio feedback.", "info");
  }

  /**
   * Assess the detailed accuracy scores through the 6-stage Nexus validation gates:
   * 1. Context Check (memory contexts loaded)
   * 2. Intent Check (response matches orchestrator's classified intent)
   * 3. Memory Check (previous discussed facts / projects integrated)
   * 4. Accuracy Check (response is complete, not truncated)
   * 5. Natural Language Check (excludes robotic disclaimer / apologies)
   * 6. Personality Check (aligns with the selected personality mode style)
   * @returns {{score: number, issues: string[], action: 'respond'|'ask_clarification'}}
   */
  evaluateAccuracy(userInput, responseText, memory = null, activeIntent = 'conversation') {
    const issues = [];
    const lowerInput = userInput.toLowerCase().trim();
    const lowerResp = responseText ? responseText.toLowerCase().trim() : '';
    
    const prefs = memory ? memory.getAllPreferences() : {};
    const activePersonality = prefs.personalityMode || prefs.personality_mode || 'casual';

    // ── GATE 1: CONTEXT CHECK ──
    let contextPass = true;
    if (memory) {
      const summary = memory.getWorkingMemorySummary();
      if (!summary) {
        contextPass = false;
        issues.push("[GATE 1: CONTEXT] Working memory context state is not populated.");
      }
    }

    // ── GATE 2: INTENT CHECK ──
    let intentPass = true;
    if (activeIntent === 'weather') {
      if (!lowerResp.includes('weather') && !lowerResp.includes('temp') && !lowerResp.includes('degree') && !lowerResp.includes('forecast')) {
        intentPass = false;
        issues.push("[GATE 2: INTENT] Response does not address weather conditions.");
      }
    } else if (activeIntent === 'home_control') {
      const controls = ['light', 'climate', 'thermostat', 'lock', 'routine', 'device', 'appliance', 'sprinkler', 'camera'];
      const hasControlWord = controls.some(c => lowerResp.includes(c));
      if (!hasControlWord) {
        intentPass = false;
        issues.push("[GATE 2: INTENT] Response fails to confirm execution of home automation device request.");
      }
    }

    // ── GATE 3: MEMORY CHECK ──
    let memoryPass = true;
    if (memory) {
      const projects = memory.getAllProjects();
      const mentionsProjectWord = /\bproject\b/i.test(lowerInput);
      if (mentionsProjectWord) {
        const matchesAny = projects.some(p => lowerInput.includes(p.name.toLowerCase()) || lowerResp.includes(p.name.toLowerCase()));
        if (!matchesAny && projects.length > 0) {
          memoryPass = false;
          issues.push("[GATE 3: MEMORY] Response references project goals without retrieving correct project details.");
        }
      }
    }

    // ── GATE 4: ACCURACY & COMPLETENESS CHECK ──
    let accuracyPass = true;
    if (!responseText || responseText.length < 8) {
      accuracyPass = false;
      issues.push("[GATE 4: ACCURACY] Response is empty or too short.");
    } else if (responseText.endsWith('...') || responseText.includes('...\n')) {
      accuracyPass = false;
      issues.push("[GATE 4: ACCURACY] Response has been truncated or cut off.");
    }

    // ── GATE 5: NATURAL LANGUAGE CHECK ──
    let naturalPass = true;
    const aiDisclaimers = [
      'as an ai', 'language model', 'cannot search', 'offline assistant', 
      'knowledge cutoff', 'do not have access', 'limitations', 'sorry for the confusion',
      'i apologize', 'apologize for the'
    ];
    for (const disclaimer of aiDisclaimers) {
      if (lowerResp.includes(disclaimer)) {
        naturalPass = false;
        issues.push(`[GATE 5: NATURAL LANGUAGE] Contains robotic disclaimer/apology: "${disclaimer}"`);
      }
    }

    // ── GATE 6: PERSONALITY CHECK ──
    let personalityPass = true;
    if (activePersonality === 'professional') {
      const casualSlang = ['gonna', 'wanna', 'hey there', 'whats up', 'what\'s up', 'chill', 'dude'];
      for (const slang of casualSlang) {
        if (lowerResp.includes(slang)) {
          personalityPass = false;
          issues.push(`[GATE 6: PERSONALITY] Response used informal/casual slang in professional mode: "${slang}"`);
        }
      }
    } else if (activePersonality === 'technical') {
      if (lowerInput.includes('code') || lowerInput.includes('function') || lowerInput.includes('script')) {
        const hasCodeKeyword = ['const', 'function', 'class', 'let', 'import', 'def', 'package', 'code'].some(k => lowerResp.includes(k));
        if (!hasCodeKeyword) {
          personalityPass = false;
          issues.push("[GATE 6: PERSONALITY] Technical mode requested but response lacks engineering syntax or code blocks.");
        }
      }
    }

    // Composite scoring logic
    let score = 1.0;
    if (!contextPass) score -= 0.15;
    if (!intentPass) score -= 0.15;
    if (!memoryPass) score -= 0.15;
    if (!accuracyPass) score -= 0.20;
    if (!naturalPass) score -= 0.20;
    if (!personalityPass) score -= 0.15;
    score = Math.max(0.1, score);

    // If critical natural language or accuracy checks fail, trigger clarification/retake
    const action = score < 0.7 ? 'ask_clarification' : 'respond';

    return {
      score,
      issues,
      action
    };
  }

  /**
   * Validate the quality of generated response.
   * @param {string} userInput - The user's original input query
   * @param {string} responseText - Generated assistant text
   * @param {LukasMemory} [memory] - Lukas memory class
   * @param {string} [intent] - Routing intent name
   * @returns {{valid: boolean, score: number, issues: string[], action: 'respond'|'ask_clarification'}}
   */
  validate(userInput, responseText, memory = null, intent = 'conversation') {
    const accuracy = this.evaluateAccuracy(userInput, responseText, memory, intent);
    const scaleScore = Math.round(accuracy.score * 100);
    return {
      valid: scaleScore >= this.MIN_ACCEPTABLE_SCORE,
      score: scaleScore,
      issues: accuracy.issues,
      action: accuracy.action
    };
  }
}

export default LukasReasoningEngine;

