import { verifyPassword, hashPassword } from './password.js';
import { handleAdvisor, enrichImportedListings } from './advisor.js';
import victorMetadata from '../assets/victor-metadata.json' with { type: 'json' };

const SESSION_COOKIE = 'nexthome_session';
const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 5;
const encoder = new TextEncoder();
const jsonHeaders = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
};
// Used only to keep missing-user password checks comparable in cost to valid-user checks.
const FALLBACK_PASSWORD_HASH = 'pbkdf2_sha256$210000$bbN6-jq5bIeQRH_ErJb_Sw$yA5NzOmm3P0KdkE79fb5cHfk-i_mQV-3oKEY_KAjVEo';
const SEED_ACCOUNTS = [
  ['seed-admin-1', '管理员账号1', 'pbkdf2_sha256$210000$bbN6-jq5bIeQRH_ErJb_Sw$yA5NzOmm3P0KdkE79fb5cHfk-i_mQV-3oKEY_KAjVEo', 'admin'],
  ['seed-user-1', '用户账号1', 'pbkdf2_sha256$210000$uvrf4BRpGfmNkM3cCcCBrg$hTLfvthWMRdyzm5ob5wXkbJjNB-epMdjT1Anaq-VAOI', 'user'],
  ['seed-user-2', '用户账号2', 'pbkdf2_sha256$210000$NidpotKCN_ANyCo_M_Y4DA$iH9UjIBlqXkla-owUUZY6M57nqHrND4s9JGEM2_Ip1c', 'user'],
];

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), { status, headers: { ...jsonHeaders, ...extraHeaders } });
}

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function bytesToBase64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function sha256(value) {
  return bytesToBase64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value))));
}

function cookieValue(request, name) {
  const cookies = request.headers.get('cookie') || '';
  for (const part of cookies.split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return value.join('=');
  }
  return '';
}

function sessionCookie(token) {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_MAX_AGE_SECONDS}`;
}

function expiredSessionCookie() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

function hasValidOrigin(request) {
  const origin = request.headers.get('origin');
  if (!origin) return true;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

async function currentUser(request, env) {
  const token = cookieValue(request, SESSION_COOKIE);
  if (!/^[A-Za-z0-9_-]{40,100}$/.test(token)) return null;
  const tokenHash = await sha256(token);
  const row = await env.DB.prepare(`
    SELECT accounts.id, accounts.username, accounts.role, advisor_accounts.seller, advisor_accounts.display_name
    FROM sessions
    JOIN accounts ON accounts.id = sessions.account_id
    LEFT JOIN advisor_accounts ON advisor_accounts.account_id = accounts.id
    WHERE sessions.token_hash = ? AND sessions.expires_at > ?
  `).bind(tokenHash, new Date().toISOString()).first();
  if (!row || !['admin', 'user'].includes(row.role)) return null;
  return { id: row.id, username: row.username, role: row.role === 'admin' ? 'admin' : row.seller ? 'seller' : 'user', name: row.display_name || row.username };
}

async function requireUser(request, env, requiredRole = null) {
  const user = await currentUser(request, env);
  if (!user) return { response: json({ error: '请先登录后再操作。' }, 401) };
  if (requiredRole && user.role !== requiredRole) {
    return { response: json({ error: '当前账号没有管理员权限。' }, 403) };
  }
  return { user };
}

function clientAddress(request) {
  return request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
}

async function rateLimitKey(request, username) {
  return sha256(`${username.toLocaleLowerCase('zh-CN')}\u0000${clientAddress(request)}`);
}

async function getRateLimit(env, key) {
  return env.DB.prepare(`
    SELECT attempts, window_started_at, blocked_until
    FROM login_rate_limits WHERE key = ?
  `).bind(key).first();
}

async function recordLoginFailure(env, key, existing) {
  const now = new Date();
  const windowStart = existing ? Date.parse(existing.window_started_at) : 0;
  const insideWindow = Number.isFinite(windowStart) && now.getTime() - windowStart < LOGIN_WINDOW_MS;
  const attempts = insideWindow ? Number(existing.attempts) + 1 : 1;
  const startedAt = insideWindow ? existing.window_started_at : now.toISOString();
  const blockedUntil = attempts >= LOGIN_MAX_ATTEMPTS
    ? new Date(now.getTime() + LOGIN_WINDOW_MS).toISOString()
    : null;
  await env.DB.prepare(`
    INSERT INTO login_rate_limits (key, attempts, window_started_at, blocked_until)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      attempts = excluded.attempts,
      window_started_at = excluded.window_started_at,
      blocked_until = excluded.blocked_until
  `).bind(key, attempts, startedAt, blockedUntil).run();
}

async function ensureSeedAccounts(env) {
  const createdAt = '2026-10-01T00:00:00.000Z';
  for (const [id, username, passwordHash, role] of SEED_ACCOUNTS) {
    await env.DB.prepare(`
      INSERT OR IGNORE INTO accounts (id, username, password_hash, role, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).bind(id, username, passwordHash, role, createdAt).run();
  }
}

async function login(request, env) {
  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ error: '登录信息格式不正确。' }, 400);
  }
  const username = normalizeText(payload?.username);
  const password = typeof payload?.password === 'string' ? payload.password : '';
  if (!username || username.length > 50 || !password || password.length > 128) {
    return json({ error: '用户名或密码错误。' }, 401);
  }

  const key = await rateLimitKey(request, username);
  const limit = await getRateLimit(env, key);
  if (limit?.blocked_until && Date.parse(limit.blocked_until) > Date.now()) {
    return json({ error: '登录尝试过于频繁，请稍后重试。' }, 429);
  }

  await ensureSeedAccounts(env);
  const account = await env.DB.prepare(`
    SELECT id, username, password_hash, role FROM accounts WHERE username = ?
  `).bind(username).first();
  let passwordMatches;
  try {
    passwordMatches = await verifyPassword(password, account?.password_hash || FALLBACK_PASSWORD_HASH);
  } catch {
    // Never log passwords, hashes, account identifiers, or raw crypto errors.
    console.error('Nexthome password verification unavailable');
    return json({ error: '登录服务暂时不可用，请稍后重试。' }, 503);
  }
  if (!account || !passwordMatches || !['admin', 'user'].includes(account.role)) {
    await recordLoginFailure(env, key, limit);
    return json({ error: '用户名或密码错误。' }, 401);
  }

  await env.DB.prepare('DELETE FROM login_rate_limits WHERE key = ?').bind(key).run();
  const token = bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)));
  const tokenHash = await sha256(token);
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + SESSION_MAX_AGE_SECONDS * 1000);
  await env.DB.prepare(`
    INSERT INTO sessions (token_hash, account_id, created_at, expires_at)
    VALUES (?, ?, ?, ?)
  `).bind(tokenHash, account.id, createdAt.toISOString(), expiresAt.toISOString()).run();
  return json(
    { user: await currentUser(new Request(request.url, { headers: { cookie: `${SESSION_COOKIE}=${token}` } }), env) },
    200,
    { 'set-cookie': sessionCookie(token) },
  );
}

async function logout(request, env) {
  const token = cookieValue(request, SESSION_COOKIE);
  if (token) await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256(token)).run();
  return json({ ok: true }, 200, { 'set-cookie': expiredSessionCookie() });
}

async function register(request, env) {
  const payload = await readJson(request);
  if (payload.error) return json({ error: payload.error }, 400);
  const { username, password, role = 'user', name = '' } = payload.value || {};
  if (typeof username !== 'string' || !/^[\p{L}\p{N}_]{3,50}$/u.test(username)
    || typeof password !== 'string' || password.length < 8 || password.length > 128
    || !['user', 'seller'].includes(role) || typeof name !== 'string' || name.length > 50) {
    return json({ error: '请使用 3–50 位用户名、8–128 位密码，并选择买家或卖家。' }, 400);
  }
  const registrationKey = await rateLimitKey(request, '__registration__');
  const registrationLimit = await getRateLimit(env, registrationKey);
  if (registrationLimit?.blocked_until && Date.parse(registrationLimit.blocked_until) > Date.now()) return json({ error: '注册尝试过于频繁，请稍后重试。' }, 429);
  await recordLoginFailure(env, registrationKey, registrationLimit);
  await ensureSeedAccounts(env);
  if (await env.DB.prepare('SELECT id FROM accounts WHERE username = ?').bind(username).first()) return json({ error: '用户名已存在。' }, 409);
  const id = crypto.randomUUID();
  try {
    await env.DB.batch([
      env.DB.prepare('INSERT INTO accounts (id, username, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)').bind(id, username, await hashPassword(password), 'user', new Date().toISOString()),
      env.DB.prepare('INSERT INTO advisor_accounts (account_id, display_name, seller) VALUES (?, ?, ?)').bind(id, name.trim() || username, role === 'seller' ? 1 : 0),
    ]);
  } catch (e) { if (/UNIQUE/i.test(e.message || '')) return json({ error: '用户名已存在。' }, 409); throw e; }
  return login(new Request(request.url, { method: 'POST', headers: request.headers, body: JSON.stringify({ username, password }) }), env);
}

function validateBasicListing(payload, checkedFields = ['ownerName', 'contactPhone', 'address']) {
  const ownerName = normalizeText(payload?.ownerName);
  const contactPhone = normalizeText(payload?.contactPhone);
  const address = normalizeText(payload?.address);
  if (checkedFields.includes('ownerName')) {
    if (!ownerName) return { error: '请输入姓名。' };
    if (ownerName.length > 50) return { error: '姓名不能超过 50 个字符。' };
  }
  if (checkedFields.includes('contactPhone') && !/^1[3-9]\d{9}$/.test(contactPhone)) return { error: '请输入有效的 11 位手机号。' };
  if (checkedFields.includes('address')) {
    if (!address) return { error: '请输入详细住址。' };
    if (address.length < 4 || !/\d/.test(address)) return { error: '请填写小区名称和具体门牌号。' };
    if (address.length > 200) return { error: '详细住址不能超过 200 个字符。' };
  }
  return { value: { ownerName, contactPhone, address } };
}

function optionalText(value, fieldName, maximumLength) {
  if (value != null && typeof value !== 'string') return { error: `${fieldName}格式不正确。` };
  const text = normalizeText(value);
  if (!text) return { value: null };
  if (text.length > maximumLength) return { error: `${fieldName}不能超过 ${maximumLength} 个字符。` };
  return { value: text };
}

function optionalNumber(value, fieldName, { integer = false, allowZero = false, maximum = Number.MAX_SAFE_INTEGER } = {}) {
  if (value === null || value === undefined || (typeof value === 'string' && !value.trim())) return { value: null };
  if (!['string', 'number'].includes(typeof value)) return { error: `${fieldName}必须是有效的数字。` };
  const number = Number(value);
  if (!Number.isFinite(number) || (integer && !Number.isInteger(number)) || (allowZero ? number < 0 : number <= 0) || number > maximum) {
    return { error: `${fieldName}必须是有效的${allowZero ? '非负数' : '正数'}。` };
  }
  return { value: number };
}

const editableFields = ['ownerName', 'contactPhone', 'address', 'bedrooms', 'livingRooms', 'bathrooms', 'areaSqm', 'totalPriceWan', 'floorLevel', 'floorTotal', 'orientation', 'decoration', 'elevator'];

function validateAdminListing(payload, existing = null) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return { error: '房源信息格式不正确。' };
  if (Object.keys(payload).some(key => !editableFields.includes(key))) return { error: '包含不允许修改的字段。' };
  for (const name of ['ownerName', 'contactPhone', 'address', 'orientation', 'decoration', 'elevator']) {
    if (payload[name] != null && typeof payload[name] !== 'string') return { error: '文本字段格式不正确。' };
  }
  const has = key => Object.hasOwn(payload, key);
  const merged = existing ? { ...existing, ...payload } : payload;
  const basic = validateBasicListing(merged, existing ? ['ownerName', 'contactPhone', 'address'].filter(has) : undefined);
  if (basic.error) return basic;
  const fields = [
    ['bedrooms', optionalNumber(payload?.bedrooms, '卧室数量', { integer: true, maximum: 20 })],
    ['livingRooms', optionalNumber(payload?.livingRooms, '客厅数量', { integer: true, allowZero: true, maximum: 20 })],
    ['bathrooms', optionalNumber(payload?.bathrooms, '卫生间数量', { integer: true, allowZero: true, maximum: 20 })],
    ['areaSqm', optionalNumber(payload?.areaSqm, '建筑面积', { maximum: 100000 })],
    ['totalPriceWan', optionalNumber(payload?.totalPriceWan, '总价', { maximum: 1000000 })],
    ['floorLevel', optionalNumber(payload?.floorLevel, '所在楼层', { integer: true, maximum: 1000 })],
    ['floorTotal', optionalNumber(payload?.floorTotal, '总楼层', { integer: true, maximum: 1000 })],
    ['orientation', optionalText(payload?.orientation, '朝向', 30)],
  ];
  const value = existing
    ? Object.fromEntries(['ownerName', 'contactPhone', 'address'].map(key => [key, has(key) ? basic.value[key] : existing[key]]))
    : { ...basic.value };
  for (const [name, result] of fields) {
    if (existing && !has(name)) { value[name] = existing[name] ?? null; continue; }
    if (result.error) return result;
    value[name] = result.value;
  }
  if (!existing || has('floorLevel') || has('floorTotal')) {
    if (value.floorLevel !== null && value.floorTotal === null) return { error: '填写所在楼层时也请填写总楼层。' };
    if (value.floorTotal !== null && value.floorLevel === null) return { error: '填写总楼层时也请填写所在楼层。' };
    if (value.floorLevel !== null && value.floorLevel > value.floorTotal) return { error: '所在楼层不能大于总楼层。' };
  }

  const decoration = normalizeText(payload?.decoration);
  if ((!existing || has('decoration')) && decoration && !['毛坯', '简装', '精装', '豪装'].includes(decoration)) return { error: '装修类型不正确。' };
  const elevator = normalizeText(payload?.elevator);
  if ((!existing || has('elevator')) && elevator && !['有电梯', '无电梯'].includes(elevator)) return { error: '电梯选项不正确。' };
  value.decoration = existing && !has('decoration') ? existing.decoration : decoration || null;
  value.elevator = existing && !has('elevator') ? existing.elevator : elevator || null;
  const priceChanged = !existing || has('areaSqm') || has('totalPriceWan');
  value.unitPriceWanPerSqm = !priceChanged ? existing.unitPriceWanPerSqm : value.areaSqm !== null && value.totalPriceWan !== null
    ? Math.round((value.totalPriceWan / value.areaSqm) * 10000) / 10000
    : null;
  value.unitPriceCalculated = priceChanged ? value.unitPriceWanPerSqm !== null : existing.unitPriceCalculated;
  return { value };
}

function mapStoredListing(row) {
  const extra = JSON.parse(row.extra_data || '{}');
  const roomParts = [];
  if (row.bedrooms !== null && row.bedrooms !== undefined) roomParts.push(`${row.bedrooms}室`);
  if (row.living_rooms !== null && row.living_rooms !== undefined) roomParts.push(`${row.living_rooms}厅`);
  if (row.bathrooms !== null && row.bathrooms !== undefined) roomParts.push(`${row.bathrooms}卫`);
  return {
    communityRefPriceWanPerSqm: null, priceVsRefPct: null, priceTag: null, priceDropped: null,
    daysOnMarket: null, listingTitle: null, highlights: null, sellingPoint: null,
    compromise: null, metro: null, targetBuyer: null, aiSummary: null,
    ...extra,
    id: row.id,
    ownerName: row.owner_name || null,
    contactPhone: row.contact_phone || null,
    address: row.address,
    community: row.community,
    building: row.building,
    unit: row.unit,
    areaSqm: row.area_sqm,
    roomType: roomParts.join('') || null,
    bedrooms: row.bedrooms,
    livingRooms: row.living_rooms,
    bathrooms: row.bathrooms,
    floorLevel: row.floor_level,
    floorTotal: row.floor_total,
    floorBand: extra.floorBand ?? null,
    orientation: row.orientation,
    decoration: row.decoration,
    elevator: row.elevator,
    totalPriceWan: row.total_price_wan,
    unitPriceWanPerSqm: row.unit_price_wan_per_sqm,
    unitPriceCalculated: Boolean(row.unit_price_calculated),
    listedDate: row.listed_date,
    createdAt: row.source_order != null ? extra.createdAt ?? null : row.created_at,
    importedAt: row.source_order != null ? row.created_at : null,
    submissionSource: row.submission_source,
    creatorAccountId: row.creator_account_id,
    creatorRole: row.creator_role,
    updatedAt: row.updated_at ?? null,
    updaterAccountId: row.updater_account_id ?? null,
  };
}

async function readBaseListings(request, env) {
  const assetUrl = new URL('/assets/properties-ai-table.json', request.url);
  const response = await env.ASSETS.fetch(new Request(assetUrl, { method: 'GET' }));
  if (!response.ok) throw new Error(`Base listing data returned ${response.status}`);
  const payload = await response.json();
  const originals = Array.isArray(payload?.table) ? payload.table : [];
  const ids = new Set(originals.map(row => row.id));
  return {
    meta: payload && typeof payload.meta === 'object' ? payload.meta : {},
    table: enrichImportedListings([...originals, ...victorMetadata.table.filter(row => row.victorAdditional && !ids.has(row.id))], victorMetadata.table),
  };
}

const listingQuery = 'SELECT * FROM listings ORDER BY CASE WHEN source_order IS NULL THEN 0 ELSE 1 END, CASE WHEN source_order IS NULL THEN created_at END DESC, source_order ASC, id ASC';

async function readListings(request, env) {
  const [base, stored] = await Promise.all([
    readBaseListings(request, env),
    env.DB.prepare(listingQuery).all(),
  ]);
  const ids = new Set((stored.results || []).map(row => row.id));
  const imports = base.table.flatMap((listing, order) => {
    if (ids.has(listing.id)) return [];
    return [env.DB.prepare(`
      INSERT INTO listings (
        id, owner_name, contact_phone, address, community, building, unit,
        area_sqm, bedrooms, living_rooms, bathrooms, floor_level, floor_total,
        orientation, decoration, elevator, total_price_wan, unit_price_wan_per_sqm,
        unit_price_calculated, listed_date, created_at, submission_source,
        creator_account_id, creator_role, extra_data, source_order
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO NOTHING
    `).bind(
      listing.id, listing.ownerName ?? '', listing.contactPhone ?? '', listing.address,
      listing.community ?? null, listing.building ?? null, listing.unit ?? null,
      listing.areaSqm ?? null, listing.bedrooms ?? null, listing.livingRooms ?? null,
      listing.bathrooms ?? null, listing.floorLevel ?? null, listing.floorTotal ?? null,
      listing.orientation ?? null, listing.decoration ?? null, listing.elevator ?? null,
      listing.totalPriceWan ?? null, listing.unitPriceWanPerSqm ?? null,
      listing.unitPriceCalculated ? 1 : 0, listing.listedDate ?? null, new Date().toISOString(),
      listing.submissionSource ?? base.meta.dataSource ?? 'imported',
      listing.creatorAccountId ?? null, listing.creatorRole ?? null, JSON.stringify(listing), order,
    )];
  });
  // The asset is a one-time source; the primary key prevents repeat imports and
  // ensures later reads never overwrite administrator edits with the asset.
  if (imports.length) await env.DB.batch(imports);
  const rows = imports.length
    ? (await env.DB.prepare(listingQuery).all()).results
    : stored.results;
  return { meta: { ...base.meta, rowCount: rows.length }, table: enrichImportedListings(rows.map(mapStoredListing), base.table) };
}

async function listListings(request, env) {
  return json(await readListings(request, env));
}

function validListingId(id) {
  return typeof id === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(id);
}

async function adminListings(request, env, id) {
  if (id !== undefined && !validListingId(id)) return json({ error: '房源 ID 格式不正确。' }, 400);
  const data = await readListings(request, env);
  if (id !== undefined) {
    const listing = data.table.find(row => row.id === id);
    return listing ? json({ listing }) : json({ error: '房源不存在，请重新搜索。' }, 404);
  }
  const query = new URL(request.url).searchParams.get('q')?.trim().toLocaleLowerCase('zh-CN') || '';
  if (query.length > 200) return json({ error: '搜索内容不能超过 200 个字符。' }, 400);
  const search = query.replace(/\s+/g, '');
  const matches = data.table.filter(row => !search || [[row.address, row.building, row.unit].filter(Boolean).join(' '), row.ownerName, row.contactPhone]
    .some(value => String(value ?? '').toLocaleLowerCase('zh-CN').replace(/\s+/g, '').includes(search)));
  return json({ listings: matches.slice(0, 50), total: matches.length });
}

async function updateAdminListing(request, env, user, id) {
  if (!validListingId(id)) return json({ error: '房源 ID 格式不正确。' }, 400);
  const payload = await readJson(request);
  if (payload.error) return json({ error: payload.error }, 400);
  await readListings(request, env);
  const row = await env.DB.prepare('SELECT * FROM listings WHERE id = ?').bind(id).first();
  if (!row) return json({ error: '房源不存在，请重新搜索。' }, 404);
  const validation = validateAdminListing(payload.value, mapStoredListing(row));
  if (validation.error) return json({ error: validation.error }, 400);
  if (!Object.keys(payload.value).length) return json({ listing: mapStoredListing(row) });
  const value = validation.value;
  const extra = JSON.parse(row.extra_data || '{}');
  if (Object.hasOwn(payload.value, 'floorLevel') || Object.hasOwn(payload.value, 'floorTotal')) extra.floorBand = null;
  if (Object.hasOwn(payload.value, 'areaSqm') || Object.hasOwn(payload.value, 'totalPriceWan')) {
    extra.priceVsRefPct = value.unitPriceWanPerSqm != null && extra.communityRefPriceWanPerSqm > 0
      ? Math.round((value.unitPriceWanPerSqm / extra.communityRefPriceWanPerSqm - 1) * 1000) / 10 : null;
    extra.priceTag = null;
  }
  await env.DB.prepare(`
    UPDATE listings SET owner_name = ?, contact_phone = ?, address = ?,
      bedrooms = ?, living_rooms = ?, bathrooms = ?, area_sqm = ?, total_price_wan = ?,
      orientation = ?, floor_level = ?, floor_total = ?, decoration = ?, elevator = ?,
      unit_price_wan_per_sqm = ?, unit_price_calculated = ?, updated_at = ?, updater_account_id = ?, extra_data = ?
    WHERE id = ?
  `).bind(
    value.ownerName ?? '', value.contactPhone ?? '', value.address, value.bedrooms, value.livingRooms,
    value.bathrooms, value.areaSqm, value.totalPriceWan, value.orientation,
    value.floorLevel, value.floorTotal, value.decoration, value.elevator,
    value.unitPriceWanPerSqm, value.unitPriceCalculated ? 1 : 0,
    new Date().toISOString(), user.id, JSON.stringify(extra), id,
  ).run();
  return json({ listing: mapStoredListing(await env.DB.prepare('SELECT * FROM listings WHERE id = ?').bind(id).first()) });
}

async function readJson(request) {
  try {
    return { value: await request.json() };
  } catch {
    return { error: '提交内容格式不正确，请检查后重试。' };
  }
}

async function insertListing(env, user, listing, source) {
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const insert = env.DB.prepare(`
    INSERT INTO listings (
      id, owner_name, contact_phone, address,
      area_sqm, bedrooms, living_rooms, bathrooms, floor_level, floor_total,
      orientation, decoration, elevator, total_price_wan, unit_price_wan_per_sqm,
      unit_price_calculated, created_at, submission_source, creator_account_id, creator_role
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    id, listing.ownerName, listing.contactPhone, listing.address,
    listing.areaSqm ?? null, listing.bedrooms ?? null, listing.livingRooms ?? null,
    listing.bathrooms ?? null, listing.floorLevel ?? null, listing.floorTotal ?? null,
    listing.orientation ?? null, listing.decoration ?? null, listing.elevator ?? null,
    listing.totalPriceWan ?? null, listing.unitPriceWanPerSqm ?? null,
    listing.unitPriceCalculated ? 1 : 0, createdAt, source, user.id, user.role === 'seller' ? 'user' : user.role,
  );
  const saved = mapStoredListing({
    id,
    owner_name: listing.ownerName,
    contact_phone: listing.contactPhone,
    address: listing.address,
    community: null,
    building: null,
    unit: null,
    area_sqm: listing.areaSqm ?? null,
    bedrooms: listing.bedrooms ?? null,
    living_rooms: listing.livingRooms ?? null,
    bathrooms: listing.bathrooms ?? null,
    floor_level: listing.floorLevel ?? null,
    floor_total: listing.floorTotal ?? null,
    orientation: listing.orientation ?? null,
    decoration: listing.decoration ?? null,
    elevator: listing.elevator ?? null,
    total_price_wan: listing.totalPriceWan ?? null,
    unit_price_wan_per_sqm: listing.unitPriceWanPerSqm ?? null,
    unit_price_calculated: listing.unitPriceCalculated ? 1 : 0,
    listed_date: null,
    created_at: createdAt,
    submission_source: source,
    creator_account_id: user.id,
    creator_role: user.role === 'seller' ? 'user' : user.role,
  });
  // The creation snapshot and business row commit together in D1. Disk writes
  // happen exclusively in the companion program, after this cloud transaction.
  await env.DB.batch([insert, env.DB.prepare(`
    INSERT INTO listing_sync_events (listing_id, creator_account_id, payload) VALUES (?, ?, ?)
  `).bind(id, user.id, JSON.stringify(saved))]);
  return saved;
}

async function createUserListing(request, env, user) {
  const payload = await readJson(request);
  if (payload.error) return json({ error: payload.error }, 400);
  const validation = validateBasicListing(payload.value);
  if (validation.error) return json({ error: validation.error }, 400);
  return json({ listing: await insertListing(env, user, validation.value, 'user_listing'), cloudSaved: true, localSync: 'pending' }, 201);
}

async function createAdminListing(request, env, user) {
  const payload = await readJson(request);
  if (payload.error) return json({ error: payload.error }, 400);
  const validation = validateAdminListing(payload.value);
  if (validation.error) return json({ error: validation.error }, 400);
  return json({ listing: await insertListing(env, user, validation.value, 'admin_manual'), cloudSaved: true, localSync: 'pending' }, 201);
}

async function syncFeed(request, env, user) {
  const params = new URL(request.url).searchParams;
  if (params.get('history') === '1') {
    const before = params.get('before');
    const after = params.get('after') || '';
    if (!/^\d{1,15}$/.test(before || '') || !Number.isSafeInteger(Number(before))
      || (after && !validListingId(after))) return json({ error: 'Invalid history cursor' }, 400);
    // Import the one-time static source before reading the historical page.
    await readListings(request, env);
    const accessClause = user.role === 'admin' ? '' : 'AND listings.creator_account_id = ?';
    const statement = env.DB.prepare(`
      SELECT listings.* FROM listings
      LEFT JOIN listing_sync_events ON listing_sync_events.listing_id = listings.id
      WHERE (listing_sync_events.sequence IS NULL OR listing_sync_events.sequence <= ?)
        AND listings.id > ? ${accessClause}
      ORDER BY listings.id ASC LIMIT 100
    `);
    const values = user.role === 'admin' ? [Number(before), after] : [Number(before), after, user.id];
    const { results = [] } = await statement.bind(...values).all();
    return json({
      cursor: results.at(-1)?.id ?? after,
      done: results.length < 100,
      listings: results.map(mapStoredListing),
      userId: user.id,
    });
  }
  const lookup = params.get('lookup');
  if (lookup !== null) {
    if (!validListingId(lookup)) return json({ error: 'Invalid ID' }, 400);
    const row = await env.DB.prepare('SELECT sequence, creator_account_id FROM listing_sync_events WHERE listing_id = ?').bind(lookup).first();
    if (!row || (user.role !== 'admin' && row.creator_account_id !== user.id)) return json({ error: 'Not found' }, 404);
    return json({ sequence: row.sequence, userId: user.id });
  }
  const after = params.get('after');
  if (after === null) {
    // First activation establishes a boundary without exporting any old rows.
    const row = await env.DB.prepare('SELECT COALESCE(MAX(sequence), 0) AS cursor FROM listing_sync_events').first();
    return json({ cursor: row.cursor, listings: [], userId: user.id });
  }
  if (!/^\d{1,15}$/.test(after) || !Number.isSafeInteger(Number(after))) return json({ error: 'Invalid sync cursor' }, 400);
  const { results = [] } = await env.DB.prepare(`
    SELECT sequence, creator_account_id, payload FROM listing_sync_events
    WHERE sequence > ? ORDER BY sequence ASC LIMIT 100
  `).bind(Number(after)).all();
  // Ordinary accounts export only their own contact records. Administrators
  // have the same complete access as the existing administrator listing API.
  const listings = results.filter(row => user.role === 'admin' || row.creator_account_id === user.id)
    .map(row => JSON.parse(row.payload));
  return json({ cursor: results.at(-1)?.sequence ?? Number(after), listings, userId: user.id });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method) && !hasValidOrigin(request)) {
        return json({ error: '请求来源校验失败。' }, 403);
      }
      if (url.pathname === '/api/auth/session' && request.method === 'GET') {
        return json({ user: await currentUser(request, env) });
      }
      if (url.pathname === '/api/auth/login' && request.method === 'POST') return await login(request, env);
      if (url.pathname === '/api/auth/register' && request.method === 'POST') return await register(request, env);
      if (url.pathname === '/api/auth/logout' && request.method === 'POST') return await logout(request, env);
      if (url.pathname.startsWith('/api/advisor/') || url.pathname === '/api/ai') {
        const auth = await requireUser(request, env);
        if (auth.response) return auth.response;
        return await handleAdvisor(request, env, auth.user, { readListings, json, currentUser });
      }
      if (url.pathname === '/api/sync/listings' && request.method === 'GET') {
        const auth = await requireUser(request, env);
        return auth.response || await syncFeed(request, env, auth.user);
      }
      if (url.pathname === '/api/listings' && request.method === 'GET') return await listListings(request, env);
      if (url.pathname === '/api/map/config' && request.method === 'GET') {
        // JS browser keys are public by design; the security code never leaves the Worker.
        return json({ key: env.AMAP_PUBLIC_JS_KEY || '', ready: Boolean(env.AMAP_PUBLIC_JS_KEY && env.AMAP_SECURITY_JS_CODE),
          coordinateSystem: env.MAP_COORDINATE_SYSTEM || '', city: env.MAP_GEOCODE_CITY || '' });
      }
      if (url.pathname.startsWith('/_AMapService/') && request.method === 'GET') {
        // Fixed destinations and paths: this is not a general-purpose proxy.
        const path = url.pathname.slice('/_AMapService'.length);
        if (!['/v3/geocode/geo', '/v3/assistant/coordinate/convert', '/v4/map/styles'].includes(path)) return json({ error: '接口不存在或请求方式不受支持。' }, 405);
        const origin = request.headers.get('origin');
        const referer = request.headers.get('referer');
        if ((origin && origin !== url.origin) || !referer || new URL(referer).origin !== url.origin) return json({ error: '请求来源校验失败。' }, 403);
        if (!env.AMAP_PUBLIC_JS_KEY || !env.AMAP_SECURITY_JS_CODE) return json({ error: '地图服务尚未配置。' }, 503);
        const upstream = new URL(path, path === '/v4/map/styles' ? 'https://webapi.amap.com' : 'https://restapi.amap.com');
        upstream.search = url.search;
        upstream.searchParams.set('key', env.AMAP_PUBLIC_JS_KEY);
        upstream.searchParams.set('jscode', env.AMAP_SECURITY_JS_CODE);
        const response = await fetch(upstream, { signal: AbortSignal.timeout(15000) });
        return new Response(response.body, { status: response.status, headers: {
          'content-type': response.headers.get('content-type') || 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
      }
      if (url.pathname === '/api/listings' && request.method === 'POST') {
        const auth = await requireUser(request, env);
        return auth.response || await createUserListing(request, env, auth.user);
      }
      if (url.pathname === '/api/admin/listings' && request.method === 'POST') {
        const auth = await requireUser(request, env, 'admin');
        return auth.response || await createAdminListing(request, env, auth.user);
      }
      if (url.pathname === '/api/admin/listings' && request.method === 'GET') {
        const auth = await requireUser(request, env, 'admin');
        return auth.response || await adminListings(request, env);
      }
      if (url.pathname.startsWith('/api/admin/listings/') && ['GET', 'PATCH'].includes(request.method)) {
        const auth = await requireUser(request, env, 'admin');
        if (auth.response) return auth.response;
        let id;
        try { id = decodeURIComponent(url.pathname.slice('/api/admin/listings/'.length)); }
        catch { return json({ error: '房源 ID 格式不正确。' }, 400); }
        return request.method === 'GET'
          ? await adminListings(request, env, id)
          : await updateAdminListing(request, env, auth.user, id);
      }
      if (url.pathname.startsWith('/api/')) return json({ error: '接口不存在或请求方式不受支持。' }, 405);
      return env.ASSETS.fetch(request);
    } catch (error) {
      console.error('Nexthome request failed');
      return json({ error: '服务暂时不可用，请稍后重试。' }, 500);
    }
  },
};
