import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import worker from '../worker/app.js';
import { openDatabase, d1 } from '../scripts/local-db.mjs';
import { sellingIntent } from '../worker/selling-intent.js';

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

test('legacy seller conversation is context data, while the current message alone supplies new structured facts',async t=>{
  const c=await setup(t);const previous='总高10层、朝南、装修较旧。请问有电梯吗，目前自住吗？';
  c.db.prepare('INSERT INTO seller_chats (account_id,property_id,role,content,created_at) VALUES (?,?,?,?,?)').run(c.a.user.id,'primary','user','一共10层，朝向南边，装修很老',new Date().toISOString());
  c.db.prepare('INSERT INTO seller_chats (account_id,property_id,role,content,created_at) VALUES (?,?,?,?,?)').run(c.a.user.id,'primary','assistant',previous,new Date().toISOString());
  let captured;t.mock.method(globalThis,'fetch',async(url,options)=>{captured=JSON.parse(options.body);return output('已记录。',{elevator:fact(true,'有电梯'),occupancy:fact('自住','目前自住')});});
  const result=await c.call('ai',{mode:'sell',message:'有电梯，目前自住'},c.a.cookie);
  assert.equal(result.status,200);assert.equal(captured.messages.length,2);
  const context=JSON.parse(captured.messages[1].content);assert.deepEqual(context.conversation[1],{role:'assistant',content:previous});assert.equal(context.currentUserMessage,'有电梯，目前自住');
  assert.match(captured.messages[0].content,/never translate the JSON keys/);assert.match(captured.messages[0].content,/mentioning it in reply is not a substitute for updates/);
  assert.equal(result.data.chatHistory[1].content,previous);assert.equal(result.data.fields.elevator,true);assert.equal(result.data.fields.occupancy,'自住');
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

test('seller send receipts replay lost acknowledgments without calling AI or overwriting later confirmed edits',async t=>{
  const c=await setup(t);let calls=0;
  t.mock.method(globalThis,'fetch',async()=>{calls++;return output('已更新。',{priceWan:fact(520,'520万元')});});
  const message={mode:'sell',requestId:'lost-ack-test',message:'售价修改为520万元'};
  const first=await c.call('ai',message,c.a.cookie);assert.equal(first.status,200);assert.equal(first.data.replayed,false);
  const edited=await c.call('selling',{revision:first.data.revision,fields:{priceWan:530}},c.a.cookie,'PATCH');assert.equal(edited.status,200);
  const replay=await c.call('ai',message,c.a.cookie);
  assert.equal(replay.status,200);assert.equal(replay.data.replayed,true);assert.equal(replay.data.content,first.data.content);
  assert.equal(replay.data.fields.priceWan,530);assert.equal(replay.data.revision,edited.data.revision);
  assert.equal(replay.data.chatHistory.length,2);assert.equal(calls,1);
  assert.equal(c.db.prepare('SELECT COUNT(*) n FROM seller_message_receipts').get().n,1);
  const changed=await c.call('ai',{...message,message:'售价修改为540万元'},c.a.cookie);
  assert.equal(changed.status,409);assert.equal(changed.data.error,'MESSAGE_REQUEST_CONFLICT');assert.equal(calls,1);
  assert.equal((await c.call('selling',undefined,c.a.cookie)).data.fields.priceWan,530);
});

test('seller send request IDs are isolated by account and property while old clients remain compatible',async t=>{
  const c=await setup(t);let calls=0;
  t.mock.method(globalThis,'fetch',async()=>{calls++;return output('已记录。',{elevator:fact(true,'有电梯'),occupancy:fact('自住','目前自住')});});
  const message={mode:'sell',requestId:'shared-id',message:'有电梯，目前自住'};
  for(const [cookie,propertyId]of [[c.a.cookie,'primary'],[c.a.cookie,'second'],[c.b.cookie,'primary']]){
    const result=await c.call('ai',{...message,propertyId},cookie);
    assert.equal(result.status,200);assert.equal(result.data.replayed,false);assert.equal(result.data.fields.elevator,true);
    assert.equal(result.data.fields.occupancy,'自住');assert.equal(result.data.chatHistory.length,2);
    assert.equal((await c.call('ai',{...message,propertyId},cookie)).data.replayed,true);
  }
  assert.equal(calls,3);assert.equal(c.db.prepare('SELECT COUNT(*) n FROM seller_message_receipts').get().n,3);
  const legacy=await c.call('ai',{mode:'sell',propertyId:'legacy',message:'有电梯，目前自住'},c.a.cookie);
  assert.equal(legacy.status,200);assert.equal(typeof legacy.data.requestId,'string');assert.equal(legacy.data.chatHistory.length,2);
  assert.equal((await c.call('state',undefined,c.a.cookie)).data.chatHistory.length,0);
});

test('concurrent copies of a seller send commit one receipt, field revision and chat pair',async t=>{
  const c=await setup(t);const finishes=[];let started;
  const bothStarted=new Promise(resolve=>started=resolve);
  t.mock.method(globalThis,'fetch',async()=>new Promise(resolve=>{finishes.push(resolve);if(finishes.length===2)started();}));
  const message={mode:'sell',requestId:'concurrent-send',message:'有电梯，目前自住'};
  const requests=[c.call('ai',message,c.a.cookie),c.call('ai',message,c.a.cookie)];await bothStarted;
  for(const finish of finishes)finish(output('已记录。',{elevator:fact(true,'有电梯'),occupancy:fact('自住','目前自住')}));
  const replies=await Promise.all(requests);
  assert.ok(replies.every(r=>r.status===200));assert.equal(replies.filter(r=>r.data.replayed).length,1);
  assert.equal(replies[0].data.content,replies[1].data.content);
  const state=(await c.call('selling',undefined,c.a.cookie)).data;
  assert.equal(state.revision,1);assert.equal(state.chatHistory.length,2);assert.equal(state.fields.elevator,true);assert.equal(state.fields.occupancy,'自住');
  assert.equal(c.db.prepare('SELECT COUNT(*) n FROM seller_message_receipts').get().n,1);
});

test('concurrent reuse of a seller send ID with different text rejects the loser without applying its facts',async t=>{
  const c=await setup(t);const finishes=[];let started;
  const bothStarted=new Promise(resolve=>started=resolve);
  t.mock.method(globalThis,'fetch',async()=>new Promise(resolve=>{finishes.push(resolve);if(finishes.length===2)started();}));
  const requests=[
    c.call('ai',{mode:'sell',requestId:'concurrent-conflict',message:'有电梯'},c.a.cookie),
    c.call('ai',{mode:'sell',requestId:'concurrent-conflict',message:'目前自住'},c.a.cookie),
  ];await bothStarted;
  finishes[0](output('已记录电梯。',{elevator:fact(true,'有电梯')}));
  finishes[1](output('已记录自住。',{occupancy:fact('自住','目前自住')}));
  const replies=await Promise.all(requests);
  assert.deepEqual(replies.map(r=>r.status).sort(),[200,409]);
  assert.equal(replies.find(r=>r.status===409).data.error,'MESSAGE_REQUEST_CONFLICT');
  const state=(await c.call('selling',undefined,c.a.cookie)).data;
  assert.equal(state.revision,1);assert.equal(state.chatHistory.length,2);
  assert.equal(Object.keys(state.fields).length,1);assert.equal(c.db.prepare('SELECT COUNT(*) n FROM seller_message_receipts').get().n,1);
});

test('seller completion remains replayable when the final state read fails after the transaction commits',async t=>{
  const c=await setup(t);let calls=0,failStateRead=false;
  t.mock.method(globalThis,'fetch',async()=>{calls++;return output('已记录。',{elevator:fact(true,'有电梯')});});
  const base=c.env.DB;
  c.env.DB={...base,
    batch:async statements=>{const result=await base.batch(statements);failStateRead=true;return result;},
    prepare:query=>{if(failStateRead&&query.startsWith('SELECT role, content, created_at FROM seller_chats')){failStateRead=false;throw Error('simulated final response read failure');}return base.prepare(query);},
  };
  const message={mode:'sell',requestId:'committed-response-failure',message:'有电梯'};
  assert.equal((await c.call('ai',message,c.a.cookie)).status,500);
  assert.equal(c.db.prepare('SELECT COUNT(*) n FROM seller_message_receipts').get().n,1);
  const replay=await c.call('ai',message,c.a.cookie);
  assert.equal(replay.status,200);assert.equal(replay.data.replayed,true);assert.equal(replay.data.fields.elevator,true);
  assert.equal(replay.data.chatHistory.length,2);assert.equal(replay.data.revision,1);assert.equal(calls,1);
});

test('seller chat insertion failure rolls back fields and receipt, then the same request can retry',async t=>{
  const c=await setup(t);let calls=0;
  t.mock.method(globalThis,'fetch',async()=>{calls++;return output('已记录。',{elevator:fact(true,'有电梯'),occupancy:fact('自住','目前自住')});});
  await c.call('selling',undefined,c.a.cookie);
  c.db.exec("CREATE TRIGGER reject_assistant_chat BEFORE INSERT ON seller_chats WHEN NEW.role='assistant' BEGIN SELECT RAISE(ABORT,'simulated chat insert failure'); END");
  const message={mode:'sell',requestId:'rollback-retry',message:'有电梯，目前自住'};
  const failed=await c.call('ai',message,c.a.cookie);
  assert.equal(failed.status,503);assert.equal(failed.data.error,'SELLING_SAVE_FAILED');assert.equal(failed.data.requestId,message.requestId);
  const unchanged=(await c.call('selling',undefined,c.a.cookie)).data;
  assert.deepEqual(unchanged.fields,{});assert.equal(unchanged.revision,0);assert.equal(unchanged.chatHistory.length,0);
  assert.equal(c.db.prepare('SELECT COUNT(*) n FROM seller_message_receipts').get().n,0);
  c.db.exec('DROP TRIGGER reject_assistant_chat');
  const success=await c.call('ai',message,c.a.cookie);
  assert.equal(success.status,200);assert.equal(success.data.replayed,false);assert.equal(success.data.fields.elevator,true);assert.equal(success.data.fields.occupancy,'自住');
  assert.equal(success.data.revision,1);assert.equal(success.data.chatHistory.length,2);assert.equal(calls,2);
  assert.equal((await c.call('ai',message,c.a.cookie)).data.replayed,true);assert.equal(calls,2);
});

test('an upstream seller failure creates no completion receipt and permits the same send ID to retry',async t=>{
  const c=await setup(t);
  const message={mode:'sell',requestId:'upstream-retry',message:'有电梯，目前自住'};
  t.mock.method(globalThis,'fetch',async()=>new Response('{}',{status:502}));
  assert.equal((await c.call('ai',message,c.a.cookie)).status,503);
  assert.equal(c.db.prepare('SELECT COUNT(*) n FROM seller_message_receipts').get().n,0);
  t.mock.method(globalThis,'fetch',async()=>output('已记录。',{elevator:fact(true,'有电梯'),occupancy:fact('自住','目前自住')}));
  const success=await c.call('ai',message,c.a.cookie);
  assert.equal(success.status,200);assert.equal(success.data.fields.elevator,true);assert.equal(success.data.chatHistory.length,2);
});

const completeFields=()=>({city:'上海',district:'浦东',community:'测试小区',address:'测试路12号1202室',areaSqm:90,layout:'两室一厅',floorLevel:6,floorTotal:18,orientation:'南',elevator:false,decoration:'精装',occupancy:'自住',reason:'改善置换',priceWan:500});
function legacySeller(c, {user=c.a.user,propertyId='primary',workflow={deferred:[],seenStages:[]},messages=['我要卖房'],revision=7}={}) {
  c.db.prepare('INSERT INTO seller_properties(account_id,property_id,fields,workflow,revision) VALUES(?,?,?,?,?)').run(user.id,propertyId,JSON.stringify(completeFields()),JSON.stringify(workflow),revision);
  for(const message of messages){const [role,content]=Array.isArray(message)?message:['user',message];c.db.prepare('INSERT INTO seller_chats(account_id,property_id,role,content,created_at)VALUES(?,?,?,?,?)').run(user.id,propertyId,role,content,new Date().toISOString());}
}
test('legacy sale intent beyond both history windows restores review on GET without changing fields, revision or messages',async t=>{
  const c=await setup(t);
  legacySeller(c,{messages:['我要卖房',...Array(205).fill('继续补充资料')]});
  const before=c.db.prepare('SELECT COUNT(*) n FROM seller_chats').get().n;
  const restored=await c.call('selling',undefined,c.a.cookie);
  assert.equal(restored.status,200);assert.equal(restored.data.validation.complete,true);assert.equal(restored.data.workflow.active,true);assert.equal(restored.data.workflow.legacyIntentChecked,true);
  assert.equal(restored.data.revision,7);assert.deepEqual(restored.data.fields,completeFields());assert.equal(restored.data.chatHistory.length,200);
  assert.equal((await c.call('selling/review',{propertyId:'primary'},c.a.cookie)).status,200);
  const confirm={propertyId:'primary',revision:7,confirm:true};
  const first=await c.call('selling/confirm',confirm,c.a.cookie),again=await c.call('selling/confirm',confirm,c.a.cookie);
  assert.equal(first.status,200);assert.equal(again.status,200);assert.equal(first.data.savedDraft.id,again.data.savedDraft.id);
  assert.equal(again.data.workflow.reviewed,true);assert.equal(again.data.revision,7);
  assert.equal(c.db.prepare('SELECT COUNT(*) n FROM seller_listing_drafts').get().n,1);assert.equal(c.db.prepare('SELECT COUNT(*) n FROM seller_chats').get().n,before);
  assert.equal(c.db.prepare('SELECT COUNT(*) n FROM seller_message_receipts').get().n,0);assert.equal(c.db.prepare('SELECT role FROM accounts WHERE id=?').get(c.a.user.id).role,'user');
});
test('complete fields and assistant claims cannot activate consultation-only legacy records, and compatibility runs once',async t=>{
  const c=await setup(t);
  legacySeller(c,{messages:['我想了解卖房流程','如果我要卖房需要哪些资料',['assistant','信息齐全，请在挂牌窗口确认。']]});
  const state=(await c.call('selling',undefined,c.a.cookie)).data;
  assert.equal(state.validation.complete,true);assert.equal(state.workflow.active,undefined);assert.equal(state.workflow.legacyIntentChecked,true);assert.equal(state.revision,7);
  assert.equal((await c.call('selling/review',{propertyId:'primary'},c.a.cookie)).status,409);
  c.db.prepare('INSERT INTO seller_chats(account_id,property_id,role,content,created_at)VALUES(?,?,?,?,?)').run(c.a.user.id,'primary','user','我要卖房',new Date().toISOString());
  assert.equal((await c.call('selling',undefined,c.a.cookie)).data.workflow.active,undefined);
  assert.equal(c.db.prepare('SELECT COUNT(*) n FROM seller_listing_drafts').get().n,0);
});
test('legacy compatibility preserves explicitly disabled workflow and an existing reviewed flag',async t=>{
  const c=await setup(t);legacySeller(c,{workflow:{active:false,reviewed:true,deferred:['address']}});
  legacySeller(c,{propertyId:'reviewed',workflow:{reviewed:true}});
  const disabled=(await c.call('selling',undefined,c.a.cookie)).data;
  assert.equal(disabled.workflow.active,false);assert.equal(disabled.workflow.reviewed,true);assert.deepEqual(disabled.workflow.deferred,['address']);assert.equal(disabled.revision,7);
  const reviewed=(await c.call('selling?propertyId=reviewed',undefined,c.a.cookie)).data;
  assert.equal(reviewed.workflow.active,true);assert.equal(reviewed.workflow.reviewed,true);assert.equal(reviewed.workflow.legacyIntentChecked,true);assert.equal(reviewed.revision,7);
});
test('legacy recovery honors the latest explicit withdrawal and isolates accounts and homes',async t=>{
  const c=await setup(t);
  legacySeller(c,{messages:['我要卖房','暂不挂牌','我想了解卖房流程']});
  legacySeller(c,{propertyId:'cancelled',messages:['I want to sell my home','取消卖房']});
  legacySeller(c,{propertyId:'other-home',messages:['我要卖另一套房']});
  legacySeller(c,{user:c.b.user,messages:['如何卖房']});
  legacySeller(c,{propertyId:'renewed',messages:['我要卖房','不卖了','我确定要卖房']});
  assert.equal((await c.call('selling',undefined,c.a.cookie)).data.workflow.active,false);
  assert.equal((await c.call('selling?propertyId=cancelled',undefined,c.a.cookie)).data.workflow.active,false);
  assert.equal((await c.call('selling?propertyId=other-home',undefined,c.a.cookie)).data.workflow.active,undefined);
  assert.equal((await c.call('selling',undefined,c.b.cookie)).data.workflow.active,undefined);
  assert.equal((await c.call('selling?propertyId=renewed',undefined,c.a.cookie)).data.workflow.active,true);
});
test('compatibility merges review flags and cannot overwrite a concurrent explicit intent decision',async t=>{
  const c=await setup(t);legacySeller(c);legacySeller(c,{propertyId:'concurrent-stop'});
  const base=c.env.DB;let intercepted=0;
  c.env.DB={...base,prepare:query=>{
    const statement=base.prepare(query);if(!query.startsWith("SELECT content FROM seller_chats WHERE"))return statement;
    const all=statement.all.bind(statement);statement.all=async()=>{const result=await all();intercepted++;
      if(intercepted===1)c.db.prepare("UPDATE seller_properties SET workflow=json_set(workflow,'$.reviewed',json('true')) WHERE account_id=? AND property_id='primary'").run(c.a.user.id);
      else c.db.prepare("UPDATE seller_properties SET workflow=json_set(workflow,'$.active',json('false'),'$.reviewed',json('true')) WHERE account_id=? AND property_id='concurrent-stop'").run(c.a.user.id);
      return result;};return statement;
  }};
  const restored=(await c.call('selling',undefined,c.a.cookie)).data;
  assert.equal(restored.workflow.active,true);assert.equal(restored.workflow.reviewed,true);assert.equal(restored.revision,7);
  const stopped=(await c.call('selling?propertyId=concurrent-stop',undefined,c.a.cookie)).data;
  assert.equal(stopped.workflow.active,false);assert.equal(stopped.workflow.reviewed,true);assert.equal(stopped.revision,7);
});
test('current messages share legacy intent rules; withdrawal disables collection and explicit resumption can restart it',async t=>{
  const c=await setup(t);legacySeller(c);
  t.mock.method(globalThis,'fetch',async()=>output('已了解。'));
  assert.equal((await c.call('ai',{mode:'sell',message:'取消挂牌'},c.a.cookie)).data.workflow.active,false);
  assert.equal((await c.call('ai',{mode:'sell',message:'如果我要卖房要交什么税？'},c.a.cookie)).data.workflow.active,false);
  assert.equal((await c.call('ai',{mode:'sell',message:'我要卖房'},c.a.cookie)).data.workflow.active,true);
  assert.equal((await c.call('ai',{mode:'sell',message:'暂不提供地址'},c.a.cookie)).data.workflow.active,true);
});
test('sale intent classification excludes hypothetical knowledge, other homes and refusal of an agent',()=>{
  for(const text of ['我要卖房','挂牌','我要卖房，需要哪些税费？','I want to sell my home','我要卖房，如果买家能全款最好'])assert.equal(sellingIntent(text).active,true,text);
  for(const text of ['不卖了','暂不挂牌','取消卖房','I do not want to sell my home','不卖了，我想了解卖房税费','不卖给中介，但现在不卖了'])assert.equal(sellingIntent(text).active,false,text);
  for(const text of ['我想了解卖房流程','如果我要卖房','如果我要卖房要交什么税？','我想知道我要卖房需要哪些材料','我要卖另一套房','不卖给中介','取消','暂不提供地址','不要取消挂牌'])assert.equal(sellingIntent(text).active,undefined,text);
});
test('seller advice survives active collection without checklists; early facts and deferred fields remain tracked',async t=>{
  const c=await setup(t);
  t.mock.method(globalThis,'fetch',async()=>output('卖房一般需要这些材料。'));
  const knowledge=await c.call('ai',{mode:'sell',message:'我想了解卖房流程'},c.a.cookie);assert.equal(knowledge.data.workflow.active,undefined);assert.equal(knowledge.data.content,'卖房一般需要这些材料。');
  t.mock.method(globalThis,'fetch',async()=>output('先比较同类房源和你的出售期限，再决定是否降价。你希望多久卖出？',{city:fact('上海','上海'),reason:fact('改善置换','改善置换'),priceWan:fact(500,'500万元')}));
  const started=await c.call('ai',{mode:'sell',message:'我要卖房，在上海，改善置换，期望500万元'},c.a.cookie);
  assert.equal(started.data.workflow.active,true);assert.equal(started.data.validation.stage,1);assert.match(started.data.content,/先比较同类房源/);assert.doesNotMatch(started.data.content,/房屋基本信息|待补充|出售相关信息/);assert.equal(started.data.fields.priceWan,500);
  t.mock.method(globalThis,'fetch',async()=>new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({reply:'未知',deferred:['district','community']})}}]})));
  const deferred=await c.call('ai',{mode:'sell',message:'区域和小区不确定，暂不提供'},c.a.cookie);assert.deepEqual(deferred.data.workflow.deferred,['district','community']);assert.equal(deferred.data.content,'未知');assert.doesNotMatch(deferred.data.content,/房屋基本信息/);assert.equal(deferred.data.validation.complete,false);
  const fields=completeFields();delete fields.reason;delete fields.priceWan;delete fields.city;
  const patch=await c.call('selling',{revision:deferred.data.revision,fields},c.a.cookie,'PATCH');assert.equal(patch.data.validation.complete,true);
  t.mock.method(globalThis,'fetch',async()=>output('all done'));
  const second=await c.call('ai',{mode:'sell',message:'请继续'},c.a.cookie);assert.equal(second.data.content,'all done');assert.doesNotMatch(second.data.content,/请补充.*出售原因|请补充.*期望售价/);
  const again=await c.call('ai',{mode:'sell',message:'谢谢'},c.a.cookie);assert.doesNotMatch(again.data.content,/出售相关信息/);
});
test('readiness checks floors, false elevator, occupancy and conflicts; natural language clears and revisions preserve unrelated conflicts',async t=>{
  const c=await setup(t);
  const saved=await c.call('selling',{revision:0,fields:completeFields()},c.a.cookie,'PATCH');assert.equal(saved.data.validation.complete,true);
  const invalid=await c.call('selling',{revision:1,fields:{floorLevel:19}},c.a.cookie,'PATCH');assert.equal(invalid.data.validation.complete,false);assert.ok(invalid.data.validation.invalid.includes('floorLevel'));
  assert.equal((await c.call('selling',{revision:2,fields:{occupancy:'unknown'}},c.a.cookie,'PATCH')).status,400);
  await c.call('selling',{revision:2,fields:{floorLevel:6}},c.a.cookie,'PATCH');
  t.mock.method(globalThis,'fetch',async()=>output('confirm',{priceWan:fact(520,'520万元')}));
  const conflict=await c.call('ai',{mode:'sell',message:'售价520万元'},c.a.cookie);assert.equal(conflict.data.validation.complete,false);
  const manual=await c.call('selling',{revision:conflict.data.revision,fields:{city:'上海'}},c.a.cookie,'PATCH');assert.equal(manual.data.pending.priceWan,520);assert.equal(manual.data.validation.complete,false);
  t.mock.method(globalThis,'fetch',async()=>output('clear',{address:fact(null,'清空房屋地址')}));
  const clear=await c.call('ai',{mode:'sell',message:'清空房屋地址'},c.a.cookie);assert.equal(clear.data.fields.address,undefined);assert.ok(clear.data.validation.missing.includes('address'));assert.equal(clear.data.fields.city,'上海');
});
test('confirmed listing drafts persist privately, deduplicate retries, isolate property/account, and do not change publication permissions',async t=>{
  const c=await setup(t);t.mock.method(globalThis,'fetch',async()=>output('开始'));
  const active=await c.call('ai',{mode:'sell',message:'I want to sell my home'},c.a.cookie);
  const full=await c.call('selling',{revision:active.data.revision,fields:completeFields()},c.a.cookie,'PATCH');
  const confirm={propertyId:'primary',revision:full.data.revision,confirm:true};
  const before=c.db.prepare('SELECT COUNT(*) n FROM listings').get().n;
  assert.equal((await c.call('selling/confirm',{...confirm,confirm:false},c.a.cookie)).status,400);
  assert.equal((await c.call('selling/review',{propertyId:'primary'},c.a.cookie)).status,200);
  const results=await Promise.all([1,2,3].map(()=>c.call('selling/confirm',confirm,c.a.cookie)));
  assert.ok(results.every(r=>r.status===200));assert.equal(new Set(results.map(r=>r.data.savedDraft.id)).size,1);
  assert.equal(c.db.prepare('SELECT COUNT(*) n FROM seller_listing_drafts').get().n,1);
  const restored=await c.call('selling',undefined,c.a.cookie);assert.equal(restored.data.workflow.reviewed,true);assert.equal(restored.data.savedDraft.id,results[0].data.savedDraft.id);
  assert.equal(c.db.prepare('SELECT COUNT(*) n FROM listings').get().n,before);assert.equal(c.db.prepare('SELECT COUNT(*) n FROM listing_sync_events').get().n,0);
  assert.equal((await c.call('selling',undefined,c.b.cookie)).data.savedDraft,null);
  assert.equal((await c.call('selling?propertyId=second',undefined,c.a.cookie)).data.savedDraft,null);
  assert.equal((await c.call('selling/confirm',confirm,c.b.cookie)).status,409);
  const changed=await c.call('selling',{revision:full.data.revision,fields:{priceWan:530}},c.a.cookie,'PATCH');
  assert.equal((await c.call('selling/confirm',confirm,c.a.cookie)).status,409);
  const updated=await c.call('selling/confirm',{...confirm,revision:changed.data.revision},c.a.cookie);assert.equal(updated.data.savedDraft.id,results[0].data.savedDraft.id);
  assert.equal(JSON.parse(c.db.prepare('SELECT fields FROM seller_listing_drafts').get().fields).priceWan,530);
  assert.equal(c.db.prepare('SELECT role FROM accounts WHERE id=?').get(c.a.user.id).role,'user');
  await c.call('draft?mode=sell&propertyId=second',{draft:'第二套私密草稿'},c.a.cookie,'PUT');assert.equal((await c.call('draft?mode=sell',undefined,c.a.cookie)).data.draft,'');assert.equal((await c.call('draft?mode=sell&propertyId=second',undefined,c.a.cookie)).data.draft,'第二套私密草稿');
});
test('only explicit units and facts are extracted, square feet convert to m² and existing numeric floor descriptions are retained',async t=>{
  const c=await setup(t);
  t.mock.method(globalThis,'fetch',async()=>output('hello',{areaSqm:fact(92.90304,'1000 square feet'),priceWan:fact(500,'5 million yuan'),elevator:fact(true,'1000 square feet')}));
  const result=await c.call('ai',{mode:'sell',message:'I want to list my home, 1000 square feet, 5 million yuan'},c.a.cookie);assert.equal(result.data.fields.areaSqm,92.90304);assert.equal(result.data.fields.priceWan,500);assert.equal(result.data.fields.elevator,undefined);
  const saved=await c.call('selling',{revision:result.data.revision,fields:{floor:'6/18'}},c.a.cookie,'PATCH');assert.equal(saved.data.fields.floorLevel,6);assert.equal(saved.data.fields.floorTotal,18);assert.equal(saved.data.fields.floor,'6/18');
});

test('AI numeric strings are validated against units and numeric floor evidence; clearing legacy floors cannot resurrect them',async t=>{
  const c=await setup(t);
  t.mock.method(globalThis,'fetch',async()=>output('好的',{areaSqm:fact('90','90平方米'),floorLevel:fact('6','六楼'),floorTotal:fact('18','共十八层')}));
  const result=await c.call('ai',{mode:'sell',message:'我要卖房，90平方米，六楼，共十八层'},c.a.cookie);assert.equal(result.data.fields.areaSqm,90);assert.equal(result.data.fields.floorLevel,6);assert.equal(result.data.fields.floorTotal,18);
  const raw=await c.call('selling',{revision:result.data.revision,fields:{floor:'6/18'}},c.a.cookie,'PATCH');
  const cleared=await c.call('selling',{revision:raw.data.revision,fields:{floorLevel:null,floorTotal:null}},c.a.cookie,'PATCH');assert.equal(cleared.data.fields.floorLevel,undefined);
  const restored=await c.call('selling',undefined,c.a.cookie);assert.equal(restored.data.fields.floorLevel,undefined);assert.equal(restored.data.fields.floorTotal,undefined);assert.equal(restored.data.fields.floor,'6/18');
});

test('new ambiguity blocks readiness without overwriting confirmed facts, and foreign currencies never become RMB prices',async t=>{
  const c=await setup(t);await c.call('selling',{revision:0,fields:completeFields()},c.a.cookie,'PATCH');
  t.mock.method(globalThis,'fetch',async()=>output('check',{areaSqm:fact(100,'面积可能100平',true)}));
  const uncertain=await c.call('ai',{mode:'sell',message:'面积可能100平'},c.a.cookie);assert.equal(uncertain.data.fields.areaSqm,90);assert.equal(uncertain.data.pending.areaSqm.uncertain,true);assert.equal(uncertain.data.validation.complete,false);
  t.mock.method(globalThis,'fetch',async()=>output('confirm'));
  const accepted=await c.call('ai',{mode:'sell',message:'确认'},c.a.cookie);assert.equal(accepted.data.fields.areaSqm,90);assert.equal(accepted.data.validation.complete,false);
  t.mock.method(globalThis,'fetch',async()=>output('new',{areaSqm:fact(90,'面积确认90平方米'),priceWan:fact(600,'USD 6 million')}));
  const corrected=await c.call('ai',{mode:'sell',message:'面积确认90平方米，价格USD 6 million'},c.a.cookie);assert.equal(corrected.data.validation.complete,false);assert.equal(corrected.data.fields.priceWan,500);assert.equal(corrected.data.pending.priceWan.uncertain,true);assert.equal(corrected.data.pending.areaSqm,undefined);
});

test('short explicit sale intent starts collection while declining one detail does not cancel intent',async t=>{
  const c=await setup(t);t.mock.method(globalThis,'fetch',async()=>output('好的'));
  const short=await c.call('ai',{mode:'sell',message:'挂牌'},c.a.cookie);assert.equal(short.data.workflow.active,true);
  const declined=await c.call('ai',{mode:'sell',propertyId:'second',message:'我要卖房，暂不提供地址'},c.a.cookie);assert.equal(declined.data.workflow.active,true);
});
