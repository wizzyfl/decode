/**
 * ProgramCache
 * ============
 * In-memory cache of discovered programs with JSON persistence.
 * Programs are cached by taskId so repeated requests are instant.
 */

const fs   = require('fs');
const path = require('path');

class ProgramCache {
  constructor(persistPath = null) {
    this.programs  = new Map(); // taskId -> { program, meta, createdAt }
    this.persistPath = persistPath;
    if (persistPath && fs.existsSync(persistPath)) {
      this._load();
    }
  }

  has(taskId)  { return this.programs.has(taskId); }
  get(taskId)  { return this.programs.get(taskId) || null; }

  set(taskId, record) {
    this.programs.set(taskId, { ...record, cachedAt: new Date().toISOString() });
    this._save();
  }

  list() {
    return [...this.programs.entries()].map(([taskId, rec]) => ({
      taskId,
      exact:            rec.exact,
      accuracy:         rec.accuracy,
      instructionCount: rec.instructionCount,
      discoveryMs:      rec.discoveryMs,
      cachedAt:         rec.cachedAt,
    }));
  }

  size()  { return this.programs.size; }
  clear() { this.programs.clear(); this._save(); }

  _save() {
    if (!this.persistPath) return;
    try {
      const obj = {};
      this.programs.forEach((v, k) => { obj[k] = v; });
      fs.mkdirSync(path.dirname(this.persistPath), { recursive: true });
      fs.writeFileSync(this.persistPath, JSON.stringify(obj, null, 2));
    } catch (e) { /* non-fatal */ }
  }

  _load() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.persistPath, 'utf8'));
      Object.entries(raw).forEach(([k, v]) => this.programs.set(k, v));
      console.log(`  [cache] Loaded ${this.programs.size} cached programs from ${this.persistPath}`);
    } catch (e) { /* non-fatal */ }
  }
}

module.exports = ProgramCache;
