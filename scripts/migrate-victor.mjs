import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase, d1, root } from './local-db.mjs';
import worker from '../worker/app.js';
export async function migrateVictor(db, source = path.join(root, 'NextHome-Victor')) {
  const files = (await readdir(path.join(source, 'data/users'))).filter(f => f.endsWith('.json'));
  const counts = { accounts: 0, existingAccounts: 0, bindings: 0, archived: 0 };
  db.exec('BEGIN');
  try {
    for (const file of files) {
      const legacy = JSON.parse(await readFile(path.join(source, 'data/users', file), 'utf8'));
      const a = legacy.account;
      if (!a || !/^[\w]{3,50}$/.test(a.username) || !/^[a-f0-9]{32}$/.test(a.salt || '') || !/^[a-f0-9]{64}$/.test(a.passwordHash || '')) throw Error('Invalid legacy account');
      const existing = db.prepare('SELECT id FROM accounts WHERE username = ?').get(a.username);
      const id = existing?.id || `victor-${a.username}`;
      if (!existing) {
        const hash = `pbkdf2_sha256$100000$${Buffer.from(a.salt, 'utf8').toString('base64url')}$${Buffer.from(a.passwordHash, 'hex').toString('base64url')}`;
        // Legacy administrator does not gain access to the current website's administrative data.
        db.prepare('INSERT INTO accounts (id, username, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)')
          .run(id, a.username, hash, 'user', a.createdAt || new Date().toISOString());
        counts.accounts++;
      } else counts.existingAccounts++;
      const st = legacy.state || {};
      db.prepare('INSERT OR IGNORE INTO advisor_accounts (account_id, display_name, seller, profile, requirements) VALUES (?, ?, ?, ?, ?)')
        .run(id, a.name || a.username, !existing && a.role === 'seller' ? 1 : 0, JSON.stringify(st.profile || {}), JSON.stringify(st.requirements || {}));
      counts.archived += db.prepare('INSERT OR IGNORE INTO legacy_archives (account_id, payload, imported_at) VALUES (?, ?, ?)')
        .run(id, JSON.stringify(st), new Date().toISOString()).changes;
      for (const listingId of st.favorites || []) {
        if (!db.prepare('SELECT id FROM listings WHERE id = ?').get(listingId)) continue;
        db.prepare('INSERT OR IGNORE INTO buyer_favorites (key, account_id, listing_id) VALUES (?, ?, ?)').run(`${id}:${listingId}`, id, listingId);
      }
      for (const b of st.browsingHistory || []) {
        if (!db.prepare('SELECT id FROM listings WHERE id = ?').get(b.propertyId)) continue;
        db.prepare('INSERT OR IGNORE INTO buyer_events (id, account_id, listing_id, kind, content, created_at) VALUES (?, ?, ?, ?, ?, ?)')
          .run(`legacy-browse:${id}:${b.propertyId}`, id, b.propertyId, 'browse', b.title || b.propertyId, b.time || new Date().toISOString());
      }
      for (const [i, m] of (st.aiMemory || []).entries()) {
        db.prepare('INSERT OR IGNORE INTO buyer_events (id, account_id, kind, content, created_at) VALUES (?, ?, ?, ?, ?)')
          .run(`legacy-memory:${id}:${i}`, id, m.type || 'legacy', m.text || '', m.time || new Date().toISOString());
      }
      if (!existing) for (const m of st.chatHistory || []) {
        db.prepare('INSERT INTO advisor_chats (account_id, role, content, created_at) VALUES (?, ?, ?, ?)')
          .run(id, m.role === 'user' ? 'user' : 'assistant', m.content || '', m.time || new Date().toISOString());
      }
    }
    for (const file of (await readdir(path.join(source, 'data/properties'))).filter(f => f.endsWith('.json'))) {
      const p = JSON.parse(await readFile(path.join(source, 'data/properties', file), 'utf8'));
      const seller = db.prepare('SELECT a.id FROM accounts a JOIN advisor_accounts s ON s.account_id = a.id WHERE a.username = ? AND s.seller = 1').get(p.seller?.username);
      if (!seller || !db.prepare('SELECT id FROM listings WHERE id = ?').get(p.id)) continue;
      counts.bindings += db.prepare('INSERT OR IGNORE INTO listing_sellers (listing_id, account_id) VALUES (?, ?)').run(p.id, seller.id).changes;
    }
    db.exec('COMMIT');
    return { ...counts, legacySessionsMigrated: false, activeDealsImported: 0 };
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const db = await openDatabase(path.join(root, '.local/nexthome.sqlite'));
  await worker.fetch(new Request('http://127.0.0.1/api/listings'), { DB:d1(db), ASSETS:{ fetch:async () => new Response(await readFile(path.join(root,'assets/properties-ai-table.json'),'utf8')) } });
  console.log(JSON.stringify(await migrateVictor(db), null, 2));
  db.close();
}
