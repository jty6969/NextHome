import assert from 'node:assert/strict';
import { readFile, readdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import worker from '../worker/app.js';

async function createDatabase(filename = ':memory:') {
  const database = new DatabaseSync(filename);
  for (const file of (await readdir(new URL('../drizzle/', import.meta.url))).filter(file => file.endsWith('.sql')).sort()) {
    const migration = await readFile(new URL(`../drizzle/${file}`, import.meta.url), 'utf8');
    for (const statement of migration.split('--> statement-breakpoint')) {
      if (statement.trim()) database.exec(statement);
    }
  }
  return database;
}

function d1(database) {
  return {
    async batch(statements) {
      database.exec('BEGIN');
      try {
        const results = statements.map(statement => statement.run());
        database.exec('COMMIT');
        return results;
      } catch (error) { database.exec('ROLLBACK'); throw error; }
    },
    prepare(sql) {
      const statement = database.prepare(sql);
      let parameters = [];
      return {
        bind(...values) {
          parameters = values;
          return this;
        },
        first() {
          return statement.get(...parameters) || null;
        },
        all() {
          return { results: statement.all(...parameters) };
        },
        run() {
          statement.run(...parameters);
          return { success: true };
        },
      };
    },
  };
}

async function createEnvironment(filename) {
  const database = await createDatabase(filename);
  return {
    database,
    env: {
      DB: d1(database),
      ASSETS: {
        async fetch() {
          return new Response(await readFile(new URL('../assets/properties-ai-table.json', import.meta.url), 'utf8'), {
            headers: { 'content-type': 'application/json' },
          });
        },
      },
    },
  };
}

function apiRequest(path, { method = 'GET', cookie = '', body } = {}) {
  const headers = { origin: 'https://nexthome.test' };
  if (cookie) headers.cookie = cookie;
  if (body !== undefined) headers['content-type'] = 'application/json';
  return new Request(`https://nexthome.test${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function request(env, path, options) {
  return worker.fetch(apiRequest(path, options), env);
}

async function login(env, username) {
  const response = await request(env, '/api/auth/login', {
    method: 'POST',
    body: { username, password: String.fromCharCode(49, 50, 51, 52, 53, 54) },
  });
  assert.equal(response.status, 200);
  const cookie = response.headers.get('set-cookie').split(';')[0];
  const payload = await response.json();
  assert.equal(payload.user.username, username);
  assert.equal('passwordHash' in payload.user, false);
  return { cookie, user: payload.user };
}

test('seeded accounts authenticate and sessions expose only safe account data', async () => {
  const { database, env } = await createEnvironment();
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM accounts').get().count, 0);
  for (const [username, role] of [['管理员账号1', 'admin'], ['用户账号1', 'user'], ['用户账号2', 'user']]) {
    const authenticated = await login(env, username);
    assert.equal(authenticated.user.role, role);
    const session = await request(env, '/api/auth/session', { cookie: authenticated.cookie });
    assert.equal(session.status, 200);
    assert.deepEqual(await session.json(), { user: authenticated.user });
  }
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM accounts').get().count, 3);
});

test('protected endpoints return 401 and admin endpoint returns 403 for users', async () => {
  const { env } = await createEnvironment();
  assert.equal((await request(env, '/api/listings', { method: 'POST', body: {} })).status, 401);
  assert.equal((await request(env, '/api/admin/listings', { method: 'POST', body: {} })).status, 401);
  const { cookie } = await login(env, '用户账号1');
  assert.equal((await request(env, '/api/admin/listings', { method: 'POST', cookie, body: {} })).status, 403);
});

test('all seeded accounts authenticate when Workers rejects native PBKDF2 above 100000 iterations', async t => {
  const { database, env } = await createEnvironment();
  const nativeDeriveBits = crypto.subtle.deriveBits.bind(crypto.subtle);
  const requestedIterations = [];
  t.mock.method(crypto.subtle, 'deriveBits', async (algorithm, ...args) => {
    requestedIterations.push(algorithm.iterations);
    if (algorithm.name === 'PBKDF2' && algorithm.iterations > 100000) {
      throw new DOMException('Pbkdf2 failed: iteration counts above 100000 are not supported', 'NotSupportedError');
    }
    return nativeDeriveBits(algorithm, ...args);
  });
  for (const username of ['管理员账号1', '用户账号1', '用户账号2']) {
    const { cookie } = await login(env, username);
    assert.equal((await request(env, '/api/auth/session', { cookie })).status, 200);
    if (username !== '管理员账号1') {
      assert.equal((await request(env, '/api/admin/listings', { method: 'POST', cookie, body: {} })).status, 403);
    }
  }
  const wrongPassword = await request(env, '/api/auth/login', {
    method: 'POST', body: { username: '用户账号1', password: 'wrong-password' },
  });
  assert.equal(wrongPassword.status, 401);
  assert.ok(requestedIterations.length >= 4);
  assert.ok(requestedIterations.every(iterations => iterations === 210000));
  for (const row of database.prepare('SELECT password_hash FROM accounts').all()) {
    assert.ok(row.password_hash.startsWith('pbkdf2_sha256$210000$'));
  }
});

test('crypto service failures return 503 without exposing secrets or counting a wrong password', async t => {
  const { database, env } = await createEnvironment();
  const logs = [];
  t.mock.method(console, 'error', (...args) => logs.push(args));
  t.mock.method(crypto.subtle, 'deriveBits', async () => {
    throw new Error('simulated crypto failure');
  });
  const response = await request(env, '/api/auth/login', {
    method: 'POST', body: { username: '用户账号1', password: String.fromCharCode(49, 50, 51, 52, 53, 54) },
  });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: '登录服务暂时不可用，请稍后重试。' });
  assert.deepEqual(logs, [['Nexthome password verification unavailable']]);
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM login_rate_limits').get().count, 0);
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM sessions').get().count, 0);
});

test('user listing stores omitted detail fields as NULL and rejects invalid phone numbers', async () => {
  const { database, env } = await createEnvironment();
  const { cookie } = await login(env, '用户账号1');
  const invalid = await request(env, '/api/listings', {
    method: 'POST', cookie, body: { ownerName: '测试业主', contactPhone: '123', address: '春江花月小区 3 幢 1202 室' },
  });
  assert.equal(invalid.status, 400);
  const response = await request(env, '/api/listings', {
    method: 'POST', cookie, body: { ownerName: '测试业主', contactPhone: '13800138000', address: '春江花月小区 3 幢 1202 室' },
  });
  assert.equal(response.status, 201);
  const row = database.prepare("SELECT * FROM listings WHERE submission_source = 'user_listing'").get();
  for (const field of ['area_sqm', 'bedrooms', 'living_rooms', 'bathrooms', 'floor_level', 'floor_total', 'orientation', 'decoration', 'elevator', 'total_price_wan', 'unit_price_wan_per_sqm']) {
    assert.equal(row[field], null, `${field} should remain NULL`);
  }
  assert.equal(row.creator_account_id, 'seed-user-1');
  assert.equal(row.creator_role, 'user');
});

test('admin listing stores complete detail data and marks calculated unit price', async () => {
  const { database, env } = await createEnvironment();
  const { cookie } = await login(env, '管理员账号1');
  const response = await request(env, '/api/admin/listings', {
    method: 'POST',
    cookie,
    body: {
      ownerName: '管理员录入', contactPhone: '13900139000', address: '未来城 8 幢 1801 室',
      bedrooms: 3, livingRooms: 2, bathrooms: 2, areaSqm: 120, totalPriceWan: 600,
      orientation: '南北', floorLevel: 18, floorTotal: 30, decoration: '精装', elevator: '有电梯',
    },
  });
  assert.equal(response.status, 201);
  const payload = await response.json();
  assert.equal(payload.listing.unitPriceCalculated, true);
  assert.equal(payload.listing.unitPriceWanPerSqm, 5);
  const row = database.prepare("SELECT * FROM listings WHERE submission_source = 'admin_manual'").get();
  assert.equal(row.bedrooms, 3);
  assert.equal(row.area_sqm, 120);
  assert.equal(row.total_price_wan, 600);
  assert.equal(row.floor_level, 18);
  assert.equal(row.floor_total, 30);
  assert.equal(row.elevator, '有电梯');
  assert.equal(row.creator_account_id, 'seed-admin-1');
  assert.equal(row.creator_role, 'admin');
});

test('admin validation rejects inconsistent floors and public listing browsing remains available', async () => {
  const { env } = await createEnvironment();
  const publicList = await request(env, '/api/listings');
  assert.equal(publicList.status, 200);
  const { cookie } = await login(env, '管理员账号1');
  const response = await request(env, '/api/admin/listings', {
    method: 'POST', cookie,
    body: { ownerName: '测试', contactPhone: '13800138000', address: '未来城 1 号', floorLevel: 12, floorTotal: 10 },
  });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /不能大于/);
});

test('login errors do not enumerate users, rate limiting activates, and logout invalidates a session', async () => {
  const { env } = await createEnvironment();
  const invalidPassword = String.fromCharCode(57, 57, 57, 57, 57, 57);
  const existingFailure = await request(env, '/api/auth/login', {
    method: 'POST', body: { username: '用户账号1', password: invalidPassword },
  });
  const missingFailure = await request(env, '/api/auth/login', {
    method: 'POST', body: { username: '不存在的账号', password: invalidPassword },
  });
  assert.equal(existingFailure.status, 401);
  assert.equal(missingFailure.status, 401);
  assert.deepEqual(await existingFailure.json(), await missingFailure.json());

  for (let attempt = 1; attempt < 5; attempt += 1) {
    const response = await request(env, '/api/auth/login', {
      method: 'POST', body: { username: '用户账号1', password: invalidPassword },
    });
    assert.equal(response.status, 401);
  }
  const limited = await request(env, '/api/auth/login', {
    method: 'POST', body: { username: '用户账号1', password: invalidPassword },
  });
  assert.equal(limited.status, 429);

  const authenticated = await login(env, '用户账号2');
  const logoutResponse = await request(env, '/api/auth/logout', { method: 'POST', cookie: authenticated.cookie });
  assert.equal(logoutResponse.status, 200);
  const session = await request(env, '/api/auth/session', { cookie: authenticated.cookie });
  assert.deepEqual(await session.json(), { user: null });
});

test('admin minimal creation stores NULL details and rejects forged metadata', async () => {
  const { database, env } = await createEnvironment();
  const { cookie } = await login(env, '管理员账号1');
  const body = { ownerName: '实际联系人', contactPhone: '13800138000', address: '真实小区 1号101室' };
  assert.equal((await request(env, '/api/admin/listings', { method: 'POST', cookie, body: { ...body, role: 'admin', createdAt: 'fake' } })).status, 400);
  const result = await request(env, '/api/admin/listings', { method: 'POST', cookie, body });
  assert.equal(result.status, 201);
  const { listing } = await result.json();
  const row = database.prepare('SELECT * FROM listings WHERE id = ?').get(listing.id);
  for (const field of ['area_sqm', 'bedrooms', 'living_rooms', 'bathrooms', 'total_price_wan', 'orientation', 'floor_level', 'floor_total', 'decoration', 'elevator']) assert.equal(row[field], null);
  assert.equal(row.creator_account_id, 'seed-admin-1');
  assert.equal(row.updated_at, null);
});

test('static listings import once under original IDs and preserve every original field', async () => {
  const { database, env } = await createEnvironment();
  const base = JSON.parse(await readFile(new URL('../assets/properties-ai-table.json', import.meta.url), 'utf8'));
  const first = await (await request(env, '/api/listings')).json();
  const second = await (await request(env, '/api/listings')).json();
  assert.equal(first.table.length, base.table.length);
  assert.equal(second.table.length, base.table.length);
  assert.equal(database.prepare('SELECT count(*) AS n FROM listings').get().n, base.table.length);
  for (const original of base.table) {
    const imported = first.table.find(row => row.id === original.id);
    for (const [key, value] of Object.entries(original)) assert.deepEqual(imported[key], value, `${original.id}.${key}`);
    assert.equal(imported.ownerName, null);
    assert.equal(imported.contactPhone, null);
    assert.equal(imported.createdAt, null);
    assert.equal(imported.creatorAccountId, null);
    assert.equal(imported.submissionSource, base.meta.dataSource);
  }
});

test('admin searches by address, name and phone and validates detail IDs', async () => {
  const { env } = await createEnvironment();
  const { cookie } = await login(env, '管理员账号1');
  const creation = await request(env, '/api/admin/listings', { method: 'POST', cookie, body: { ownerName: '搜索联系人', contactPhone: '13900139000', address: '搜索小区 9号901室' } });
  const { listing } = await creation.json();
  for (const query of ['搜索小区', '搜索联系人', '13900139000']) {
    const response = await request(env, `/api/admin/listings?q=${encodeURIComponent(query)}`, { cookie });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).listings[0].id, listing.id);
  }
  assert.equal((await request(env, `/api/admin/listings/${listing.id}`, { cookie })).status, 200);
  assert.equal((await request(env, '/api/admin/listings/missing', { cookie })).status, 404);
  assert.equal((await request(env, '/api/admin/listings/%2Fbad', { cookie })).status, 400);
});

test('partial edits keep the same row and creation audit and clear optional values to NULL', async () => {
  const { database, env } = await createEnvironment();
  const user = await login(env, '用户账号1');
  const admin = await login(env, '管理员账号1');
  const created = await (await request(env, '/api/listings', { method: 'POST', cookie: user.cookie, body: { ownerName: '原联系人', contactPhone: '13800138000', address: '原小区 1号101室' } })).json();
  const id = created.listing.id;
  const path = `/api/admin/listings/${id}`;
  const original = database.prepare('SELECT * FROM listings WHERE id = ?').get(id);
  assert.equal((await request(env, path, { method: 'PATCH', cookie: admin.cookie, body: { areaSqm: 100, totalPriceWan: 500, orientation: '南北', floorLevel: 8, floorTotal: 10 } })).status, 200);
  const updated = await (await request(env, path, { method: 'PATCH', cookie: admin.cookie, body: { orientation: null, totalPriceWan: 550 } })).json();
  assert.equal(updated.listing.id, id);
  assert.equal(updated.listing.unitPriceWanPerSqm, 5.5);
  assert.equal(updated.listing.orientation, null);
  assert.equal(updated.listing.areaSqm, 100);
  const row = database.prepare('SELECT * FROM listings WHERE id = ?').get(id);
  for (const field of ['created_at', 'creator_account_id', 'creator_role', 'submission_source', 'owner_name', 'contact_phone', 'address']) assert.equal(row[field], original[field]);
  assert.equal(row.updater_account_id, 'seed-admin-1');
  assert.ok(Date.parse(row.updated_at));
  const publicList = await (await request(env, '/api/listings')).json();
  assert.equal(publicList.table.filter(row => row.id === id).length, 1);
  assert.equal(publicList.table.find(row => row.id === id).totalPriceWan, 550);
  assert.equal((await (await request(env, path, { cookie: admin.cookie })).json()).listing.orientation, null);
});

test('editing imported listings survives repeated reads without duplicates or lost original metadata', async () => {
  const { database, env } = await createEnvironment();
  const { cookie } = await login(env, '管理员账号1');
  const id = 'lshy-1';
  const original = (await (await request(env, `/api/admin/listings/${id}`, { cookie })).json()).listing;
  const count = database.prepare('SELECT count(*) AS n FROM listings').get().n;
  const patch = await request(env, `/api/admin/listings/${id}`, { method: 'PATCH', cookie, body: { ownerName: '补充的联系人', contactPhone: '13800138000', totalPriceWan: 850 } });
  assert.equal(patch.status, 200);
  for (let i = 0; i < 2; i++) {
    const refreshed = (await (await request(env, '/api/listings')).json()).table;
    const listing = refreshed.find(row => row.id === id);
    assert.equal(refreshed.filter(row => row.id === id).length, 1);
    assert.equal(listing.totalPriceWan, 850);
    assert.equal(listing.ownerName, '补充的联系人');
    for (const key of ['createdAt', 'importedAt', 'creatorAccountId', 'submissionSource', 'community', 'building', 'unit', 'metro', 'listingTitle', 'highlights', 'aiSummary']) assert.deepEqual(listing[key], original[key]);
  }
  assert.equal(database.prepare('SELECT count(*) AS n FROM listings').get().n, count);
});

test('anonymous and ordinary users cannot search, load or edit by forging administrator role', async () => {
  const { env } = await createEnvironment();
  const { cookie } = await login(env, '用户账号1');
  for (const [credential, status] of [['', 401], [cookie, 403]]) {
    for (const path of ['/api/admin/listings?q=x', '/api/admin/listings/lshy-1']) assert.equal((await request(env, path, { cookie: credential })).status, status);
    assert.equal((await request(env, '/api/admin/listings/lshy-1', { method: 'PATCH', cookie: credential, body: { role: 'admin', totalPriceWan: 1 } })).status, status);
  }
});

test('invalid edits fail without writing values, metadata or extra rows', async () => {
  const { database, env } = await createEnvironment();
  const { cookie } = await login(env, '管理员账号1');
  await request(env, '/api/listings');
  const before = database.prepare('SELECT * FROM listings WHERE id = ?').get('lshy-1');
  for (const body of [{ floorLevel: 7 }, { areaSqm: -1 }, { totalPriceWan: false }, { floorTotal: 3.5 }, { contactPhone: '123' }, { ownerName: null }, { address: '' }, { decoration: 'bad' }, { elevator: {} }, { orientation: [] }, { creatorAccountId: 'fake' }, { id: 'new' }, []]) {
    assert.equal((await request(env, '/api/admin/listings/lshy-1', { method: 'PATCH', cookie, body })).status, 400, JSON.stringify(body));
  }
  assert.equal((await request(env, '/api/admin/listings/missing', { method: 'PATCH', cookie, body: { orientation: '南' } })).status, 404);
  assert.deepEqual(database.prepare('SELECT * FROM listings WHERE id = ?').get('lshy-1'), before);
});

test('write failures return recoverable JSON rather than an unhandled rejection', async t => {
  const { env } = await createEnvironment();
  const { cookie } = await login(env, '管理员账号1');
  await request(env, '/api/listings');
  const prepare = env.DB.prepare;
  t.mock.method(console, 'error', () => {});
  env.DB.prepare = sql => {
    if (/INSERT INTO listings|UPDATE listings/.test(sql)) throw new Error('unavailable');
    return prepare(sql);
  };
  for (const [path, method, body] of [
    ['/api/admin/listings', 'POST', { ownerName: '测试', contactPhone: '13800138000', address: '测试小区 1号101室' }],
    ['/api/admin/listings/lshy-1', 'PATCH', { orientation: '南' }],
  ]) {
    const result = await request(env, path, { method, cookie, body });
    assert.equal(result.status, 500);
    assert.match((await result.json()).error, /稍后重试/);
  }
});

test('additive migration preserves existing records and foreign key and role constraints', async () => {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON');
  const migrations = (await readdir(new URL('../drizzle/', import.meta.url))).filter(file => file.endsWith('.sql')).sort();
  const apply = async file => {
    for (const sql of (await readFile(new URL(`../drizzle/${file}`, import.meta.url), 'utf8')).split('--> statement-breakpoint')) if (sql.trim()) db.exec(sql);
  };
  await apply(migrations[0]);
  await apply(migrations[1]);
  db.prepare('INSERT INTO accounts VALUES (?, ?, ?, ?, ?)').run('original-user', '原录入人', 'hash', 'user', '2026-09-05');
  db.prepare('INSERT INTO listings (id, owner_name, contact_phone, address, created_at, submission_source, creator_account_id, creator_role) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run('existing', '原业主', '13800138000', '原小区 1号', '2026-09-05', 'listing_form', 'original-user', 'user');
  const before = db.prepare('SELECT * FROM listings').get();
  await apply(migrations[2]);
  const after = db.prepare('SELECT * FROM listings').get();
  for (const [field, value] of Object.entries(before)) assert.equal(after[field], value);
  assert.equal(after.updated_at, null);
  assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0);
  assert.throws(() => db.prepare("UPDATE listings SET creator_role = 'fake'").run());
  db.close();
});

test('saved edits survive closing and reopening the database connection', async () => {
  const filename = path.join(tmpdir(), `nexthome-admin-${crypto.randomUUID()}.sqlite`);
  const environment = await createEnvironment(filename);
  let database = environment.database;
  try {
    const { cookie } = await login(environment.env, '管理员账号1');
    const result = await request(environment.env, '/api/admin/listings/lshy-1', { method: 'PATCH', cookie, body: { orientation: '东南' } });
    assert.equal(result.status, 200);
    database.close();
    database = new DatabaseSync(filename);
    const reloadedEnvironment = { ...environment.env, DB: d1(database) };
    const listings = (await (await request(reloadedEnvironment, '/api/listings')).json()).table;
    assert.equal(listings.filter(row => row.id === 'lshy-1').length, 1);
    assert.equal(listings.find(row => row.id === 'lshy-1').orientation, '东南');
    assert.equal((await (await request(reloadedEnvironment, '/api/admin/listings/lshy-1', { cookie })).json()).listing.orientation, '东南');
  } finally {
    database.close();
    await unlink(filename);
  }
});
