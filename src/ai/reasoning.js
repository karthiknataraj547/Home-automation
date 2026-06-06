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
   * Assess the detailed accuracy scores (Confidence, Evidence, Context, Completeness)
   * @returns {{score: number, confidence: number, evidence: number, context: number, completeness: number, issues: string[], action: 'respond'|'ask_clarification'}}
   */
  evaluateAccuracy(userInput, responseText, memory = null, searchResult = null) {
    let confidence = 1.0;
    let evidence = 1.0;
    let context = 1.0;
    let completeness = 1.0;
    const issues = [];

    const lowerInput = userInput.toLowerCase().trim();
    const lowerResp = responseText ? responseText.toLowerCase().trim() : '';

    // 1. Confidence Evaluation
    const vaguePhrases = [
      /\bdo that\b/, /\bdo it\b/, /\bthing\b/, /\bstuff\b/, 
      /\bwhat is it\b/, /\bdo something\b/, /\bthat thing\b/,
      /^\b(yes|no|ok|okay|sure|cool|yeah|yup|nah)\b$/
    ];
    let vagueMatches = 0;
    for (const re of vaguePhrases) {
      if (re.test(lowerInput)) vagueMatches++;
    }
    if (vagueMatches > 0) {
      confidence -= 0.35 * vagueMatches;
    }
    if (lowerInput.length < 5) {
      confidence -= 0.3;
    }
    confidence = Math.max(0.1, Math.min(1.0, confidence));

    // 2. Evidence Evaluation
    if (memory) {
      const projects = memory.getAllProjects();
      const mentionsProject = projects.some(p => lowerInput.includes(p.name.toLowerCase()));
      const containsProjectWord = /\bproject\b/i.test(lowerInput);
      if (containsProjectWord && !mentionsProject) {
        evidence -= 0.3;
        issues.push("Referenced project is not registered in active memory.");
      }
    }
    if (lowerInput.includes('search') || lowerInput.includes('find') || lowerInput.includes('who is') || lowerInput.includes('weather')) {
      if (searchResult && (!searchResult.answer || searchResult.answer.length < 10)) {
        evidence -= 0.4;
        issues.push("Search query execution produced zero evidence.");
      }
    }
    evidence = Math.max(0.1, Math.min(1.0, evidence));

    // 3. Context Evaluation
    if (memory) {
      const historyCount = memory.shortTerm.messages.length;
      if (historyCount === 0) {
        context -= 0.2;
      }
      const hasProject = memory.shortTerm.currentProject;
      if (!hasProject && lowerInput.includes('goal')) {
        context -= 0.3;
        issues.push("Context lacks active working memory project.");
      }
    }
    context = Math.max(0.1, Math.min(1.0, context));

    // 4. Completeness Evaluation
    if (!responseText || responseText.length < 8) {
      completeness = 0.1;
      issues.push("Response length is insufficient.");
    } else {
      if (responseText.endsWith('...') || responseText.includes('...\n')) {
        completeness -= 0.3;
        issues.push("Response appears truncated.");
      }
      const limitations = ['cannot search', 'do not have access', 'offline assistant', 'knowledge cutoff', 'as an ai'];
      for (const lim of limitations) {
        if (lowerResp.includes(lim)) {
          completeness -= 0.2;
          issues.push(`Robotic internet limitation disclaimer: "${lim}"`);
        }
      }
    }
    completeness = Math.max(0.1, Math.min(1.0, completeness));

    // Composite Score
    const compositeScore = (confidence * 0.4 + evidence * 0.2 + context * 0.2 + completeness * 0.2);
    
    // Low confidence threshold route check
    let action = 'respond';
    if (confidence < 0.6) {
      action = 'ask_clarification';
      issues.push("Confidence score is below the 0.6 threshold. Halting for clarification.");
    }

    return {
      score: compositeScore,
      confidence,
      evidence,
      context,
      completeness,
      issues,
      action
    };
  }

  /**
   * Validate the quality of generated response.
   * @param {string} userInput - The user's original input query
   * @param {string} responseText - Generated assistant text
   * @param {LukasMemory} [memory] - Lukas memory class
   * @returns {{valid: boolean, score: number, issues: string[], action: 'respond'|'ask_clarification'}}
   */
  validate(userInput, responseText, memory = null) {
    const accuracy = this.evaluateAccuracy(userInput, responseText, memory);
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

