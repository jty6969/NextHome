import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM, VirtualConsole } from 'jsdom';
import test from 'node:test';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const response = (data, status = 200) => ({ ok: status < 400, status, json: async () => data });
const admin = { id: 'admin-1', username: '真实管理员', role: 'admin' };
// Test fixtures stay in memory and are never submitted to a real service.
const property = {
  id: 'fixture-1', address: '测试区真实地址 1号101室', community: '原始小区名称',
  ownerName: '姓名', contactPhone: '13800138000', roomType: '3室2厅2卫', bedrooms: 3,
  areaSqm: 110, totalPriceWan: 420, unitPriceWanPerSqm: 3.82, unitPriceCalculated: true,
  orientation: '南北', decoration: '精装', elevator: '有电梯', floorLevel: 3, floorTotal: 12,
  priceTag: '低于参考价', floorBand: '中楼层', listedDate: '2026-09-01', daysOnMarket: 30,
};

async function page({ preference, storageBlocked = false, user = admin, rows = [property], handler, fastDeadlines = false } = {}) {
  const errors = [];
  const requests = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', error => errors.push(error));
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://nexthome.test/', virtualConsole,
    beforeParse(window) {
      if (fastDeadlines) {
        const schedule = window.setTimeout.bind(window);
        window.setTimeout = (callback, delay, ...args) => schedule(callback, delay === 20000 ? 25 : delay, ...args);
      }
      if (preference) window.localStorage.setItem('nexthome.language', preference);
      if (storageBlocked) Object.defineProperty(window, 'localStorage', { get() { throw new Error('Storage blocked'); } });
      window.HTMLElement.prototype.scrollIntoView = () => {};
      window.fetch = async (url, options = {}) => {
        requests.push({ url, options });
        if (handler) {
          const result = await handler(url, options);
          if (result) return result;
        }
        if (url === '/api/auth/session') return response({ user });
        if (url === '/api/listings') return response({ table: rows });
        if (url.startsWith('/api/admin/listings?q=')) return response({ listings: rows, total: rows.length });
        if (url === `/api/admin/listings/${property.id}`) return response({ listing: property });
        throw new Error(`Unexpected request: ${url}`);
      };
    },
  });
  await tick();
  assert.deepEqual(errors, []);
  const document = dom.window.document;
  const get = id => document.getElementById(id);
  const choose = language => document.querySelector(`[data-language="${language}"]`).click();
  const submit = id => get(id).dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  return { dom, document, get, choose, submit, requests };
}

test('default, persisted and invalid preferences initialize safely; language names stay unchanged', async () => {
  for (const [preference, expected] of [[undefined, 'zh-CN'], ['en', 'en'], ['unknown', 'zh-CN']]) {
    const p = await page({ preference });
    try {
      assert.equal(p.document.documentElement.lang, expected);
      assert.equal(p.document.querySelector('[aria-checked="true"]').dataset.language, expected);
      assert.deepEqual([...p.document.querySelectorAll('[data-language]')].map(node => node.textContent), ['简体中文', 'English']);
      p.choose('en');
      assert.equal(p.dom.window.localStorage.getItem('nexthome.language'), 'en');
      assert.equal(p.document.title, 'Nexthome | Property Library');
      p.choose('zh-CN');
      assert.equal(p.get('propertyInfoButton').textContent, '房屋信息');
      assert.equal(p.dom.window.localStorage.getItem('nexthome.language'), 'zh-CN');
    } finally { p.dom.window.close(); }
  }
  const p = await page({ storageBlocked: true });
  try { p.choose('en'); assert.equal(p.get('propertyInfoButton').textContent, 'Properties'); }
  finally { p.dom.window.close(); }
});

test('hover stays open across the dropdown gap; click, outside click, Escape and keyboard work', async () => {
  const p = await page();
  try {
    const wrapper = p.get('languageSwitch');
    const menu = p.get('languageMenu');
    wrapper.dispatchEvent(new p.dom.window.MouseEvent('mouseenter'));
    assert.equal(menu.hidden, false);
    menu.dispatchEvent(new p.dom.window.MouseEvent('mouseenter'));
    assert.equal(menu.hidden, false);
    wrapper.dispatchEvent(new p.dom.window.MouseEvent('mouseleave'));
    assert.equal(menu.hidden, true);
    // A desktop click after hover pins the open menu instead of closing it.
    wrapper.dispatchEvent(new p.dom.window.MouseEvent('mouseenter'));
    p.get('languageButton').click();
    assert.equal(menu.hidden, false);
    const key = name => p.document.activeElement.dispatchEvent(new p.dom.window.KeyboardEvent('keydown', { key: name, bubbles: true }));
    assert.equal(p.document.activeElement.dataset.language, 'zh-CN');
    key('ArrowDown');
    assert.equal(p.document.activeElement.dataset.language, 'en');
    key('Home');
    assert.equal(p.document.activeElement.dataset.language, 'zh-CN');
    key('End');
    assert.equal(p.document.activeElement.dataset.language, 'en');
    key('Escape');
    assert.equal(menu.hidden, true);
    assert.equal(p.document.activeElement, p.get('languageButton'));
    p.get('languageButton').click();
    p.document.body.click();
    assert.equal(menu.hidden, true);
    assert.equal(p.get('languageButton').getAttribute('aria-expanded'), 'false');
    p.get('languageButton').click();
    key('Tab');
    assert.equal(menu.hidden, true);
  } finally { p.dom.window.close(); }
});

test('language switching keeps filters, sorting, card identity, favorites and raw business data', async () => {
  const p = await page();
  try {
    const original = JSON.stringify(property);
    const card = p.document.querySelector('.listing-card');
    const favorite = card.querySelector('.favorite');
    favorite.click();
    p.get('district').value = '测试区';
    p.get('layout').value = '三室';
    p.get('price').value = '300–500 万';
    p.get('decoration').value = '精装';
    p.get('sort').value = '总价从低到高';
    p.get('searchInput').value = '真实地址';
    p.submit('searchForm');
    const requestCount = p.requests.length;
    p.choose('en');
    assert.equal(p.document.querySelector('.listing-card'), card);
    assert.equal(p.get('resultCount').textContent, '1');
    assert.equal(favorite.getAttribute('aria-pressed'), 'true');
    for (const [id, value] of [['district', '测试区'], ['layout', '三室'], ['price', '300–500 万'], ['decoration', '精装'], ['sort', '总价从低到高'], ['searchInput', '真实地址']]) assert.equal(p.get(id).value, value);
    assert.equal(p.get('layout').selectedOptions[0].textContent, '3 bedrooms');
    assert.match(card.textContent, /Below reference price/);
    assert.match(card.textContent, /Floor 3 \/ 12/);
    assert.match(card.textContent, /3 bed \/ 2 living \/ 2 bath/);
    assert.match(card.textContent, /Days listed: 30/);
    assert.match(card.textContent, /North \/ South/);
    assert.match(card.textContent, /姓名 · 13800138000/);
    assert.equal(card.querySelector('h3').textContent, property.address);
    assert.equal(p.requests.length, requestCount);
    assert.equal(JSON.stringify(property), original);
    p.choose('zh-CN');
    assert.match(card.textContent, /低于参考价/);
    assert.equal(favorite.getAttribute('aria-pressed'), 'true');
    assert.equal(card.hidden, false);
  } finally { p.dom.window.close(); }
});

test('sorting and filters still operate in English with unchanged canonical values', async () => {
  const p = await page({ preference: 'en', rows: [property, { ...property, id: 'fixture-2', totalPriceWan: 200, areaSqm: 85 }] });
  try {
    p.get('sort').value = '总价从低到高';
    p.get('sort').dispatchEvent(new p.dom.window.Event('change'));
    assert.equal(p.document.querySelector('.listing-card').dataset.id, 'fixture-2');
    p.get('price').value = '300 万以内';
    p.get('price').dispatchEvent(new p.dom.window.Event('change'));
    assert.equal(p.get('resultCount').textContent, '1');
    assert.equal(p.document.querySelector('[data-id="fixture-2"]').hidden, false);
    p.get('clearFilter').click();
    assert.equal(p.get('resultCount').textContent, '2');
  } finally { p.dom.window.close(); }
});

test('all modal drafts, password visibility, selected edit record and session survive language changes', async () => {
  const p = await page();
  try {
    p.get('openListingModal').click();
    p.get('ownerName').value = '未保存姓名';
    p.get('ownerPhone').value = '13800138000';
    p.get('propertyAddress').value = '未保存地址 3号';
    p.choose('en');
    assert.equal(p.get('listingModal').hidden, false);
    assert.equal(p.get('ownerName').value, '未保存姓名');
    assert.equal(p.get('propertyAddress').value, '未保存地址 3号');
    p.get('closeListingModal').click();
    p.get('openAdminModal').click();
    p.get('adminOwnerName').value = '新增草稿';
    p.get('adminDecoration').value = '毛坯';
    p.get('adminEditMode').click();
    p.submit('adminSearchForm');
    await tick();
    p.document.querySelector('#adminSearchResults button').click();
    await tick();
    p.get('adminOrientation').value = '未保存朝向';
    const requestCount = p.requests.length;
    p.choose('zh-CN');
    p.choose('en');
    assert.equal(p.get('adminModal').hidden, false);
    assert.equal(p.get('adminOrientation').value, '未保存朝向');
    assert.match(p.get('adminSelectedListing').textContent, /Selected:.*fixture-1/);
    assert.equal(p.requests.length, requestCount);
    assert.match(p.get('authButton').textContent, /真实管理员 · Administrator/);
    p.get('adminCreateMode').click();
    assert.equal(p.get('adminOwnerName').value, '新增草稿');
    assert.equal(p.get('adminDecoration').value, '毛坯');
    p.get('closeAdminModal').click();
    p.get('authButton').click();
    p.choose('zh-CN');
    assert.match(p.get('loggedInDescription').textContent, /真实管理员（管理员）/);
  } finally { p.dom.window.close(); }
  const guest = await page({ user: null });
  try {
    guest.get('authButton').click();
    guest.get('loginUsername').value = '未保存用户名';
    guest.get('loginPassword').value = 'unsaved-password';
    guest.get('toggleLoginPassword').click();
    guest.choose('en');
    assert.equal(guest.get('loginPassword').value, 'unsaved-password');
    assert.equal(guest.get('loginPassword').type, 'text');
    assert.equal(guest.get('toggleLoginPassword').getAttribute('aria-label'), 'Hide password');
    assert.equal(guest.get('authModal').hidden, false);
    guest.get('languageButton').click();
    guest.document.dispatchEvent(new guest.dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.equal(guest.get('languageMenu').hidden, true);
    assert.equal(guest.get('authModal').hidden, false);
  } finally { guest.dom.window.close(); }
});

test('in-flight login translates loading, backend error, and already displayed errors in both directions', async () => {
  let finish;
  const p = await page({ user: null, handler: async url => url === '/api/auth/login' ? new Promise(resolve => { finish = resolve; }) : undefined });
  try {
    p.get('authButton').click();
    p.get('loginUsername').value = '原始用户名';
    p.get('loginPassword').value = 'original-password';
    p.submit('loginForm');
    p.choose('en');
    assert.equal(p.get('submitLoginButton').textContent, 'Logging in…');
    assert.equal(p.get('submitLoginButton').disabled, true);
    finish(response({ error: '用户名或密码错误。' }, 401));
    await tick();
    assert.equal(p.get('loginFormMessage').textContent, 'Incorrect username or password.');
    p.choose('zh-CN');
    assert.equal(p.get('loginFormMessage').textContent, '用户名或密码错误。');
    assert.equal(p.get('loginUsername').value, '原始用户名');
    assert.equal(p.get('loginPassword').value, 'original-password');
  } finally { p.dom.window.close(); }
});

test('English admin saves send canonical values and original business data; success stays localized', async () => {
  let payload;
  const p = await page({ preference: 'en', handler: async (url, options) => {
    if (url === '/api/admin/listings' && options.method === 'POST') {
      payload = JSON.parse(options.body);
      return response({ listing: { ...property, ...payload, submissionSource: 'admin_manual' } }, 201);
    }
  } });
  try {
    p.get('openAdminModal').click();
    p.get('adminOwnerName').value = '原始姓名';
    p.get('adminOwnerPhone').value = '13800138000';
    p.get('adminPropertyAddress').value = '原始地址 1号';
    p.get('adminDecoration').value = '毛坯';
    p.get('adminElevator').value = '有电梯';
    p.submit('adminListingForm');
    await tick();
    assert.equal(payload.ownerName, '原始姓名');
    assert.equal(payload.address, '原始地址 1号');
    assert.equal(payload.decoration, '毛坯');
    assert.equal(payload.elevator, '有电梯');
    assert.match(p.get('listingToast').textContent, /Property saved and added/);
    p.choose('zh-CN');
    assert.match(p.get('listingToast').textContent, /房源已录入/);
  } finally { p.dom.window.close(); }
});

test('custom and native validation display localized messages without changing input', async () => {
  const p = await page();
  try {
    p.get('openListingModal').click();
    p.get('ownerName').value = '真实姓名';
    p.get('ownerPhone').value = '123';
    p.get('propertyAddress').value = '完整地址 1号';
    p.submit('listingForm');
    assert.match(p.get('ownerPhone').validationMessage, /11 位手机号/);
    p.choose('en');
    assert.equal(p.get('ownerPhone').validationMessage, 'Enter a valid 11-digit mobile number.');
    assert.equal(p.get('ownerPhone').value, '123');
    assert.match(p.get('listingFormMessage').textContent, /11-digit/);
    p.get('closeListingModal').click();
    p.get('openAdminModal').click();
    p.get('adminListingForm').reportValidity();
    assert.equal(p.get('adminFormMessage').textContent, 'Please fill in this field.');
    p.choose('zh-CN');
    assert.equal(p.get('adminFormMessage').textContent, '请填写此项。');
  } finally { p.dom.window.close(); }
});

test('loading, empty lists, no matches, and failed list fetches are localized', async () => {
  let finish;
  const p = await page({ handler: async url => url === '/api/listings' ? new Promise(resolve => { finish = resolve; }) : undefined });
  try {
    assert.equal(p.document.querySelectorAll('.listing-card').length, 0);
    p.choose('en');
    assert.equal(p.get('emptyStateTitle').textContent, 'Loading properties…');
    finish(response({ table: [] }));
    await tick();
    assert.equal(p.get('emptyStateTitle').textContent, 'No properties yet');
    p.get('searchInput').value = '无结果';
    p.submit('searchForm');
    assert.equal(p.get('emptyStateTitle').textContent, 'No matching properties');
    p.choose('zh-CN');
    assert.equal(p.get('emptyStateTitle').textContent, '没有找到符合条件的房源');
  } finally { p.dom.window.close(); }
  const failed = await page({ preference: 'en', handler: async url => url === '/api/listings' ? response({}, 503) : undefined });
  try {
    assert.equal(failed.get('emptyStateTitle').textContent, 'Unable to load properties');
    failed.choose('zh-CN');
    assert.equal(failed.get('emptyStateTitle').textContent, '房源列表加载失败');
  } finally { failed.dom.window.close(); }
});

test('unknown service errors get a localized fallback, while server numeric validation stays specific', async () => {
  for (const [error, expected] of [['未知后端错误信息。', 'Unable to save the property. Please try again later.'], ['卧室数量必须是有效的正数。', 'Bedroom count must be a valid positive number.']]) {
    const p = await page({ preference: 'en', handler: async (url, options) => options.method === 'POST' ? response({ error }, 400) : undefined });
    try {
      p.get('openAdminModal').click();
      p.get('adminOwnerName').value = '原名';
      p.get('adminOwnerPhone').value = '13800138000';
      p.get('adminPropertyAddress').value = '原地址 1号';
      p.submit('adminListingForm');
      await tick();
      assert.equal(p.get('adminFormMessage').textContent, expected);
      p.choose('zh-CN');
      assert.equal(p.get('adminFormMessage').textContent, error);
    } finally { p.dom.window.close(); }
  }
});

test('English interface contains no untranslated authored Chinese copy or attributes', async () => {
  const p = await page({ preference: 'en', user: null, rows: [] });
  try {
    const walker = p.document.createTreeWalker(p.document.body, p.dom.window.NodeFilter.SHOW_TEXT);
    const untranslated = [];
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (node.parentElement.closest('script, style, [data-language]')) continue;
      if (/[\u4e00-\u9fff]/.test(node.textContent)) untranslated.push(node.textContent.trim());
    }
    for (const element of p.document.querySelectorAll('[placeholder], [aria-label], [title]')) {
      for (const name of ['placeholder', 'aria-label', 'title']) {
        if (/[\u4e00-\u9fff]/.test(element.getAttribute(name) || '')) untranslated.push(element.getAttribute(name));
      }
    }
    assert.deepEqual(untranslated, []);
  } finally { p.dom.window.close(); }
});

test('stalled initial fetches and response bodies stop loading and leave login usable', async () => {
  for (const stalledBody of [false, true]) {
    const aborted = [];
    const p = await page({ preference: 'en', fastDeadlines: true, handler: async (url, options) => {
      if (!['/api/listings', '/api/auth/session'].includes(url)) return;
      const pending = () => new Promise((resolve, reject) => {
        options.signal.addEventListener('abort', () => {
          aborted.push(url);
          reject(new Error('Aborted stalled request'));
        }, { once: true });
      });
      return stalledBody ? { ok: true, status: 200, json: pending } : pending();
    } });
    try {
      await new Promise(resolve => setTimeout(resolve, 60));
      assert.equal(p.get('emptyStateTitle').textContent, 'Unable to load properties');
      assert.deepEqual(aborted.sort(), ['/api/auth/session', '/api/listings']);
      assert.equal(p.get('authButton').disabled, false);
      p.get('authButton').click();
      assert.equal(p.get('authModal').hidden, false);
      p.choose('zh-CN');
      assert.equal(p.get('emptyStateTitle').textContent, '房源列表加载失败');
    } finally { p.dom.window.close(); }
  }
});
