// ═══════════════════════════════════════════════════════════════════════
// LUKAS Research Agent — Multi-Source Real-Time Web Research Engine
// Sources: Wikipedia, DuckDuckGo Instant, Serper/Google (via API), Web Scraping
// ═══════════════════════════════════════════════════════════════════════

import { callLukasAI } from './core.js';

class LukasResearchAgent {
  constructor() {
    this.WIKIPEDIA_API    = 'https://en.wikipedia.org/api/rest_v1/page/summary/';
    this.WIKIPEDIA_SEARCH = 'https://en.wikipedia.org/w/api.php';
    this.DDG_INSTANT_API  = 'https://api.duckduckgo.com/';
    this.SERPER_API       = 'https://google.serper.dev/search';
    this.TIMEOUT          = 9000;

    // CORS proxies tried in order — first success wins
    this._proxies = [
      t => `https://corsproxy.io/?${encodeURIComponent(t)}`,
      t => `https://api.allorigins.win/get?url=${encodeURIComponent(t)}`,
      t => `https://corsproxy.org/?url=${encodeURIComponent(t)}`,
      t => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(t)}`,
    ];
  }

  // ─── Public Entry Point ───────────────────────────────────────────────────

  /**
   * Research a topic using up to 4 real-time sources, then synthesize with AI.
   * @param {string} query
   * @param {{ apiKey?: string, apiProvider?: string, memory?: object, serperKey?: string }} opts
   */
  async research(query, { apiKey = null, apiProvider = 'openai', memory = null, serperKey = null } = {}) {
    console.log(`[Research Agent] Researching: "${query}"`);

    const results = await this._gatherSources(query, serperKey);

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

  async _gatherSources(query, serperKey) {
    const sources = [];
    let confidence = 0;

    const add = (items) => {
      const arr = Array.isArray(items) ? items : (items ? [items] : []);
      for (const s of arr.slice(0, 4)) {
        if (s && s.text && s.text.trim().length > 20) {
          sources.push(s);
          confidence = Math.max(confidence, s.confidence || 0.5);
        }
      }
    };

    // ── Step 1: Try backend API first (server-side, no CORS, aggregates multiple sources) ──
    const backendResults = await this._searchBackend(query);
    if (backendResults && backendResults.length > 0) {
      add(backendResults);
      // Backend already ran Wikipedia & DDG — return early if we got good results
      if (sources.length >= 2 && confidence >= 0.85) {
        return { found: true, sources, confidence, query };
      }
    }

    // ── Step 2: Client-side parallel fallback (if backend unavailable or returned few results) ──
    const [wikiResult, ddgResult, serperResult, scrapedResult] = await Promise.allSettled([
      this._searchWikipedia(query),
      this._searchDDGInstant(query),
      serperKey ? this._searchSerper(query, serperKey) : Promise.resolve(null),
      sources.length < 2 ? this._searchDDGScrape(query) : Promise.resolve(null),
    ]);

    // Priority order: Serper (Google) > Wikipedia > DDG Instant > DDG Scrape
    for (const r of [serperResult, wikiResult, ddgResult, scrapedResult]) {
      if (r.status === 'fulfilled' && r.value) add(r.value);
    }

    return { found: sources.length > 0, sources, confidence, query };
  }

  // ─── Source 0: Backend API (Vercel Serverless — highest quality) ─────────

  async _searchBackend(query) {
    try {
      // Works on both localhost (Vite dev server) and Vercel deployment
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
      // Backend not available (static hosting, offline, etc.) — fall through to client-side
      console.info('[Research Agent] Backend unavailable, using client-side search:', e.message);
    }
    return null;
  }

  // ─── Source 1: Wikipedia (multi-fallback) ────────────────────────────────

  async _searchWikipedia(query) {
    try {
      // Step 1: Direct slug
      const slug = encodeURIComponent(query.replace(/ /g, '_'));
      let data = await this._fetchJSON(`${this.WIKIPEDIA_API}${slug}`);

      // Step 2: OpenSearch fallback
      if (!data?.extract) {
        const searchUrl = `${this.WIKIPEDIA_SEARCH}?action=opensearch&search=${encodeURIComponent(query)}&limit=3&format=json&origin=*`;
        const searchData = await this._fetchJSON(searchUrl);
        if (searchData?.[1]?.length > 0) {
          const bestSlug = encodeURIComponent(searchData[1][0].replace(/ /g, '_'));
          data = await this._fetchJSON(`${this.WIKIPEDIA_API}${bestSlug}`);
        }
      }

      // Step 3: Full-text query search fallback
      if (!data?.extract) {
        const qUrl = `${this.WIKIPEDIA_SEARCH}?action=query&list=search&srsearch=${encodeURIComponent(query)}&limit=3&format=json&origin=*`;
        const qData = await this._fetchJSON(qUrl);
        if (qData?.query?.search?.length > 0) {
          const bestTitle = qData.query.search[0].title;
          const bestSlug = encodeURIComponent(bestTitle.replace(/ /g, '_'));
          data = await this._fetchJSON(`${this.WIKIPEDIA_API}${bestSlug}`);
        }
      }

      if (!data?.extract) return null;

      // Freshness note: Wikipedia is updated continuously but may lag 1-2 days for breaking news
      return {
        source: 'Wikipedia',
        url: data.content_urls?.desktop?.page || `https://en.wikipedia.org/wiki/${slug}`,
        title: data.title,
        excerpt: data.extract?.slice(0, 800),
        text: data.extract,
        confidence: 0.82,
        type: 'encyclopedia',
      };
    } catch (e) {
      console.warn('[Research] Wikipedia error:', e.message);
      return null;
    }
  }

  // ─── Source 2: DuckDuckGo Instant Answers API ───────────────────────────

  async _searchDDGInstant(query) {
    try {
      // DDG Instant Answers API — CORS-friendly, returns structured answer boxes
      const url = `${this.DDG_INSTANT_API}?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
      const data = await this._fetchJSON(url);
      if (!data) return null;

      const results = [];

      // Best case: a direct answer
      if (data.Answer && data.Answer.trim()) {
        results.push({
          source: 'DuckDuckGo Answer',
          url: data.AbstractURL || '',
          title: data.Heading || query,
          excerpt: data.Answer,
          text: data.Answer,
          confidence: 0.92,
          type: 'instant_answer',
        });
      }

      // Abstract text (Wikipedia-backed)
      if (data.AbstractText && data.AbstractText.trim()) {
        results.push({
          source: `DuckDuckGo (via ${data.AbstractSource || 'Web'})`,
          url: data.AbstractURL || '',
          title: data.Heading || query,
          excerpt: data.AbstractText.slice(0, 600),
          text: data.AbstractText,
          confidence: 0.85,
          type: 'abstract',
        });
      }

      // Related topics
      if (data.RelatedTopics?.length > 0) {
        for (const topic of data.RelatedTopics.slice(0, 2)) {
          if (topic.Text && topic.Text.trim().length > 30) {
            results.push({
              source: 'DuckDuckGo Related',
              url: topic.FirstURL || '',
              title: topic.Text.slice(0, 80),
              excerpt: topic.Text.slice(0, 400),
              text: topic.Text,
              confidence: 0.70,
              type: 'related',
            });
          }
        }
      }

      return results.length > 0 ? results : null;
    } catch (e) {
      console.warn('[Research] DDG Instant error:', e.message);
      return null;
    }
  }

  // ─── Source 3: Google Serper API (if key provided) ──────────────────────

  async _searchSerper(query, serperKey) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.TIMEOUT);

      const response = await fetch(this.SERPER_API, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'X-API-KEY': serperKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ q: query, num: 5, gl: 'in', hl: 'en' }),
      });
      clearTimeout(timer);

      if (!response.ok) return null;
      const data = await response.json();

      const results = [];

      // Answer box (highest confidence)
      if (data.answerBox) {
        const ab = data.answerBox;
        const text = ab.answer || ab.snippet || ab.snippetHighlighted?.join(' ') || '';
        if (text) {
          results.push({
            source: 'Google Featured Snippet',
            url: ab.link || '',
            title: ab.title || query,
            excerpt: text.slice(0, 600),
            text: text,
            confidence: 0.96,
            type: 'answer_box',
          });
        }
      }

      // Knowledge panel
      if (data.knowledgeGraph) {
        const kg = data.knowledgeGraph;
        const text = kg.description || '';
        if (text) {
          results.push({
            source: 'Google Knowledge Graph',
            url: kg.website || kg.descriptionLink || '',
            title: kg.title || query,
            excerpt: text.slice(0, 600),
            text: text,
            confidence: 0.94,
            type: 'knowledge_graph',
          });
        }
      }

      // Organic results
      for (const r of (data.organic || []).slice(0, 3)) {
        if (r.snippet && r.snippet.trim()) {
          results.push({
            source: `Google (${r.domain || new URL(r.link).hostname})`,
            url: r.link,
            title: r.title,
            excerpt: r.snippet.slice(0, 500),
            text: r.snippet,
            confidence: 0.88,
            type: 'organic',
          });
        }
      }

      return results.length > 0 ? results : null;
    } catch (e) {
      console.warn('[Research] Serper error:', e.message);
      return null;
    }
  }

  // ─── Source 4: DuckDuckGo HTML Scrape (via CORS proxy chain) ─────────────

  async _searchDDGScrape(query) {
    try {
      const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
      const html = await this.fetchWithProxy(url);
      if (!html) return null;

      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');
      const results = [];

      doc.querySelectorAll('.result').forEach(el => {
        const titleEl = el.querySelector('.result__a');
        const snippetEl = el.querySelector('.result__snippet');
        if (titleEl && snippetEl) {
          const snippet = snippetEl.textContent.trim();
          if (snippet.length > 30) {
            results.push({
              source: 'Web Search (DuckDuckGo)',
              url: titleEl.getAttribute('href') || '',
              title: titleEl.textContent.trim(),
              excerpt: snippet.slice(0, 500),
              text: snippet,
              confidence: 0.75,
              type: 'web_result',
            });
          }
        }
      });

      return results.length > 0 ? results : null;
    } catch (e) {
      console.warn('[Research] DDG scrape error:', e.message);
      return null;
    }
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
      const result = await callLukasAI({
        systemPrompt,
        userMessage: userPrompt,
        memory: null,
        apiKey,
        apiProvider,
        temperature: 0.3,
        maxTokens: 600,
        includeHistory: false,
      });
      return result;
    } catch (e) {
      // AI synthesis failed — return best raw source text
      return sources[0]?.text || sources[0]?.excerpt || null;
    }
  }

  // ─── Quick Fact Check ────────────────────────────────────────────────────

  async quickFact(query) {
    try {
      const url = `${this.DDG_INSTANT_API}?q=${encodeURIComponent(query)}&format=json&no_html=1`;
      const data = await this._fetchJSON(url);
      if (data?.Answer) return { answer: data.Answer, source: 'DuckDuckGo', confidence: 0.92 };
      if (data?.AbstractText) return { answer: data.AbstractText.slice(0, 300), source: data.AbstractSource, confidence: 0.80 };
    } catch {}
    return null;
  }

  // ─── Distance & Route Helpers ─────────────────────────────────────────────

  async searchDistance(from, to) {
    return this.research(`distance from ${from} to ${to}`);
  }

  // ─── CORS Proxy Fetch ─────────────────────────────────────────────────────

  /**
   * Tries up to 4 CORS proxies sequentially; returns raw text/HTML or null.
   */
  async fetchWithProxy(url) {
    for (let i = 0; i < this._proxies.length; i++) {
      try {
        const proxyUrl = this._proxies[i](url);
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 5500);

        const response = await fetch(proxyUrl, { signal: controller.signal });
        clearTimeout(timer);

        if (response.ok) {
          if (proxyUrl.includes('allorigins')) {
            const json = await response.json();
            if (json.contents && json.contents.trim().length > 100) return json.contents;
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

  // ─── JSON Fetch Helper ───────────────────────────────────────────────────

  async _fetchJSON(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.TIMEOUT);
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
      clearTimeout(timer);
    }
  }
}

export default LukasResearchAgent;
