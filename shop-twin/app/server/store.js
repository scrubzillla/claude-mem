// The twin's own data (which spot each car is in, planned moves, activity) for one shop, saved as
// JSON. Tekmetric has no field for these, so this file is the shared source for every screen.
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

export class JsonStore {
  constructor(dir, shopId) {
    this.file = path.join(dir, `shop-${shopId}.json`);
    this.dir = dir;
    this.timer = null;
    this.pending = null;
    this.writing = Promise.resolve();
  }
  async load() {
    try {
      return JSON.parse(await readFile(this.file, 'utf8'));
    } catch (e) {
      if (e.code === 'ENOENT') return {};
      throw new Error(`Could not read ${this.file}: ${e.message}`);
    }
  }
  /** Debounced, atomic (write to a temp file, then rename). */
  save(data) {
    this.pending = data;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 300);
  }
  flush() {
    clearTimeout(this.timer);
    const data = this.pending;
    if (!data) return this.writing;
    this.pending = null;
    this.writing = this.writing.then(async () => {
      await mkdir(this.dir, { recursive: true });
      const tmp = `${this.file}.tmp`;
      await writeFile(tmp, JSON.stringify(data, null, 2));
      await rename(tmp, this.file);
    }).catch((e) => console.error(`[store] save failed: ${e.message}`));
    return this.writing;
  }
}

/** In-memory store for tests. */
export class MemoryStore {
  constructor(initial = {}) { this.data = initial; }
  async load() { return structuredClone(this.data); }
  save(data) { this.data = structuredClone(data); }
  flush() { return Promise.resolve(); }
}
