// api/search.js — LUKAS Search Backend (Vercel Serverless Function)
// Proxies search queries to multiple real-time search APIs:
//   1. DuckDuckGo Instant Answers (free, no key)
//   2. Brave Search API (free tier: 2000 calls/month)
//   3. Google Serper API (free tier: 2500 calls/month)
//   4. Wikipedia REST API (always free)
//
// Set environment variables in Vercel dashboard:
//   BRAVE_API_KEY   — https://api.search.brave.com/
//   SERPER_API_KEY  — https://serper.dev/

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

  // ── 1. Brave Search API ──────────────────────────────────────────────────
  if (process.env.BRAVE_API_KEY) {
    try {
      const braveRes = await fetch(
        `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(q)}&count=5&country=in&search_lang=en`,
        {
          headers: {
            'Accept': 'application/json',
            'Accept-Encoding': 'gzip',
            'X-Subscription-Token': process.env.BRAVE_API_KEY,
          },
          signal: AbortSignal.timeout(5000),
        }
      );
      if (braveRes.ok) {
        const data = await braveRes.json();

        // FAQ / Answer box
        if (data.faq?.results?.length > 0) {
          const faq = data.faq.results[0];
          results.push({
            source: 'Brave Search (FAQ)',
            title: faq.question || q,
            text: faq.answer || '',
            url: faq.url || '',
            confidence: 0.93,
            type: 'faq',
          });
        }

        // Infobox
        if (data.infobox?.results?.length > 0) {
          const box = data.infobox.results[0];
          const text = box.long_desc || box.description || '';
          if (text) {
            results.push({
              source: 'Brave Search (Infobox)',
              title: box.title || q,
              text,
              url: box.website || '',
              confidence: 0.92,
              type: 'infobox',
            });
          }
        }

        // Organic
        for (const item of (data.web?.results || []).slice(0, 3)) {
          if (item.description) {
            results.push({
              source: `Brave Search (${item.meta_url?.hostname || 'Web'})`,
              title: item.title || '',
              text: item.description,
              url: item.url || '',
              confidence: 0.85,
              type: 'organic',
            });
          }
        }
      }
    } catch (e) {
      console.warn('[Backend] Brave Search failed:', e.message);
    }
  }

  // ── 2. Google Serper API ────────────────────────────────────────────────
  if (process.env.SERPER_API_KEY && results.length < 3) {
    try {
      const serperRes = await fetch('https://google.serper.dev/search', {
        method: 'POST',
        headers: {
          'X-API-KEY': process.env.SERPER_API_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ q, num: 5, gl: 'in', hl: 'en' }),
        signal: AbortSignal.timeout(5000),
      });
      if (serperRes.ok) {
        const data = await serperRes.json();

        // Answer box
        if (data.answerBox) {
          const ab = data.answerBox;
          const text = ab.answer || ab.snippet || (ab.snippetHighlighted || []).join(' ');
          if (text) {
            results.unshift({ // highest priority
              source: 'Google Featured Snippet',
              title: ab.title || q,
              text,
              url: ab.link || '',
              confidence: 0.96,
              type: 'answer_box',
            });
          }
        }

        // Knowledge graph
        if (data.knowledgeGraph?.description) {
          results.push({
            source: 'Google Knowledge Graph',
            title: data.knowledgeGraph.title || q,
            text: data.knowledgeGraph.description,
            url: data.knowledgeGraph.website || '',
            confidence: 0.94,
            type: 'knowledge_graph',
          });
        }

        // Organic
        for (const item of (data.organic || []).slice(0, 3)) {
          if (item.snippet) {
            results.push({
              source: `Google (${item.domain || ''})`,
              title: item.title || '',
              text: item.snippet,
              url: item.link || '',
              confidence: 0.87,
              type: 'organic',
            });
          }
        }
      }
    } catch (e) {
      console.warn('[Backend] Serper failed:', e.message);
    }
  }

  // ── 3. DuckDuckGo Instant (always available, CORS-safe from backend) ────
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

  // ── 4. Wikipedia (always available from server-side) ────────────────────
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

  // Sort by confidence desc
  results.sort((a, b) => (b.confidence || 0) - (a.confidence || 0));

  return res.status(200).json({
    query: q,
    found: results.length > 0,
    results: results.slice(0, 6),
    timestamp: new Date().toISOString(),
    backend: 'lukas-search-v2',
  });
}
