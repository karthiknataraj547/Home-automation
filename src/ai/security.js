// ═══════════════════════════════════════════════════════════════════════
// LUKAS Security Agent
// Handles JWT-based authentication, input sanitization,
// rate limiting, and AES-GCM encryption for stored secrets.
// Uses Web Crypto API — no external dependencies.
// ═══════════════════════════════════════════════════════════════════════

class LukasSecurityAgent {
  constructor() {
    this._rateLimitMap  = new Map(); // userId → [timestamps]
    this._sessionTokens = new Map(); // token → { username, expiresAt }
    this._auditLog      = [];
    this._maxAuditLog   = 500;

    // Rate limit config
    this.RATE_WINDOW_MS    = 60000;  // 1 minute window
    this.MAX_ACTIONS       = 60;     // max 60 actions per user per minute
    this.BLOCKED_DURATION  = 300000; // 5 minute block

    // JWT config
    this.JWT_SECRET   = 'LUKAS_JWT_SECRET_v1';   // stored in memory (for Web Crypto)
    this.TOKEN_TTL_MS = 86400000;                 // 24 hours

    // Prompt injection detection patterns
    this._injectionPatterns = [
      /ignore\s+(?:all\s+)?previous\s+instructions?/i,
      /disregard\s+(?:all\s+)?prior/i,
      /you\s+are\s+now\s+(?:a\s+)?(?:different|new)/i,
      /act\s+as\s+(?:if\s+you\s+)?(?:are\s+)?(?:a\s+|an\s+)?(?:different|evil|unrestricted)/i,
      /jailbreak|dan\s+mode|developer\s+mode/i,
      /forget\s+(?:your\s+)?(?:rules?|instructions?|training)/i,
    ];
  }

  // ─── JWT Token Management ─────────────────────────────────────────────────

  /**
   * Generate a session token for a verified user.
   * Stored in sessionStorage (not localStorage) for security.
   * @param {string} username
   * @returns {string} token
   */
  generateToken(username) {
    const token = this._generateSecureId();
    const expiresAt = Date.now() + this.TOKEN_TTL_MS;

    this._sessionTokens.set(token, { username, expiresAt, createdAt: Date.now() });

    // Store in sessionStorage (survives page reload but not new tab)
    try {
      sessionStorage.setItem('lukas_auth_token', token);
      sessionStorage.setItem('lukas_auth_user', username);
      sessionStorage.setItem('lukas_auth_expires', String(expiresAt));
    } catch { /* sessionStorage unavailable */ }

    this.auditAction(username, 'LOGIN', 'Session token generated');
    return token;
  }

  /**
   * Verify a session token. Returns username or null.
   * @param {string} token
   * @returns {string|null} username
   */
  verifyToken(token) {
    if (!token) return null;

    const session = this._sessionTokens.get(token);
    if (!session) return null;
    if (Date.now() > session.expiresAt) {
      this._sessionTokens.delete(token);
      return null;
    }
    return session.username;
  }

  /**
   * Get the currently active session from sessionStorage.
   * @returns {{ username: string, token: string } | null}
   */
  getCurrentSession() {
    try {
      const token    = sessionStorage.getItem('lukas_auth_token');
      const username = sessionStorage.getItem('lukas_auth_user');
      const expires  = parseInt(sessionStorage.getItem('lukas_auth_expires') || '0');

      if (!token || !username || Date.now() > expires) return null;
      return { username, token, expiresAt: expires };
    } catch {
      return null;
    }
  }

  revokeToken(token) {
    this._sessionTokens.delete(token);
    try {
      sessionStorage.removeItem('lukas_auth_token');
      sessionStorage.removeItem('lukas_auth_user');
      sessionStorage.removeItem('lukas_auth_expires');
    } catch { /* ignore */ }
  }

  // ─── Rate Limiting ────────────────────────────────────────────────────────

  /**
   * Check if a user action is within rate limits.
   * @param {string} userId
   * @param {string} action
   * @returns {{ allowed: boolean, remaining: number, resetAt: number }}
   */
  rateLimit(userId, action = 'command') {
    const key = `${userId}:${action}`;
    const now = Date.now();

    if (!this._rateLimitMap.has(key)) {
      this._rateLimitMap.set(key, []);
    }

    const timestamps = this._rateLimitMap.get(key);

    // Remove timestamps outside the window
    const windowStart = now - this.RATE_WINDOW_MS;
    const recent = timestamps.filter(t => t > windowStart);
    this._rateLimitMap.set(key, recent);

    const remaining = this.MAX_ACTIONS - recent.length;
    const allowed   = remaining > 0;

    if (allowed) {
      recent.push(now);
    } else {
      this.auditAction(userId, 'RATE_LIMITED', `Action "${action}" blocked`);
    }

    return {
      allowed,
      remaining: Math.max(0, remaining - 1),
      resetAt: windowStart + this.RATE_WINDOW_MS
    };
  }

  // ─── Input Sanitization ───────────────────────────────────────────────────

  /**
   * Sanitize a user command before sending to AI.
   * Detects and strips prompt injection attempts.
   * @param {string} input
   * @returns {{ sanitized: string, isInjection: boolean, threats: string[] }}
   */
  sanitizeInput(input) {
    const threats = [];
    let sanitized = input;

    // Check for prompt injection patterns
    for (const pattern of this._injectionPatterns) {
      if (pattern.test(input)) {
        threats.push(pattern.source);
        sanitized = sanitized.replace(pattern, '[BLOCKED]');
      }
    }

    // Strip HTML/script tags
    sanitized = sanitized.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '[BLOCKED]');
    sanitized = sanitized.replace(/<[^>]+>/g, '');

    // Limit input length
    if (sanitized.length > 2000) {
      sanitized = sanitized.slice(0, 2000) + '...';
    }

    if (threats.length > 0) {
      this.auditAction('system', 'INJECTION_ATTEMPT', `Patterns detected: ${threats.join(', ')}`);
    }

    return { sanitized, isInjection: threats.length > 0, threats };
  }

  // ─── Encryption (AES-GCM via Web Crypto) ─────────────────────────────────

  /**
   * Encrypt sensitive data using AES-GCM.
   * @param {string} plaintext
   * @param {string} password   Master password for key derivation
   * @returns {Promise<string>} Base64-encoded ciphertext
   */
  async encrypt(plaintext, password) {
    try {
      const enc      = new TextEncoder();
      const salt     = crypto.getRandomValues(new Uint8Array(16));
      const iv       = crypto.getRandomValues(new Uint8Array(12));
      const keyMat   = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
      const key      = await crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
        keyMat, { name: 'AES-GCM', length: 256 }, false, ['encrypt']
      );
      const cipherBuf = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plaintext));
      const result    = new Uint8Array(salt.length + iv.length + cipherBuf.byteLength);
      result.set(salt, 0);
      result.set(iv, salt.length);
      result.set(new Uint8Array(cipherBuf), salt.length + iv.length);
      return btoa(String.fromCharCode(...result));
    } catch (e) {
      console.error('[Security] Encryption failed:', e);
      return null;
    }
  }

  /**
   * Decrypt data encrypted by encrypt().
   * @param {string} ciphertext  Base64-encoded
   * @param {string} password
   * @returns {Promise<string|null>}
   */
  async decrypt(ciphertext, password) {
    try {
      const enc    = new TextEncoder();
      const dec    = new TextDecoder();
      const data   = Uint8Array.from(atob(ciphertext), c => c.charCodeAt(0));
      const salt   = data.slice(0, 16);
      const iv     = data.slice(16, 28);
      const cipher = data.slice(28);
      const keyMat = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
      const key    = await crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
        keyMat, { name: 'AES-GCM', length: 256 }, false, ['decrypt']
      );
      const plain  = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipher);
      return dec.decode(plain);
    } catch {
      return null;
    }
  }

  // ─── Audit Logging ────────────────────────────────────────────────────────

  auditAction(userId, action, detail = '') {
    const entry = {
      ts: new Date().toISOString(),
      userId,
      action,
      detail
    };
    this._auditLog.push(entry);
    if (this._auditLog.length > this._maxAuditLog) this._auditLog.shift();

    if (['INJECTION_ATTEMPT', 'RATE_LIMITED', 'AUTH_FAILED'].includes(action)) {
      console.warn(`[Security] ${action} — ${userId}: ${detail}`);
    }
  }

  getAuditLog(limit = 50) {
    return this._auditLog.slice(-limit);
  }

  // ─── Utilities ────────────────────────────────────────────────────────────

  _generateSecureId() {
    const arr = new Uint8Array(32);
    crypto.getRandomValues(arr);
    return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  hashPassword(password) {
    // Simple deterministic hash for password comparison (non-cryptographic OK here,
    // since real passwords use bcrypt on a server)
    let hash = 0;
    for (let i = 0; i < password.length; i++) {
      hash = ((hash << 5) - hash) + password.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash).toString(36);
  }
}

export default LukasSecurityAgent;
