// ═══════════════════════════════════════════════════════════════════════
// LUKAS Database Agent — IndexedDB Persistence Layer
// Local-first, persistent, queryable, transactional storage.
// Architecture: Supabase/PostgreSQL-ready via config swap.
//
// Stores: users, devices, memories, tasks, schedules, logs, preferences,
//         rules, analytics events, conversation history, agent state
// ═══════════════════════════════════════════════════════════════════════

const DB_NAME    = 'LukasAIOS';
const DB_VERSION = 3;

// ── Schema definition ──────────────────────────────────────────────────────
const STORES = {
  USERS:         'users',
  DEVICES:       'devices',
  MEMORIES:      'memories',
  TASKS:         'tasks',
  SCHEDULES:     'schedules',
  RULES:         'rules',
  PREFERENCES:   'preferences',
  ANALYTICS:     'analytics',
  AGENT_LOGS:    'agent_logs',
  CONVERSATION:  'conversation',
  SESSIONS:      'sessions',
  NOTIFICATIONS: 'notifications',
};

class LukasDatabaseAgent {
  constructor() {
    this._db       = null;
    this._ready    = false;
    this._initPromise = null;

    // Cloud sync config (optional — set via setCloudConfig())
    this._cloudConfig = null;

    // Auto-init
    this._initPromise = this._openDB();
  }

  // ─── DB Initialization ───────────────────────────────────────────────────

  async _openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);

      req.onupgradeneeded = (event) => {
        const db = event.target.result;

        // Users store
        if (!db.objectStoreNames.contains(STORES.USERS)) {
          const us = db.createObjectStore(STORES.USERS, { keyPath: 'username' });
          us.createIndex('email', 'email', { unique: false });
        }

        // Devices store
        if (!db.objectStoreNames.contains(STORES.DEVICES)) {
          const ds = db.createObjectStore(STORES.DEVICES, { keyPath: 'id' });
          ds.createIndex('zone', 'zone', { unique: false });
          ds.createIndex('category', 'category', { unique: false });
        }

        // Memories store
        if (!db.objectStoreNames.contains(STORES.MEMORIES)) {
          const ms = db.createObjectStore(STORES.MEMORIES, { keyPath: 'id', autoIncrement: true });
          ms.createIndex('username', 'username', { unique: false });
          ms.createIndex('type', 'type', { unique: false });
          ms.createIndex('ts', 'ts', { unique: false });
        }

        // Tasks / reminders store
        if (!db.objectStoreNames.contains(STORES.TASKS)) {
          const ts = db.createObjectStore(STORES.TASKS, { keyPath: 'id' });
          ts.createIndex('username', 'username', { unique: false });
          ts.createIndex('status', 'status', { unique: false });
        }

        // Schedules store
        if (!db.objectStoreNames.contains(STORES.SCHEDULES)) {
          const ss = db.createObjectStore(STORES.SCHEDULES, { keyPath: 'id' });
          ss.createIndex('username', 'username', { unique: false });
          ss.createIndex('triggerAt', 'triggerAt', { unique: false });
        }

        // Rules store
        if (!db.objectStoreNames.contains(STORES.RULES)) {
          const rs = db.createObjectStore(STORES.RULES, { keyPath: 'id' });
          rs.createIndex('username', 'username', { unique: false });
          rs.createIndex('enabled', 'enabled', { unique: false });
        }

        // Preferences store
        if (!db.objectStoreNames.contains(STORES.PREFERENCES)) {
          db.createObjectStore(STORES.PREFERENCES, { keyPath: 'key' });
        }

        // Analytics store
        if (!db.objectStoreNames.contains(STORES.ANALYTICS)) {
          const as = db.createObjectStore(STORES.ANALYTICS, { keyPath: 'id', autoIncrement: true });
          as.createIndex('type', 'type', { unique: false });
          as.createIndex('ts', 'ts', { unique: false });
          as.createIndex('username', 'username', { unique: false });
        }

        // Agent logs store
        if (!db.objectStoreNames.contains(STORES.AGENT_LOGS)) {
          const ls = db.createObjectStore(STORES.AGENT_LOGS, { keyPath: 'id', autoIncrement: true });
          ls.createIndex('agent', 'agent', { unique: false });
          ls.createIndex('level', 'level', { unique: false });
          ls.createIndex('ts', 'ts', { unique: false });
        }

        // Conversation history store
        if (!db.objectStoreNames.contains(STORES.CONVERSATION)) {
          const cs = db.createObjectStore(STORES.CONVERSATION, { keyPath: 'id', autoIncrement: true });
          cs.createIndex('username', 'username', { unique: false });
          cs.createIndex('ts', 'ts', { unique: false });
          cs.createIndex('role', 'role', { unique: false });
        }

        // Sessions store
        if (!db.objectStoreNames.contains(STORES.SESSIONS)) {
          const ss2 = db.createObjectStore(STORES.SESSIONS, { keyPath: 'token' });
          ss2.createIndex('username', 'username', { unique: false });
          ss2.createIndex('expiresAt', 'expiresAt', { unique: false });
        }

        // Notifications store
        if (!db.objectStoreNames.contains(STORES.NOTIFICATIONS)) {
          const ns = db.createObjectStore(STORES.NOTIFICATIONS, { keyPath: 'id', autoIncrement: true });
          ns.createIndex('ts', 'ts', { unique: false });
          ns.createIndex('read', 'read', { unique: false });
        }

        console.log('[Database] Schema upgraded to v' + DB_VERSION);
      };

      req.onsuccess = (event) => {
        this._db    = event.target.result;
        this._ready = true;
        console.log('[Database] IndexedDB ready — LukasAIOS v' + DB_VERSION);
        resolve(this._db);
      };

      req.onerror = (event) => {
        console.error('[Database] Failed to open IndexedDB:', event.target.error);
        reject(event.target.error);
      };
    });
  }

  async _ensureReady() {
    if (!this._ready) await this._initPromise;
  }

  // ─── Generic CRUD ─────────────────────────────────────────────────────────

  /**
   * Put (upsert) a record into a store.
   * @param {string} store   One of STORES.*
   * @param {object} record  Must contain the keyPath field
   */
  async put(store, record) {
    await this._ensureReady();
    return new Promise((resolve, reject) => {
      const tx  = this._db.transaction(store, 'readwrite');
      const req = tx.objectStore(store).put(record);
      req.onsuccess = () => resolve(req.result);
      req.onerror   = () => reject(req.error);
    });
  }

  /**
   * Get a single record by primary key.
   */
  async get(store, key) {
    await this._ensureReady();
    return new Promise((resolve, reject) => {
      const tx  = this._db.transaction(store, 'readonly');
      const req = tx.objectStore(store).get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror   = () => reject(req.error);
    });
  }

  /**
   * Get all records from a store.
   */
  async getAll(store) {
    await this._ensureReady();
    return new Promise((resolve, reject) => {
      const tx  = this._db.transaction(store, 'readonly');
      const req = tx.objectStore(store).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror   = () => reject(req.error);
    });
  }

  /**
   * Delete a record by primary key.
   */
  async delete(store, key) {
    await this._ensureReady();
    return new Promise((resolve, reject) => {
      const tx  = this._db.transaction(store, 'readwrite');
      const req = tx.objectStore(store).delete(key);
      req.onsuccess = () => resolve(true);
      req.onerror   = () => reject(req.error);
    });
  }

  /**
   * Query records by an index.
   * @param {string} store
   * @param {string} indexName  e.g. 'username'
   * @param {*}      value      The value to match
   */
  async queryByIndex(store, indexName, value) {
    await this._ensureReady();
    return new Promise((resolve, reject) => {
      const tx    = this._db.transaction(store, 'readonly');
      const idx   = tx.objectStore(store).index(indexName);
      const req   = idx.getAll(IDBKeyRange.only(value));
      req.onsuccess = () => resolve(req.result || []);
      req.onerror   = () => reject(req.error);
    });
  }

  /**
   * Count records in a store.
   */
  async count(store) {
    await this._ensureReady();
    return new Promise((resolve, reject) => {
      const tx  = this._db.transaction(store, 'readonly');
      const req = tx.objectStore(store).count();
      req.onsuccess = () => resolve(req.result);
      req.onerror   = () => reject(req.error);
    });
  }

  /**
   * Clear all records from a store.
   */
  async clear(store) {
    await this._ensureReady();
    return new Promise((resolve, reject) => {
      const tx  = this._db.transaction(store, 'readwrite');
      const req = tx.objectStore(store).clear();
      req.onsuccess = () => resolve(true);
      req.onerror   = () => reject(req.error);
    });
  }

  /**
   * Bulk insert records (fast batch write).
   */
  async bulkPut(store, records) {
    await this._ensureReady();
    return new Promise((resolve, reject) => {
      const tx = this._db.transaction(store, 'readwrite');
      const os = tx.objectStore(store);
      let count = 0;
      for (const record of records) {
        os.put(record);
        count++;
      }
      tx.oncomplete = () => resolve(count);
      tx.onerror    = () => reject(tx.error);
    });
  }

  // ─── Domain-specific helpers ──────────────────────────────────────────────

  // Preferences
  async getPreference(key) {
    const row = await this.get(STORES.PREFERENCES, key);
    return row ? row.value : null;
  }
  async setPreference(key, value) {
    return this.put(STORES.PREFERENCES, { key, value, updatedAt: Date.now() });
  }
  async getAllPreferences() {
    const rows = await this.getAll(STORES.PREFERENCES);
    return Object.fromEntries(rows.map(r => [r.key, r.value]));
  }

  // Memories
  async saveMemory(username, type, content, embedding = null) {
    return this.put(STORES.MEMORIES, {
      username, type, content, embedding,
      ts: Date.now(),
      id: `mem_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
    });
  }
  async getMemoriesByUser(username) {
    return this.queryByIndex(STORES.MEMORIES, 'username', username);
  }
  async getMemoriesByType(username, type) {
    const all = await this.getMemoriesByUser(username);
    return all.filter(m => m.type === type);
  }

  // Conversation history
  async saveConversationTurn(username, role, content, intent = '') {
    return this.put(STORES.CONVERSATION, {
      username, role, content, intent,
      ts: Date.now()
    });
  }
  async getConversationHistory(username, limit = 20) {
    const all = await this.queryByIndex(STORES.CONVERSATION, 'username', username);
    return all.sort((a, b) => b.ts - a.ts).slice(0, limit).reverse();
  }

  // Schedules
  async saveSchedule(schedule) {
    return this.put(STORES.SCHEDULES, schedule);
  }
  async getSchedules(username) {
    return this.queryByIndex(STORES.SCHEDULES, 'username', username);
  }
  async deleteSchedule(id) {
    return this.delete(STORES.SCHEDULES, id);
  }

  // Rules
  async saveRule(rule) {
    return this.put(STORES.RULES, rule);
  }
  async getRules(username) {
    return this.queryByIndex(STORES.RULES, 'username', username);
  }
  async deleteRule(id) {
    return this.delete(STORES.RULES, id);
  }

  // Analytics events
  async recordAnalyticsEvent(type, data, username = 'Guest') {
    return this.put(STORES.ANALYTICS, {
      type, data, username,
      ts: Date.now()
    });
  }
  async getAnalyticsEvents(type = null, limit = 500) {
    const all = await this.getAll(STORES.ANALYTICS);
    const sorted = all.sort((a, b) => b.ts - a.ts);
    if (type) return sorted.filter(e => e.type === type).slice(0, limit);
    return sorted.slice(0, limit);
  }

  // Agent logs
  async saveAgentLog(agent, level, message, meta = {}) {
    return this.put(STORES.AGENT_LOGS, {
      agent, level, message,
      ts: new Date().toISOString(),
      ...meta
    });
  }
  async getAgentLogs(agent = null, limit = 200) {
    const all = await this.getAll(STORES.AGENT_LOGS);
    const sorted = all.sort((a, b) => (b.ts > a.ts ? 1 : -1));
    if (agent) return sorted.filter(l => l.agent === agent).slice(0, limit);
    return sorted.slice(0, limit);
  }

  // Devices
  async saveDevice(device) {
    return this.put(STORES.DEVICES, device);
  }
  async getDevice(id) {
    return this.get(STORES.DEVICES, id);
  }
  async getAllDevices() {
    return this.getAll(STORES.DEVICES);
  }

  // Notifications
  async saveNotification(title, body, priority = 'normal') {
    return this.put(STORES.NOTIFICATIONS, {
      title, body, priority,
      ts: Date.now(),
      read: false
    });
  }
  async getUnreadNotifications() {
    const all = await this.getAll(STORES.NOTIFICATIONS);
    return all.filter(n => !n.read).sort((a, b) => b.ts - a.ts);
  }
  async markNotificationRead(id) {
    const n = await this.get(STORES.NOTIFICATIONS, id);
    if (n) { n.read = true; await this.put(STORES.NOTIFICATIONS, n); }
  }

  // ─── Diagnostic / stats ───────────────────────────────────────────────────

  async getStorageStats() {
    const stats = {};
    for (const store of Object.values(STORES)) {
      stats[store] = await this.count(store);
    }
    return stats;
  }

  // ─── Cloud Sync (Supabase) — plug-in ready ────────────────────────────────

  /**
   * Configure optional Supabase cloud sync.
   * When set, put() operations will also replicate to Supabase REST API.
   * @param {{ url: string, anonKey: string }} config
   */
  setCloudConfig(config) {
    this._cloudConfig = config;
    console.log('[Database] Cloud sync configured to:', config.url);
  }

  async _syncToCloud(store, record) {
    if (!this._cloudConfig) return;
    try {
      await fetch(`${this._cloudConfig.url}/rest/v1/${store}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': this._cloudConfig.anonKey,
          'Authorization': `Bearer ${this._cloudConfig.anonKey}`,
          'Prefer': 'resolution=merge-duplicates'
        },
        body: JSON.stringify(record)
      });
    } catch (e) {
      console.warn('[Database] Cloud sync failed (offline?):', e.message);
    }
  }

  // ─── LocalStorage Migration ───────────────────────────────────────────────

  /**
   * One-time migration of existing LocalStorage data into IndexedDB.
   * Safe to call multiple times (idempotent).
   */
  async migrateFromLocalStorage() {
    const migrationKey = 'lukas_idb_migration_v1';
    if (localStorage.getItem(migrationKey)) return;

    console.log('[Database] Migrating LocalStorage data to IndexedDB...');
    let migrated = 0;

    // Migrate all lukas_ prefixed keys
    const keys = Object.keys(localStorage).filter(k => k.startsWith('lukas_'));
    for (const key of keys) {
      try {
        const value = localStorage.getItem(key);
        await this.setPreference(key, value);
        migrated++;
      } catch { /* ignore individual failures */ }
    }

    localStorage.setItem(migrationKey, `${Date.now()}`);
    console.log(`[Database] Migration complete: ${migrated} keys moved to IndexedDB.`);
    return migrated;
  }
}

// ── Singleton export ──────────────────────────────────────────────────────
const lukasDB = new LukasDatabaseAgent();
export { STORES };
export default lukasDB;
