// api/search.js — LUKAS Search Backend (Vercel Serverless Function)
// Proxies search queries to multiple real-time search APIs:
//   1. SerpAPI — Google Search (https://serpapi.com) — set SERPER_API_KEY
//   2. DuckDuckGo Instant Answers (free, no key needed)
//   3. Wikipedia REST API (always free)
//
// Set in Vercel Environment Variables:
//   SERPER_API_KEY = your SerpAPI key from https://serpapi.com/

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const query = req.method === 'POST' ? req.body?.query : req.query?.q;

  if (!query || typeof query !== 'string') {
    return res.status(400).json({ error: 'Missing query parameter' });
  }

  const q = query.trim();
  const results = [];

  // ── 1. SerpAPI — Google Search (highest quality, real-time) ─────────────
  const serpApiKey = process.env.SERPER_API_KEY;
  if (serpApiKey) {
    try {
      const serpUrl = `https://serpapi.com/search?engine=google&q=${encodeURIComponent(q)}&api_key=${serpApiKey}&gl=in&hl=en&num=5&no_cache=false`;
      const serpRes = await fetch(serpUrl, {
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(8000),
      });

      if (serpRes.ok) {
        const data = await serpRes.json();

        // Answer Box — highest confidence (e.g. "who is the PM of India?")
        if (data.answer_box) {
          const ab = data.answer_box;
          const text = ab.answer || ab.snippet || (Array.isArray(ab.list) ? ab.list.join(', ') : '') || '';
          if (text) {
            results.push({
              source: 'Google Answer Box',
              title: ab.title || q,
              text: text.trim(),
              url: ab.link || '',
              confidence: 0.97,
              type: 'answer_box',
            });
          }
        }

        // Knowledge Graph (e.g. famous people, places, companies)
        if (data.knowledge_graph) {
          const kg = data.knowledge_graph;
          const text = kg.description || '';
          const extraFacts = Object.entries(kg)
            .filter(([k]) => !['title','type','description','header_images','source','knowledge_graph_search_link'].includes(k))
            .slice(0, 4)
            .map(([k, v]) => `${k}: ${v}`)
            .join(', ');
          const fullText = [text, extraFacts].filter(Boolean).join(' | ');
          if (fullText) {
            results.push({
              source: 'Google Knowledge Graph',
              title: kg.title || q,
              text: fullText,
              url: kg.website || '',
              confidence: 0.95,
              type: 'knowledge_graph',
            });
          }
        }

        // Organic search results (top 4)
        for (const item of (data.organic_results || []).slice(0, 4)) {
          const text = item.snippet || '';
          if (text) {
            let domain = '';
            try { domain = new URL(item.link).hostname; } catch {}
            results.push({
              source: `Google (${domain})`,
              title: item.title || '',
              text,
              url: item.link || '',
              confidence: 0.87,
              type: 'organic',
            });
          }
        }

        console.log(`[SerpAPI] Found ${results.length} results for: "${q}"`);
      } else {
        const errText = await serpRes.text();
        console.warn('[SerpAPI] Non-OK response:', serpRes.status, errText.slice(0, 200));
      }
    } catch (e) {
      console.warn('[Backend] SerpAPI failed:', e.message);
    }
  } else {
    console.warn('[Backend] SERPER_API_KEY not set — SerpAPI skipped');
  }

  // ── 2. DuckDuckGo Instant (free, always available as fallback) ───────────
  try {
    const ddgRes = await fetch(
      `https://api.duckduckgo.com/?q=${encodeURIComponent(q)}&format=json&no_html=1&skip_disambig=1`,
      { signal: AbortSignal.timeout(5000) }
    );
    if (ddgRes.ok) {
      const data = await ddgRes.json();
      if (data.Answer) {
        results.push({
          source: 'DuckDuckGo Instant',
          title: data.Heading || q,
          text: data.Answer,
          url: '',
          confidence: 0.91,
          type: 'instant_answer',
        });
      }
      if (data.AbstractText) {
        results.push({
          source: `DuckDuckGo (${data.AbstractSource || 'Web'})`,
          title: data.Heading || q,
          text: data.AbstractText,
          url: data.AbstractURL || '',
          confidence: 0.83,
          type: 'abstract',
        });
      }
    }
  } catch (e) {
    console.warn('[Backend] DDG Instant failed:', e.message);
  }

  // ── 3. Wikipedia (always available, high accuracy for factual topics) ────
  if (results.length < 2) {
    try {
      const wikiSearchRes = await fetch(
        `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(q)}&limit=2&format=json`,
        { signal: AbortSignal.timeout(5000) }
      );
      if (wikiSearchRes.ok) {
        const wikiSearch = await wikiSearchRes.json();
        if (wikiSearch.query?.search?.length > 0) {
          const title = wikiSearch.query.search[0].title;
          const wikiSummary = await fetch(
            `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}`,
            { signal: AbortSignal.timeout(5000) }
          );
          if (wikiSummary.ok) {
            const wikiData = await wikiSummary.json();
            if (wikiData.extract) {
              results.push({
                source: 'Wikipedia',
                title: wikiData.title,
                text: wikiData.extract,
                url: wikiData.content_urls?.desktop?.page || '',
                confidence: 0.82,
                type: 'encyclopedia',
              });
            }
          }
        }
      }
    } catch (e) {
      console.warn('[Backend] Wikipedia failed:', e.message);
    }
  }

  // Sort by confidence descending
  results.sort((a, b) => (b.confidence || 0) - (a.confidence || 0));

  return res.status(200).json({
    query: q,
    found: results.length > 0,
    results: results.slice(0, 6),
    timestamp: new Date().toISOString(),
    backend: 'lukas-search-serpapi-v2',
    serpapi_used: !!serpApiKey,
  });
}
