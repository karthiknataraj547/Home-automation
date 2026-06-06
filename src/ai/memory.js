// ═══════════════════════════════════════════════════════════════════════
// LUKAS Memory Engine — Short-term + Long-term Memory System
// Transforms LUKAS from a stateless chatbot to a context-aware AI OS
// ═══════════════════════════════════════════════════════════════════════

class LukasMemory {
  constructor() {
    this.MAX_SHORT_TERM = 30;       // Max messages kept in session
    this.MAX_HISTORY_PROMPT = 12;   // Messages injected into AI prompts
    this.MAX_INTERACTION_LOG = 200; // Interaction history for learning

    // Short-term: in-memory, cleared on page reload
    this.shortTerm = {
      messages: [],         // [{role, content, timestamp, category}]
      activeGoals: [],      // Current user goals being pursued
      contextTags: new Set(), // Topics active in this session
      pendingTasks: [],     // Queued subtasks
      lastIntent: null,     // Last classified intent
      currentProject: null,
      currentGoal: null,
    };

    // Long-term: persisted to localStorage
    this.longTerm = this._loadLongTerm();

    // Auto-migrate any existing reminder data
    this._migrate();

    console.log('[LUKAS Memory] Initialized.', {
      preferences: Object.keys(this.longTerm.preferences).length,
      facts: Object.keys(this.longTerm.facts).length,
      projects: Object.keys(this.longTerm.projects).length,
    });
  }

  // ─── Persistence ─────────────────────────────────────────────────────────

  _loadLongTerm() {
    const safe = (key, fallback) => {
      try { return JSON.parse(localStorage.getItem(key) || 'null') || fallback; }
      catch { return fallback; }
    };
    return {
      preferences: safe('lukas_mem_preferences', {}),
      facts: safe('lukas_mem_facts', {}),
      projects: safe('lukas_mem_projects', {}),
      patterns: safe('lukas_mem_patterns', []),
      interactionLog: safe('lukas_mem_interactions', []),
      sessionCount: safe('lukas_mem_sessions', 0) + 1,
    };
  }

  _saveLongTerm() {
    try {
      localStorage.setItem('lukas_mem_preferences', JSON.stringify(this.longTerm.preferences));
      localStorage.setItem('lukas_mem_facts', JSON.stringify(this.longTerm.facts));
      localStorage.setItem('lukas_mem_projects', JSON.stringify(this.longTerm.projects));
      localStorage.setItem('lukas_mem_patterns', JSON.stringify(this.longTerm.patterns));
      localStorage.setItem('lukas_mem_sessions', JSON.stringify(this.longTerm.sessionCount));
    } catch (e) {
      console.warn('[LUKAS Memory] Storage write failed:', e);
    }
  }

  _migrate() {
    // Lift any old-format preferences into new namespace
    const oldPrefs = ['lukas_muted', 'lukas_vocal_volume', 'lukas_vocal_rate'];
    oldPrefs.forEach(key => {
      const val = localStorage.getItem(key);
      if (val !== null && !this.longTerm.preferences[key]) {
        this.longTerm.preferences[key] = val;
      }
    });
  }

  // ─── Short-Term Message History ──────────────────────────────────────────

  /**
   * Add a message to the conversation history.
   * @param {'user'|'assistant'|'system'} role
   * @param {string} content
   * @param {string} [category] - Intent category for learning
   */
  addMessage(role, content, category = null) {
    this.shortTerm.messages.push({
      role,
      content: content.slice(0, 2000), // Limit individual message length
      timestamp: Date.now(),
      category,
    });

    // Keep rolling window
    if (this.shortTerm.messages.length > this.MAX_SHORT_TERM) {
      this.shortTerm.messages = this.shortTerm.messages.slice(-this.MAX_SHORT_TERM);
    }

    // Track context tags
    if (category) this.shortTerm.contextTags.add(category);
  }

  /**
   * Get last N messages formatted for the AI API (role/content pairs only).
   */
  getHistory(n = null) {
    const count = n ?? this.MAX_HISTORY_PROMPT;
    return this.shortTerm.messages
      .slice(-count)
      .map(({ role, content }) => ({ role, content }));
  }

  /**
   * Get messages as a human-readable string for prompt injection.
   */
  getHistoryAsText(n = 8) {
    const history = this.shortTerm.messages.slice(-n);
    if (!history.length) return '';
    return history
      .map(m => `${m.role === 'user' ? 'User' : 'LUKAS'}: ${m.content}`)
      .join('\n');
  }

  /**
   * Clear short-term memory (new session or user request).
   */
  clearSession() {
    this.shortTerm.messages = [];
    this.shortTerm.contextTags.clear();
    this.shortTerm.activeGoals = [];
    this.shortTerm.pendingTasks = [];
    this.shortTerm.lastIntent = null;
    this.shortTerm.currentProject = null;
    this.shortTerm.currentGoal = null;
  }

  // ─── Long-Term Preferences ───────────────────────────────────────────────

  setPreference(key, value) {
    this.longTerm.preferences[key] = value;
    this._saveLongTerm();
  }

  getPreference(key, defaultValue = null) {
    return this.longTerm.preferences[key] ?? defaultValue;
  }

  getAllPreferences() {
    return { ...this.longTerm.preferences };
  }

  // ─── Long-Term Facts ─────────────────────────────────────────────────────

  addFact(key, value) {
    this.longTerm.facts[key] = { value, timestamp: Date.now() };
    this._saveLongTerm();
  }

  getFact(key) {
    return this.longTerm.facts[key]?.value ?? null;
  }

  getAllFacts() {
    return Object.entries(this.longTerm.facts).reduce((acc, [k, v]) => {
      acc[k] = v.value;
      return acc;
    }, {});
  }

  // ─── Long-Term Projects ──────────────────────────────────────────────────

  setProject(name, data) {
    const existing = this.longTerm.projects[name] || { goals: [], problems: [] };
    this.longTerm.projects[name] = {
      goals: [],
      problems: [],
      ...existing,
      ...data,
      name,
      updatedAt: Date.now()
    };
    this._saveLongTerm();
  }

  getProject(name) {
    return this.longTerm.projects[name] ?? null;
  }

  getAllProjects() {
    return Object.values(this.longTerm.projects);
  }

  updateProjectStatus(name, status) {
    if (this.longTerm.projects[name]) {
      this.longTerm.projects[name].status = status;
      this.longTerm.projects[name].updatedAt = Date.now();
      this._saveLongTerm();
    }
  }

  deleteProject(name) {
    delete this.longTerm.projects[name];
    this._saveLongTerm();
  }

  addProjectGoal(name, goal) {
    if (!this.longTerm.projects[name]) {
      this.setProject(name, { description: 'Auto-created project', status: 'active' });
    }
    const project = this.longTerm.projects[name];
    if (!project.goals) project.goals = [];
    if (!project.goals.includes(goal)) {
      project.goals.push(goal);
      project.updatedAt = Date.now();
      this._saveLongTerm();
    }
  }

  addProjectProblem(name, problem) {
    if (!this.longTerm.projects[name]) {
      this.setProject(name, { description: 'Auto-created project', status: 'active' });
    }
    const project = this.longTerm.projects[name];
    if (!project.problems) project.problems = [];
    if (!project.problems.includes(problem)) {
      project.problems.push(problem);
      project.updatedAt = Date.now();
      this._saveLongTerm();
    }
  }

  clearProjectProblems(name) {
    if (this.longTerm.projects[name]) {
      this.longTerm.projects[name].problems = [];
      this.longTerm.projects[name].updatedAt = Date.now();
      this._saveLongTerm();
    }
  }

  // ─── Context Summary (for Prompt Injection) ──────────────────────────────

  /**
   * Build a rich context block to inject into AI system prompts.
   */
  buildContextBlock() {
    const prefs = this.longTerm.preferences;
    const facts = this.longTerm.facts;
    const projects = Object.values(this.longTerm.projects);
    const topics = [...this.shortTerm.contextTags].slice(-5);

    const lines = [];

    // [WORKING MEMORY]
    lines.push('### [WORKING MEMORY]');
    const name = prefs.name || facts.name?.value || null;
    if (name) lines.push(`User's name: ${name}`);
    if (prefs.location || facts.location?.value) {
      lines.push(`User location: ${prefs.location || facts.location?.value}`);
    }
    if (this.shortTerm.currentProject) lines.push(`Current Project: ${this.shortTerm.currentProject}`);
    if (this.shortTerm.currentGoal) lines.push(`Current Goal: ${this.shortTerm.currentGoal}`);
    if (topics.length > 0) {
      lines.push(`Topics discussed this session: ${topics.join(', ')}`);
    }
    lines.push(`Session #${this.longTerm.sessionCount} with LUKAS`);

    // [PROJECTS MEMORY]
    lines.push('\n### [PROJECTS MEMORY]');
    if (projects.length > 0) {
      const projectList = projects
        .map(p => {
          let pLines = `• Project: ${p.name}${p.status ? ` [${p.status}]` : ''}${p.description ? `: ${p.description}` : ''}`;
          if (p.goals && p.goals.length > 0) {
            pLines += `\n  - Goals: ${p.goals.join(', ')}`;
          }
          if (p.problems && p.problems.length > 0) {
            pLines += `\n  - Problems/Issues: ${p.problems.join(', ')}`;
          }
          return pLines;
        })
        .join('\n');
      lines.push(projectList);
    } else {
      lines.push('No active projects recorded.');
    }

    // [LONG-TERM MEMORY]
    lines.push('\n### [LONG-TERM MEMORY]');
    if (prefs.responseStyle) lines.push(`Prefers: ${prefs.responseStyle} responses`);
    if (prefs.language && prefs.language !== 'en') lines.push(`Language: ${prefs.language}`);
    const factKeys = Object.keys(facts).filter(k => !['name', 'location'].includes(k));
    if (factKeys.length > 0) {
      const factList = factKeys.map(k => `• ${k}: ${facts[k].value}`).join('\n');
      lines.push(`Remembered facts:\n${factList}`);
    } else {
      lines.push('No long-term facts recorded.');
    }

    return lines.join('\n');
  }

  // ─── Auto Fact Extraction ─────────────────────────────────────────────────

  /**
   * Scan user message for facts to auto-store (name, location, preferences, etc.)
   */
  extractAndStoreFacts(userMessage) {
    const patterns = [
      { re: /\bmy name is ([A-Z][a-z]+(?:\s[A-Z][a-z]+)?)/i,    key: 'name' },
      { re: /\bcall me ([A-Z][a-z]+)/i,                          key: 'name' },
      { re: /\bi(?:'m| am) ([A-Z][a-z]+)/i,                     key: 'name', pref: false },
      { re: /\bi live in ([A-Za-z\s,]+?)(?:\.|$)/i,             key: 'location' },
      { re: /\bi(?:'m| am) from ([A-Za-z\s,]+?)(?:\.|$)/i,     key: 'location' },
      { re: /\bi prefer (\w+) responses/i,                       key: 'responseStyle', pref: true },
      { re: /\bi(?:'m| am) working on ([^.?!]+)/i,              key: 'currentProject' },
      { re: /\bmy (?:favorite|favourite) ([^.?!]+?) is ([^.?!]+)/i, keyFn: m => m[1], valFn: m => m[2] },
    ];

    let extracted = false;
    for (const { re, key, pref, keyFn, valFn } of patterns) {
      const match = userMessage.match(re);
      if (match) {
        const k = keyFn ? keyFn(match).toLowerCase().trim() : key;
        const v = valFn ? valFn(match).trim() : match[1].trim();
        if (v && v.length < 80) {
          this.addFact(k, v);
          if (pref !== false && ['name', 'location', 'responseStyle'].includes(k)) {
            this.setPreference(k, v);
          }
          console.log(`[LUKAS Memory] Auto-extracted fact: ${k} = "${v}"`);
          extracted = true;
        }
      }
    }

    // Detect working memory declarations or goals / problems:
    // e.g. "I am starting a project called Store, my goal is to launch it by next week, and the main problem is payment gateway setup."
    // 1. Project name
    const projectMatch = userMessage.match(/(?:working on|building|developing|creating|making|project called)\s+(?:a\s+)?([^.?!,]+?)(?:\s+project|app|system|website|tool)?(?:\.|,|$)/i);
    let currentProjName = this.shortTerm.currentProject;
    if (projectMatch && projectMatch[1].length < 60) {
      currentProjName = projectMatch[1].trim();
      this.shortTerm.currentProject = currentProjName;
      if (!this.longTerm.projects[currentProjName]) {
        this.setProject(currentProjName, { description: `Created from conversation`, status: 'active' });
        console.log(`[LUKAS Memory] Created active project: "${currentProjName}"`);
      }
      extracted = true;
    }

    // 2. Project Goal
    const goalMatch = userMessage.match(/(?:my goal is to|the goal is to|goal is|aim to)\s+([^.?!,]+)/i);
    if (goalMatch && goalMatch[1]) {
      const goalStr = goalMatch[1].trim();
      this.shortTerm.currentGoal = goalStr;
      if (currentProjName) {
        this.addProjectGoal(currentProjName, goalStr);
        console.log(`[LUKAS Memory] Added goal to "${currentProjName}": "${goalStr}"`);
      }
      extracted = true;
    }

    // 3. Project Problem
    const problemMatch = userMessage.match(/(?:main problem is|problem is|issue is|active problem is)\s+([^.?!,]+)/i);
    if (problemMatch && problemMatch[1]) {
      const problemStr = problemMatch[1].trim();
      if (currentProjName) {
        this.addProjectProblem(currentProjName, problemStr);
        console.log(`[LUKAS Memory] Added problem to "${currentProjName}": "${problemStr}"`);
      }
      extracted = true;
    }

    return extracted;
  }

  // ─── Learning from Interactions ──────────────────────────────────────────

  /**
   * Record a completed interaction to learn user patterns.
   */
  learnFromInteraction(userQuery, category, responseQuality = 1.0) {
    const entry = {
      query: userQuery.slice(0, 120),
      category,
      quality: responseQuality,
      timestamp: Date.now(),
    };

    this.longTerm.interactionLog.push(entry);

    // Keep rolling window
    if (this.longTerm.interactionLog.length > this.MAX_INTERACTION_LOG) {
      this.longTerm.interactionLog = this.longTerm.interactionLog.slice(-this.MAX_INTERACTION_LOG);
    }

    // Detect dominant use case pattern
    const recent = this.longTerm.interactionLog.slice(-30);
    const counts = {};
    recent.forEach(e => { counts[e.category] = (counts[e.category] || 0) + 1; });
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    if (top && top[1] >= 5) {
      const wasDifferent = this.longTerm.preferences.dominantUseCase !== top[0];
      this.longTerm.preferences.dominantUseCase = top[0];
      if (wasDifferent) console.log(`[LUKAS Memory] Dominant use case updated: ${top[0]}`);
    }

    // Persist interaction log separately
    try {
      localStorage.setItem('lukas_mem_interactions', JSON.stringify(this.longTerm.interactionLog));
    } catch {}

    this._saveLongTerm();
  }

  // ─── Goal Management ─────────────────────────────────────────────────────

  addGoal(goal) {
    this.shortTerm.activeGoals.push({ goal, createdAt: Date.now(), status: 'active' });
  }

  completeGoal(index) {
    if (this.shortTerm.activeGoals[index]) {
      this.shortTerm.activeGoals[index].status = 'completed';
    }
  }

  getActiveGoals() {
    return this.shortTerm.activeGoals.filter(g => g.status === 'active');
  }

  // ─── Stats & Debug ───────────────────────────────────────────────────────

  getStats() {
    return {
      shortTermMessages: this.shortTerm.messages.length,
      longTermFacts: Object.keys(this.longTerm.facts).length,
      longTermProjects: Object.keys(this.longTerm.projects).length,
      preferences: Object.keys(this.longTerm.preferences).length,
      interactionLog: this.longTerm.interactionLog.length,
      sessionCount: this.longTerm.sessionCount,
      activeGoals: this.shortTerm.activeGoals.length,
      contextTags: [...this.shortTerm.contextTags],
    };
  }

  /**
   * Get a clean Working Memory snapshot for the UI Memory Panel.
   */
  getWorkingMemorySummary() {
    const prefs = this.longTerm.preferences;
    const facts = this.longTerm.facts;
    return {
      userName: prefs.name || facts.name?.value || 'Commander',
      currentProject: this.shortTerm.currentProject || null,
      currentGoal: this.shortTerm.currentGoal || null,
      contextTags: [...this.shortTerm.contextTags].slice(-6),
      sessionCount: this.longTerm.sessionCount,
      messageCount: this.shortTerm.messages.length,
      dominantUseCase: prefs.dominantUseCase || null,
      location: prefs.location || facts.location?.value || null,
    };
  }

  /**
   * Get active project summaries for the UI Memory Panel.
   */
  getProjectMemorySummary() {
    return Object.values(this.longTerm.projects)
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
      .slice(0, 5)
      .map(p => ({
        name: p.name,
        status: p.status || 'active',
        description: p.description || '',
        goals: (p.goals || []).slice(0, 3),
        problems: (p.problems || []).slice(0, 2),
        updatedAt: p.updatedAt ? new Date(p.updatedAt).toLocaleDateString() : 'Unknown',
      }));
  }

  /**
   * Get long-term facts for the UI Memory Panel.
   */
  getLongTermFactsSummary() {
    const prefs = this.longTerm.preferences;
    const facts = this.longTerm.facts;
    const items = [];
    const keyLabels = { name: 'Name', location: 'Location', responseStyle: 'Style', dominantUseCase: 'Top Use' };
    for (const [k, v] of Object.entries(facts)) {
      if (items.length >= 8) break;
      items.push({ key: keyLabels[k] || k, value: v.value });
    }
    if (prefs.responseStyle && !facts.responseStyle) items.push({ key: 'Response Style', value: prefs.responseStyle });
    if (prefs.dominantUseCase) items.push({ key: 'Top Activity', value: prefs.dominantUseCase });
    return items;
  }

  exportMemory() {
    return {
      shortTerm: {
        messages: this.shortTerm.messages,
        activeGoals: this.shortTerm.activeGoals,
        contextTags: [...this.shortTerm.contextTags],
      },
      longTerm: this.longTerm,
    };
  }

  clearAllMemory() {
    this.clearSession();
    this.longTerm = { preferences: {}, facts: {}, projects: {}, patterns: [], interactionLog: [], sessionCount: 0 };
    ['lukas_mem_preferences','lukas_mem_facts','lukas_mem_projects','lukas_mem_patterns','lukas_mem_sessions','lukas_mem_interactions']
      .forEach(k => localStorage.removeItem(k));
    console.log('[LUKAS Memory] All memory cleared.');
  }
}

export default LukasMemory;
