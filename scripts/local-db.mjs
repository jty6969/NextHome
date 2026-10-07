import { DatabaseSync } from 'node:sqlite';
import { readdir, readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export async function openDatabase(filename = ':memory:') {
  if (filename !== ':memory:') await mkdir(path.dirname(filename), { recursive: true });
  const db = new DatabaseSync(filename);
  db.exec('PRAGMA foreign_keys=ON');
  db.exec('CREATE TABLE IF NOT EXISTS local_migrations (name TEXT PRIMARY KEY)');
  for (const file of (await readdir(path.join(root, 'drizzle'))).filter(f => f.endsWith('.sql')).sort()) {
    if (db.prepare('SELECT name FROM local_migrations WHERE name = ?').get(file)) continue;
    db.exec('BEGIN');
    try {
      db.exec(await readFile(path.join(root, 'drizzle', file), 'utf8'));
      db.prepare('INSERT INTO local_migrations (name) VALUES (?)').run(file);
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
  }
  return db;
}
export function d1(db) {
  let batches = Promise.resolve();
  return {
    prepare(sql) {
      const statement = db.prepare(sql); let parameters = [];
      return {
        bind(...values) { parameters = values; return this; },
        async first() { return statement.get(...parameters) || null; },
        async all() { return { results: statement.all(...parameters) }; },
        async run() { const r = statement.run(...parameters); return { success: true, meta: { changes: r.changes, last_row_id: r.lastInsertRowid } }; },
      };
    },
    batch(statements) {
      const operation = batches.then(async () => {
        db.exec('BEGIN');
        try { const results = []; for (const s of statements) results.push(await s.run()); db.exec('COMMIT'); return results; }
        catch (e) { db.exec('ROLLBACK'); throw e; }
      });
      batches = operation.catch(() => {});
      return operation;
    },
  };
}
