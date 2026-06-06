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

  let prompt = `You are LUKAS, an advanced AI Operating System — a Jarvis-style executive assistant.
You are speaking with ${userName}.

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
[OPERATING PRINCIPLES]
1. THINK before answering — understand intent fully
2. BE PROACTIVE — if you notice gaps, risks, or better approaches, mention them
3. REMEMBER context — reference what was discussed earlier when relevant
4. ${styleGuide}
5. EXECUTE fully — don't stop halfway through complex tasks
6. PERSONALIZE — adapt to what you know about ${userName}
7. HONEST — if uncertain, say so and explain what you do know
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

You are NOT a generic chatbot. You are a capable AI executive assistant that:
- Executes smart home control (lights, climate, security, routines)
- Conducts research and synthesizes information
- Maintains context across this conversation
- Proactively improves upon requests
- Remembers user preferences and adapts over time

Respond naturally and professionally. Never say "As an AI language model" or similar phrases.
Always address ${userName} directly.`;

  // Intent-specific additions
  if (intent === 'task_execution') {
    prompt += `\n\nFor this task: deliver a COMPLETE result. Focus on output, not explanation.`;
  } else if (intent === 'research') {
    prompt += `\n\nFor research: synthesize information clearly, acknowledge uncertainty, cite key points.`;
  } else if (intent === 'planning') {
    prompt += `\n\nFor planning: provide concrete, actionable steps with clear priorities and timelines.`;
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
}) {
  const systemPrompt = buildSystemPrompt(memory, homeContext, intent, isVoice);

  const result = await callLukasAI({
    systemPrompt,
    userMessage,
    memory,
    apiKey,
    apiProvider,
    temperature: 0.75,
    maxTokens: 1500,
    jsonMode: false,
    includeHistory: true,
    streamCallback,
  });

  return result;
}

/**
 * Quality scoring — evaluate response before delivering.
 * Returns { score, issues, improved } where score is 0-100.
 */
function scoreResponse(userInput, response) {
  if (!response) return { score: 0, issues: ['No response generated'] };

  const issues = [];
  let score = 100;

  // Length checks
  if (response.length < 10) { issues.push('Response too short'); score -= 40; }
  if (response.length > 3000) { issues.push('Response may be too verbose'); score -= 5; }

  // AI wording check
  const badPhrases = ['as an ai', 'as a language model', 'i cannot', 'i am unable to', 'i don\'t have the ability'];
  for (const phrase of badPhrases) {
    if (response.toLowerCase().includes(phrase)) {
      issues.push(`Contains generic AI phrasing: "${phrase}"`);
      score -= 15;
      break;
    }
  }

  // Relevance check — basic keyword overlap
  const inputWords = new Set(userInput.toLowerCase().split(/\s+/).filter(w => w.length > 3));
  const responseWords = new Set(response.toLowerCase().split(/\s+/));
  const overlap = [...inputWords].filter(w => responseWords.has(w)).length;
  if (overlap === 0 && inputWords.size > 3) {
    issues.push('Response may not address the query');
    score -= 20;
  }

  // Check for incomplete responses
  if (response.endsWith('...') || response.includes('...\n')) {
    issues.push('Response appears incomplete');
    score -= 15;
  }

  return { score: Math.max(0, score), issues };
}

export {
  buildSystemPrompt,
  buildParserSystemPrompt,
  callLukasAI,
  parseHomeCommand,
  generateConversationalResponse,
  scoreResponse,
};
