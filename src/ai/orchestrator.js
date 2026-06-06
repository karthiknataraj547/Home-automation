// ═══════════════════════════════════════════════════════════════════════
// LUKAS Orchestrator — Intent Classification, Task Planning & Agent Routing
// The central nervous system that decides HOW to handle every request
// ═══════════════════════════════════════════════════════════════════════

/**
 * Intent categories LUKAS can classify
 */
export const INTENT = {
  HOME_CONTROL:    'home_control',    // Device/light/climate/security commands
  RESEARCH:        'research',        // Web search, Wikipedia, fact-lookup
  TASK_EXECUTION:  'task_execution',  // Write, generate, code, analyze
  AUTOMATION:      'automation',      // Schedule, remind, workflow, routine
  WEATHER:         'weather',         // Weather queries
  MEDIA:           'media',           // Music, volume, playback
  MEMORY_QUERY:    'memory_query',    // "What did I say?", "Do you remember?"
  PLANNING:        'planning',        // Multi-step project planning
  ANALYSIS:        'analysis',        // Data analysis, comparisons
  MATH:            'math',            // Calculations
  CONVERSATION:    'conversation',    // General chat, questions, discussions
  SYSTEM:          'system',          // LUKAS settings, diagnostics
  UNKNOWN:         'unknown',
};

/**
 * Confidence levels for routing decisions
 */
const CONFIDENCE = {
  HIGH:   0.85,
  MEDIUM: 0.60,
  LOW:    0.35,
};

class LukasOrchestrator {
  constructor(memory) {
    this.memory = memory;
    this.API_TIMEOUT = 12000; // 12 seconds — up from previous 2s
  }

  // ─── Main Entry Point ────────────────────────────────────────────────────

  /**
   * Analyze a user request and return a routing decision.
   * Uses lightweight local rules first, then AI for ambiguous cases.
   */
  async analyze(userInput, homeContext = '', apiKey = null, apiProvider = 'openai') {
    const input = userInput.trim();

    // 1. Try fast rule-based classification first
    const ruleResult = this._classifyByRules(input);
    if (ruleResult.confidence >= CONFIDENCE.HIGH) {
      console.log(`[Orchestrator] Rule-based: ${ruleResult.intent} (${Math.round(ruleResult.confidence * 100)}%)`);
      return ruleResult;
    }

    // 2. Fall back to AI classification for ambiguous inputs
    if (apiKey) {
      try {
        const aiResult = await this._classifyWithAI(input, homeContext, apiKey, apiProvider);
        if (aiResult) {
          console.log(`[Orchestrator] AI-classified: ${aiResult.intent} (${Math.round((aiResult.confidence||0.8) * 100)}%)`);
          return aiResult;
        }
      } catch (e) {
        console.warn('[Orchestrator] AI classification failed, using rules:', e.message);
      }
    }

    // 3. Return rule result even if medium confidence
    return ruleResult;
  }

  // ─── Rule-Based Classification (Fast, Zero API cost) ─────────────────────

  _classifyByRules(input) {
    const text = input.toLowerCase();

    // Memory queries
    if (/do you remember|what did (i|we)|earlier you said|you mentioned|recall|from our (last|previous)|what was I asking|my name is|you know (my|me)/i.test(text)) {
      return { intent: INTENT.MEMORY_QUERY, confidence: 0.92, subtasks: ['recall_context'] };
    }

    // Home control — very high signal words
    const homePatterns = /\b(turn (on|off)|switch (on|off)|set (the )?light|dim|brightness|color|temperature|thermostat|lock|unlock|arm|disarm|routine|scene|mode|fan|ac|aircon|heater|sprinkler|water the|living room|bedroom|kitchen|outdoor|garage)\b/i;
    if (homePatterns.test(text)) {
      return { intent: INTENT.HOME_CONTROL, confidence: 0.93, subtasks: ['parse_device_command'] };
    }

    // Weather
    if (/\b(weather|temperature outside|forecast|rain|humidity|wind|feels like|how (hot|cold)|what'?s the (temp|weather))\b/i.test(text)) {
      return { intent: INTENT.WEATHER, confidence: 0.92, subtasks: ['fetch_weather'] };
    }

    // Media control
    if (/\b(play|pause|stop|skip|next track|previous|volume|mute|unmute|shuffle|playlist|music|song|spotify|youtube)\b/i.test(text)) {
      return { intent: INTENT.MEDIA, confidence: 0.90, subtasks: ['media_control'] };
    }

    // Reminders & Automation
    if (/\b(remind me|set (a )?reminder|schedule|alarm at|add (a )?task|don't (let me) forget|notify me|automate|workflow|trigger)\b/i.test(text)) {
      return { intent: INTENT.AUTOMATION, confidence: 0.91, subtasks: ['create_reminder'] };
    }

    // Research
    if (/\b(search|look up|find out|what is|who is|when (was|did|is)|where is|how does|explain|define|tell me about|what'?s the (history|story)|research|wikipedia|latest news)\b/i.test(text)) {
      return { intent: INTENT.RESEARCH, confidence: 0.82, subtasks: ['web_research', 'synthesize'] };
    }

    // Math
    if (/\b(calculate|compute|what is \d+|solve|\d+\s*[\+\-\*\/]\s*\d+|percentage|convert \d+|how many|how much is)\b/i.test(text)) {
      return { intent: INTENT.MATH, confidence: 0.88, subtasks: ['calculate'] };
    }

    // Task execution
    if (/\b(write|draft|create|generate|make (a|an)|build|code|program|design|plan|outline|summarize|translate|rewrite|improve|edit)\b/i.test(text)) {
      return { intent: INTENT.TASK_EXECUTION, confidence: 0.80, subtasks: ['generate_content'] };
    }

    // Planning
    if (/\b(plan|roadmap|strategy|steps to|how (should|do) I|project (plan|timeline)|milestone|break down|organize)\b/i.test(text)) {
      return { intent: INTENT.PLANNING, confidence: 0.80, subtasks: ['create_plan'] };
    }

    // System / LUKAS settings
    if (/\b(your (name|version|capabilities)|what can you do|help|settings|clear (memory|history)|forget|lukas status|diagnostics|system)\b/i.test(text)) {
      return { intent: INTENT.SYSTEM, confidence: 0.85, subtasks: ['system_response'] };
    }

    // Default to conversation with medium confidence
    return { intent: INTENT.CONVERSATION, confidence: 0.55, subtasks: ['conversational_response'] };
  }

  // ─── AI-Powered Classification (for Ambiguous Inputs) ─────────────────────

  async _classifyWithAI(input, homeContext, apiKey, apiProvider) {
    const systemPrompt = `You are LUKAS's intent classification engine. Your ONLY job is to classify the user's request.

Return a JSON object with:
{
  "intent": "<one of: home_control|research|task_execution|automation|weather|media|memory_query|planning|analysis|math|conversation|system>",
  "confidence": <0.0 to 1.0>,
  "subtasks": ["<list of subtask strings>"],
  "entities": {"target": "...", "action": "...", "value": "..."},
  "requiresResearch": <true/false>,
  "isComplex": <true/false>
}`;

    const userPrompt = `Classify this request: "${input}"`;

    try {
      const result = await this._callAI(systemPrompt, userPrompt, apiKey, apiProvider, 0.1);
      const parsed = JSON.parse(result);
      if (parsed.intent && Object.values(INTENT).includes(parsed.intent)) {
        return {
          intent: parsed.intent,
          confidence: parsed.confidence || 0.75,
          subtasks: parsed.subtasks || [],
          entities: parsed.entities || {},
          requiresResearch: parsed.requiresResearch || false,
          isComplex: parsed.isComplex || false,
        };
      }
    } catch (e) {
      console.warn('[Orchestrator] AI parse error:', e.message);
    }
    return null;
  }

  // ─── Task Decomposition ──────────────────────────────────────────────────

  /**
   * Break a complex request into ordered subtasks.
   * Used for compound commands like "research X, summarize it, and set a reminder"
   */
  async decompose(input, intent, apiKey, apiProvider) {
    // If no api key is available, use rule-based decomposition for simple split keywords like 'and then'
    if (!apiKey) {
      const parts = input.split(/\band then\b|\bthen\b/i);
      if (parts.length > 1) {
        return parts.map((part, index) => {
          const trimmed = part.trim();
          const ruleClass = this._classifyByRules(trimmed);
          return {
            task: trimmed,
            agent: this._intentToAgent(ruleClass.intent),
            dependsOn: index > 0 ? index - 1 : null
          };
        });
      }
      return [{ task: input, agent: this._intentToAgent(intent), dependsOn: null }];
    }

    const systemPrompt = `You are LUKAS's task planning and decomposition engine.
Your goal is to break down a complex, compound or multi-step user request into an ordered sequence of subtasks.
Each subtask should specify the agent responsible for executing it.
Supported agents:
- 'research' (for web searching or looking up external info)
- 'home_control' (for smart home device status or actions like lights, climate, climate mode)
- 'automation' (for scheduling reminders, timers, alarms, or routines)
- 'weather' (for weather inquiries)
- 'media' (for music or volume control)
- 'math' (for arithmetic and computations)
- 'conversation' (for general chatting or synthesizing final responses)
- 'system' (for diagnostics, system commands, or settings)

Return ONLY a JSON array of objects, with NO markdown backticks or commentary:
[
  { "task": "detailed task instruction for this step", "agent": "one of the agents above", "dependsOn": null or integer index of prerequisite step }
]

Example input: "Set up a morning routine, search the weather, and set a reminder to water my plants."
Example output:
[
  { "task": "activate morning routine in home", "agent": "home_control", "dependsOn": null },
  { "task": "retrieve the weather forecast", "agent": "weather", "dependsOn": null },
  { "task": "set a reminder to water the plants", "agent": "automation", "dependsOn": null }
]`;

    try {
      const result = await this._callAI(systemPrompt, input, apiKey, apiProvider, 0.15);
      const cleaned = result.replace(/```json/g, '').replace(/```/g, '').trim();
      const parsed = JSON.parse(cleaned);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed.map(step => ({
          task: step.task,
          agent: step.agent || 'conversation',
          dependsOn: typeof step.dependsOn === 'number' ? step.dependsOn : null
        }));
      }
    } catch (e) {
      console.warn('[Orchestrator] Task decomposition AI call failed, falling back:', e.message);
    }

    return [{ task: input, agent: this._intentToAgent(intent), dependsOn: null }];
  }

  _intentToAgent(intent) {
    const map = {
      [INTENT.HOME_CONTROL]:   'home_control',
      [INTENT.RESEARCH]:       'research',
      [INTENT.TASK_EXECUTION]: 'task_execution',
      [INTENT.AUTOMATION]:     'automation',
      [INTENT.WEATHER]:        'weather',
      [INTENT.MEDIA]:          'media',
      [INTENT.PLANNING]:       'task_execution',
      [INTENT.ANALYSIS]:       'task_execution',
      [INTENT.MATH]:           'conversation',
      [INTENT.CONVERSATION]:   'conversation',
      [INTENT.MEMORY_QUERY]:   'memory',
      [INTENT.SYSTEM]:         'system',
    };
    return map[intent] || 'conversation';
  }

  // ─── Low-Level AI Caller ─────────────────────────────────────────────────

  async _callAI(systemPrompt, userPrompt, apiKey, provider, temperature = 0.3) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.API_TIMEOUT);

    try {
      if (provider === 'openai') {
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
          signal: controller.signal,
          body: JSON.stringify({
            model: 'gpt-4o-mini',
            messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
            temperature,
            response_format: { type: 'json_object' },
            max_tokens: 300,
          }),
        });
        const data = await response.json();
        return data.choices?.[0]?.message?.content || '{}';

      } else if (provider === 'gemini') {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            contents: [{ parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }] }],
            generationConfig: { temperature, responseMimeType: 'application/json', maxOutputTokens: 300 },
          }),
        });
        const data = await response.json();
        return data.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
      }
    } finally {
      clearTimeout(timeout);
    }
    return '{}';
  }
}

export default LukasOrchestrator;
