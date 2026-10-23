import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadLocalMapConfig } from '../scripts/local-map-config.mjs';
import worker from '../worker/app.js';

test('local map config reads ignored .env.local, forwards only map values and lets environment override',async t=>{
  const root=await mkdtemp(path.join(tmpdir(),'nexthome-map-config-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const empty=await loadLocalMapConfig(root,{});assert.equal(empty.AMAP_PUBLIC_JS_KEY,'');
  await writeFile(path.join(root,'.env.local'),'AMAP_PUBLIC_JS_KEY="public-test-key"\nAMAP_SECURITY_JS_CODE="private-test-code"\nMAP_GEOCODE_CITY=上海\nUNRELATED_SECRET=do-not-import');
  const env=await loadLocalMapConfig(root,{AMAP_PUBLIC_JS_KEY:' env-key '});
  assert.equal(env.AMAP_PUBLIC_JS_KEY,'env-key');assert.equal(env.AMAP_SECURITY_JS_CODE,'private-test-code');assert.equal(env.MAP_GEOCODE_CITY,'上海');assert.equal(env.UNRELATED_SECRET,undefined);
  const config=await (await worker.fetch(new Request('https://nexthome.test/api/map/config'),env)).json();
  assert.equal(config.ready,true);assert.deepEqual(config.missing,[]);assert.doesNotMatch(JSON.stringify(config),/private-test-code/);
  const missing=await (await worker.fetch(new Request('https://nexthome.test/api/map/config'),{})).json();
  assert.equal(missing.ready,false);assert.deepEqual(missing.missing,['AMAP_PUBLIC_JS_KEY','AMAP_SECURITY_JS_CODE']);
  const source=await readFile(new URL('../scripts/dev.mjs',import.meta.url),'utf8');assert.match(source,/\.\.\.await loadLocalMapConfig\(root\)/);
});
test('existing Baidu browser config is reused, valid AMap settings take precedence and explicit provider is honored',async t=>{
  const root=await mkdtemp(path.join(tmpdir(),'nexthome-baidu-config-'));t.after(()=>rm(root,{recursive:true,force:true}));
  await writeFile(path.join(root,'map-config.json'),JSON.stringify({baiduAk:'public-baidu-test',center:{lng:121.5,lat:31.2,zoom:12},unrelatedSecret:'not-for-browser'}));
  const env=await loadLocalMapConfig(root,{});
  const get=async env=>(await worker.fetch(new Request('https://nexthome.test/api/map/config'),env)).json();
  const baidu=await get(env);assert.equal(baidu.provider,'baidu');assert.equal(baidu.key,'public-baidu-test');assert.equal(baidu.ready,true);assert.equal(baidu.center.zoom,12);assert.doesNotMatch(JSON.stringify(baidu),/unrelatedSecret|not-for-browser/);
  assert.equal((await get({...env,AMAP_PUBLIC_JS_KEY:'amap-test',AMAP_SECURITY_JS_CODE:'secret-test'})).provider,'amap');
  const explicit=await get({...env,MAP_PROVIDER:'amap'});assert.equal(explicit.provider,'amap');assert.equal(explicit.ready,false);
  assert.equal((await loadLocalMapConfig(root,{BAIDU_PUBLIC_JS_KEY:'override'})).BAIDU_PUBLIC_JS_KEY,'override');
});
