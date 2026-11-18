// The parts of the tlx SQLite database this server uses: `meta` (JSON values,
// including the site login cookies) and `app_sessions` (this app's own
// password logins). The Python server (server/tlx_server/store.py) shares the
// same file and owns the rest; the tables and value formats match its own.
import { Database } from 'bun:sqlite';
import { chmodSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS app_sessions (id TEXT PRIMARY KEY, created REAL NOT NULL);
`;

export class Store {
  readonly db: Database;

  constructor(path: string) {
    const file = path !== ':memory:';
    if (file) {
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    }
    this.db = new Database(path, { create: true, strict: true });
    this.db.run('PRAGMA journal_mode=WAL');
    // Two processes write this file; wait out the other's write instead of failing.
    this.db.run('PRAGMA busy_timeout=5000');
    this.db.run(SCHEMA);
    if (file) {
      chmodSync(path, 0o600); // holds the site login cookies
    }
  }

  getMeta(key: string): unknown {
    const row = this.db
      .query<{ value: string }, [string]>('SELECT value FROM meta WHERE key = ?')
      .get(key);
    return row ? JSON.parse(row.value) : null;
  }

  setMeta(key: string, value: unknown): void {
    this.db
      .query(
        'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      )
      .run(key, JSON.stringify(value ?? null));
  }

  addSession(id: string): void {
    this.db
      .query('INSERT INTO app_sessions (id, created) VALUES (?, ?)')
      .run(id, Date.now() / 1000);
  }

  hasSession(id: string, maxAgeSeconds: number): boolean {
    const row = this.db
      .query<{ created: number }, [string]>('SELECT created FROM app_sessions WHERE id = ?')
      .get(id);
    return row !== null && Date.now() / 1000 - row.created < maxAgeSeconds;
  }

  dropSession(id: string): void {
    this.db.query('DELETE FROM app_sessions WHERE id = ?').run(id);
  }

  close(): void {
    this.db.close();
  }
}
