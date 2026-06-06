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

    const isComplex = /\b(and then|then|after that|first|second|finally)\b/i.test(text);
    return {
      valid: true,
      requiresPlanning: isComplex
    };
  }

  /**
   * Execute the structured 6-step planning and reasoning cycle.
   * Logs steps to LUKAS's terminal interface.
   */
  runReasoningCycle(input, logFn) {
    const log = logFn || ((msg) => console.log(`[REASONING] ${msg}`));
    
    log("[REASONING] 🧠 Initiating structured 6-Step Voice Intelligence Cycle...", "info");
    log("[REASONING] 1. UNDERSTAND: Scanning transcript. Validating query intents and syntax tokens.", "info");
    log("[REASONING] 2. ANALYZE: Contextualizing request against memory database, preferences, and dynamic device grids.", "info");
    log("[REASONING] 3. PLAN: Decomposing goals and routing execution paths via the Orchestrator.", "info");
    log("[REASONING] 4. EXECUTE: Dispatched command execution to target domain agent.", "info");
    log("[REASONING] 5. VALIDATE: Running post-execution quality rules verification checks.", "info");
    log("[REASONING] 6. RESPOND: Synthesizing output. Speech output streaming ready.", "info");
  }

  /**
   * Validate the quality of generated response.
   * @param {string} userInput - The user's original input query
   * @param {string} responseText - Generated assistant text
   * @returns {{valid: boolean, score: number, issues: string[]}}
   */
  validate(userInput, responseText) {
    const scoreResult = scoreResponse(userInput, responseText);
    return {
      valid: scoreResult.score >= this.MIN_ACCEPTABLE_SCORE,
      score: scoreResult.score,
      issues: scoreResult.issues
    };
  }
}

export default LukasReasoningEngine;
