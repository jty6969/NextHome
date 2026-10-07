import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM, VirtualConsole } from 'jsdom';
import test from 'node:test';

const admin = { id: 'seed-admin-1', username: '管理员账号1', role: 'admin' };
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const response = (data, status = 200) => ({ ok: status < 400, status, json: async () => data });

async function page({ delayedSession = false, handler, sessionUser = admin, loginUser = admin } = {}) {
  const errors = [];
  let resolveSession;
  const console = new VirtualConsole();
  console.on('jsdomError', error => errors.push(error));
  const dom = new JSDOM(await readFile(new URL('../index.html', import.meta.url), 'utf8'), {
    runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://nexthome.test/', virtualConsole: console,
    beforeParse(window) {
      window.HTMLElement.prototype.scrollIntoView = () => {};
      window.fetch = async (url, options = {}) => {
        if (url === '/api/auth/session') {
          if (delayedSession) return new Promise(resolve => { resolveSession = resolve; });
          return response({ user: sessionUser });
        }
        if (url === '/api/auth/login') return response({ user: loginUser });
        if (handler) {
          const result = await handler(url, options);
          if (result) return result;
        }
        if (url === '/api/listings') return response({ table: [] });
        throw new Error(`Unexpected request: ${url}`);
      };
    },
  });
  await tick();
  return { dom, document: dom.window.document, errors, resolveSession: () => resolveSession(response({ user: null })) };
}

test('authenticated admin entry opens and closes through button, backdrop and Escape', async () => {
  const p = await page();
  try {
    assert.deepEqual(p.errors, []);
    const modal = p.document.getElementById('adminModal');
    const open = () => p.document.getElementById('openAdminModal').click();
    assert.equal(p.document.getElementById('openAdminModal').hidden, false);
    open();
    assert.equal(modal.hidden, false);
    p.document.getElementById('closeAdminModal').click();
    assert.equal(modal.hidden, true);
    open();
    modal.click();
    assert.equal(modal.hidden, true);
    open();
    p.document.dispatchEvent(new p.dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.equal(modal.hidden, true);
  } finally { p.dom.window.close(); }
});

test('collect entry is absent for all roles and listing entry remains usable', async () => {
  for (const [sessionUser, modalId] of [[admin, 'listingModal'], [{ id: 'user-1', username: '用户', role: 'user' }, 'listingModal'], [null, 'authModal']]) {
    const p = await page({ sessionUser });
    try {
      assert.equal(p.document.getElementById('openCollectModal'), null);
      assert.equal(p.document.querySelector('[aria-label="收录房源"]'), null);
      p.document.getElementById('openListingModal').click();
      assert.equal(p.document.getElementById(modalId).hidden, false);
      assert.deepEqual(p.errors, []);
    } finally { p.dom.window.close(); }
  }
});

test('listing action resumes after administrator or ordinary-user login without a collect entry', async () => {
  for (const loginUser of [admin, { id: 'user-1', username: '用户', role: 'user' }]) {
    const p = await page({ sessionUser: null, loginUser });
    try {
      p.document.getElementById('openListingModal').click();
      assert.equal(p.document.getElementById('authModal').hidden, false);
      p.document.getElementById('loginUsername').value = loginUser.username;
      p.document.getElementById('loginPassword').value = 'test';
      submit(p, 'loginForm');
      await tick();
      assert.equal(p.document.getElementById('openCollectModal'), null);
      assert.equal(p.document.getElementById('authModal').hidden, true);
      assert.equal(p.document.getElementById('listingModal').hidden, false);
      if (loginUser.role !== 'admin') assert.equal(p.document.getElementById('adminModal').hidden, true);
    } finally { p.dom.window.close(); }
  }
});

test('late anonymous initialization cannot overwrite a successful administrator login', async () => {
  const p = await page({ delayedSession: true });
  try {
    p.document.getElementById('authButton').click();
    p.document.getElementById('loginUsername').value = admin.username;
    p.document.getElementById('loginPassword').value = 'test';
    p.document.getElementById('loginForm').dispatchEvent(new p.dom.window.Event('submit', { bubbles: true, cancelable: true }));
    await tick();
    assert.equal(p.document.getElementById('openAdminModal').hidden, false);
    p.resolveSession();
    await tick();
    p.document.getElementById('openAdminModal').click();
    assert.equal(p.document.getElementById('adminModal').hidden, false);
  } finally { p.dom.window.close(); }
});

const listing = {
  id: 'existing-1', ownerName: '原联系人', contactPhone: '13800138000', address: '测试小区 1号101室',
  bedrooms: 3, livingRooms: 2, bathrooms: 1, areaSqm: 100, totalPriceWan: 500,
  orientation: '南北', floorLevel: 5, floorTotal: 10, decoration: '简装', elevator: null,
  roomType: '3室2厅1卫', submissionSource: 'user_listing', createdAt: '2026-09-05T00:00:00Z',
};
function submit(p, id) { p.document.getElementById(id).dispatchEvent(new p.dom.window.Event('submit', { bubbles: true, cancelable: true })); }
async function choose(p) {
  p.document.getElementById('openAdminModal').click();
  p.document.getElementById('adminEditMode').click();
  submit(p, 'adminSearchForm');
  await tick();
  p.document.querySelector('#adminSearchResults button').click();
  await tick();
}
const loadHandler = async url => {
  if (url.startsWith('/api/admin/listings?q=')) return response({ listings: [listing], total: 1 });
  if (url === `/api/admin/listings/${listing.id}`) return response({ listing });
};

test('search and loading populate the edit form and save only changed fields with PATCH', async () => {
  const writes = [];
  let stored = { ...listing };
  const p = await page({ handler: async (url, options) => {
    if (options.method === 'PATCH') {
      writes.push({ url, body: JSON.parse(options.body), method: options.method });
      stored = { ...stored, ...JSON.parse(options.body) };
      return response({ listing: stored });
    }
    if (url === '/api/listings') return response({ table: [stored] });
    return loadHandler(url);
  } });
  try {
    await choose(p);
    assert.equal(p.document.getElementById('adminOwnerName').value, listing.ownerName);
    assert.equal(p.document.getElementById('adminAreaSqm').value, '100');
    p.document.getElementById('adminOrientation').value = '';
    p.document.getElementById('adminTotalPriceWan').value = '550';
    submit(p, 'adminListingForm');
    await tick();
    assert.deepEqual(writes, [{ url: `/api/admin/listings/${listing.id}`, body: { totalPriceWan: '550', orientation: null }, method: 'PATCH' }]);
    assert.equal(p.document.getElementById('adminModal').hidden, true);
    assert.equal(p.document.querySelectorAll(`[data-id="${listing.id}"]`).length, 1);
    assert.match(p.document.getElementById('listingGrid').textContent, /550万/);
    assert.deepEqual(p.errors, []);
  } finally { p.dom.window.close(); }
});

test('minimal new listing submits NULL optional fields and appears immediately', async () => {
  const writes = [];
  let stored;
  const p = await page({ handler: async (url, options) => {
    if (url === '/api/admin/listings' && options.method === 'POST') {
      const body = JSON.parse(options.body);
      writes.push(body);
      stored = { ...body, id: 'new-1', submissionSource: 'admin_manual' };
      return response({ listing: stored }, 201);
    }
    if (url === '/api/listings') return response({ table: stored ? [stored] : [] });
  } });
  try {
    p.document.getElementById('openAdminModal').click();
    p.document.getElementById('adminOwnerName').value = '真实联系人';
    p.document.getElementById('adminOwnerPhone').value = '13900139000';
    p.document.getElementById('adminPropertyAddress').value = '真实小区 9号901室';
    submit(p, 'adminListingForm');
    await tick();
    assert.equal(writes.length, 1);
    for (const name of ['areaSqm', 'totalPriceWan', 'bedrooms', 'floorLevel', 'floorTotal', 'orientation', 'decoration', 'elevator']) assert.equal(writes[0][name], null);
    assert.equal(p.document.getElementById('adminModal').hidden, true);
    assert.equal(p.document.querySelectorAll('[data-id="new-1"]').length, 1);
  } finally { p.dom.window.close(); }
});

test('failed saves preserve edit inputs and keep the modal open for retry', async () => {
  const p = await page({ handler: async (url, options) => options.method === 'PATCH'
    ? response({ error: '数据库保存失败，请重试。' }, 500) : loadHandler(url) });
  try {
    await choose(p);
    p.document.getElementById('adminOrientation').value = '东南';
    submit(p, 'adminListingForm');
    await tick();
    assert.equal(p.document.getElementById('adminOrientation').value, '东南');
    assert.equal(p.document.getElementById('adminModal').hidden, false);
    assert.equal(p.document.getElementById('submitAdminButton').disabled, false);
    assert.match(p.document.getElementById('adminFormMessage').textContent, /保存失败/);
  } finally { p.dom.window.close(); }
});

test('failed loading keeps the existing draft and selected record', async () => {
  let failLoad = false;
  const p = await page({ handler: async url => failLoad && url === `/api/admin/listings/${listing.id}`
    ? response({ error: '加载失败，请重试。' }, 503) : loadHandler(url) });
  try {
    await choose(p);
    p.document.getElementById('adminOwnerName').value = '未保存的修改';
    failLoad = true;
    p.document.querySelector('#adminSearchResults button').click();
    await tick();
    assert.equal(p.document.getElementById('adminOwnerName').value, '未保存的修改');
    assert.match(p.document.getElementById('adminSelectedListing').textContent, /existing-1/);
    assert.match(p.document.getElementById('adminFormMessage').textContent, /加载失败/);
    assert.equal(p.document.getElementById('adminModal').hidden, false);
  } finally { p.dom.window.close(); }
});

test('successful creation followed by list refresh failure cannot retry as another creation', async () => {
  const methods = [];
  let stored;
  let listFails = false;
  const p = await page({ handler: async (url, options) => {
    if (options.method === 'POST' || options.method === 'PATCH') {
      methods.push(options.method);
      stored = { ...stored, ...JSON.parse(options.body), id: 'saved-1', submissionSource: 'admin_manual' };
      listFails = true;
      return response({ listing: stored }, options.method === 'POST' ? 201 : 200);
    }
    if (url === '/api/listings' && listFails) return response({ error: 'unavailable' }, 503);
  } });
  try {
    p.document.getElementById('openAdminModal').click();
    p.document.getElementById('adminOwnerName').value = '真实联系人';
    p.document.getElementById('adminOwnerPhone').value = '13900139000';
    p.document.getElementById('adminPropertyAddress').value = '真实小区 9号901室';
    submit(p, 'adminListingForm');
    await tick();
    assert.equal(p.document.getElementById('adminModal').hidden, false);
    assert.equal(p.document.getElementById('adminOwnerName').value, '真实联系人');
    assert.match(p.document.getElementById('adminFormMessage').textContent, /已保存.*刷新失败/);
    assert.equal(p.document.querySelectorAll('[data-id="saved-1"]').length, 1);
    p.document.getElementById('adminAreaSqm').value = '90';
    submit(p, 'adminListingForm');
    await tick();
    assert.deepEqual(methods, ['POST', 'PATCH']);
    assert.equal(p.document.querySelectorAll('[data-id="saved-1"]').length, 1);
  } finally { p.dom.window.close(); }
});

test('imported rows with unknown contacts can be supplemented without inventing required data', async () => {
  const imported = { ...listing, ownerName: null, contactPhone: null };
  let payload;
  const p = await page({ handler: async (url, options) => {
    if (options.method === 'PATCH') { payload = JSON.parse(options.body); return response({ listing: { ...imported, ...payload } }); }
    if (url.startsWith('/api/admin/listings?q=')) return response({ listings: [imported], total: 1 });
    if (url === `/api/admin/listings/${listing.id}`) return response({ listing: imported });
  } });
  try {
    await choose(p);
    assert.equal(p.document.getElementById('adminOwnerName').value, '');
    p.document.getElementById('adminOrientation').value = '东';
    submit(p, 'adminListingForm');
    await tick();
    assert.deepEqual(payload, { orientation: '东' });
  } finally { p.dom.window.close(); }
});

test('mode switches and closing retain drafts and ordinary users cannot open the administrator modal', async () => {
  const p = await page();
  try {
    p.document.getElementById('openAdminModal').click();
    p.document.getElementById('adminOwnerName').value = '暂存姓名';
    p.document.getElementById('adminEditMode').click();
    assert.equal(p.document.getElementById('submitAdminButton').disabled, true);
    p.document.getElementById('adminCreateMode').click();
    assert.equal(p.document.getElementById('adminOwnerName').value, '暂存姓名');
    p.document.getElementById('closeAdminModal').click();
    p.document.getElementById('openAdminModal').click();
    assert.equal(p.document.getElementById('adminOwnerName').value, '暂存姓名');
  } finally { p.dom.window.close(); }
  for (const sessionUser of [null, { id: 'user-1', username: '普通用户', role: 'user' }]) {
    const ordinary = await page({ sessionUser });
    ordinary.document.getElementById('openAdminModal').click();
    assert.equal(ordinary.document.getElementById('adminModal').hidden, true);
    ordinary.dom.window.close();
  }
});

test('failed new saves and searches retain input and show a recoverable error', async () => {
  const p = await page({ handler: async (url, options) => {
    if (options.method === 'POST') return response({ error: '新增保存失败，请重试。' }, 503);
    if (url.startsWith('/api/admin/listings?q=')) return response({ error: '搜索服务暂时不可用。' }, 503);
  } });
  try {
    p.document.getElementById('openAdminModal').click();
    p.document.getElementById('adminOwnerName').value = '待保存姓名';
    p.document.getElementById('adminOwnerPhone').value = '13800138000';
    p.document.getElementById('adminPropertyAddress').value = '测试小区 1号101室';
    submit(p, 'adminListingForm');
    await tick();
    assert.equal(p.document.getElementById('adminOwnerName').value, '待保存姓名');
    assert.equal(p.document.getElementById('adminModal').hidden, false);
    assert.match(p.document.getElementById('adminFormMessage').textContent, /新增保存失败/);
    p.document.getElementById('adminEditMode').click();
    p.document.getElementById('adminSearchInput').value = '13800138000';
    submit(p, 'adminSearchForm');
    await tick();
    assert.equal(p.document.getElementById('adminSearchInput').value, '13800138000');
    assert.match(p.document.getElementById('adminSearchMessage').textContent, /暂时不可用/);
    p.document.getElementById('adminCreateMode').click();
    assert.equal(p.document.getElementById('adminOwnerName').value, '待保存姓名');
  } finally { p.dom.window.close(); }
});

test('existing filters, favorites and user listing submission remain operational', async () => {
  let posted;
  const p = await page({ sessionUser: { id: 'user-1', username: '用户', role: 'user' }, handler: async (url, options) => {
    if (url === '/api/listings' && options.method === 'POST') { posted = JSON.parse(options.body); return response({ listing }, 201); }
    if (url === '/api/listings') return response({ table: [listing] });
  } });
  try {
    const favorite = p.document.querySelector('.favorite');
    favorite.click();
    assert.equal(favorite.getAttribute('aria-pressed'), 'true');
    favorite.click();
    assert.equal(favorite.getAttribute('aria-pressed'), 'false');
    p.document.getElementById('searchInput').value = '无匹配地址';
    submit(p, 'searchForm');
    assert.equal(p.document.getElementById('resultCount').textContent, '0');
    p.document.getElementById('clearFilter').click();
    assert.equal(p.document.getElementById('resultCount').textContent, '1');
    p.document.getElementById('openListingModal').click();
    p.document.getElementById('ownerName').value = '挂牌联系人';
    p.document.getElementById('ownerPhone').value = '13800138000';
    p.document.getElementById('propertyAddress').value = '挂牌小区 1号101室';
    submit(p, 'listingForm');
    await tick();
    assert.deepEqual(posted, { ownerName: '挂牌联系人', contactPhone: '13800138000', address: '挂牌小区 1号101室' });
    assert.equal(p.document.getElementById('listingModal').hidden, true);
  } finally { p.dom.window.close(); }
});
