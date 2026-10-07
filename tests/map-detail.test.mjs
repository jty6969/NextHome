import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { JSDOM, VirtualConsole } from 'jsdom';
import worker from '../worker/app.js';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const tick = () => new Promise(resolve => setTimeout(resolve, 50));
const response = (result, status = 200) => ({ ok: status < 400, status, json: async () => result });
const rows = [
  { id: 'real-id-1', address: '原始地址一', listingTitle: '原始标题', images: ['/assets/home-1.png'], totalPriceWan: 420, areaSqm: 110, bedrooms: 3, longitude: 121.5, latitude: 31.2, coordinateSystem: 'gcj02', decoration: '原装修', ownerName: '原联系人', contactPhone: '原电话' },
  { id: 'real-id-2', address: '原始地址二', totalPriceWan: 200, areaSqm: 70, longitude: 121.5, latitude: 31.2, coordinateSystem: 'gcj02' },
  { id: 'missing-address' },
];
async function page({ url = 'https://nexthome.test/', properties = rows, key = true, stored, handler, geocodes } = {}) {
  const errors = [], markers = [], geocodeCalls = [], maps = [], requests = [];
  const console = new VirtualConsole(); console.on('jsdomError', error => errors.push(error));
  const dom = new JSDOM(html, { url, runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: console, beforeParse(window) {
    window.scrollTo = () => {}; window.HTMLElement.prototype.scrollIntoView = () => {};
    if (stored) { window.sessionStorage.setItem('nexthome.results', JSON.stringify(stored)); window.localStorage.setItem('nexthome.favorites', '["real-id-1"]'); }
    class Point { constructor(lng, lat) { this.lng = lng; this.lat = lat; } getLng() { return this.lng; } getLat() { return this.lat; } }
    window.AMap = {
      Pixel: class { constructor(x, y) { this.x = x; this.y = y; } },
      Map: class {
        constructor(id, options) { this.options = options; this.center = options.center || [121.5, 31.2]; this.zoom = options.zoom; this.host = window.document.getElementById(id); maps.push(this); }
        getCenter() { return new Point(...this.center); } getZoom() { return this.zoom; } setCenter(center) { this.center = center; }
        setZoom(zoom) { this.zoom = zoom; } setZoomAndCenter(zoom, center) { this.zoom = zoom; this.center = center; }
        setFitView(markers) { this.fitted = markers.length; } panBy(...values) { this.pan = values; } destroy() { this.host.replaceChildren(); }
      },
      Marker: class {
        constructor(options) { this.options = options; markers.push(this); }
        setMap(map) { if (map) map.host.append(this.options.content); else this.options.content.remove(); }
      },
      InfoWindow: class {
        constructor(options) { this.options = options; } open(map, position) { this.position = position; map.host.append(this.options.content); } close() { this.options.content.remove(); }
      },
      Geocoder: class {
        getLocation(address, done) { geocodeCalls.push(address); if (geocodes) geocodes(address, done, Point); else done('error', {}); }
      },
      convertFrom(position, system, done) { done('complete', { locations: [new Point(...position)] }); },
    };
    window.fetch = async (url, options = {}) => {
      requests.push(url);
      const result = await handler?.(url, options); if (result) return result;
      if (url === '/api/listings') return response({ table: properties });
      if (url === '/api/auth/session') return response({ user: { id: 'same-user', username: '原用户', role: 'user' } });
      if (url === '/api/map/config') return response({ key: key ? 'in-memory-test-key' : '', ready: key });
      throw new Error(`Unexpected request ${url}`);
    };
  } });
  await tick();
  const document = dom.window.document, get = id => document.getElementById(id);
  return { dom, document, get, errors, markers, geocodeCalls, maps, requests, choose: lang => document.querySelector(`[data-language="${lang}"]`).click(), close: () => dom.window.close() };
}

test('card image/title use stable links; favorites never navigate; details preserve raw/missing data and list/session state', async () => {
  const p = await page();
  try {
    const card = p.document.querySelector('[data-id="real-id-1"]');
    const imageLink = card.querySelector('.photo-link'), titleLink = card.querySelector('h3 a');
    assert.equal(imageLink.href, titleLink.href); assert.match(titleLink.href, /listing=real-id-1/);
    card.querySelector('.favorite').click(); assert.equal(p.dom.window.location.search, '');
    p.get('searchInput').value = '原始标题'; p.get('searchForm').dispatchEvent(new p.dom.window.Event('submit', { cancelable: true }));
    p.get('sort').value = '总价从低到高'; p.get('sort').dispatchEvent(new p.dom.window.Event('change'));
    titleLink.focus(); titleLink.click();
    assert.equal(p.get('detailPage').hidden, false); assert.equal(p.get('homePage').hidden, true);
    assert.equal(p.get('detailContent').querySelector('h1').textContent, rows[0].listingTitle);
    assert.equal(p.get('detailContent').querySelector('img').getAttribute('src'), rows[0].images[0]);
    assert.match(p.get('detailContent').textContent, /暂无信息/); assert.match(p.get('detailContent').textContent, /原联系人/);
    p.choose('en'); assert.match(p.get('detailContent').textContent, /No information available/);
    assert.match(p.get('detailContent').textContent, /原装修/); assert.match(p.get('authButton').textContent, /原用户/);
    p.get('detailFavorite').click(); assert.equal(p.get('detailFavorite').getAttribute('aria-pressed'), 'false');
    p.get('backFromDetail').click(); await tick();
    assert.equal(p.get('homePage').hidden, false); assert.equal(p.get('searchInput').value, '原始标题'); assert.equal(p.get('sort').value, '总价从低到高');
    assert.equal(p.document.querySelector('[data-id="real-id-1"]'), card); assert.equal(card.querySelector('.favorite').getAttribute('aria-pressed'), 'false');
    assert.equal(p.document.activeElement, titleLink);
    p.dom.window.history.forward(); await tick(); assert.equal(p.get('detailPage').hidden, false);
    p.dom.window.history.back(); await tick(); imageLink.click(); assert.equal(p.get('detailPage').hidden, false);
    p.get('propertyInfoButton').click(); assert.equal(p.get('homePage').hidden, false); assert.equal(p.get('searchInput').value, '原始标题');
    titleLink.click(); p.document.querySelector('nav a[href="#listings"]').click(); assert.equal(p.get('homePage').hidden, false);
    assert.deepEqual(p.errors, []);
  } finally { p.close(); }
});

test('map uses filtered results, independent markers at original shared coordinates, popup image/name/detail routes, and returns to map', async () => {
  const original = JSON.stringify(rows), p = await page();
  try {
    p.get('openMap').click(); await tick();
    assert.equal(p.get('mapModal').hidden, false); assert.equal(p.markers.length, 2);
    assert.deepEqual(p.markers[0].options.position, p.markers[1].options.position);
    assert.notEqual(p.markers[0].options.offset.x, p.markers[1].options.offset.x);
    assert.equal(p.geocodeCalls.length, 0); assert.match(p.get('mapResults').textContent, /地址缺失/);
    for (const selector of ['.map-popup a:has(img)', '.map-popup h3 a', '.map-popup a.surface-button']) {
      p.document.querySelector('.map-pin').click();
      assert.equal(p.document.querySelector('.map-popup h3').textContent, rows[0].listingTitle);
      p.document.querySelector(selector).click(); assert.equal(p.get('detailPage').hidden, false); assert.equal(p.get('mapModal').hidden, true);
      p.get('backFromDetail').click(); await tick(); assert.equal(p.get('mapModal').hidden, false);
    }
    p.document.querySelectorAll('.map-pin')[1].click(); assert.match(p.document.querySelector('.map-popup').textContent, /暂无图片/);
    p.choose('en'); await tick(); assert.match(p.get('mapStatus').textContent, /2 of 3/); assert.match(p.get('mapResults').textContent, /Address missing/);
    p.get('mapCanvas').focus(); p.get('mapCanvas').dispatchEvent(new p.dom.window.KeyboardEvent('keydown', { key: '+', bubbles: true })); assert.equal(p.maps.at(-1).getZoom(), 12);
    p.get('mapCanvas').dispatchEvent(new p.dom.window.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })); assert.deepEqual(p.maps.at(-1).pan, [80, 0]);
    p.get('retryMap').focus(); p.document.dispatchEvent(new p.dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await tick(); assert.equal(p.get('mapModal').hidden, true);
    p.get('searchInput').value = '原始地址二'; p.get('openMap').click(); await tick(); assert.equal(p.document.querySelectorAll('.map-pin').length, 1);
    assert.match(p.get('mapResults').textContent, /原始地址二/); assert.doesNotMatch(p.get('mapResults').textContent, /原始标题/);
    p.get('closeMap').click(); await tick(); assert.equal(p.get('mapModal').hidden, true); assert.equal(p.get('searchInput').value, '原始地址二');
    assert.equal(JSON.stringify(rows), original); assert.deepEqual(p.errors, []);
  } finally { p.close(); }
});

test('direct detail/refresh restores controls and favorites; direct map opens safely while listings load', async () => {
  const state = { search: '原始', filters: ['', '', '', '', ''], sort: '总价从低到高' };
  const p = await page({ url: 'https://nexthome.test/?listing=real-id-2', stored: state });
  try {
    assert.equal(p.get('detailPage').hidden, false); assert.equal(p.get('detailContent').querySelector('h1').textContent, rows[1].address);
    assert.match(p.get('detailContent').textContent, /暂无图片/); p.get('backFromDetail').click();
    assert.equal(p.get('searchInput').value, state.search); assert.equal(p.get('sort').value, state.sort);
    assert.equal(p.document.querySelector('[data-id="real-id-1"] .favorite').getAttribute('aria-pressed'), 'true'); assert.deepEqual(p.errors, []);
  } finally { p.close(); }
  const map = await page({ url: 'https://nexthome.test/?view=map' });
  try { assert.equal(map.get('mapModal').hidden, false); assert.equal(map.document.querySelectorAll('.map-pin').length, 2); assert.deepEqual(map.errors, []); }
  finally { map.close(); }
});

test('real address lookup is cached; ambiguous/failed results never create invented coordinates and language changes preserve business data', async () => {
  const properties = [{ id: 'geo-1', address: '原始详细地址' }, { id: 'geo-2', address: '原始详细地址' }, { id: 'ambiguous', address: '只有区名' }, { id: 'failed', address: '无法定位地址' }];
  const p = await page({ properties, geocodes(address, done, Point) {
    if (address === '原始详细地址') done('complete', { geocodes: [{ level: '门牌号', location: new Point(121.4, 31.1) }] });
    else if (address === '只有区名') done('complete', { geocodes: [{ level: '区县', location: new Point(121, 31) }] });
    else done('error', {});
  } });
  try {
    p.get('openMap').click(); await tick(); assert.equal(p.markers.length, 2); assert.equal(p.geocodeCalls.filter(address => address === '原始详细地址').length, 1);
    assert.match(p.get('mapResults').textContent, /结果不明确/); assert.match(p.get('mapResults').textContent, /地址定位失败/);
    p.choose('en'); await tick(); assert.match(p.get('mapResults').textContent, /lookup is ambiguous/); assert.match(p.get('mapResults').textContent, /原始详细地址/);
    assert.deepEqual(p.errors, []);
  } finally { p.close(); }
});

test('unconfigured map, empty filters, nonexistent details and list errors have bilingual recoverable states', async () => {
  const p = await page({ key: false });
  try {
    p.get('openMap').click(); await tick(); assert.match(p.get('mapStatus').textContent, /尚未配置/); assert.equal(p.markers.length, 0);
    p.choose('en'); assert.match(p.get('mapStatus').textContent, /not configured/);
    p.get('closeMap').click(); await tick(); p.get('searchInput').value = 'no matches'; p.get('openMap').click(); await tick(); assert.match(p.get('mapStatus').textContent, /No matching/);
    assert.deepEqual(p.errors, []);
  } finally { p.close(); }
  const missing = await page({ url: 'https://nexthome.test/?listing=does-not-exist' });
  try { assert.match(missing.get('detailContent').textContent, /不存在/); missing.choose('en'); assert.match(missing.get('detailContent').textContent, /not found/); }
  finally { missing.close(); }
  const failed = await page({ url: 'https://nexthome.test/?listing=real-id-1', handler: url => url === '/api/listings' ? response({}, 500) : undefined });
  try { assert.equal(failed.get('retryDetail').hidden, false); failed.choose('en'); assert.match(failed.get('detailContent').textContent, /Unable to load/); }
  finally { failed.close(); }
});

test('map config exposes only the public browser key, never the server security code; proxy paths and origins are restricted', async () => {
  const env = { AMAP_PUBLIC_JS_KEY: 'public-test-key', AMAP_SECURITY_JS_CODE: 'server-only-test-code' };
  const result = await worker.fetch(new Request('https://nexthome.test/api/map/config'), env);
  const config = await result.json(); assert.equal(config.key, env.AMAP_PUBLIC_JS_KEY); assert.equal(config.ready, true); assert.doesNotMatch(JSON.stringify(config), /server-only/);
  for (const [path, referer, status] of [['_AMapService/v3/geocode/geo', undefined, 403], ['_AMapService/v3/geocode/geo', 'https://other.test/', 403], ['_AMapService/anything', 'https://nexthome.test/', 405]]) {
    const response = await worker.fetch(new Request(`https://nexthome.test/${path}`, { headers: referer ? { referer } : {} }), env); assert.equal(response.status, status);
  }
});

test('map keyboard focus stays inside dialog/language controls; language-menu Escape does not close map', async () => {
  const p = await page();
  try {
    p.get('openMap').click(); await tick();
    p.get('languageButton').focus(); p.get('languageButton').dispatchEvent(new p.dom.window.KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }));
    assert.ok(p.get('mapModal').contains(p.document.activeElement));
    p.get('languageButton').click();
    p.document.dispatchEvent(new p.dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.equal(p.get('languageMenu').hidden, true); assert.equal(p.get('mapModal').hidden, false);
    p.document.dispatchEvent(new p.dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await tick();
    assert.equal(p.get('mapModal').hidden, true); assert.equal(p.get('homePage').inert, false);
  } finally { p.close(); }
});

test('late geocoding cannot update a closed map; SDK network errors are bilingual and retryable', async () => {
  let finish;
  const p = await page({ properties: [{ id: 'late-id', address: '原始地址' }], geocodes(address, done, Point) { finish = () => done('complete', { geocodes: [{ level: '门牌号', location: new Point(121.5, 31.2) }] }); } });
  try {
    p.get('openMap').click(); await tick(); assert.equal(typeof finish, 'function');
    p.get('closeMap').click(); await tick(); finish(); await tick();
    assert.equal(p.get('mapModal').hidden, true); assert.equal(p.markers.length, 0); assert.deepEqual(p.errors, []);
  } finally { p.close(); }
  const sdk = await page();
  try {
    delete sdk.dom.window.AMap;
    sdk.get('openMap').click(); await tick();
    sdk.document.querySelector('script[src^="https://webapi.amap.com/maps"]').dispatchEvent(new sdk.dom.window.Event('error'));
    await tick(); assert.match(sdk.get('mapStatus').textContent, /地图加载失败/);
    sdk.choose('en'); assert.match(sdk.get('mapStatus').textContent, /Unable to load the map/); assert.equal(sdk.get('retryMap').disabled, false);
    assert.deepEqual(sdk.errors, []);
  } finally { sdk.close(); }
});
