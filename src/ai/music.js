// ═══════════════════════════════════════════════════════════════════════
// LUKAS Music Intelligence Engine — Song Search & Smart Playback
// Resolves any song/artist/genre request to a streamable audio URL
// Backend: Invidious (YouTube proxy), no API key required
// Falls back through multiple public instances automatically
// ═══════════════════════════════════════════════════════════════════════

class LukasMusicEngine {
  constructor() {
    // Invidious public instances — tried in order, first success wins
    // These are community-run YouTube proxies with no auth required
    this._invidiousInstances = [
      'https://invidious.io.lol',
      'https://inv.nadeko.net',
      'https://invidious.nerdvpn.de',
      'https://invidious.privacyredirect.com',
      'https://invidious.perennialte.ch',
    ];

    // LUKAS built-in curated playlist — always available offline
    this.builtInPlaylist = [
      { id: 'builtin_1',  title: 'Viper (Synthwave)',        artist: 'MDN Audio Lab',       url: 'https://raw.githubusercontent.com/mdn/webaudio-examples/main/audio-analyser/viper.mp3',           genre: ['synthwave', 'electronic'] },
      { id: 'builtin_2',  title: 'Outfoxing (Cyberpunk)',    artist: 'MDN Audio Lab',       url: 'https://raw.githubusercontent.com/mdn/webaudio-examples/main/output-timestamp/outfoxing.mp3',     genre: ['cyberpunk', 'electronic'] },
      { id: 'builtin_3',  title: 'Ambient Horizon',          artist: 'Lukas Synth Engine',  url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3',                                   genre: ['ambient', 'chill'] },
      { id: 'builtin_4',  title: 'Cybernetic Pulse',         artist: 'Jarvis Wave Generator',url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3',                                   genre: ['cyberpunk', 'electronic'] },
      { id: 'builtin_5',  title: 'Neural Symphony',          artist: 'Lukas Synth Engine',  url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3',                                   genre: ['ambient', 'classical'] },
      { id: 'builtin_6',  title: 'Bollywood Hits (Live)',    artist: 'Vividh Bharati Radio', url: 'https://vividhbharati-lh.akamaihd.net/i/vividhbharati_1@507811/index_1_a-p.m3u8',               genre: ['bollywood', 'hindi', 'indian', 'desi'] },
      { id: 'builtin_7',  title: 'Ghazal Radio (Mirchi)',    artist: 'Mirchi Mehfil',       url: 'https://mirchimahfil-lh.akamaihd.net/i/MirchiMehfl_1@120798/index_1_a-b.m3u8',                   genre: ['ghazal', 'hindi', 'urdu'] },
      { id: 'builtin_8',  title: 'Kannada Hits (AIR)',       artist: 'AIR Kannada',         url: 'https://airkannada-lh.akamaihd.net/i/airkannada_1@507819/master.m3u8',                            genre: ['kannada', 'karnataka', 'regional'] },
      { id: 'builtin_9',  title: 'Classic Rock Radio',       artist: 'SoundHelix Radio',    url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-4.mp3',                                   genre: ['rock', 'classic'] },
      { id: 'builtin_10', title: 'Jazz Lounge',              artist: 'SoundHelix Jazz',     url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-5.mp3',                                   genre: ['jazz', 'lounge', 'chill'] },
    ];

    // User-added songs (from custom URL input or search)
    this._userTracks = JSON.parse(localStorage.getItem('lukas_user_tracks') || '[]');

    // Active search cache to avoid repeat API calls
    this._searchCache = new Map();

    // Current state
    this.currentTrack = null;
    this.history = [];

    console.log('[LUKAS Music] Engine initialized.', {
      builtIn: this.builtInPlaylist.length,
      userTracks: this._userTracks.length,
    });
  }

  // ─── Public API ──────────────────────────────────────────────────────────

  /**
   * The main entry point — resolve any music request to a track.
   * Returns { track, source, message } or null if not found.
   *
   * @param {string} query - Natural language: "play blinding lights", "play something by arijit"
   * @returns {Promise<{track, source, message}>}
   */
  async resolveRequest(query) {
    const q = query.toLowerCase().trim();

    console.log(`[LUKAS Music] Resolving: "${query}"`);

    const searchQuery = this._extractSearchQuery(q);

    // If the user specified a specific track/artist, search for it first
    if (searchQuery) {
      // 1. Check user-added tracks (saved library) using the specific search query
      const userMatch = this._matchUserTrack(searchQuery);
      if (userMatch) {
        console.log(`[LUKAS Music] User track match: "${userMatch.title}"`);
        return {
          track: userMatch,
          source: 'user_library',
          message: `Playing "${userMatch.title}" by ${userMatch.artist} from your saved tracks.`,
        };
      }

      // 2. Search via backend (/api/music-search) — uses Invidious YouTube proxy
      try {
        const result = await this._searchMusic(searchQuery);
        if (result) {
          console.log(`[LUKAS Music] Found via search: "${result.title}"`);
          return {
            track: result,
            source: 'youtube',
            message: `Found "${result.title}" by ${result.artist}. Playing now.`,
          };
        }
      } catch (e) {
        console.warn('[LUKAS Music] Search failed:', e.message);
      }
    }

    // 3. Fallback to genre/mood request if no specific song was found or requested
    const genreTrack = this._matchGenre(q);
    if (genreTrack) {
      console.log(`[LUKAS Music] Genre match: "${genreTrack.title}"`);
      return {
        track: genreTrack,
        source: 'builtin',
        message: `Playing ${genreTrack.title} from your LUKAS library.`,
      };
    }

    // 4. Fallback — best builtIn match by keyword
    const keywordMatch = this._fuzzyMatchBuiltin(searchQuery || q);
    if (keywordMatch) {
      return {
        track: keywordMatch,
        source: 'builtin_fuzzy',
        message: `I couldn't find that exact song, but playing "${keywordMatch.title}" which seems close.`,
      };
    }

    return null;
  }
  /**
   * Add a track from a direct URL (from the custom stream input box).
   */
  addUserTrack(title, artist, url) {
    const track = {
      id: 'user_' + Date.now(),
      title,
      artist: artist || 'Unknown Artist',
      url,
      genre: ['custom'],
      addedAt: Date.now(),
    };
    this._userTracks.push(track);
    this._saveUserTracks();
    return track;
  }

  /**
   * Save a searched YouTube track for offline reference.
   */
  saveToLibrary(track) {
    const exists = this._userTracks.find(t => t.id === track.id);
    if (!exists) {
      this._userTracks.push({ ...track, savedAt: Date.now() });
      this._saveUserTracks();
    }
  }

  /**
   * Get the full combined playlist for the media widget.
   */
  getFullPlaylist() {
    return [...this.builtInPlaylist, ...this._userTracks];
  }

  /**
   * Parse what the user is trying to play from their raw command.
   * Returns a clean search string for the music engine.
   *
   * Examples:
   *   "play blinding lights" → "blinding lights"
   *   "play something by arijit singh" → "arijit singh"
   *   "play hindi songs" → null (genre, not specific song)
   *   "play kesariya by arijit singh" → "kesariya arijit singh"
   */
  static parseMediaCommand(rawInput) {
    let text = rawInput.toLowerCase().trim();

    // Strip filler words
    text = text
      .replace(/\b(lukas|hey lukas|ok lukas|alexa)\b/gi, '')
      .replace(/\b(please|can you|could you|would you|i want to|i'd like to)\b/gi, '')
      .replace(/\b(play|start|put on|queue|stream|listen to|play me|play some|play a|play an)\b/gi, '')
      .replace(/\b(music|song|songs|track|tracks|audio|sounds?)\b/gi, '')
      .replace(/\b(something by|some|a song by|songs by|by)\b/gi, '')
      .trim();

    // Check genre words — return null so we handle as genre, not song search
    const genreWords = ['bollywood', 'hindi', 'kannada', 'telugu', 'tamil', 'punjabi', 'marathi', 'jazz', 'rock', 'pop', 'ambient', 'lofi', 'classical', 'ghazal', 'synthwave', 'cyberpunk', 'electronic', 'chill', 'relaxing', 'sad', 'happy', 'workout', 'focus'];
    const isGenreOnly = genreWords.some(g => text === g || text === g + 's');
    if (isGenreOnly) return null;

    return text.length > 1 ? text : null;
  }

  // ─── Genre Matching ────────────────────────────────────────────────────────

  _matchGenre(query) {
    const genreMap = {
      'bollywood': ['bollywood', 'hindi', 'desi', 'indian'],
      'hindi': ['bollywood', 'hindi', 'desi', 'indian'],
      'kannada': ['kannada', 'karnataka', 'bengaluru', 'bangalore'],
      'telugu': ['telugu'],
      'ghazal': ['ghazal', 'urdu'],
      'synthwave': ['synthwave', 'electronic', 'viper'],
      'cyberpunk': ['cyberpunk', 'electronic', 'outfoxing'],
      'ambient': ['ambient', 'chill', 'relaxing', 'lofi', 'focus'],
      'jazz': ['jazz', 'lounge'],
      'rock': ['rock', 'classic rock'],
      'classical': ['classical', 'orchestra'],
    };

    for (const [genre, keywords] of Object.entries(genreMap)) {
      if (keywords.some(k => query.includes(k))) {
        // Find the best built-in track for this genre
        const match = this.builtInPlaylist.find(t =>
          t.genre.some(g => keywords.includes(g.toLowerCase()))
        );
        if (match) return match;
      }
    }
    return null;
  }

  // ─── User Track Matching ───────────────────────────────────────────────────

  _matchUserTrack(query) {
    // Score each user track by title+artist overlap
    let bestScore = 0;
    let bestTrack = null;

    for (const track of this._userTracks) {
      const haystack = `${track.title} ${track.artist}`.toLowerCase();
      const score = this._fuzzyScore(query, haystack);
      if (score > bestScore) {
        bestScore = score;
        bestTrack = track;
      }
    }

    return bestScore >= 0.4 ? bestTrack : null;
  }

  // ─── Built-in Fuzzy Match ──────────────────────────────────────────────────

  _fuzzyMatchBuiltin(query) {
    let bestScore = 0;
    let bestTrack = null;

    for (const track of this.builtInPlaylist) {
      const haystack = `${track.title} ${track.artist} ${track.genre.join(' ')}`.toLowerCase();
      const score = this._fuzzyScore(query, haystack);
      if (score > bestScore) {
        bestScore = score;
        bestTrack = track;
      }
    }

    return bestScore > 0.15 ? bestTrack : null;
  }

  // ─── Fuzzy Score (simple word overlap ratio) ───────────────────────────────

  _fuzzyScore(query, target) {
    const queryWords = query.split(/\s+/).filter(w => w.length > 1);
    if (!queryWords.length) return 0;
    const matches = queryWords.filter(w => target.includes(w)).length;
    return matches / queryWords.length;
  }

  // ─── Extract Clean Search Query ────────────────────────────────────────────

  _extractSearchQuery(query) {
    return LukasMusicEngine.parseMediaCommand(query);
  }

  // ─── Backend Music Search ──────────────────────────────────────────────────

  /**
   * Search for a song via the LUKAS backend (/api/music-search).
   * Backend uses Invidious to get YouTube video metadata + audio stream URL.
   */
  async _searchMusic(query) {
    // Check cache first
    const cacheKey = query.toLowerCase().trim();
    if (this._searchCache.has(cacheKey)) {
      console.log(`[LUKAS Music] Cache hit: "${query}"`);
      return this._searchCache.get(cacheKey);
    }

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 12000);

      const response = await fetch('/api/music-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({ query }),
      });
      clearTimeout(timer);

      if (!response.ok) throw new Error(`Backend returned ${response.status}`);

      const data = await response.json();

      if (data.found && data.track) {
        const track = {
          id: 'yt_' + data.track.videoId,
          title: data.track.title,
          artist: data.track.author || 'Unknown Artist',
          url: data.track.audioUrl,
          thumbnail: data.track.thumbnail || '',
          duration: data.track.duration || 0,
          genre: ['search'],
          videoId: data.track.videoId,
        };

        // Cache it
        this._searchCache.set(cacheKey, track);
        return track;
      }
    } catch (e) {
      if (e.name === 'AbortError') {
        console.warn('[LUKAS Music] Search timed out.');
      } else {
        console.warn('[LUKAS Music] Backend search failed, trying direct Invidious:', e.message);
      }

      // Direct client-side Invidious fallback
      return await this._searchInvidiousDirect(query);
    }

    return null;
  }

  /**
   * Direct client-side Invidious fallback (when backend unavailable).
   * Tries each public instance in sequence.
   */
  async _searchInvidiousDirect(query) {
    for (const instance of this._invidiousInstances) {
      try {
        const searchUrl = `${instance}/api/v1/search?q=${encodeURIComponent(query + ' audio')}&type=video&fields=videoId,title,author,lengthSeconds,videoThumbnails`;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 6000);

        const response = await fetch(searchUrl, { signal: controller.signal });
        clearTimeout(timer);

        if (!response.ok) continue;

        const results = await response.json();
        if (!Array.isArray(results) || results.length === 0) continue;

        // Pick the best result (prefer official audio/topic channels)
        const best = this._pickBestResult(results, query);
        if (!best) continue;

        // Get audio stream URL for this video
        const audioUrl = await this._getAudioStreamUrl(instance, best.videoId);
        if (!audioUrl) continue;

        const track = {
          id: 'yt_' + best.videoId,
          title: best.title,
          artist: best.author || 'Unknown Artist',
          url: audioUrl,
          thumbnail: best.videoThumbnails?.[0]?.url || '',
          duration: best.lengthSeconds || 0,
          genre: ['search'],
          videoId: best.videoId,
        };

        // Cache it
        const cacheKey = query.toLowerCase().trim();
        this._searchCache.set(cacheKey, track);
        return track;

      } catch (e) {
        console.warn(`[LUKAS Music] Invidious ${instance} failed:`, e.message);
      }
    }

    return null;
  }

  /**
   * Get a direct audio stream URL from an Invidious instance.
   * Returns the best audio-only format URL.
   */
  async _getAudioStreamUrl(instance, videoId) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 6000);

      const url = `${instance}/api/v1/videos/${videoId}?fields=adaptiveFormats,formatStreams`;
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);

      if (!response.ok) return null;

      const data = await response.json();

      // Prefer audio-only adaptive formats
      const audioFormats = (data.adaptiveFormats || [])
        .filter(f => f.type && f.type.startsWith('audio/') && f.url)
        .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));

      if (audioFormats.length > 0) {
        return audioFormats[0].url;
      }

      // Fall back to combined format (has both video and audio)
      const combined = (data.formatStreams || []).find(f => f.url);
      if (combined) return combined.url;

    } catch (e) {
      console.warn('[LUKAS Music] Stream URL fetch failed:', e.message);
    }

    return null;
  }

  /**
   * Pick the best search result — prefers official/topic channels and short-ish duration.
   */
  _pickBestResult(results, query) {
    if (!results.length) return null;

    const qLower = query.toLowerCase();

    // Score each result
    const scored = results.slice(0, 8).map(r => {
      let score = 0;
      const title = (r.title || '').toLowerCase();
      const author = (r.author || '').toLowerCase();

      // Title relevance
      const queryWords = qLower.split(/\s+/).filter(w => w.length > 1);
      const titleMatches = queryWords.filter(w => title.includes(w)).length;
      score += (titleMatches / Math.max(queryWords.length, 1)) * 50;

      // Official/topic channels get a boost
      if (author.includes('- topic') || author.includes('vevo') || author.includes('official')) {
        score += 30;
      }

      // Prefer reasonable duration (1-8 minutes for songs)
      const dur = r.lengthSeconds || 0;
      if (dur > 60 && dur < 480) score += 20;
      else if (dur > 480) score -= 10; // Too long (probably a full album/playlist)

      // Penalize mixes, compilations, playlists in title
      if (title.includes('mix') || title.includes('compilation') || title.includes('playlist') || title.includes('full album')) {
        score -= 20;
      }

      return { result: r, score };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored[0]?.result || results[0];
  }

  // ─── Persistence ───────────────────────────────────────────────────────────

  _saveUserTracks() {
    try {
      localStorage.setItem('lukas_user_tracks', JSON.stringify(this._userTracks.slice(-50)));
    } catch (e) {
      console.warn('[LUKAS Music] Failed to save user tracks:', e);
    }
  }
}

export default LukasMusicEngine;
