import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { JSDOM } from 'jsdom';
import worker from '../worker/app.js';
import { ListingSync, writeListing } from '../scripts/listing-sync-core.mjs';
import { createLocalSyncServer } from '../scripts/listing-sync-server.mjs';

// Actual Worker routes and SQL migrations, served over isolated local HTTP.
// No requests to the production site and no fixture files in listing-data.
async function isolated(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'nexthome-sync-test-'));
  const db = new DatabaseSync(path.join(directory, 'cloud.sqlite'));
  for (const file of (await readdir(new URL('../drizzle/', import.meta.url))).filter(name => name.endsWith('.sql')).sort()) {
    for (const statement of (await readFile(new URL(`../drizzle/${file}`, import.meta.url), 'utf8')).split('--> statement-breakpoint')) if (statement.trim()) db.exec(statement);
  }
  const env = { DB: {
    prepare(sql) {
      const statement = db.prepare(sql); let args = [];
      return { bind(...values) { args = values; return this; }, first() { return statement.get(...args) || null; }, all() { return { results: statement.all(...args) }; }, run() { statement.run(...args); return { success: true }; } };
    },
    async batch(statements) { db.exec('BEGIN'); try { const result = statements.map(statement => statement.run()); db.exec('COMMIT'); return result; } catch (error) { db.exec('ROLLBACK'); throw error; } },
  }, ASSETS: { fetch: async () => new Response(JSON.stringify({ table: [], meta: {} })) } };
  const server = http.createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    const result = await worker.fetch(new Request(`${origin}${req.url}`, { method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : body }), env);
    res.writeHead(result.status, Object.fromEntries(result.headers)); res.end(await result.text());
  });
  let origin;
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { await new Promise(resolve => server.close(resolve)); db.close(); await rm(directory, { recursive: true, force: true }); });
  async function client(username) {
    const login = await fetch(`${origin}/api/auth/login`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ username, password: String.fromCharCode(49, 50, 51, 52, 53, 54) }) });
    assert.equal(login.status, 200);
    const { user } = await login.json(); const cookie = login.headers.get('set-cookie').split(';')[0];
    const request = (endpoint, options = {}) => fetch(`${origin}${endpoint}`, { ...options, headers: { origin, cookie, ...options.headers } });
    const api = async endpoint => {
      const result = await request(endpoint);
      if (!result.ok) { const error = new Error('request_failed'); error.code = result.status === 401 ? 'auth_required' : 'request_failed'; throw error; }
      return result.json();
    };
    const create = async (extra = {}) => {
      const response = await request(user.role === 'admin' ? '/api/admin/listings' : '/api/listings', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ownerName: '隔离联系人', contactPhone: '13800138000', address: '隔离测试小区 1号101室', ...extra }) });
      assert.equal(response.status, 201); const result = await response.json(); assert.equal(result.cloudSaved, true); assert.equal(result.localSync, 'pending'); return result.listing;
    };
    return { user, request, api, create };
  }
  return { directory, db, origin, client };
}

test('historical export and new feed share a gap-free boundary with exact, duplicate-safe JSON', async t => {
  const fixture = await isolated(t); const admin = await fixture.client('管理员账号1');
  const historical = await admin.create();
  const engine = new ListingSync({ directory: path.join(fixture.directory, 'exports'), origin: fixture.origin, userId: admin.user.id, api: admin.api });
  await engine.initialize();
  assert.equal(await engine.poll(), 'ready');
  assert.equal(await engine.listingStatus(historical.id), 'before_start');
  const user = await fixture.client('用户账号1');
  const listing = await user.create();
  assert.equal(await engine.exportHistory(), 1);
  assert.equal(await engine.listingStatus(historical.id), 'synced');
  assert.equal(await engine.poll(), 'ready');
  const filename = path.join(engine.directory, `${listing.id}.json`);
  assert.deepEqual(JSON.parse(await readFile(filename, 'utf8')), listing);
  assert.equal(listing.areaSqm, null); assert.equal(listing.orientation, null);
  assert.equal(fixture.db.prepare('SELECT id FROM listings WHERE id = ?').get(listing.id).id, listing.id);
  assert.equal(await engine.listingStatus(listing.id), 'synced');
  assert.equal(await engine.exportHistory(), 1);
  assert.deepEqual((await readdir(engine.directory)).filter(name => !name.startsWith('.')).sort(), [`${historical.id}.json`, `${listing.id}.json`].sort());
  // Edits never change the immutable creation snapshot or local export.
  await admin.request(`/api/admin/listings/${listing.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ orientation: '南' }) });
  const offlineNew = await user.create();
  const restarted = new ListingSync({ directory: engine.directory, origin: fixture.origin, userId: admin.user.id, api: admin.api });
  await restarted.initialize(); assert.equal(await restarted.poll(), 'ready');
  assert.deepEqual(JSON.parse(await readFile(filename, 'utf8')), listing);
  assert.deepEqual(JSON.parse(await readFile(path.join(engine.directory, `${offlineNew.id}.json`), 'utf8')), offlineNew);
  const state = await readFile(restarted.statePath, 'utf8');
  for (const secret of ['nexthome_session=', 'password', 'contactPhone', '13800138000']) assert.ok(!state.includes(secret));
  assert.equal((await readdir(engine.directory)).filter(name => name.endsWith('.tmp')).length, 0);
});

test('disk failure keeps cloud row and checkpoint; offline and lost checkpoint recover without duplicates', async t => {
  const fixture = await isolated(t); const admin = await fixture.client('管理员账号1');
  let offline = false; let diskFails = true;
  const engine = new ListingSync({ directory: path.join(fixture.directory, 'exports'), origin: fixture.origin, userId: admin.user.id,
    api: endpoint => { if (offline) throw new Error('offline'); return admin.api(endpoint); },
    writer: async (...args) => { if (diskFails) throw new Error('disk_full'); return writeListing(...args); },
  });
  await engine.initialize(); const cursor = engine.state.cursor;
  const listing = await admin.create({ bedrooms: 3, areaSqm: 125, totalPriceWan: 625 });
  assert.equal(await engine.poll(), 'failed'); assert.equal(engine.state.cursor, cursor);
  assert.ok(fixture.db.prepare('SELECT id FROM listings WHERE id = ?').get(listing.id));
  assert.equal(await engine.listingStatus(listing.id), 'failed');
  diskFails = false; offline = true; assert.equal(await engine.poll(), 'failed'); assert.equal(engine.state.cursor, cursor);
  offline = false;
  const persist = engine.persist.bind(engine); let checkpointFails = true;
  engine.persist = async state => { if (checkpointFails) throw new Error('checkpoint_failed'); return persist(state); };
  assert.equal(await engine.poll(), 'failed');
  const before = await readFile(path.join(engine.directory, `${listing.id}.json`), 'utf8');
  checkpointFails = false; assert.equal(await engine.poll(), 'ready');
  assert.equal(await readFile(path.join(engine.directory, `${listing.id}.json`), 'utf8'), before);
  assert.deepEqual(JSON.parse(before), listing);
  assert.equal((await readdir(engine.directory)).filter(name => name === `${listing.id}.json`).length, 1);
  // Existing, different files are never silently overwritten.
  await writeFile(path.join(engine.directory, `${listing.id}.json`), '{"id":"manual-change"}');
  await assert.rejects(writeListing(engine.directory, listing), /file_conflict/);
  assert.equal(await engine.listingStatus(listing.id), 'failed');
  await assert.rejects(writeListing(engine.directory, { id: '../escape' }), /invalid_listing/);
});

test('history and live feeds enforce sessions, user ownership, multi-account creation and pagination', async t => {
  const fixture = await isolated(t); const admin = await fixture.client('管理员账号1');
  const user1 = await fixture.client('用户账号1'); const user2 = await fixture.client('用户账号2');
  assert.equal((await fetch(`${fixture.origin}/api/sync/listings?after=0`)).status, 401);
  assert.equal((await admin.request('/api/sync/listings?after=-1')).status, 400);
  const first = await user1.create(); const second = await user2.create(); const third = await admin.create();
  assert.deepEqual((await user1.api('/api/sync/listings?history=1&before=3&after=')).listings.map(row => row.id), [first.id]);
  assert.deepEqual((await user2.api('/api/sync/listings?history=1&before=3&after=')).listings.map(row => row.id), [second.id]);
  assert.deepEqual((await admin.api('/api/sync/listings?history=1&before=3&after=')).listings.map(row => row.id).sort(), [first.id, second.id, third.id].sort());
  assert.equal((await admin.request('/api/sync/listings?history=1&before=bad&after=')).status, 400);
  assert.deepEqual((await user1.api('/api/sync/listings?after=0')).listings.map(row => row.id), [first.id]);
  assert.deepEqual((await user2.api('/api/sync/listings?after=0')).listings.map(row => row.id), [second.id]);
  assert.equal((await user1.request(`/api/sync/listings?lookup=${second.id}`)).status, 404);
  assert.deepEqual((await admin.api('/api/sync/listings?after=0')).listings.map(row => row.id), [first.id, second.id, third.id]);
  // More than one feed page; also covers multiple inserts sharing a timestamp.
  const insert = fixture.db.prepare('INSERT INTO listing_sync_events (listing_id, creator_account_id, payload) VALUES (?, ?, ?)');
  for (let n = 0; n < 105; n++) insert.run(`isolated-${n}`, user1.user.id, JSON.stringify({ id: `isolated-${n}`, value: null }));
  const engine = new ListingSync({ directory: path.join(fixture.directory, 'exports'), origin: fixture.origin, userId: admin.user.id, api: admin.api });
  await engine.initialize();
  // Reproduce an already established boundary while retaining no-history state.
  engine.state.cursor = 3; engine.state.startCursor = 3; await engine.persist(engine.state);
  assert.equal(await engine.poll(), 'ready');
  assert.equal((await readdir(engine.directory)).filter(name => !name.startsWith('.')).length, 105);
  await user1.request('/api/auth/logout', { method: 'POST' });
  assert.equal((await user1.request('/api/sync/listings?after=0')).status, 401);
  assert.equal(fixture.db.prepare('SELECT count(*) AS n FROM listings').get().n, 3);
});

test('authenticated browser bridge exports history then writes a newly created listing', async t => {
  const fixture = await isolated(t); const admin = await fixture.client('管理员账号1');
  const historical = await admin.create();
  const baseline = await admin.api('/api/sync/listings');
  const output = path.join(fixture.directory, 'bridge-exports');
  let bridgeEngine;
  const local = createLocalSyncServer({ origin: fixture.origin, port: 0, bridge: {
    exportHistory: true,
    async initialize(userId, cursor) {
      bridgeEngine = new ListingSync({ directory: output, origin: fixture.origin, userId, api: null });
      await bridgeEngine.initializeFromBoundary(cursor); return bridgeEngine;
    },
  } });
  await new Promise(resolve => local.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => local.close(resolve)));
  const base = `http://127.0.0.1:${local.address().port}`;
  const localRequest = (endpoint, body) => fetch(`${base}${endpoint}`, { method: body ? 'POST' : 'GET',
    headers: { origin: fixture.origin, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined });
  assert.deepEqual(await (await localRequest('/bridge/state')).json(), { userId: null, cursor: null, startCursor: null,
    historyCursor: '', historyComplete: false, exportHistory: true });
  assert.equal((await localRequest('/bridge/initialize', { userId: admin.user.id, cursor: baseline.cursor })).status, 200);
  const history = await admin.api(`/api/sync/listings?history=1&before=${baseline.cursor}&after=`);
  assert.equal((await localRequest('/bridge/history', history)).status, 200);
  const created = await admin.create({ bedrooms: 2, livingRooms: 1 });
  const live = await admin.api(`/api/sync/listings?after=${baseline.cursor}`);
  assert.equal((await localRequest('/bridge/events', live)).status, 200);
  assert.deepEqual(JSON.parse(await readFile(path.join(output, `${historical.id}.json`), 'utf8')), historical);
  assert.deepEqual(JSON.parse(await readFile(path.join(output, `${created.id}.json`), 'utf8')), created);
  assert.equal((await localRequest(`/status?id=${created.id}`)).status, 200);
});

test('local HTTP status and retry use exact origin, expose no contacts and never claim success before a file exists', async t => {
  const fixture = await isolated(t); const admin = await fixture.client('管理员账号1');
  let fail = true;
  const engine = new ListingSync({ directory: path.join(fixture.directory, 'exports'), origin: fixture.origin, userId: admin.user.id, api: admin.api,
    writer: async (...args) => { if (fail) throw new Error('disk'); return writeListing(...args); } });
  await engine.initialize(); const listing = await admin.create();
  const local = createLocalSyncServer({ engine, origin: fixture.origin, port: 0 });
  await new Promise(resolve => local.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => local.close(resolve)));
  const base = `http://127.0.0.1:${local.address().port}`;
  const query = `/status?id=${listing.id}`;
  assert.equal((await fetch(base + query)).status, 403);
  assert.equal((await fetch(base + query, { headers: { origin: 'https://evil.test' } })).status, 403);
  const reboundStatus = await new Promise(resolve => {
    http.get(base + query, { headers: { origin: fixture.origin, host: 'evil.test' } }, response => { response.resume(); resolve(response.statusCode); });
  });
  assert.equal(reboundStatus, 403);
  const get = async () => (await fetch(base + query, { headers: { origin: fixture.origin } })).json();
  assert.equal((await get()).state, 'pending');
  const retry = () => fetch(`${base}/retry?id=${listing.id}`, { method: 'POST', headers: { origin: fixture.origin, 'content-type': 'application/json' }, body: '{}' });
  assert.equal((await (await retry()).json()).state, 'failed');
  fail = false; const result = await (await retry()).json();
  assert.deepEqual(result, { userId: admin.user.id, state: 'synced' });
  assert.ok(!JSON.stringify(result).includes('contactPhone'));
  await admin.request('/api/auth/logout', { method: 'POST' });
  assert.equal(await engine.poll(), 'auth_required');
  assert.equal((await get()).state, 'auth_required');
});

test('real form submission saves to isolated cloud and file; local errors and language changes preserve cloud success', async t => {
  const fixture = await isolated(t); const client = await fixture.client('用户账号1');
  const engine = new ListingSync({ directory: path.join(fixture.directory, 'exports'), origin: fixture.origin, userId: client.user.id, api: client.api });
  await engine.initialize();
  let reachable = false; let lastId; let posts = 0;
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const dom = new JSDOM(html, { url: fixture.origin, runScripts: 'dangerously', pretendToBeVisual: true, beforeParse(window) {
    window.AbortController = globalThis.AbortController;
    window.HTMLElement.prototype.scrollIntoView = () => {};
    const schedule = window.setTimeout.bind(window);
    window.setTimeout = (callback, delay, ...args) => schedule(callback, delay === 100 ? 0 : delay, ...args);
    window.fetch = async (url, options = {}) => {
      if (url.startsWith('http://127.0.0.1:47831')) {
        if (!reachable) throw new Error('not_running');
        if (options.method === 'POST') await engine.poll();
        return { ok: true, json: async () => ({ userId: engine.userId, state: await engine.listingStatus(lastId) }) };
      }
      const response = await client.request(url, options);
      if (url === '/api/listings' && options.method === 'POST') { posts++; lastId = (await response.clone().json()).listing.id; }
      return response;
    };
  } });
  t.after(() => dom.window.close());
  const waitFor = async predicate => { for (let n = 0; n < 200; n++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 10)); } assert.fail('UI timed out'); };
  const get = id => dom.window.document.getElementById(id);
  await waitFor(() => get('authButton').textContent.includes(client.user.username));
  get('openListingModal').click(); get('ownerName').value = '隔离界面录入'; get('ownerPhone').value = '13800138000'; get('propertyAddress').value = '隔离界面小区 2号202室';
  get('listingForm').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  await waitFor(() => get('localSyncMessage').textContent.includes('无法连接'));
  assert.equal(posts, 1); assert.equal(get('listingModal').hidden, true);
  dom.window.document.querySelector('[data-language="en"]').click();
  assert.match(get('localSyncMessage').textContent, /Saved to cloud; cannot connect/);
  reachable = true; get('retryLocalSync').click();
  await waitFor(() => get('localSyncMessage').textContent.includes('synced to listing-data'));
  assert.equal(posts, 1);
  const cloud = fixture.db.prepare('SELECT payload FROM listing_sync_events WHERE listing_id = ?').get(lastId);
  assert.deepEqual(JSON.parse(await readFile(path.join(engine.directory, `${lastId}.json`), 'utf8')), JSON.parse(cloud.payload));
  dom.window.document.querySelector('[data-language="zh-CN"]').click();
  assert.match(get('localSyncMessage').textContent, /云端已保存；本机已同步/);
  // A different local account cannot produce a successful status for this UI.
  engine.userId = 'different-account'; get('retryLocalSync').click();
  await waitFor(() => get('localSyncMessage').textContent.includes('当前网站账号'));
});
