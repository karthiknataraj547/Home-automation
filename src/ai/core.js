// ═══════════════════════════════════════════════════════════════════════
// LUKAS AI Core — Unified Intelligence Engine
// Handles: system prompts, conversation AI, streaming, quality scoring
// Replaces the fragmented askOpenAI/askGemini/parseCommand pattern
// ═══════════════════════════════════════════════════════════════════════

/**
 * Build LUKAS's master system prompt with full context injection.
 * This is what makes LUKAS feel like it knows you.
 */
function buildSystemPrompt(memory, homeContext = '', intent = 'conversation', isVoice = false) {
  const now = new Date();
  const timeStr = now.toLocaleString('en-IN', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZoneName: 'short'
  });

  const contextBlock = memory ? memory.buildContextBlock() : '';
  const historyText = memory ? memory.getHistoryAsText(8) : '';
  const prefs = memory ? memory.getAllPreferences() : {};
  const userName = memory?.getFact('name') || prefs.name || 'Commander';

  const responseStyle = prefs.responseStyle || 'balanced';
  const styleGuide = {
    'concise': 'Keep responses short and direct. Maximum 2-3 sentences unless detail is truly needed.',
    'detailed': 'Provide thorough, comprehensive answers with context, reasoning, and examples.',
    'balanced': 'Match response length to complexity — brief for simple tasks, detailed for complex ones.',
    'technical': 'Use precise technical language. Include implementation details and edge cases.',
  }[responseStyle] || 'Match response length to complexity.';

  let prompt = `You are LUKAS Infinity OS, an advanced Cognitive AI Operating System and a human-level AI companion.
You are speaking with ${userName}. You are not a generic chatbot; you are a trusted friend, a professional executive assistant, a personal researcher, a technology expert, a project manager, and a real conversational companion. The goal is for ${userName} to feel like they are speaking with an intelligent, reliable companion rather than software.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CURRENT TIME: ${timeStr}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;

  if (contextBlock) {
    prompt += `\n\n[USER PROFILE & CONTEXT]\n${contextBlock}`;
  }

  if (homeContext) {
    prompt += `\n\n[HOME ENVIRONMENT]\n${homeContext}`;
  }

  if (historyText) {
    prompt += `\n\n[RECENT CONVERSATION]\n${historyText}`;
  }

  prompt += `\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[OPERATING PRINCIPLES & COGNITIVE PIPELINE]
You must process every command through the LUKAS 8-stage intelligence pipeline:
  Intent Detection → Context Retrieval → Task Planning → Reasoning → Execution → Validation → Response

Never allow direct "question → answer" behavior. Always think and analyze before answering.
1. THINK before answering — understand intent fully and run through the pipeline stage-by-stage.
2. BE PROACTIVE & AUTONOMOUS — suggest improvements, identify risks, and recommend optimizations.
   *Example:* If the user mentions launching a project/store (e.g. "I launched my store"), proactively suggest SEO improvements, analytics setup, marketing campaigns, and conversion optimizations.
3. REMEMBER context — reference what was discussed earlier naturally, connecting projects, goals, and interests.
4. ${styleGuide}
5. EXECUTE fully — don't stop halfway through complex tasks.
6. PERSONALIZE — adapt your vocabulary, humor, and style to what you know about ${userName}.
7. HONEST — if uncertain, say so and explain what you do know.

[ADAPTIVE EMOTIONAL INTELLIGENCE LAYER]
Detect ${userName}'s mood, tone, or situation from their message (e.g., frustration, excitement, confusion, urgency, satisfaction, stress) and adjust your response style accordingly:
- If user is stressed, anxious, or frustrated: Speak calmly, concisely, and supportively. Avoid jargon or lecturing.
- If user is brainstorming or planning: Become highly collaborative, creative, and imaginative. Offer multiple options and ideas.
- If user is working or needs things done: Become extremely efficient, direct, and focused. Get straight to the point without fluff.
- If user is excited: Be enthusiastic, encouraging, and celebrate their progress.
- If user is confused: Speak clearly, break steps down simply, and offer guiding questions.

[HUMAN CONVERSATION SYSTEM & RULES]
- Avoid robotic, synthetic, or standard AI responses.
- NEVER say "As an AI...", "As a language model...", or "I am an AI...".
- Avoid generic apologies (like "sorry for the confusion", "apologize for") or generic robotic transitions ("furthermore", "in summary", "consequently").
- Use conversational phrasing, natural pauses, varying vocabulary, and refer back to previous context naturally.
- Do not ask follow-up questions unless they are genuinely helpful for the next action.

[UNIVERSAL LANGUAGE & ACCENT ENGINE]
- You support: English (with American, British, Australian, Indian, Canadian accent contexts), Hindi, Kannada, Tamil, Telugu, Malayalam, Marathi, Gujarati, Bengali, Punjabi, Urdu, Arabic, French, German, Spanish, Portuguese, Italian, Japanese, Korean, Mandarin Chinese, Russian, and other world languages.
- Detect the user's input language and dialect (including mixed-languages / code-switching) automatically, and respond seamlessly in the same language or dialect style. Maintain natural phrasing.

[BEHAVIORAL RATIO]
- 40% Executive Assistant: Manage schedule, preferences, active files, memory, and devices.
- 25% Research & Web Intelligence: Search web sources, verify facts, resolve ambiguities.
- 15% Engineering Mind: Apply precise logic, syntax correctness, and understand hardware/protocols.
- 10% Project Manager: Trace active goals, log problems, and define checklists.
- 10% Automation Core: Event schedules, trigger rules, and state flows.

[EXECUTIVE PRE-CHECK SYSTEM]
Before writing your response, perform a cognitive validation step:
- Determine precisely what the user is trying to accomplish.
- Identify what target state they want to achieve.
- Highlight any potential risks or execution gaps.
- Propose the single best next action.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Respond naturally and professionally. Always address ${userName} directly.`;

  // Intent-specific additions
  if (intent === 'task_execution') {
    prompt += `\n\nFor this task: Think through the request carefully, then deliver a COMPLETE result. Structure your response as:
[EXECUTIVE ANALYSIS]
User Goal: <one-line summary of what they want>
Actual Objective: <what they really need to achieve>
Risks/Considerations: <any gaps, risks, or important context>
Best Next Step: <the single most important action>

[RESPONSE]
<your actual response here>`;
  } else if (intent === 'planning') {
    prompt += `\n\nFor planning: Think through the goals and constraints, then structure your plan as:
[EXECUTIVE ANALYSIS]
User Goal: <what they want>
Actual Objective: <what success looks like>
Risks/Considerations: <blockers or assumptions>
Best Next Step: <immediate action item>

[RESPONSE]
<concrete numbered plan with priorities and realistic timelines>`;
  } else if (intent === 'research') {
    prompt += `\n\nFor research: synthesize information clearly, acknowledge uncertainty, cite key points.`;
  }

  if (isVoice) {
    prompt += `\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[VOICE MODE RULES]
1. You are speaking with the user via Text-to-Speech voice output.
2. Keep your response extremely brief, concise, and natural (maximum 1-2 short sentences).
3. Speak directly and conversationally. Avoid bullet points, lists, code blocks, or markdown formatting.
4. If the user asks for details, explanation, or a breakdown, you may then expand your response.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;
  }

  return prompt;
}

/**
 * Build the home control parser system prompt.
 * Kept lean because it's a structured extraction task, not a conversation.
 */
function buildParserSystemPrompt() {
  return `You are LUKAS's smart home command parser. Extract structured intent from natural language.

Return ONLY a JSON object:
{
  "category": "light|climate|security|media|routine|reminder|weather|time|diagnostics|unknown",
  "action": "on|off|toggle|set|color|brightness|lock|unlock|increase|decrease|play|pause|stop|skip|morning|cinema|eco|lockdown|null",
  "targetZone": "Living Room|Bedroom|Kitchen|Outdoor|All|null",
  "targetDeviceName": "<exact device name or null>",
  "isGlobal": true|false,
  "value": "<numeric or color value or null>",
  "timeExpression": "<for reminders: '5 minutes', '3pm', 'tomorrow' etc or null>",
  "reminderText": "<what to remind about or null>"
}

Be precise. If the command is about home devices/climate/security/routines → always return a specific category.
Only return "unknown" for genuinely conversational requests.`;
}

/**
 * Core AI call function — used by all agents.
 * Supports OpenAI, Gemini, and Puter fallback.
 * Includes memory-injected conversation history.
 */
async function callLukasAI({
  systemPrompt,
  userMessage,
  memory = null,
  apiKey = null,
  apiProvider = 'openai',
  temperature = 0.72,
  maxTokens = 1200,
  jsonMode = false,
  includeHistory = true,
  streamCallback = null, // for streaming support
}) {
  const API_TIMEOUT = 20000; // 20 seconds
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), API_TIMEOUT);

  // Build message array with conversation history
  const messages = [{ role: 'system', content: systemPrompt }];

  // Inject conversation history for multi-turn context
  if (memory && includeHistory) {
    const history = memory.getHistory(10);
    // Add history but skip the current message (it's added below)
    const historyWithoutLast = history.length > 0 && history[history.length - 1]?.role === 'user'
      ? history.slice(0, -1)
      : history;
    messages.push(...historyWithoutLast);
  }

  messages.push({ role: 'user', content: userMessage });

  try {
    if (apiProvider === 'openai' && apiKey) {
      const body = {
        model: 'gpt-4o-mini',
        messages,
        temperature,
        max_tokens: maxTokens,
      };
      if (jsonMode) body.response_format = { type: 'json_object' };
      if (streamCallback) body.stream = true;

      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        signal: controller.signal,
        body: JSON.stringify(body),
      });

      if (!response.ok) throw new Error(`OpenAI API error: ${response.status}`);

      // Handle streaming
      if (streamCallback && body.stream) {
        return await _handleOpenAIStream(response, streamCallback);
      }

      const data = await response.json();
      return data.choices?.[0]?.message?.content || null;

    } else if (apiProvider === 'gemini' && apiKey) {
      // Build Gemini contents array from messages
      const geminiContents = [];
      let systemContent = '';

      for (const msg of messages) {
        if (msg.role === 'system') {
          systemContent = msg.content;
        } else {
          geminiContents.push({
            role: msg.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: msg.content }]
          });
        }
      }

      // Prepend system to first user message (Gemini doesn't have system role)
      if (systemContent && geminiContents.length > 0 && geminiContents[0].role === 'user') {
        geminiContents[0].parts[0].text = `${systemContent}\n\n${geminiContents[0].parts[0].text}`;
      }

      const genConfig = { temperature, maxOutputTokens: maxTokens };
      if (jsonMode) genConfig.responseMimeType = 'application/json';

      if (streamCallback) {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:streamGenerateContent?alt=sse&key=${apiKey}`;
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({ contents: geminiContents, generationConfig: genConfig }),
        });

        if (!response.ok) throw new Error(`Gemini API error: ${response.status}`);

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let fullText = '';
        let streamBuffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          streamBuffer += decoder.decode(value, { stream: true });
          const lines = streamBuffer.split('\n');
          streamBuffer = lines.pop() || '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data: ')) continue;
            const dataStr = trimmed.slice(6).trim();
            try {
              const parsed = JSON.parse(dataStr);
              const delta = parsed.candidates?.[0]?.content?.parts?.[0]?.text || '';
              if (delta) {
                fullText += delta;
                streamCallback(delta, fullText);
              }
            } catch (e) {}
          }
        }

        if (streamBuffer.trim().startsWith('data: ')) {
          try {
            const parsed = JSON.parse(streamBuffer.trim().slice(6).trim());
            const delta = parsed.candidates?.[0]?.content?.parts?.[0]?.text || '';
            if (delta) {
              fullText += delta;
              streamCallback(delta, fullText);
            }
          } catch (e) {}
        }

        return fullText;
      } else {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({ contents: geminiContents, generationConfig: genConfig }),
        });

        if (!response.ok) throw new Error(`Gemini API error: ${response.status}`);
        const data = await response.json();
        return data.candidates?.[0]?.content?.parts?.[0]?.text || null;
      }

    } else if (window.puter?.ai) {
      // Puter AI fallback — no history support
      const puterResponse = await window.puter.ai.chat(
        `${systemPrompt}\n\nUser: ${userMessage}`,
        { model: 'gpt-4o-mini' }
      );
      return typeof puterResponse === 'string' ? puterResponse : puterResponse?.message?.content || null;
    }

  } catch (e) {
    if (e.name === 'AbortError') {
      throw new Error('LUKAS AI response timed out. Please try again.');
    }
    throw e;
  } finally {
    clearTimeout(timeout);
  }

  return null;
}

/**
 * Handle OpenAI streaming response — calls streamCallback with each chunk.
 */
async function _handleOpenAIStream(response, streamCallback) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let fullText = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value);
    const lines = chunk.split('\n').filter(l => l.startsWith('data: '));

    for (const line of lines) {
      const data = line.slice(6);
      if (data === '[DONE]') continue;
      try {
        const parsed = JSON.parse(data);
        const delta = parsed.choices?.[0]?.delta?.content || '';
        if (delta) {
          fullText += delta;
          streamCallback(delta, fullText);
        }
      } catch {}
    }
  }

  return fullText;
}

/**
 * Parse a home control command — specialized low-temperature structured extraction.
 */
async function parseHomeCommand(userMessage, apiKey, apiProvider) {
  try {
    const result = await callLukasAI({
      systemPrompt: buildParserSystemPrompt(),
      userMessage,
      memory: null,         // No history for parser — focused extraction
      apiKey,
      apiProvider,
      temperature: 0.05,    // Near-deterministic
      maxTokens: 200,
      jsonMode: true,
      includeHistory: false,
    });

    if (!result) return null;
    const parsed = JSON.parse(result);
    return parsed.category ? parsed : null;
  } catch (e) {
    console.warn('[AI Core] Parser failed:', e.message);
    return null;
  }
}

/**
 * Generate a conversational response with full context.
 */
async function generateConversationalResponse({
  userMessage,
  memory,
  homeContext = '',
  intent = 'conversation',
  apiKey,
  apiProvider,
  streamCallback = null,
  isVoice = false,
  systemPrompt = null,
  temperature = 0.75,
  maxTokens = 1500,
  reasoning = null,
}) {
  const finalSystemPrompt = systemPrompt || buildSystemPrompt(memory, homeContext, intent, isVoice);

  let result = await callLukasAI({
    systemPrompt: finalSystemPrompt,
    userMessage,
    memory,
    apiKey,
    apiProvider,
    temperature,
    maxTokens,
    jsonMode: false,
    includeHistory: !!memory,
    streamCallback,
  });

  // If streaming is active, we cannot intercept to refine, so return immediately
  if (streamCallback) return result;

  // ── LUKAS Response Quality Self-Reflection & Refinement Algorithm ──
  let attempts = 0;
  let validationResult;

  // ── Intent-specific quality thresholds ──────────────────────────────────────
  // Conversation doesn't need to be as perfect as task execution
  const thresholds = {
    task_execution: 82,
    research: 80,
    planning: 82,
    conversation: 70,
    home_control: 65,
  };
  const minScore = thresholds[intent] || 78;

  if (reasoning) {
    validationResult = reasoning.validate(userMessage, result, memory);
  } else {
    const scoreObj = scoreResponse(userMessage, result);
    validationResult = {
      valid: scoreObj.score >= minScore,
      score: scoreObj.score,
      issues: scoreObj.issues,
      action: 'respond'
    };
  }

  // If confidence is low, the reasoning engine will specify action === 'ask_clarification'.
  // In that case, we run Executive Framing to present a structured intake assessment.
  if (validationResult.action === 'ask_clarification') {
    console.log(`[Self-Reflection] Low confidence action detected. Running Executive Framing to ask clarifying questions.`);
    const framingPrompt = buildExecutiveFramingPrompt(memory, intent);
    try {
      const clarificationResponse = await callLukasAI({
        systemPrompt: framingPrompt,
        userMessage,
        memory: null,
        apiKey,
        apiProvider,
        temperature: 0.5,
        maxTokens: 500,
      });
      return clarificationResponse || "I want to make sure I understand you correctly. Could you please clarify your request?";
    } catch (e) {
      return "I want to make sure I understand you correctly. Could you please clarify your request? What exactly would you like to achieve?";
    }
  }

  while (!validationResult.valid && attempts < 2) {
    console.log(`[Self-Reflection] Response scored low (${validationResult.score}/${minScore}). Issues:`, validationResult.issues);

    const reflectionPrompt = `You are LUKAS's response refinement engine. The previous response was evaluated and had some issues:
${validationResult.issues.map(i => `- ${i}`).join('\n')}

Original user query: "${userMessage}"
Previous response: "${result}"

Please rewrite the response to resolve all the issues above. Keep it professional, Jarvis-style, natural, concise, and completely accurate. Do NOT apologize, do NOT say "as an AI", and do NOT explain your edits; return ONLY the refined response text.`;

    const refined = await callLukasAI({
      systemPrompt: "You are LUKAS, an advanced AI Operating System. You refine and polish your own text to be perfect.",
      userMessage: reflectionPrompt,
      memory: null,
      apiKey,
      apiProvider,
      temperature: 0.45,
      maxTokens: Math.max(600, maxTokens),
      jsonMode: false,
      includeHistory: false,
    });

    if (refined && refined.trim().length > 5) {
      // Sanity check: discard if refined is shorter than 80% of original (over-truncation)
      if (refined.trim().length < result.length * 0.8 && result.length > 200) {
        console.log(`[Self-Reflection] Refined response too short (${refined.length} vs ${result.length}). Discarding.`);
        break;
      }
      result = refined;
      if (reasoning) {
        validationResult = reasoning.validate(userMessage, result, memory);
      } else {
        const scoreObj = scoreResponse(userMessage, result);
        validationResult = {
          valid: scoreObj.score >= minScore,
          score: scoreObj.score,
          issues: scoreObj.issues,
          action: 'respond'
        };
      }
      if (validationResult.action === 'ask_clarification') {
        return "I want to make sure I understand you correctly. Could you please clarify your request?";
      }
    }
    attempts++;
  }

  console.log(`[Self-Reflection] Final response score: ${validationResult.score} after ${attempts} refinement attempts.`);
  return result;
}

/**
 * Quality scoring — evaluate response before delivering.
 * Returns { score, issues } where score is 0-100.
 */
function scoreResponse(userInput, response) {
  if (!response) return { score: 0, issues: ['No response generated'] };

  const issues = [];
  let score = 100;
  const lowerResp = response.toLowerCase().trim();

  // 1. Length checks
  if (response.length < 8) { issues.push('Response too short'); score -= 40; }
  if (response.length > 2500) { issues.push('Response may be too verbose'); score -= 5; }

  // 2. AI disclaimers and internet limitation checks (since live search is active)
  const limitations = [
    'cannot search', 'do not have access to real-time', 'do not have real-time',
    'cut-off date', 'knowledge cutoff', 'offline assistant', 'as a language model',
    'as an ai', 'do not have access to live', 'not connected to the internet'
  ];
  for (const phrase of limitations) {
    if (lowerResp.includes(phrase)) {
      issues.push(`Mentions AI real-time/internet limitations when search is active: "${phrase}"`);
      score -= 25;
    }
  }

  // 3. Robotic/AI filler checks
  const badPhrases = ['i am unable to', 'i don\'t have the ability', 'i cannot answer', 'as an assistant', 'as an ai assistant'];
  for (const phrase of badPhrases) {
    if (lowerResp.includes(phrase)) {
      issues.push(`Contains generic robotic phrasing: "${phrase}"`);
      score -= 15;
    }
  }

  // 4. Robotic transition words
  const roboticTransitions = ['furthermore', 'in summary', 'consequently', 'firstly', 'secondly', 'lastly'];
  let transitionCount = 0;
  for (const transition of roboticTransitions) {
    if (lowerResp.includes(transition)) {
      transitionCount++;
    }
  }
  if (transitionCount > 1) {
    issues.push(`Contains multiple robotic transition words (${transitionCount})`);
    score -= transitionCount * 5;
  }

  // 5. Apologetic phrases
  const apologies = ['apologize for', 'sorry for the confusion', 'i apologize', 'i\'m sorry'];
  for (const apology of apologies) {
    if (lowerResp.includes(apology)) {
      issues.push(`Contains apologetic phrases: "${apology}"`);
      score -= 10;
    }
  }

  // 6. Relevance check — basic keyword overlap
  const stopWords = ['what', 'when', 'where', 'please', 'tell', 'show', 'about', 'is', 'the', 'a', 'an', 'and'];
  const inputWords = new Set(userInput.toLowerCase().split(/\s+/).filter(w => w.length > 3 && !stopWords.includes(w)));
  const responseWords = new Set(lowerResp.split(/\s+/));
  const overlap = [...inputWords].filter(w => responseWords.has(w)).length;
  if (overlap === 0 && inputWords.size > 2) {
    issues.push('Response does not overlap with key words of the query');
    score -= 20;
  }

  // 7. Check for incomplete responses
  if (response.endsWith('...') || response.includes('...\n')) {
    issues.push('Response appears incomplete or cut off');
    score -= 15;
  }

  return { score: Math.max(0, score), issues };
}

/**
 * Build the Executive Framing Prompt for requirement intake when query is ambiguous or low-confidence.
 */
function buildExecutiveFramingPrompt(memory, intent = 'planning') {
  const userName = memory?.getFact('name') || 'Commander';
  const contextBlock = memory ? memory.buildContextBlock() : '';
  return `You are LUKAS, an advanced AI Operating System.
The user (${userName}) has made a request under the "${intent}" intent which requires clarification or structure.
You must NOT answer or plan immediately. Instead, act as an Executive PM and present a structured requirement-gathering checklist.

You MUST return your response in this exact format:
[EXECUTIVE ANALYSIS]
Status: Awaiting Clarification
Identified Goal: <what you think they want>
Required Inputs: <what specific facts you need to know from the user>
Potential Blockers: <risks or assumptions>

[RESPONSE]
I have analyzed your request. To execute this effectively, I need a few more details. Please clarify:
1. <Specific question 1>
2. <Specific question 2>
3. <Specific question 3>

Return only this structured analysis. Keep the tone professional, Jarvis-style, and brief.

[USER PROFILE & CONTEXT]
${contextBlock}`;
}

export {
  buildSystemPrompt,
  buildParserSystemPrompt,
  buildExecutiveFramingPrompt,
  callLukasAI,
  parseHomeCommand,
  generateConversationalResponse,
  scoreResponse,
};
