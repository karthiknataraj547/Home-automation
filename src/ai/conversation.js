// ═══════════════════════════════════════════════════════════════════════
// LUKAS Conversation Context Agent
// Tracks entity references across the conversation so LUKAS can
// resolve "that one", "it", "the light", "same temperature" etc.
// Maintains a 20-turn entity-tagged context window.
// ═══════════════════════════════════════════════════════════════════════

class LukasConversationAgent {
  constructor() {
    // Sliding window of turns: { role, content, entities, intent, ts }
    this._turns      = [];
    this._maxTurns   = 20;

    // Last resolved entities per category
    this._lastDevice  = null;   // e.g. { id: 'livingRoomLight', name: 'Living Room Light', type: 'light' }
    this._lastRoom    = null;   // e.g. 'Living Room'
    this._lastAction  = null;   // e.g. 'turn_off'
    this._lastValue   = null;   // e.g. 25 (temperature), 80 (brightness)
    this._lastTopic   = null;   // e.g. 'weather', 'music', 'projector'

    // Pronoun / reference patterns
    this._pronouns = ['it', 'that', 'that one', 'the same', 'those', 'them', 'this one'];
    this._devicePronouns = ['the light', 'the fan', 'the ac', 'the lock', 'the camera', 'the projector'];
  }

  // ─── Turn Recording ───────────────────────────────────────────────────────

  /**
   * Record a conversation turn and extract entities.
   * @param {'user'|'assistant'} role
   * @param {string} content
   * @param {string} intent   e.g. 'home_control', 'conversation'
   */
  recordTurn(role, content, intent = '') {
    const entities = this._extractEntities(content);
    const turn = {
      role, content, intent, entities,
      ts: Date.now()
    };

    this._turns.push(turn);
    if (this._turns.length > this._maxTurns) {
      this._turns.shift();
    }

    // Update last-known context from user turns
    if (role === 'user') {
      this._updateContext(entities, intent);
    }
  }

  // ─── Reference Resolution ─────────────────────────────────────────────────

  /**
   * Resolve vague references in a new user input.
   * Returns an enriched version of the input with references resolved.
   * @param {string} input
   * @returns {{ resolved: string, isFollowUp: boolean, resolvedEntities: object }}
   */
  resolveReferences(input) {
    const lower     = input.toLowerCase().trim();
    const isFollowUp = this._detectFollowUp(lower);
    let resolved     = input;
    const resolvedEntities = {};

    if (!isFollowUp) {
      return { resolved, isFollowUp: false, resolvedEntities };
    }

    // Resolve device references
    if (this._lastDevice && this._containsDevicePronoun(lower)) {
      resolved = resolved.replace(/\b(it|that one?|the light|the fan|the ac|the lock|those|them|this one?)\b/gi,
        this._lastDevice.name);
      resolvedEntities.device = this._lastDevice;
    }

    // Resolve room references
    if (this._lastRoom && lower.includes('same room')) {
      resolved = resolved.replace(/\bsame room\b/gi, this._lastRoom);
      resolvedEntities.room = this._lastRoom;
    }

    // Resolve "same temperature" / "same brightness"
    if (this._lastValue !== null) {
      if (lower.includes('same temperature') || lower.includes('same temp')) {
        resolved = resolved.replace(/same temp(?:erature)?/gi, String(this._lastValue));
        resolvedEntities.value = this._lastValue;
      }
      if (lower.includes('same brightness')) {
        resolved = resolved.replace(/same brightness/gi, String(this._lastValue) + '%');
        resolvedEntities.value = this._lastValue;
      }
    }

    return { resolved, isFollowUp, resolvedEntities };
  }

  // ─── Follow-up Detection ──────────────────────────────────────────────────

  /**
   * Detect if this input is a follow-up / correction to a previous turn.
   * @param {string} lower  Lowercased input
   */
  _detectFollowUp(lower) {
    if (this._turns.length < 2) return false;

    const corrections = [
      'not that', 'not that one', 'no, the other', 'i meant', 'i mean',
      'actually', 'wait, no', 'the other one', 'wrong one', 'change it',
      'not the', 'instead', 'no wait', 'nevermind that'
    ];
    if (corrections.some(c => lower.includes(c))) return true;

    // Contains a pronoun but no new device name → likely a follow-up
    const hasPronoun = this._pronouns.some(p => lower.includes(p)) ||
                       this._devicePronouns.some(p => lower.includes(p));
    const hasNewDevice = this._extractDeviceName(lower) !== null;
    if (hasPronoun && !hasNewDevice) return true;

    // Very short input (likely a correction or clarification)
    const words = lower.split(/\s+/).filter(Boolean);
    if (words.length <= 3 && this._turns.length >= 2) return true;

    return false;
  }

  _containsDevicePronoun(lower) {
    return this._pronouns.some(p => lower.includes(p)) ||
           this._devicePronouns.some(p => lower.includes(p));
  }

  // ─── Entity Extraction ────────────────────────────────────────────────────

  _extractEntities(text) {
    const lower = text.toLowerCase();
    const entities = {};

    // Device type
    const deviceTypes = [
      { pattern: /\b(?:living room|lounge)\s*(?:light|lamp|bulb)?\b/, name: 'Living Room Light', id: 'livingRoomLight', type: 'light', room: 'Living Room' },
      { pattern: /\bbedroom\s*(?:light|lamp|bulb)?\b/, name: 'Bedroom Light', id: 'bedroomLight', type: 'light', room: 'Bedroom' },
      { pattern: /\bkitchen\s*(?:light|lamp|bulb)?\b/, name: 'Kitchen Light', id: 'kitchenLight', type: 'light', room: 'Kitchen' },
      { pattern: /\b(?:outdoor|outside|front door|gate)\s*(?:lock|door)?\b/, name: 'Outdoor Lock', id: 'outdoorLock', type: 'lock', room: 'Outdoor' },
      { pattern: /\b(?:ac|air conditioner|air conditioning|thermostat)\b/, name: 'AC', id: 'climate', type: 'climate', room: null },
      { pattern: /\b(?:fan)\b/, name: 'Fan', id: 'fan', type: 'fan', room: null },
      { pattern: /\b(?:projector|screen|display)\b/, name: 'Projector', id: 'projector', type: 'projector', room: null },
    ];

    for (const dt of deviceTypes) {
      if (dt.pattern.test(lower)) {
        entities.device = { id: dt.id, name: dt.name, type: dt.type };
        if (dt.room) entities.room = dt.room;
        break;
      }
    }

    // Room without device
    if (!entities.room) {
      if (lower.includes('living room')) entities.room = 'Living Room';
      else if (lower.includes('bedroom')) entities.room = 'Bedroom';
      else if (lower.includes('kitchen')) entities.room = 'Kitchen';
      else if (lower.includes('outdoor') || lower.includes('outside')) entities.room = 'Outdoor';
    }

    // Numeric values
    const numMatch = text.match(/\b(\d{1,3})\s*(?:degrees?|°|percent|%|celsius|fahrenheit)?\b/);
    if (numMatch) entities.value = parseInt(numMatch[1]);

    // Action
    if (lower.includes('turn on') || lower.includes('switch on')) entities.action = 'turn_on';
    else if (lower.includes('turn off') || lower.includes('switch off')) entities.action = 'turn_off';
    else if (lower.includes('dim') || lower.includes('brightness')) entities.action = 'dim';
    else if (lower.includes('lock')) entities.action = 'lock';
    else if (lower.includes('unlock')) entities.action = 'unlock';
    else if (lower.includes('set') || lower.includes('change')) entities.action = 'set';

    // Topic (for non-device contexts)
    if (lower.includes('weather')) entities.topic = 'weather';
    else if (lower.includes('music') || lower.includes('song')) entities.topic = 'music';
    else if (lower.includes('game') || lower.includes('play')) entities.topic = 'game';

    return entities;
  }

  _extractDeviceName(lower) {
    const deviceKeywords = ['living room', 'bedroom', 'kitchen', 'outdoor', 'ac', 'fan', 'projector', 'light', 'lock'];
    return deviceKeywords.find(k => lower.includes(k)) || null;
  }

  _updateContext(entities, intent) {
    if (entities.device) this._lastDevice = entities.device;
    if (entities.room)   this._lastRoom   = entities.room;
    if (entities.action) this._lastAction = entities.action;
    if (entities.value !== undefined) this._lastValue = entities.value;
    if (entities.topic)  this._lastTopic  = entities.topic;
  }

  // ─── Context Block ────────────────────────────────────────────────────────

  /**
   * Build a compact context block to inject into AI system prompts.
   * @returns {string}
   */
  buildContextBlock() {
    const parts = [];

    if (this._lastDevice) {
      parts.push(`Last mentioned device: ${this._lastDevice.name} (ID: ${this._lastDevice.id})`);
    }
    if (this._lastRoom) {
      parts.push(`Last mentioned room: ${this._lastRoom}`);
    }
    if (this._lastAction) {
      parts.push(`Last action: ${this._lastAction}`);
    }
    if (this._lastValue !== null) {
      parts.push(`Last numeric value: ${this._lastValue}`);
    }
    if (this._lastTopic) {
      parts.push(`Last topic: ${this._lastTopic}`);
    }

    const recentTurns = this._turns.slice(-4).map(t =>
      `${t.role === 'user' ? 'User' : 'LUKAS'}: ${t.content.slice(0, 120)}`
    ).join('\n');

    if (recentTurns) {
      parts.push(`\nRecent context:\n${recentTurns}`);
    }

    return parts.join('\n');
  }

  /**
   * Get the last N turns for passing to AI.
   */
  getRecentTurns(n = 6) {
    return this._turns.slice(-n);
  }

  /**
   * Get current entity context snapshot.
   */
  getContext() {
    return {
      lastDevice: this._lastDevice,
      lastRoom:   this._lastRoom,
      lastAction: this._lastAction,
      lastValue:  this._lastValue,
      lastTopic:  this._lastTopic,
      turnCount:  this._turns.length
    };
  }

  reset() {
    this._turns      = [];
    this._lastDevice = null;
    this._lastRoom   = null;
    this._lastAction = null;
    this._lastValue  = null;
    this._lastTopic  = null;
  }
}

export default LukasConversationAgent;
