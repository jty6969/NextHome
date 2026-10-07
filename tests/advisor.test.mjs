import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, readdir, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pbkdf2Sync, randomBytes } from 'node:crypto';
import worker from '../worker/app.js';
import { openDatabase, d1 } from '../scripts/local-db.mjs';
import { extractRequirements, consultationStatus } from '../worker/advisor.js';
import { migrateVictor } from '../scripts/migrate-victor.mjs';
test('concurrent offers, viewings and confirmations retain a single authoritative record',async t=>{
  const c=await setup(t);
  const offers=await Promise.all([1,2].map(()=>c.call('/api/advisor/offers',{threadId:c.thread.id,price:880},c.buyer.cookie)));
  assert.deepEqual(offers.map(r=>r.status).sort(),[200,409]);assert.equal(c.db.prepare('SELECT COUNT(*) n FROM buyer_offers').get().n,1);
  const offer=offers.find(r=>r.status===200).data.id;
  const accepts=await Promise.all([1,2].map(()=>c.call('/api/advisor/offer-action',{offerId:offer,action:'accept'},c.seller.cookie)));
  assert.deepEqual(accepts.map(r=>r.status).sort(),[200,409]);const deal=c.db.prepare('SELECT * FROM buyer_deals').get();
  await Promise.all([c.buyer.cookie,c.seller.cookie].map(cookie=>c.call('/api/advisor/deal-confirm',{dealId:deal.id,step:1},cookie)));
  assert.equal(c.db.prepare('SELECT current_step FROM buyer_deals').get().current_step,2);
  const date=new Date(Date.now()+86400000*2).toISOString().slice(0,10),slot='10:00-11:00';
  await c.call('/api/advisor/slots',{listingId:'lshy-1',slots:[{date,slot}]},c.seller.cookie,'PUT');
  const bookings=await Promise.all([1,2].map(()=>c.call('/api/advisor/viewings',{threadId:c.thread.id,date,slot},c.buyer.cookie)));
  assert.deepEqual(bookings.map(r=>r.status).sort(),[200,409]);assert.equal(c.db.prepare('SELECT COUNT(*) n FROM buyer_viewings').get().n,1);
});
test('requirements keep local units, recognize negative elevator preference and English budgets', () => {
  const data = extractRequirements('一家三口，上海自住，预算800万，首付300万，月供10000元，3室100平，无电梯');
  assert.equal(data.profile.monthlyPaymentMax, 10000);
  assert.equal(data.requirements.needElevator, false);
  assert.equal(data.profile.budget, 800);
  assert.equal(consultationStatus(data).ready, true);
  assert.equal(extractRequirements('budget 5 million').profile.budget, 500);
});
async function setup(t) {
  const db = await openDatabase(); t.after(() => db.close());
  const env = { DB:d1(db), ASSETS:{ fetch:async () => new Response(await readFile(new URL('../assets/properties-ai-table.json', import.meta.url), 'utf8')) } };
  const call = async (route, data, cookie = '', method = 'POST') => {
    const response = await worker.fetch(new Request('https://nexthome.test' + route, {
      method:data === undefined ? 'GET' : method,
      headers:{ origin:'https://nexthome.test', cookie, 'content-type':'application/json' },
      ...(data === undefined ? {} : { body:JSON.stringify(data) }),
    }), env);
    return { status:response.status, data:await response.json(), cookie:response.headers.get('set-cookie')?.split(';')[0] };
  };
  const admin = await call('/api/auth/login', { username:'管理员账号1', password:'123456' });
  const buyer = await call('/api/auth/register', { username:'buyer_test', password:'buyer_password', role:'user' });
  const seller = await call('/api/auth/register', { username:'seller_test', password:'seller_password', role:'seller' });
  const other = await call('/api/auth/register', { username:'other_test', password:'other_password', role:'seller' });
  assert.equal(buyer.status, 200); assert.equal(seller.data.user.role, 'seller');
  await call('/api/listings', undefined);
  assert.equal((await call('/api/advisor/assign', { listingId:'lshy-1', username:'seller_test' }, admin.cookie)).status, 200);
  const conversation = await call('/api/advisor/threads', { listingId:'lshy-1' }, buyer.cookie);
  return { db, env, call, admin, buyer, seller, other, thread:conversation.data.thread };
}
test('seller-created listings preserve the original creation API and bind to their actual creator',async t=>{
  const c=await setup(t);
  const created=await c.call('/api/listings',{ownerName:'测试卖家',contactPhone:'13800138000',address:'上海市测试路12号'},c.seller.cookie);
  assert.equal(created.status,201);const id=created.data.listing.id;
  const workspace=await c.call('/api/advisor/seller',undefined,c.seller.cookie);assert.ok(workspace.data.listings.some(p=>p.id===id));
  assert.equal((await c.call('/api/advisor/slots',{listingId:id,slots:[]},c.other.cookie,'PUT')).status,403);
  assert.equal((await c.call('/api/advisor/threads',{listingId:id},c.buyer.cookie)).data.thread.seller_id,c.seller.data.user.id);
});
test('registration limits repeated work and rejects incorrectly typed buyer facts',async t=>{
  const c=await setup(t);
  for(const username of ['fourth_account','fifth_account'])assert.equal((await c.call('/api/auth/register',{username,password:'long_password'})).status,200);
  assert.equal((await c.call('/api/auth/register',{username:'sixth_account',password:'long_password'})).status,429);
  assert.equal((await c.call('/api/advisor/profile',{profile:{budget:'800'}},c.buyer.cookie,'PATCH')).status,400);
  assert.equal((await c.call('/api/advisor/profile',{requirements:{needElevator:'true'}},c.buyer.cookie,'PATCH')).status,400);
});
test('registration blocks privilege escalation and advisor APIs enforce authentication and origin', async t => {
  const c = await setup(t);
  assert.equal((await c.call('/api/auth/register', { username:'forged_admin', password:'long_password', role:'admin' })).status, 400);
  assert.equal((await c.call('/api/advisor/state', undefined)).status, 401);
  assert.equal((await c.call('/api/ai', { message:'test' })).status, 401);
  assert.equal((await c.call('/api/advisor/assign', { listingId:'lshy-2', username:'seller_test' }, c.buyer.cookie)).status, 403);
  const denied = await worker.fetch(new Request('https://nexthome.test/api/advisor/favorite', {
    method:'POST', headers:{origin:'https://evil.test',cookie:c.buyer.cookie}, body:'{}' }), c.env);
  assert.equal(denied.status, 403);
});
test('messages append, unread belongs to the recipient, and third-party reads are denied', async t => {
  const c = await setup(t), id = c.thread.id;
  await c.call('/api/advisor/messages', {threadId:id,content:'buyer message'}, c.buyer.cookie);
  await c.call('/api/advisor/messages', {threadId:id,content:'seller reply'}, c.seller.cookie);
  const messages = (await c.call('/api/advisor/messages?threadId='+id, undefined, c.buyer.cookie)).data.messages;
  assert.equal(messages.length, 2); assert.deepEqual(messages.map(m=>m.role), ['buyer','seller']);
  assert.equal((await c.call('/api/advisor/messages?threadId='+id, undefined, c.other.cookie)).status, 404);
  assert.equal((await c.call('/api/advisor/state', undefined, c.buyer.cookie)).data.threads[0].unread, 1);
  await c.call('/api/advisor/read', {threadId:id,throughId:messages.at(-1).id}, c.buyer.cookie);
  assert.equal((await c.call('/api/advisor/state', undefined, c.buyer.cookie)).data.threads[0].unread, 0);
  assert.equal((await c.call('/api/advisor/state', undefined, c.seller.cookie)).data.threads[0].unread, 1);
  assert.equal((await c.call('/api/state', {transactions:[]}, c.buyer.cookie, 'PUT')).status, 405);
});
test('counteroffer and six-step transaction require the actual buyer and seller', async t => {
  const c = await setup(t), id = c.thread.id;
  const offer = (await c.call('/api/advisor/offers', {threadId:id,price:850,reason:'test'}, c.buyer.cookie)).data.id;
  assert.equal((await c.call('/api/advisor/offer-action', {offerId:offer,action:'accept'}, c.other.cookie)).status, 404);
  await c.call('/api/advisor/offer-action', {offerId:offer,action:'counter',counterPrice:870}, c.seller.cookie);
  assert.equal((await c.call('/api/advisor/offer-action', {offerId:offer,action:'accept-counter'}, c.seller.cookie)).status, 409);
  assert.equal((await c.call('/api/advisor/offer-action', {offerId:offer,action:'accept-counter'}, c.buyer.cookie)).status, 200);
  const deal = (await c.call('/api/advisor/state', undefined, c.buyer.cookie)).data.deals[0];
  assert.equal(deal.price, 870);
  for (let step = 1; step < 6; step++) {
    const first = await c.call('/api/advisor/deal-confirm', {dealId:deal.id,step}, c.buyer.cookie);
    assert.equal(first.data.deal.current_step, step);
    assert.equal((await c.call('/api/advisor/deal-confirm', {dealId:deal.id,step}, c.other.cookie)).status, 404);
    const second = await c.call('/api/advisor/deal-confirm', {dealId:deal.id,step}, c.seller.cookie);
    assert.equal(second.data.deal.current_step, step + 1);
    assert.equal((await c.call('/api/advisor/deal-confirm', {dealId:deal.id,step}, c.buyer.cookie)).status, 409);
  }
  const steps = (await c.call('/api/advisor/deal?id='+deal.id, undefined, c.buyer.cookie)).data.steps;
  assert.equal(steps.length, 6); assert.ok(steps.every(s => s.done));
});
test('viewing validates future slots, listing ownership, booking conflicts and explicit actions', async t => {
  const c = await setup(t);
  const date = new Date(Date.now()+86400000).toISOString().slice(0,10), slot='10:00-11:00';
  assert.equal((await c.call('/api/advisor/slots', {listingId:'lshy-1',slots:[{date:'2026-01-01',slot}]}, c.seller.cookie, 'PUT')).status, 400);
  assert.equal((await c.call('/api/advisor/slots', {listingId:'lshy-1',slots:[{date,slot}]}, c.other.cookie, 'PUT')).status, 403);
  assert.equal((await c.call('/api/advisor/slots', {listingId:'lshy-1',slots:[{date,slot}]}, c.seller.cookie, 'PUT')).status, 200);
  const payload = {threadId:c.thread.id,date,slot,note:'test'};
  assert.equal((await c.call('/api/advisor/viewings', payload, c.buyer.cookie)).status, 200);
  assert.equal((await c.call('/api/advisor/viewings', payload, c.buyer.cookie)).status, 409);
  const v = (await c.call('/api/advisor/state', undefined, c.buyer.cookie)).data.viewings[0];
  assert.equal((await c.call('/api/advisor/viewing-action', {viewingId:v.id,action:'confirm'}, c.other.cookie)).status, 404);
  assert.equal((await c.call('/api/advisor/viewing-action', {viewingId:v.id,action:'nonsense'}, c.seller.cookie)).status, 400);
  assert.equal((await c.call('/api/advisor/viewing-action', {viewingId:v.id,action:'reject',note:'busy'}, c.seller.cookie)).status, 200);
});
test('favorites, browsing and editable profiles are isolated per account', async t => {
  const c = await setup(t);
  await c.call('/api/advisor/favorite', {listingId:'lshy-1',active:true}, c.buyer.cookie);
  await c.call('/api/advisor/browse', {listingId:'lshy-1'}, c.buyer.cookie);
  await c.call('/api/advisor/browse', {listingId:'lshy-1'}, c.buyer.cookie);
  const own = (await c.call('/api/advisor/state', undefined, c.buyer.cookie)).data;
  assert.deepEqual(own.favorites, ['lshy-1']);
  assert.equal(own.events.filter(e=>e.kind==='browse').length, 1);
  assert.deepEqual((await c.call('/api/advisor/state', undefined, c.other.cookie)).data.favorites, []);
  assert.equal((await c.call('/api/advisor/profile', {profile:{budget:800},transactions:[]}, c.buyer.cookie, 'PATCH')).status, 400);
  await c.call('/api/advisor/profile',{profile:{budget:800,monthlyPaymentMax:10000}},c.buyer.cookie,'PATCH');
  const cleared=await c.call('/api/advisor/profile',{profile:{budget:null}},c.buyer.cookie,'PATCH');
  assert.equal(cleared.data.profile.budget,undefined);assert.equal(cleared.data.profile.monthlyPaymentMax,10000);
});
test('AI fixes upstream and context, rejects client secrets, avoids duplicate user turns and gates listings', async t => {
  const c = await setup(t); c.env.DEEPSEEK_API_KEY='TEST_ONLY'; let captured;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    captured={url,payload:JSON.parse(options.body)};
    return new Response(JSON.stringify({choices:[{message:{content:'[lshy-1] buy it'}}]}));
  });
  assert.equal((await c.call('/api/advisor/ai', {endpoint:'https://evil.test',message:'test'}, c.buyer.cookie)).status, 400);
  const result = await c.call('/api/advisor/ai', {message:'test question'}, c.buyer.cookie);
  assert.equal(result.status, 200); assert.doesNotMatch(result.data.content, /lshy-1/);
  assert.equal(captured.url, 'https://api.deepseek.com/chat/completions');
  assert.equal(captured.payload.messages.filter(m=>m.content==='test question').length, 1);
  t.mock.method(globalThis,'fetch',async()=>new Response('{}',{status:402}));
  assert.equal((await c.call('/api/advisor/ai',{message:'余额检查'},c.buyer.cookie)).data.error,'AI_BALANCE_REQUIRED');
  delete c.env.DEEPSEEK_API_KEY;
  assert.equal((await c.call('/api/advisor/ai', {message:'test'}, c.buyer.cookie)).status, 503);
});
test('legacy password hashes and bindings migrate once; sessions and confirmation snapshots stay archived', async t => {
  const c = await setup(t);
  // Build synthetic accounts in a temporary directory; never read local user data.
  const source = await mkdtemp(path.join(tmpdir(), 'nexthome-migration-test-'));
  t.after(() => rm(source, { recursive: true, force: true }));
  await mkdir(path.join(source, 'data/users'), { recursive: true });
  await mkdir(path.join(source, 'data/properties'), { recursive: true });
  const sellers = new Set();
  const properties = new URL('../legacy/victor/data/properties/', import.meta.url);
  for (const file of (await readdir(properties)).filter(file => file.endsWith('.json'))) {
    const property = JSON.parse(await readFile(new URL(file, properties), 'utf8'));
    sellers.add(property.seller.username);
    await writeFile(path.join(source, 'data/properties', file), JSON.stringify({ id:property.id, seller:{ username:property.seller.username } }));
  }
  const salt = randomBytes(16).toString('hex');
  const passwordHash = pbkdf2Sync('seller123', salt, 100000, 32, 'sha256').toString('hex');
  for (const username of [...sellers, 'legacy_buyer_fixture']) {
    await writeFile(path.join(source, 'data/users', username + '.json'), JSON.stringify({
      account:{ username, salt, passwordHash, role:sellers.has(username) ? 'seller' : 'buyer' },
      state:{ transactions:[{ id:'synthetic-unconfirmed-deal', step:6 }], favorites:['lshy-1'] },
    }));
  }
  const first=await migrateVictor(c.db, source), second=await migrateVictor(c.db, source);
  assert.equal(first.accounts, 36); assert.equal(first.bindings, 34); // the existing manual binding is preserved
  assert.equal(second.accounts, 0); assert.equal(second.bindings,0);assert.equal(second.archived,0);assert.equal(first.activeDealsImported, 0);
  const legacy = await c.call('/api/auth/login', {username:'seller_lshy01',password:'seller123'});
  assert.equal(legacy.status, 200); assert.equal(legacy.data.user.role, 'seller');
  assert.equal(c.db.prepare('SELECT COUNT(*) n FROM legacy_archives').get().n, 36);
});
