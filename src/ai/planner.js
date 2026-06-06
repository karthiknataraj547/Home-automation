// ═══════════════════════════════════════════════════════════════════════
// LUKAS Planner Agent — Executive Task Decomposition Engine
// Converts complex requests into structured, actionable step plans
// Emits progress events for real-time UI display
// ═══════════════════════════════════════════════════════════════════════

import { callLukasAI } from './core.js';

class LukasPlannerAgent {
  constructor() {
    this.onPlanCreated = null;    // Callback when plan is ready: (plan) => void
    this.onStepStarted = null;    // Callback when step starts: (stepIdx, step) => void
    this.onStepCompleted = null;  // Callback when step completes: (stepIdx, result) => void
    this.onPlanCompleted = null;  // Callback when full plan done: (plan) => void

    // Plan complexity thresholds
    this.COMPLEX_INTENT_TYPES = new Set([
      'planning', 'task_execution', 'project_management', 'research', 'build'
    ]);

    // Trigger words that force planner mode
    this.COMPLEX_TRIGGER_PATTERNS = [
      /\b(build|create|set up|establish|design|develop|launch|deploy|configure)\b/i,
      /\b(plan|roadmap|strategy|blueprint|schedule|organize)\b/i,
      /\b(website|app|store|system|platform|automation|workflow)\b/i,
      /\b(step by step|guide me|help me|walk me through|how do i)\b/i,
      /\b(project|milestone|checklist|action items)\b/i,
    ];
  }

  /**
   * Determine if a command needs the planner agent.
   * @param {string} text - User's command text
   * @param {string} intent - Classified intent from orchestrator
   * @returns {boolean}
   */
  needsPlanning(text, intent = '') {
    if (this.COMPLEX_INTENT_TYPES.has(intent)) return true;
    return this.COMPLEX_TRIGGER_PATTERNS.some(re => re.test(text));
  }

  /**
   * Generate a structured executive plan for a complex request.
   * Returns a PlanResult object with steps, estimate, and risks.
   *
   * @param {string} userRequest - What the user wants to accomplish
   * @param {object} memory - LukasMemory instance
   * @param {string} apiKey - AI API key
   * @param {string} apiProvider - 'openai' | 'gemini'
   * @returns {Promise<PlanResult>}
   */
  async createPlan(userRequest, memory = null, apiKey = null, apiProvider = 'openai') {
    console.log(`[LUKAS Planner] Creating plan for: "${userRequest}"`);

    const userName = memory?.getFact('name') || 'Commander';
    const currentProject = memory?.shortTerm?.currentProject;
    const contextBlock = memory ? memory.buildContextBlock() : '';

    const systemPrompt = `You are LUKAS's Executive Planner Agent. Your job is to break down complex user requests into clear, actionable step-by-step plans.

You MUST return a valid JSON object in this exact format:
{
  "title": "<Short plan title>",
  "objective": "<One sentence: what success looks like>",
  "estimate": "<Realistic time estimate: '2 hours', '3 days', etc.>",
  "steps": [
    {
      "id": 1,
      "title": "<Step title>",
      "description": "<What to do in this step>",
      "type": "research|design|setup|build|test|deploy|communicate",
      "duration": "<e.g. 30 mins>",
      "dependsOn": []
    }
  ],
  "risks": ["<Risk 1>", "<Risk 2>"],
  "nextAction": "<The single most important thing to do RIGHT NOW>"
}

Rules:
- Steps should be concrete and actionable (3-8 steps ideal)
- Duration should be realistic
- nextAction should be immediately executable
- risks should be genuine blockers or considerations
- Return ONLY valid JSON, no extra text`;

    const userPrompt = `Create an executive plan for this request from ${userName}:

"${userRequest}"
${currentProject ? `\nActive Project Context: ${currentProject}` : ''}
${contextBlock ? `\nUser Context:\n${contextBlock}` : ''}

Return the complete JSON plan.`;

    try {
      const result = await callLukasAI({
        systemPrompt,
        userMessage: userPrompt,
        memory: null,
        apiKey,
        apiProvider,
        temperature: 0.4,
        maxTokens: 1200,
        jsonMode: true,
        includeHistory: false,
      });

      if (!result) throw new Error('No response from AI');

      const plan = JSON.parse(result);
      if (!plan.steps || !Array.isArray(plan.steps)) {
        throw new Error('Invalid plan structure');
      }

      // Add status tracking to each step
      plan.steps = plan.steps.map((step, i) => ({
        ...step,
        id: i + 1,
        status: 'pending', // pending | active | completed | failed
        startedAt: null,
        completedAt: null,
      }));
      plan.createdAt = Date.now();
      plan.status = 'ready';

      console.log(`[LUKAS Planner] Plan created: "${plan.title}" (${plan.steps.length} steps, ~${plan.estimate})`);

      if (this.onPlanCreated) this.onPlanCreated(plan);
      return plan;

    } catch (e) {
      console.warn('[LUKAS Planner] AI plan generation failed, using fallback:', e.message);
      return this._buildFallbackPlan(userRequest);
    }
  }

  /**
   * Format a plan as a readable chat response.
   */
  formatPlanAsText(plan) {
    if (!plan) return 'Plan generation failed.';

    let text = `**${plan.title}**\n\n`;
    text += `📋 **Objective:** ${plan.objective}\n`;
    text += `⏱️ **Estimate:** ${plan.estimate}\n\n`;
    text += `**Step-by-Step Plan:**\n`;
    plan.steps.forEach((step, i) => {
      text += `\n${i + 1}. **${step.title}**\n   ${step.description} *(${step.duration})*`;
    });
    if (plan.risks && plan.risks.length > 0) {
      text += `\n\n⚠️ **Watch Out For:**\n`;
      plan.risks.forEach(r => { text += `• ${r}\n`; });
    }
    text += `\n\n✅ **Start here:** ${plan.nextAction}`;
    return text;
  }

  // ─── Fallback plan when AI is unavailable ─────────────────────────────────

  _buildFallbackPlan(userRequest) {
    const req = userRequest.toLowerCase();
    let steps = [];
    let title = 'Action Plan';

    if (req.includes('website') || req.includes('store') || req.includes('web')) {
      title = 'Website Development Plan';
      steps = [
        { id: 1, title: 'Define Requirements', description: 'Document goals, features, and target audience', type: 'design', duration: '1 hour', dependsOn: [], status: 'pending' },
        { id: 2, title: 'Choose Tech Stack', description: 'Select framework, hosting, and domain', type: 'setup', duration: '30 mins', dependsOn: [1], status: 'pending' },
        { id: 3, title: 'Design UI/UX', description: 'Create wireframes and visual design', type: 'design', duration: '2 hours', dependsOn: [1], status: 'pending' },
        { id: 4, title: 'Build Core Pages', description: 'Develop home, product, and checkout pages', type: 'build', duration: '4 hours', dependsOn: [2, 3], status: 'pending' },
        { id: 5, title: 'Test & QA', description: 'Test all flows on mobile and desktop', type: 'test', duration: '1 hour', dependsOn: [4], status: 'pending' },
        { id: 6, title: 'Deploy & Launch', description: 'Publish to production and announce', type: 'deploy', duration: '30 mins', dependsOn: [5], status: 'pending' },
      ];
    } else if (req.includes('app') || req.includes('application')) {
      title = 'App Development Plan';
      steps = [
        { id: 1, title: 'Scope & Requirements', description: 'Define features and user stories', type: 'design', duration: '1 hour', dependsOn: [], status: 'pending' },
        { id: 2, title: 'Architecture Design', description: 'Plan data models and system architecture', type: 'design', duration: '1 hour', dependsOn: [1], status: 'pending' },
        { id: 3, title: 'Build MVP', description: 'Implement core features', type: 'build', duration: '1 day', dependsOn: [2], status: 'pending' },
        { id: 4, title: 'Test & Fix', description: 'QA testing and bug fixes', type: 'test', duration: '2 hours', dependsOn: [3], status: 'pending' },
        { id: 5, title: 'Launch', description: 'Deploy and share with users', type: 'deploy', duration: '30 mins', dependsOn: [4], status: 'pending' },
      ];
    } else {
      steps = [
        { id: 1, title: 'Research & Analysis', description: 'Gather information and understand requirements', type: 'research', duration: '30 mins', dependsOn: [], status: 'pending' },
        { id: 2, title: 'Plan & Design', description: 'Create a detailed approach and design', type: 'design', duration: '30 mins', dependsOn: [1], status: 'pending' },
        { id: 3, title: 'Execute', description: 'Implement the solution', type: 'build', duration: '1 hour', dependsOn: [2], status: 'pending' },
        { id: 4, title: 'Review & Validate', description: 'Test and verify the outcome', type: 'test', duration: '30 mins', dependsOn: [3], status: 'pending' },
      ];
    }

    return {
      title,
      objective: `Successfully complete: ${userRequest}`,
      estimate: `${Math.ceil(steps.length * 0.75)} hours`,
      steps,
      risks: ['Requirements may change', 'External dependencies could cause delays'],
      nextAction: steps[0]?.description || 'Begin with research and planning',
      createdAt: Date.now(),
      status: 'ready',
    };
  }
}

export default LukasPlannerAgent;
