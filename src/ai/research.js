// ═══════════════════════════════════════════════════════════════════════
// LUKAS Research Agent — Web Research, Fact Verification & Synthesis
// Handles: Wikipedia, DuckDuckGo, multi-source synthesis, fact-checking
// ═══════════════════════════════════════════════════════════════════════

import { callLukasAI } from './core.js';

class LukasResearchAgent {
  constructor() {
    this.WIKIPEDIA_API = 'https://en.wikipedia.org/api/rest_v1/page/summary/';
    this.WIKIPEDIA_SEARCH = 'https://en.wikipedia.org/w/api.php';
    this.DDG_API = 'https://api.duckduckgo.com/';
    this.TIMEOUT = 8000;
  }

  // ─── Main Research Entry Point ───────────────────────────────────────────

  /**
   * Research a topic using multiple sources, then synthesize with AI.
   */
  async research(query, { apiKey = null, apiProvider = 'openai', memory = null } = {}) {
    console.log(`[Research Agent] Researching: "${query}"`);

    const results = await this._gatherSources(query);

    if (!results.found) {
      return {
        answer: null,
        sources: [],
        confidence: 0,
        raw: results,
      };
    }

    // If AI key or Puter AI is available, synthesize; otherwise return best raw result
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

    // No AI — return the best raw source
    const best = results.sources[0];
    return {
      answer: best?.excerpt || best?.text || null,
      sources: [best?.source].filter(Boolean),
      confidence: best?.confidence || 0.5,
      raw: results,
    };
  }

  // ─── Source Gathering ────────────────────────────────────────────────────

  async _gatherSources(query) {
    const sources = [];
    let confidence = 0;

    // Run Wikipedia and DuckDuckGo in parallel
    const [wikiResult, ddgResult] = await Promise.allSettled([
      this._searchWikipedia(query),
      this._searchDuckDuckGo(query),
    ]);

    if (wikiResult.status === 'fulfilled' && wikiResult.value) {
      sources.push(wikiResult.value);
      confidence = Math.max(confidence, wikiResult.value.confidence);
    }

    if (ddgResult.status === 'fulfilled' && ddgResult.value) {
      // DDG may return multiple results
      const ddgSources = Array.isArray(ddgResult.value) ? ddgResult.value : [ddgResult.value];
      for (const s of ddgSources.slice(0, 3)) {
        if (s) {
          sources.push(s);
          confidence = Math.max(confidence, s.confidence || 0.5);
        }
      }
    }

    return {
      found: sources.length > 0,
      sources,
      confidence,
      query,
    };
  }

  // ─── Wikipedia ───────────────────────────────────────────────────────────

  async _searchWikipedia(query) {
    try {
      // First: direct page fetch
      const slug = encodeURIComponent(query.replace(/ /g, '_'));
      const directUrl = `${this.WIKIPEDIA_API}${slug}`;

      let data = await this._fetch(directUrl);

      // If direct fails, search for best match
      if (!data || data.type === 'https://mediawiki.org/wiki/HyperSwitch/errors/not_found') {
        const searchUrl = `${this.WIKIPEDIA_SEARCH}?action=opensearch&search=${encodeURIComponent(query)}&limit=3&format=json&origin=*`;
        const searchData = await this._fetch(searchUrl);

        if (searchData && searchData[1]?.length > 0) {
          const bestMatch = searchData[1][0];
          const matchSlug = encodeURIComponent(bestMatch.replace(/ /g, '_'));
          data = await this._fetch(`${this.WIKIPEDIA_API}${matchSlug}`);
        }
      }

      // If direct match and opensearch both failed, use full-text query search API
      if (!data || !data.extract) {
        try {
          const querySearchUrl = `${this.WIKIPEDIA_SEARCH}?action=query&list=search&srsearch=${encodeURIComponent(query)}&limit=3&format=json&origin=*`;
          const querySearchData = await this._fetch(querySearchUrl);
          if (querySearchData && querySearchData.query?.search?.length > 0) {
            const bestMatchTitle = querySearchData.query.search[0].title;
            const matchSlug = encodeURIComponent(bestMatchTitle.replace(/ /g, '_'));
            data = await this._fetch(`${this.WIKIPEDIA_API}${matchSlug}`);
          }
        } catch (e) {}
      }

      if (!data || !data.extract) return null;

      return {
        source: 'Wikipedia',
        url: data.content_urls?.desktop?.page || `https://en.wikipedia.org/wiki/${slug}`,
        title: data.title,
        excerpt: data.extract?.slice(0, 800),
        text: data.extract,
        confidence: 0.85,
        type: 'encyclopedia',
      };
    } catch (e) {
      console.warn('[Research] Wikipedia error:', e.message);
      return null;
    }
  }

  // ─── DuckDuckGo Instant Answers ──────────────────────────────────────────

  async _searchDuckDuckGo(query) {
    try {
      const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
      const html = await this.fetchWithProxy(url);
      
      if (!html) return null;
      
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');
      const results = [];
      
      const resultElements = doc.querySelectorAll('.result');
      resultElements.forEach(el => {
        const titleEl = el.querySelector('.result__a');
        const snippetEl = el.querySelector('.result__snippet');
        if (titleEl && snippetEl) {
          results.push({
            source: 'Web Search',
            url: titleEl.getAttribute('href') || '',
            title: titleEl.textContent.trim(),
            excerpt: snippetEl.textContent.trim().slice(0, 600),
            text: snippetEl.textContent.trim(),
            confidence: 0.82,
            type: 'web_result',
          });
        }
      });
      
      return results.length > 0 ? results : null;
    } catch (e) {
      console.warn('[Research] DuckDuckGo scraper error:', e.message);
      return null;
    }
  }

  // ─── AI Synthesis ────────────────────────────────────────────────────────

  async _synthesize(query, sources, apiKey, apiProvider, memory) {
    const sourceText = sources
      .slice(0, 4)
      .map((s, i) => `[Source ${i + 1}: ${s.source}]\n${s.text || s.excerpt}`)
      .join('\n\n---\n\n');

    const systemPrompt = `You are LUKAS's research synthesis engine.
Given research sources, provide a clear, accurate, well-organized answer.

Rules:
- Synthesize information from multiple sources when available
- Be factually accurate — if sources disagree, note it
- Be appropriately concise unless the topic requires depth
- Don't say "According to Wikipedia..." — just present the information naturally
- If sources are insufficient, say so honestly
- Add relevant context the user would find useful`;

    const userPrompt = `Query: ${query}\n\nResearch Sources:\n${sourceText}\n\nProvide a clear, helpful answer based on these sources.`;

    try {
      const result = await callLukasAI({
        systemPrompt,
        userMessage: userPrompt,
        memory: null, // Research synthesis doesn't need conversation history
        apiKey,
        apiProvider,
        temperature: 0.4,
        maxTokens: 800,
        includeHistory: false,
      });
      return result;
    } catch (e) {
      // If AI synthesis fails, return best source text
      return sources[0]?.text || sources[0]?.excerpt || null;
    }
  }

  // ─── Quick Fact Check ────────────────────────────────────────────────────

  async quickFact(query) {
    // Fast path: DuckDuckGo answer box only
    try {
      const url = `${this.DDG_API}?q=${encodeURIComponent(query)}&format=json&no_html=1`;
      const data = await this._fetch(url);
      if (data?.Answer) return { answer: data.Answer, source: 'DuckDuckGo', confidence: 0.9 };
      if (data?.AbstractText) return { answer: data.AbstractText.slice(0, 300), source: data.AbstractSource, confidence: 0.75 };
    } catch {}
    return null;
  }

  // ─── Distance & Route Info ───────────────────────────────────────────────

  async searchDistance(from, to) {
    return this.research(`distance from ${from} to ${to} km`);
  }

  // ─── CORS Proxy Fetch Wrapper ─────────────────────────────────────────────
  async fetchWithProxy(url) {
    const proxies = [
      target => `https://corsproxy.io/?${encodeURIComponent(target)}`,
      target => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(target)}`,
      target => `https://corsproxy.org/?url=${encodeURIComponent(target)}`,
      target => `https://api.allorigins.win/get?url=${encodeURIComponent(target)}`
    ];

    for (let i = 0; i < proxies.length; i++) {
      try {
        const proxyUrl = proxies[i](url);
        
        // Timeout each proxy try to 5 seconds to keep overall latency low
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        
        const response = await fetch(proxyUrl, { signal: controller.signal });
        clearTimeout(timeout);
        
        if (response.ok) {
          if (proxies[i].toString().includes('allorigins')) {
            const json = await response.json();
            if (json.contents) return json.contents;
          } else {
            const text = await response.text();
            if (text && text.trim().length > 100) return text;
          }
        }
      } catch (err) {
        console.warn(`[Research] Proxy ${i + 1} failed:`, err.message);
      }
    }
    return null;
  }

  // ─── HTTP Fetch Helper ───────────────────────────────────────────────────

  async _fetch(url) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.TIMEOUT);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { 'Accept': 'application/json' },
      });
      if (!response.ok) return null;
      return await response.json();
    } catch (e) {
      if (e.name !== 'AbortError') console.warn('[Research] Fetch error:', e.message);
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }
}

export default LukasResearchAgent;
