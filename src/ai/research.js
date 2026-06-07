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
    const isDeepQuery = /\b(deep research|research this|research company|analyze company|detailed research|full report|intelligence report)\b/i.test(query)
      || (query.toLowerCase().trim().startsWith('research ') && query.split(' ').length <= 4);

    if (isDeepQuery) {
      return await this.deepResearch(query, { apiKey, apiProvider, memory });
    }

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

  async deepResearch(query, { apiKey = null, apiProvider = 'openai', memory = null } = {}) {
    console.log(`[Research Agent] Initiating deep research pipeline for: "${query}"`);

    let cleanQuery = query.trim();
    const cleanMatch = query.match(/(?:deep research|research company|research|about|tell me about|info on)\s+(.+)/i);
    if (cleanMatch && cleanMatch[1]) {
      cleanQuery = cleanMatch[1].trim();
    }

    const subQueries = [
      { q: cleanQuery, type: 'Core Overview' },
      { q: `${cleanQuery} about us company history team leadership`, type: 'Background & Team' },
      { q: `${cleanQuery} products services features technology`, type: 'Products & Technology' },
      { q: `${cleanQuery} pricing subscription cost plans tiers`, type: 'Pricing & Business Model' },
      { q: `${cleanQuery} reviews reputation rating customer feedback`, type: 'Reputation & Feedback' }
    ];

    if (typeof window !== 'undefined' && window.__lukasDiag) {
      window.__lukasDiag.logToTerminal(`[DEEP RESEARCH] Decomposing into ${subQueries.length} parallel target queries.`, 'info');
    }

    const searchPromises = subQueries.map(async (item) => {
      try {
        console.log(`[Deep Research] Querying: "${item.q}"`);
        const searchRes = await this._gatherSources(item.q);
        return {
          type: item.type,
          sources: searchRes.found ? searchRes.sources : [],
          success: searchRes.found
        };
      } catch (e) {
        console.warn(`[Deep Research] Sub-query "${item.q}" failed:`, e.message);
        return { type: item.type, sources: [], success: false };
      }
    });

    const gatheredResults = await Promise.all(searchPromises);

    const allExcerpts = [];
    const allLinks = new Set();
    const sourceTypes = [];

    gatheredResults.forEach(r => {
      if (r.success && r.sources.length > 0) {
        sourceTypes.push(r.type);
        r.sources.slice(0, 3).forEach(src => {
          allExcerpts.push(`[${r.type} Source - ${src.source}]\n${src.text || src.excerpt}`);
          if (src.url) allLinks.add(src.url);
        });
      }
    });

    if (allExcerpts.length === 0) {
      return {
        answer: `I attempted a deep research analysis on "${cleanQuery}" but could not retrieve high-confidence sources.`,
        sources: [],
        confidence: 0
      };
    }

    if (typeof window !== 'undefined' && window.__lukasDiag) {
      window.__lukasDiag.logToTerminal(`[DEEP RESEARCH] Merged data from ${sourceTypes.join(', ')}. Synthesizing intelligence report...`, 'info');
    }

    const combinedContent = allExcerpts.join('\n\n---\n\n');
    const now = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' });

    const systemPrompt = `You are LUKAS, an advanced AI Operating System with deep research capabilities.
Current date/time: ${now} IST

You have been given a comprehensive set of real-time search results spanning several categories (Overview, History/Team, Products, Pricing, and Reviews).
Your job is to synthesize these sources into a premium, professional executive intelligence report about the requested topic/company.

The report MUST be structured using these Markdown headers:
# Executive Intelligence Report: [Name]

## 1. Executive Summary & Overview
Provide a concise overview of what the company/topic is, their core mission, and their position in the market.

## 2. Background & Leadership
Detail their corporate history, founders, key team members, and timeline.

## 3. Core Products & Technology
Describe what they offer, their primary technology stack, features, and key differentiators.

## 4. Pricing & Business Model
Summarize their pricing plans, tiers, customer segments, and monetization strategy.

## 5. Reputation & Market Feedback
Detail customer reviews, common compliments/complaints, and overall market feedback.

## 6. Synthesis & Knowledge Graph Map
Summarize key entities (partners, competitors, technologies) and your final assessment.

Rules:
- Present information cleanly and professionally
- State facts directly, referencing multiple points from the sources
- If information is missing from the sources for a specific section (e.g. no pricing data found), state that clearly rather than guessing or hallucinating.
- Never mention "According to Source X" — integrate details naturally.`;

    const userPrompt = `Synthesize this raw intelligence feed about "${cleanQuery}":\n\n${combinedContent}`;

    try {
      const report = await generateConversationalResponse({
        userMessage: userPrompt,
        memory: null,
        apiKey,
        apiProvider,
        systemPrompt,
        temperature: 0.25,
        maxTokens: 1500,
      });

      return {
        answer: report,
        sources: Array.from(allLinks).slice(0, 5),
        confidence: 0.95
      };
    } catch (e) {
      console.error('[Deep Research] Synthesis failed:', e.message);
      return {
        answer: `Here is the aggregated research data on ${cleanQuery}:\n\n` + combinedContent.slice(0, 1000) + '...',
        sources: Array.from(allLinks).slice(0, 5),
        confidence: 0.6
      };
    }
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
