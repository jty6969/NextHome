import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';
import { developmentVersion } from '../scripts/dev-version.mjs';

test('iPhone install assets exist and standalone navigation stays in scope', async () => {
  const manifest = JSON.parse(await readFile(new URL('../manifest.webmanifest', import.meta.url)));
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.start_url, '/?app=1');
  for (const size of [180,192,512]) {
    const png = await readFile(new URL(`../assets/app-icon-${size}.png`, import.meta.url));
    assert.equal(png.readUInt32BE(16), size);
    assert.equal(png.readUInt32BE(20), size);
  }
});

test('mobile controls translate and detect updates without reloading or saving drafts', async () => {
  const dom = new JSDOM('<html lang="zh-CN"><head><meta name="nexthome-version" content="old"></head><body><div class="header-actions"></div><textarea></textarea></body></html>', { runScripts:'outside-only', url:'https://nexthome.test/' });
  const w = dom.window;
  let poll, confirmations = 0;
  w.matchMedia = () => ({matches:false});
  w.setInterval = callback => { poll = callback; };
  Object.defineProperty(w.document, 'hidden', {value:false});
  w.fetch = async () => ({ok:true,json:async()=>({version:'new'})});
  w.confirm = () => { confirmations++; return false; };
  w.eval(await readFile(new URL('../assets/mobile-app.js', import.meta.url),'utf8'));
  assert.equal(w.document.querySelector('.app-refresh').textContent, '刷新版本');
  await poll();
  assert.match(w.document.querySelector('.app-refresh').textContent, /新版本/);
  const textarea=w.document.querySelector('textarea');
  textarea.value='私人购房预算';textarea.dispatchEvent(new w.Event('input',{bubbles:true}));
  w.document.querySelector('.app-refresh').click();
  assert.equal(confirmations,1);
  assert.equal(textarea.value,'私人购房预算');
  assert.equal(w.localStorage.length,0);
  w.document.documentElement.lang='en';w.document.dispatchEvent(new w.Event('languagechange'));
  assert.equal(w.document.querySelector('.app-install').textContent,'Add to iPhone Home Screen');
  w.document.querySelector('.app-install').click();
  assert.equal(w.document.querySelector('.app-help').hidden,false);
  dom.window.close();
});

test('offline worker never handles API requests and does not hide authentication failures', async () => {
  const listeners = {};
  let online = true;
  const self={location:{origin:'https://nexthome.test'},addEventListener:(name,fn)=>{listeners[name]=fn;}};
  vm.runInNewContext(await readFile(new URL('../sw.js',import.meta.url),'utf8'), {self, URL, Response, fetch:async()=>{if(!online)throw new Error('offline');return new Response('Login',{status:401});}});
  let result;
  listeners.fetch({request:{url:'https://nexthome.test/api/session',mode:'cors',method:'GET'},respondWith:r=>{result=r;}});
  assert.equal(result,undefined);
  const navigation={request:{url:'https://nexthome.test/',mode:'navigate',method:'GET'},respondWith:r=>{result=r;}};
  listeners.fetch(navigation);assert.equal((await result).status,401);
  online=false;listeners.fetch(navigation);
  assert.equal((await result).status,503);
  assert.match(await (await result).text(),/暂时无法连接电脑/);
});

test('development fingerprint changes with source but ignores private local data', async () => {
  const dir=await mkdtemp(path.join(tmpdir(),'nexthome-version-'));
  try {
    for(const folder of ['assets','worker','.local']) await mkdir(path.join(dir,folder));
    for(const file of ['index.html','manifest.webmanifest','sw.js','assets/app.js','worker/app.js']) await writeFile(path.join(dir,file),'v1');
    const before=await developmentVersion(dir);
    await writeFile(path.join(dir,'.local/private.json'),'private data');
    assert.equal(await developmentVersion(dir),before);
    await writeFile(path.join(dir,'worker/app.js'),'v2');
    assert.notEqual(await developmentVersion(dir),before);
  } finally { await rm(dir,{recursive:true,force:true}); }
});
