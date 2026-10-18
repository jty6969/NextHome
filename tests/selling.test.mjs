import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import worker from '../worker/app.js';
import { openDatabase, d1 } from '../scripts/local-db.mjs';

async function setup(t) {
  const db=await openDatabase();t.after(()=>db.close());
  const env={DB:d1(db),DEEPSEEK_API_KEY:'TEST_ONLY',ASSETS:{fetch:async()=>new Response(await readFile(new URL('../assets/properties-ai-table.json',import.meta.url),'utf8'))}};
  const call=async(route,data,cookie='',method='POST')=>{
    const response=await worker.fetch(new Request(`https://nexthome.test/api/advisor/${route}`,{method:data===undefined?'GET':method,headers:{origin:'https://nexthome.test',cookie,'content-type':'application/json'},...(data===undefined?{}:{body:JSON.stringify(data)})}),env);
    return {status:response.status,data:await response.json()};
  };
  const login=async username=>{
    const r=await worker.fetch(new Request('https://nexthome.test/api/auth/register',{method:'POST',headers:{origin:'https://nexthome.test','content-type':'application/json'},body:JSON.stringify({username,password:'seller_test_password',role:'user'})}),env);
    return {cookie:r.headers.get('set-cookie').split(';')[0],user:(await r.json()).user};
  };
  const a=await login('seller_consult_a'),b=await login('seller_consult_b');
  return {db,env,call,a,b};
}
const output=(reply,updates={})=>new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({reply,updates})}}]}));
const fact=(value,evidence,uncertain=false)=>({value,evidence,uncertain});

test('seller consultation profile and mode drafts survive reload, isolate users and never grant seller permissions',async t=>{
  const c=await setup(t);
  assert.equal((await c.call('selling')).status,401);
  const initial=await c.call('selling',undefined,c.a.cookie);assert.deepEqual(initial.data.fields,{});
  const save=await c.call('selling',{propertyId:'primary',revision:0,fields:{city:'上海',priceWan:520,mortgage:false,mortgageWan:0,viewing:'周末下午'}},c.a.cookie,'PATCH');
  assert.equal(save.status,200);assert.equal(save.data.fields.priceWan,520);assert.equal(save.data.fields.mortgage,false);
  assert.deepEqual((await c.call('selling',undefined,c.b.cookie)).data.fields,{});
  assert.equal((await c.call('selling',{revision:0,fields:{city:'北京'}},c.a.cookie,'PATCH')).status,409);
  const cleared=await c.call('selling',{revision:1,fields:{priceWan:null}},c.a.cookie,'PATCH');assert.equal(cleared.data.fields.priceWan,undefined);assert.equal(cleared.data.fields.city,'上海');
  for(const [mode,draft] of [['buy','买房草稿'],['sell','卖房草稿']])assert.equal((await c.call(`draft?mode=${mode}`,{draft},c.a.cookie,'PUT')).status,200);
  assert.equal((await c.call('draft?mode=buy',undefined,c.a.cookie)).data.draft,'买房草稿');assert.equal((await c.call('draft?mode=sell',undefined,c.a.cookie)).data.draft,'卖房草稿');
  assert.equal((await c.call('draft?mode=sell',undefined,c.b.cookie)).data.draft,'');
  assert.equal((await c.call('draft?mode=admin',{draft:'x'},c.a.cookie,'PUT')).status,400);
  assert.equal((await c.call('draft?mode=sell',{},c.a.cookie,'PUT')).status,400);
  for(const fields of [{priceWan:'520'},{areaSqm:-1},{elevator:'true'},{mortgageWan:1000001},{unknown:'private'}])assert.equal((await c.call('selling',{revision:2,fields},c.a.cookie,'PATCH')).status,400);
  assert.equal(c.db.prepare('SELECT role FROM accounts WHERE id=?').get(c.a.user.id).role,'user');
  assert.equal(c.db.prepare('SELECT seller FROM advisor_accounts WHERE account_id=?').get(c.a.user.id).seller,0);
  assert.equal(c.db.prepare('SELECT COUNT(*) n FROM listing_sellers WHERE account_id=?').get(c.a.user.id).n,0);
  const buyer=(await c.call('state',undefined,c.a.cookie)).data;assert.deepEqual(buyer.profile,{});assert.deepEqual(buyer.chatHistory,[]);
});

test('seller DeepSeek prompt, extraction and histories are independent and support natural language corrections',async t=>{
  const c=await setup(t);let captured;
  c.db.prepare('INSERT INTO advisor_chats (account_id,role,content,created_at) VALUES (?,?,?,?)').run(c.a.user.id,'user','只在买房历史中的内容',new Date().toISOString());
  t.mock.method(globalThis,'fetch',async(url,options)=>{captured={url,body:JSON.parse(options.body)};return output('希望什么时候卖出？',{priceWan:fact(500,'500万元'),replacement:fact('卖旧买新','卖旧买新'),areaSqm:fact(90,'90平')});});
  const result=await c.call('ai',{mode:'sell',message:'90平，期望500万元，卖旧买新'},c.a.cookie);
  assert.equal(result.status,200);assert.equal(result.data.fields.priceWan,500);assert.equal(result.data.fields.areaSqm,90);assert.equal(result.data.saved,true);
  assert.equal(captured.url,'https://api.deepseek.com/chat/completions');assert.equal(captured.body.model,'deepseek-flash');assert.equal(captured.body.response_format.type,'json_object');
  assert.match(captured.body.messages[0].content,/卖房顾问/);assert.match(captured.body.messages[0].content,/1–2/);assert.doesNotMatch(JSON.stringify(captured.body),/只在买房历史/);
  t.mock.method(globalThis,'fetch',async()=>output('可以何时看房？',{priceWan:fact(520,'520 万'),timeline:fact('三个月内','三个月内卖掉'),viewing:fact('只有周末下午','只有周末下午能看房')}));
  const changed=await c.call('ai',{mode:'sell',message:'期望售价改成 520 万。我希望三个月内卖掉。只有周末下午能看房。'},c.a.cookie);
  assert.equal(changed.data.fields.priceWan,520);assert.equal(changed.data.fields.timeline,'三个月内');assert.equal(changed.data.fields.viewing,'只有周末下午');
  const buyer=(await c.call('state',undefined,c.a.cookie)).data;assert.equal(buyer.chatHistory.length,1);assert.deepEqual(buyer.profile,{});
  assert.equal((await c.call('selling',undefined,c.a.cookie)).data.chatHistory.length,4);
  assert.equal((await c.call('selling',undefined,c.b.cookie)).data.chatHistory.length,0);
});

test('seller extraction rejects unsupported, uncertain, invented and unitless facts and confirms conflicting values',async t=>{
  const c=await setup(t);
  await c.call('selling',{revision:0,fields:{priceWan:500}},c.a.cookie,'PATCH');
  t.mock.method(globalThis,'fetch',async()=>output('请确认价格和面积。',{
    priceWan:fact(520,'520万元'),areaSqm:fact(100,'100平',true),city:fact('北京','北京'),mortgageWan:fact(90,'90'),address:fact('猜测地址','缺少的证据'),
  }));
  const conflict=await c.call('ai',{mode:'sell',message:'想卖520万元，可能100平，贷款90'},c.a.cookie);
  assert.equal(conflict.data.fields.priceWan,500);assert.deepEqual(conflict.data.pending,{priceWan:520});assert.match(conflict.data.content,/先确认/);
  for(const key of ['areaSqm','city','mortgageWan','address'])assert.equal(conflict.data.fields[key],undefined);
  t.mock.method(globalThis,'fetch',async()=>output('还有未结清的贷款吗？'));
  const confirmed=await c.call('ai',{mode:'sell',message:'确认'},c.a.cookie);assert.equal(confirmed.data.fields.priceWan,520);assert.deepEqual(confirmed.data.pending,{});
  t.mock.method(globalThis,'fetch',async()=>output('金额需要明确单位。',{priceWan:fact(600,'600'),mortgageWan:fact(999,'剩余贷款50万元')}));
  const ambiguous=await c.call('ai',{mode:'sell',message:'售价600，剩余贷款50万元'},c.a.cookie);assert.equal(ambiguous.data.fields.priceWan,520);assert.equal(ambiguous.data.fields.mortgageWan,undefined);
});

test('a manual edit during seller AI request wins, and different property keys never share data',async t=>{
  const c=await setup(t);let finish,started;
  const ready=new Promise(resolve=>started=resolve);
  t.mock.method(globalThis,'fetch',async()=>{started();return new Promise(resolve=>finish=resolve);});
  const pending=c.call('ai',{mode:'sell',message:'期望520万元'},c.a.cookie);await ready;
  const saved=await c.call('selling',{revision:0,fields:{priceWan:530}},c.a.cookie,'PATCH');assert.equal(saved.status,200);
  finish(output('希望何时卖出？',{priceWan:fact(520,'520万元')}));
  const reply=await pending;assert.equal(reply.data.fields.priceWan,530);assert.equal(reply.data.saved,false);assert.match(reply.data.content,/最新编辑/);
  t.mock.method(globalThis,'fetch',async()=>output('第二套房何时交房？',{city:fact('杭州','杭州')}));
  const second=await c.call('ai',{mode:'sell',propertyId:'second-home',message:'第二套房在杭州'},c.a.cookie);
  assert.equal(second.data.fields.city,'杭州');assert.equal(second.data.fields.priceWan,undefined);assert.equal(second.data.chatHistory.length,2);
  const first=(await c.call('selling',undefined,c.a.cookie)).data;assert.equal(first.fields.city,undefined);assert.equal(first.fields.priceWan,530);assert.equal(first.chatHistory.length,2);
});

test('seller upstream failures preserve stored data and malformed output cannot write facts',async t=>{
  const c=await setup(t);
  for(const [status,code]of [[402,'AI_BALANCE_REQUIRED'],[401,'AI_CREDENTIAL_INVALID'],[500,'AI_UNAVAILABLE']]){
    t.mock.method(globalThis,'fetch',async()=>new Response('{}',{status}));
    const failed=await c.call('ai',{mode:'sell',message:'卖房'},c.a.cookie);assert.equal(failed.data.error,code);
  }
  t.mock.method(globalThis,'fetch',async()=>new Response(JSON.stringify({choices:[{message:{content:'not json'}}]})));
  assert.equal((await c.call('ai',{mode:'sell',message:'卖房'},c.a.cookie)).data.error,'AI_EMPTY_RESPONSE');
  const state=(await c.call('selling',undefined,c.a.cookie)).data;assert.deepEqual(state.fields,{});assert.deepEqual(state.chatHistory,[]);
});
