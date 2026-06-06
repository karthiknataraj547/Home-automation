// ═══════════════════════════════════════════════════════════════════════
// LUKAS Research Agent — Multi-Source Real-Time Web Research Engine
// Restricted to Backend Server-Side Search to enforce CORS Compliance
// ═══════════════════════════════════════════════════════════════════════

import { callLukasAI, generateConversationalResponse } from './core.js';

class LukasResearchAgent {
  constructor() {
    this.TIMEOUT = 9000;
  }

  // ─── Public Entry Point ───────────────────────────────────────────────────

  /**
   * Research a topic using server-side search API, then synthesize with AI.
   * @param {string} query
   * @param {{ apiKey?: string, apiProvider?: string, memory?: object }} opts
   */
  async research(query, { apiKey = null, apiProvider = 'openai', memory = null } = {}) {
    console.log(`[Research Agent] Researching: "${query}"`);

    const results = await this._gatherSources(query);

    if (!results.found) {
      return { answer: null, sources: [], confidence: 0, raw: results };
    }

    const hasAI = apiKey || (typeof window !== 'undefined' && window.puter?.ai);
    if (hasAI && results.sources.length > 0) {
      const synthesized = await this._synthesize(query, results.sources, apiKey, apiProvider, memory);
      return {
        answer: synthesized,
        sources: results.sources.map(s => s.source),
        confidence: results.confidence,
        raw: results,
      };
    }

    const best = results.sources[0];
    return {
      answer: best?.excerpt || best?.text || null,
      sources: [best?.source].filter(Boolean),
      confidence: best?.confidence || 0.5,
      raw: results,
    };
  }

  // ─── Source Gathering ─────────────────────────────────────────────────────

  async _gatherSources(query) {
    const sources = [];
    let confidence = 0;

    const backendResults = await this._searchBackend(query);
    if (backendResults && backendResults.length > 0) {
      for (const s of backendResults.slice(0, 4)) {
        if (s && s.text && s.text.trim().length > 20) {
          sources.push(s);
          confidence = Math.max(confidence, s.confidence || 0.5);
        }
      }
    }

    return { found: sources.length > 0, sources, confidence, query };
  }

  // ─── Backend API Search (CORS Compliant) ───────────────────────────────────

  async _searchBackend(query) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 6000);

      const response = await fetch('/api/search', {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
      });
      clearTimeout(timer);

      if (!response.ok) return null;
      const data = await response.json();

      if (data.found && data.results?.length > 0) {
        console.log(`[Research Agent] Backend returned ${data.results.length} results`);
        return data.results;
      }
    } catch (e) {
      console.info('[Research Agent] Backend unavailable:', e.message);
    }
    return null;
  }

  // ─── AI Synthesis ────────────────────────────────────────────────────────

  async _synthesize(query, sources, apiKey, apiProvider, memory) {
    const now = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' });

    const sourceText = sources
      .slice(0, 5)
      .map((s, i) => `[Source ${i + 1} — ${s.source} | Confidence: ${Math.round((s.confidence || 0.5) * 100)}%]\n${s.text || s.excerpt}`)
      .join('\n\n---\n\n');

    const systemPrompt = `You are LUKAS, an advanced AI home assistant with real-time web search capability.
Current date/time: ${now} IST

When answering, you have access to real-time web search results. Use them to provide accurate, up-to-date information.

Rules:
- Prioritize high-confidence sources (Google Featured Snippets, Knowledge Graphs) over lower ones
- State facts directly and confidently when sources agree
- If sources conflict, mention the discrepancy briefly
- Do NOT say "According to Wikipedia" — present information naturally
- Keep answers concise but complete
- For political/current affairs questions, rely on web search results, not your training data
- If a source says someone is currently in a role, trust it over any prior knowledge`;

    const userPrompt = `User asked: "${query}"\n\nReal-time search results:\n${sourceText}\n\nProvide a clear, accurate, conversational answer.`;

    try {
      const result = await generateConversationalResponse({
        userMessage: userPrompt,
        memory: null,
        apiKey,
        apiProvider,
        systemPrompt,
        temperature: 0.3,
        maxTokens: 600,
      });
      return result;
    } catch (e) {
      return sources[0]?.text || sources[0]?.excerpt || null;
    }
  }
}

export default LukasResearchAgent;
