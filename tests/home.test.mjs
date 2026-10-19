import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { JSDOM, VirtualConsole } from 'jsdom';
import worker from '../worker/app.js';
import { openDatabase, d1 } from '../scripts/local-db.mjs';

const [html, advisor, home, selling] = await Promise.all(['index.html','assets/advisor.js','assets/home.js','assets/selling-profile.js'].map(file => readFile(new URL(`../${file}`, import.meta.url), 'utf8')));
const flush = () => new Promise(resolve => setTimeout(resolve, 20));
const response = (data, status = 200) => ({ ok: status < 400, status, json: async () => data });
async function page(t, { user = null, preference, blockedStorage = false, storage = {}, handler, chatHistory = [], sellingState = {fields:{},revision:0,chatHistory:[]}, savedDrafts = {buy:'',sell:''}, url = 'https://nexthome.test/' } = {}) {
  const requests = [], errors = [];
  const console = new VirtualConsole(); console.on('jsdomError', error => errors.push(error));
  const state = {profile:{},requirements:{},gate:{count:0,ready:false},favorites:[],events:[],chatHistory,threads:[],viewings:[],offers:[],deals:[]};
  const dom = new JSDOM(html, { url, runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: console,
    beforeParse(w) {
      w.scrollTo = () => {}; w.HTMLElement.prototype.scrollIntoView = () => {};
      if (preference) w.localStorage.setItem('nexthome.language', preference);
      for(const [key,value]of Object.entries(storage))w.localStorage.setItem(key,value);
      if (blockedStorage) Object.defineProperty(w, 'localStorage', { get() { throw Error('Storage blocked'); } });
      w.fetch = async (url, options = {}) => {
        requests.push({ url, options });
        const result = await handler?.(url, options, state); if (result) return result;
        if (url === '/api/auth/session') return response({ user });
        if (url === '/api/auth/logout') { user = null; return response({ ok:true }); }
        if (url === '/api/listings') return response({ table:[] });
        if (url === '/api/advisor/state') return response(structuredClone(state));
        if (url === '/api/advisor/selling') return response(structuredClone(sellingState));
        if (url.startsWith('/api/advisor/draft?mode=')) {
          const mode=new URL(url,'https://nexthome.test').searchParams.get('mode');
          if(options.method==='PUT')savedDrafts[mode]=JSON.parse(options.body).draft;
          return response({draft:savedDrafts[mode]});
        }
        if (url === '/api/map/config') return response({ ready:false });
        throw Error(`Unexpected request ${url}`);
      };
    }
  });
  t.after(() => dom.window.close()); await flush();
  dom.window.eval(advisor); dom.window.eval(selling); dom.window.eval(home); await flush();
  const get = id => dom.window.document.getElementById(id);
  const action = key => dom.window.document.querySelector(`[data-home-action="${key}"]`).click();
  const choose = language => dom.window.document.querySelector(`#languageMenu [data-language="${language}"]`).click();
  return { dom, w:dom.window, get, action, choose, requests, state, errors };
}

test('default and old shortcut entries open the AI home; explicit list links keep the manual search', async t => {
  for (const path of ['/', '/#listings', '/?source=shortcut#listings']) {
    const p = await page(t, { url:`https://nexthome.test${path}` });
    assert.equal(p.get('assistantPage').hidden, false);
    assert.equal(p.get('propertySearch').hidden, true);
    assert.equal(p.get('listings').hidden, true);
    assert.equal(p.w.location.hash, '');
    if (path.includes('source=')) assert.equal(p.w.location.search, '?source=shortcut');
    assert.equal(p.w.document.querySelector('[data-home-action="new"]').getAttribute('aria-current'), 'page');
    p.w.document.querySelector('nav a[href="#listings"]').click();
    assert.equal(p.get('listings').hidden, false);
    assert.equal(new URL(p.w.location.href).searchParams.get('view'), 'list');
    p.action('new'); assert.equal(p.get('assistantPage').hidden, false);
    assert.deepEqual(p.errors, []);
  }
  for (const path of ['/?view=list', '/?view=list#listings']) {
    const p = await page(t, { url:`https://nexthome.test${path}` });
    assert.equal(p.get('assistantPage').hidden, true);
    assert.equal(p.get('propertySearch').hidden, false);
    assert.equal(p.get('listings').hidden, false);
    assert.deepEqual(p.errors, []);
  }
});

test('home languages retain drafts, persist preferences, and work without storage', async t => {
  for (const blockedStorage of [false, true]) {
    const p = await page(t, { blockedStorage });
    assert.equal(p.get('assistantPage').hidden, false); assert.equal(p.get('listings').hidden, true);
    assert.equal(p.get('assistantPage').querySelectorAll('[data-keyword]').length, 0);
    assert.doesNotMatch(p.get('assistantPage').textContent, /按预算找房|规划通勤范围|了解购房流程/);
    p.get('homeInput').value = '预算草稿'; p.get('homeInput').dispatchEvent(new p.w.Event('input'));
    p.choose('en'); assert.match(p.get('homeTitle').textContent, /next stop/);
    assert.equal(p.get('homeInput').value, '预算草稿'); assert.equal(p.get('homeSend').hidden, false);
    assert.equal(p.get('homeInput').placeholder, 'Ask your home advisor');
    assert.equal(p.w.document.querySelector('[data-home-action="viewings"]').getAttribute('aria-label'), 'Book a viewing');
    if (!blockedStorage) assert.equal(p.w.localStorage.getItem('nexthome.language'), 'en');
    p.choose('zh-CN'); assert.equal(p.get('homeInput').placeholder, '询问购房助手');
    assert.deepEqual(p.errors, []);
  }
  const reload = await page(t, { preference:'en' });
  assert.equal(reload.get('homeInput').placeholder, 'Ask your home advisor');
});

test('admin entry uses existing role check and modal; account menu keeps logout and role visibility', async t => {
  for (const role of [null, 'user', 'seller', 'admin']) {
    const p = await page(t, { user: role ? {id:role,role,username:'Test account'} : null });
    assert.equal(p.get('openAdminModal').hidden, role !== 'admin');
    const actions = p.get('openAdminModal').parentElement;
    assert.ok([...actions.children].indexOf(p.get('openAdminModal')) < [...actions.children].indexOf(p.get('languageSwitch')));
    assert.ok([...actions.children].indexOf(p.get('languageSwitch')) < [...actions.children].indexOf(p.get('authButton')));
    p.get('openAdminModal').click(); assert.equal(p.get('adminModal').hidden, role !== 'admin');
    if (role === 'admin') p.get('closeAdminModal').click();
    p.get('authButton').click();
    if (role) {
      assert.equal(p.get('homeAccountMenu').hidden, false);
      p.choose('en'); assert.match(p.get('homeAccountMenu').textContent, /Sign out/);
      p.get('homeAccountMenu').querySelectorAll('button')[1].click(); await flush();
      assert.equal(p.get('openAdminModal').hidden, true); assert.equal(p.w.Nexthome.getUser(), null);
      assert.ok(p.requests.some(request => request.url === '/api/auth/logout'));
    } else assert.equal(p.get('authModal').hidden, false);
    assert.deepEqual(p.errors, []);
  }
});

test('left navigation preserves property search, map, booking and settings access', async t => {
  const p = await page(t, { user:{id:'buyer',role:'user',username:'Buyer'} });
  p.action('list'); assert.equal(p.get('listings').hidden, false); assert.equal(p.get('assistantPage').hidden, true);
  assert.equal(p.w.location.search, '?view=list');
  p.action('new'); assert.equal(p.get('assistantPage').hidden, false);
  p.action('map'); await flush(); assert.equal(p.get('mapModal').hidden, false);
  assert.match(p.get('mapStatus').textContent, /没有找到符合条件/);
  p.get('closeMap').click(); await flush();
  p.action('viewings'); await flush(); assert.equal(p.get('advisorOverlay').hidden, false);
  assert.match(p.get('advisorBody').textContent, /暂无看房预约/);
  assert.equal(p.w.document.querySelector('.advisor-tabs [aria-selected="true"]').textContent, '看房预约');
  p.w.document.dispatchEvent(new p.w.KeyboardEvent('keydown', {key:'Escape',bubbles:true}));
  p.action('settings'); assert.equal(p.get('homePanelOverlay').hidden, false);
  p.choose('en'); assert.match(p.get('homePanelOverlay').textContent, /Account & security/);
  assert.deepEqual(p.errors, []);
  const guest = await page(t); guest.action('viewings'); await flush();
  assert.match(guest.get('advisorBody').textContent, /登录后使用购房助手/);
});

test('home AI uses existing API, handles pending/error and preserves successful replies if refresh fails', async t => {
  let finish, failRefresh = false;
  const p = await page(t, { user:{id:'buyer',role:'user',username:'Buyer'}, handler:async (url, options) => {
    if (url === '/api/advisor/ai') return new Promise(resolve => { finish=resolve; });
    if (url === '/api/advisor/state' && failRefresh) return response({},503);
  } });
  const submit = () => p.get('homeComposer').dispatchEvent(new p.w.Event('submit',{cancelable:true,bubbles:true}));
  p.get('homeInput').value = '预算800万'; submit(); await flush();
  assert.equal(p.get('homeSend').disabled, true); assert.equal(p.get('homeComposer').getAttribute('aria-busy'), 'true');
  p.choose('en'); assert.match(p.get('homeStatus').textContent, /Analyzing/);
  finish(response({error:'AI_UNAVAILABLE'},503)); await flush();
  assert.equal(p.get('homeInput').value, '预算800万'); assert.match(p.get('homeStatus').textContent,/temporarily unavailable/);
  p.choose('zh-CN'); assert.match(p.get('homeStatus').textContent,/暂时不可用/);
  submit(); await flush(); failRefresh=true; finish(response({content:'请补充通勤需求。'})); await flush();
  assert.equal(p.get('homeInput').value,''); assert.match(p.get('homeConversation').textContent,/请补充通勤需求/);
  assert.equal(p.get('homeComposer').getAttribute('aria-busy'),'false');
  const request = p.requests.find(request=>request.url === '/api/advisor/ai');
  assert.deepEqual(JSON.parse(request.options.body), {message:'预算800万',language:'zh'});
  p.action('new'); assert.equal(p.get('homeConversation').hidden,true);
  assert.deepEqual(p.errors, []);
});

test('history safely renders stored chat, remains available after new chat, and localizes', async t => {
  const history=[{role:'user',content:'三室'}, {role:'assistant',content:'<img src=x onerror=alert(1)>'}];
  const p=await page(t,{user:{id:'buyer',role:'user',username:'Buyer'},chatHistory:history});
  p.action('history'); await flush();
  assert.match(p.get('homePanelOverlay').textContent,/三室/);
  assert.equal(p.get('homePanelOverlay').querySelector('img'),null);
  p.choose('en'); assert.match(p.get('homePanelOverlay').textContent,/Continue conversation/);
  [...p.get('homePanelOverlay').querySelectorAll('button')].find(button=>button.textContent === 'Continue conversation').click();
  assert.equal(p.get('homeConversation').hidden,false); p.action('new');
  p.action('history'); await flush(); assert.match(p.get('homePanelOverlay').textContent,/三室/);
  assert.deepEqual(p.errors, []);
});

test('keyboard shortcuts, sidebar expansion, voice transcript and modal cleanup work', async t => {
  const p=await page(t); p.get('sidebarToggle').click();
  assert.equal(p.get('sidebarToggle').getAttribute('aria-expanded'),'true');
  p.choose('en'); assert.equal(p.get('sidebarToggle').getAttribute('aria-label'),'Collapse sidebar');
  p.get('homePlus').click(); assert.equal(p.get('homeQuickMenu').hidden,false);
  p.w.document.activeElement.dispatchEvent(new p.w.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
  assert.equal(p.get('homeQuickMenu').hidden,true); assert.equal(p.w.document.activeElement,p.get('homePlus'));
  let recognition;
  p.w.SpeechRecognition=class {constructor(){recognition=this;}start(){}abort(){this.aborted=true;}};
  p.get('homeVoice').click(); assert.equal(recognition.lang,'en-US');
  recognition.onresult({results:[Object.assign([{transcript:'Three bedrooms'}],{isFinal:true})]});
  assert.equal(p.get('homeInput').value,'Three bedrooms');
  p.get('homeVoice').click(); assert.equal(recognition.aborted,true); assert.equal(p.get('homeSend').hidden,false);
  p.get('homeInput').dispatchEvent(new p.w.KeyboardEvent('keydown',{key:'Enter',isComposing:true,bubbles:true}));
  assert.equal(p.get('authModal').hidden,true);
  p.get('homeInput').dispatchEvent(new p.w.KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
  assert.equal(p.get('authModal').hidden,false); await flush(); assert.equal(p.get('homeSidebar').inert,true);
  assert.equal(p.get('homeInput').value,'Three bedrooms'); assert.deepEqual(p.errors, []);
});

test('segmented modes use keyboard selection, distinct drafts and seller copy without changing role', async t => {
  const p=await page(t,{user:{id:'buyer',role:'user',username:'Buyer'}});
  assert.equal(p.get('buyMode').getAttribute('aria-selected'),'true');
  assert.equal(p.get('sellMode').tabIndex,-1);
  p.get('homeInput').value='买房草稿';p.get('homeInput').dispatchEvent(new p.w.Event('input'));
  p.get('buyMode').dispatchEvent(new p.w.KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true}));await flush();
  assert.equal(p.get('assistantMode').dataset.mode,'sell');assert.equal(p.w.document.activeElement,p.get('sellMode'));
  assert.equal(p.get('sellMode').getAttribute('aria-selected'),'true');
  assert.equal(p.get('assistantContent').getAttribute('aria-labelledby'),'sellMode');
  assert.equal(p.get('homeInput').value,'');assert.match(p.get('homeInput').placeholder,/出售的房子/);
  assert.match(p.get('homeTitle').textContent,/卖房/);assert.equal(p.get('sellerProfile').hidden,false);
  assert.doesNotMatch(p.get('sellerProfile').textContent,/卖房需求档案|待补充/);assert.equal(p.get('listingReview').hidden,true);assert.equal(p.w.document.querySelector('[data-home-action="profile"]').hidden,true);
  p.get('homeInput').value='卖房草稿';p.get('homeInput').dispatchEvent(new p.w.Event('input'));
  p.choose('en');assert.match(p.get('homeTitle').textContent,/sell/);assert.equal(p.get('homeInput').value,'卖房草稿');
  p.get('sellMode').dispatchEvent(new p.w.KeyboardEvent('keydown',{key:'End',bubbles:true}));
  assert.equal(p.get('homeInput').value,'买房草稿');assert.equal(p.get('sellerProfile').hidden,true);
  p.get('sellMode').click();assert.equal(p.get('homeInput').value,'卖房草稿');
  assert.equal(p.w.Nexthome.getUser().role,'user');assert.deepEqual(p.errors,[]);
});

test('simultaneous buyer and seller requests finish in their originating modes', async t => {
  const finishes={};
  const p=await page(t,{user:{id:'buyer',role:'user',username:'Buyer'},handler:async(url,options)=>{
    if(url==='/api/advisor/ai'){const data=JSON.parse(options.body);return new Promise(resolve=>finishes[data.mode||'buy']=resolve);}
  }});
  const submit=text=>{p.get('homeInput').value=text;p.get('homeComposer').dispatchEvent(new p.w.Event('submit',{cancelable:true,bubbles:true}));};
  p.get('sellMode').click();await flush();submit('期望售价520万元');await flush();
  assert.equal(p.get('homeComposer').getAttribute('aria-busy'),'true');
  p.get('buyMode').click();assert.equal(p.get('homeComposer').getAttribute('aria-busy'),'false');
  submit('预算800万元');await flush();
  finishes.sell(response({content:'可以何时看房？',fields:{priceWan:520},revision:1,chatHistory:[],saved:true}));await flush();
  assert.doesNotMatch(p.get('homeConversation').textContent,/看房/);
  assert.equal(p.get('homeInput').value,'预算800万元');assert.equal(p.get('homeComposer').getAttribute('aria-busy'),'true');
  p.get('sellMode').click();assert.match(p.get('homeConversation').textContent,/可以何时看房/);assert.equal(p.get('listingReview').hidden,true);
  finishes.buy(response({content:'买房回复'}));await flush();
  assert.doesNotMatch(p.get('homeConversation').textContent,/买房回复/);
  p.get('buyMode').click();assert.match(p.get('homeConversation').textContent,/买房回复/);assert.equal(p.get('homeInput').value,'');assert.deepEqual(p.errors,[]);
});

test('saved buyer history, seller profile and per-mode drafts restore; seller history stays separate', async t => {
  const p=await page(t,{user:{id:'buyer',role:'user',username:'Buyer'},chatHistory:[{role:'user',content:'旧买房对话'}],
    sellingState:{fields:{replacement:'卖旧买新',mortgage:false},revision:3,chatHistory:[{role:'user',content:'旧卖房对话'}]},savedDrafts:{buy:'买房存档草稿',sell:'卖房存档草稿'}});
  assert.match(p.get('homeConversation').textContent,/旧买房/);assert.equal(p.get('homeInput').value,'买房存档草稿');
  p.get('sellMode').click();await flush();assert.match(p.get('homeConversation').textContent,/旧卖房/);assert.doesNotMatch(p.get('homeConversation').textContent,/旧买房/);
  assert.equal(p.get('homeInput').value,'卖房存档草稿');assert.match(p.get('sellerProfile').textContent,/继续规划买房/);
  p.action('history');await flush();assert.match(p.get('homePanelOverlay').textContent,/旧卖房/);assert.doesNotMatch(p.get('homePanelOverlay').textContent,/旧买房/);
  p.get('homePanelOverlay').querySelector('.icon-button').click();
  [...p.get('sellerProfile').querySelectorAll('button')].find(b=>b.textContent.includes('继续规划买房')).click();assert.equal(p.get('assistantMode').dataset.mode,'buy');
  assert.deepEqual(p.errors,[]);
});

const completeSeller=()=>({propertyId:'primary',fields:{city:'上海',district:'浦东',community:'测试小区',address:'测试路12号1202室',areaSqm:90,layout:'两室一厅',floorLevel:6,floorTotal:18,orientation:'南',elevator:false,decoration:'精装',occupancy:'自住',reason:'置换',priceWan:500},revision:1,pending:{},workflow:{active:true},validation:{complete:true},chatHistory:[]});
function sellerHandler(seller,extra){return async(url,options)=>{
  const custom=await extra?.(url,options);if(custom)return custom;
  if(url==='/api/advisor/selling/review'){seller.workflow.reviewed=true;return response(structuredClone(seller));}
  if(url==='/api/advisor/selling'&&options.method==='PATCH'){
    const payload=JSON.parse(options.body);assert.equal(payload.revision,seller.revision);
    for(const [k,v]of Object.entries(payload.fields)){if(v===null)delete seller.fields[k];else seller.fields[k]=v;}seller.revision++;seller.pending={};return response(structuredClone(seller));
  }
  if(url==='/api/advisor/selling/confirm'){seller.savedDraft={id:'one-draft',source_revision:seller.revision};return response(structuredClone(seller));}
};}
const submitChat=(p,text)=>{p.get('homeInput').value=text;p.get('homeComposer').dispatchEvent(new p.w.Event('submit',{cancelable:true,bubbles:true}));};
test('a complete legacy seller conversation opens review on reload through the real API without resending or saving',async t=>{
  const db=await openDatabase();t.after(()=>db.close());
  const env={DB:d1(db),ASSETS:{fetch:async()=>new Response(await readFile(new URL('../assets/properties-ai-table.json',import.meta.url),'utf8'))}};
  const registered=await worker.fetch(new Request('https://nexthome.test/api/auth/register',{method:'POST',headers:{origin:'https://nexthome.test','content-type':'application/json'},body:JSON.stringify({username:'legacy_modal_test',password:'local_modal_test_password',role:'user'})}),env);
  assert.equal(registered.status,200);const user=(await registered.json()).user,cookie=registered.headers.get('set-cookie').split(';')[0];
  const fields=completeSeller().fields;
  db.prepare('INSERT INTO seller_properties(account_id,property_id,fields,revision,workflow)VALUES(?,?,?,?,?)').run(user.id,'primary',JSON.stringify(fields),8,JSON.stringify({deferred:[],seenStages:[]}));
  db.prepare('INSERT INTO seller_chats(account_id,property_id,role,content,created_at)VALUES(?,?,?,?,?)').run(user.id,'primary','user','我要卖房',new Date().toISOString());
  for(let i=0;i<14;i++)db.prepare('INSERT INTO seller_chats(account_id,property_id,role,content,created_at)VALUES(?,?,?,?,?)').run(user.id,'primary',i%2?'assistant':'user',i%2?'请补充下一项。':'补充房屋资料。',new Date().toISOString());
  const handler=async(url,options)=>{
    if(!url.startsWith('/api/advisor/'))return;
    return worker.fetch(new Request('https://nexthome.test'+url,{method:options.method||'GET',headers:{...options.headers,origin:'https://nexthome.test',cookie},...(options.body?{body:options.body}:{})}),env);
  };
  const p=await page(t,{user,handler});p.get('sellMode').click();await flush();await flush();
  assert.equal(p.get('listingReview').hidden,false);assert.equal(p.get('listingReviewTitle').textContent,'挂牌信息');
  assert.equal(p.get('listing-address').value,fields.address);assert.equal(p.get('listing-priceWan').value,String(fields.priceWan));
  const row=db.prepare('SELECT * FROM seller_properties WHERE account_id=?').get(user.id);
  assert.equal(JSON.parse(row.workflow).active,true);assert.equal(JSON.parse(row.workflow).reviewed,true);assert.equal(row.revision,8);assert.deepEqual(JSON.parse(row.fields),fields);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM seller_listing_drafts').get().n,0);assert.equal(db.prepare('SELECT COUNT(*) n FROM seller_chats').get().n,15);
  assert.equal(p.requests.filter(r=>r.url==='/api/advisor/ai').length,0);
  p.get('listingReview').querySelector('.icon-button').dispatchEvent(new p.w.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));assert.equal(p.get('listingReview').hidden,true);
  const reload=await page(t,{user,handler});reload.get('sellMode').click();await flush();await flush();assert.equal(reload.get('listingReview').hidden,true);
  [...reload.get('sellerProfile').querySelectorAll('button')].find(b=>b.textContent==='查看挂牌信息').click();assert.equal(reload.get('listingReview').hidden,false);
  reload.get('listingReview').querySelector('form').dispatchEvent(new reload.w.Event('submit',{cancelable:true,bubbles:true}));await flush();await flush();
  assert.equal(db.prepare('SELECT COUNT(*) n FROM seller_listing_drafts').get().n,1);assert.equal(db.prepare('SELECT role FROM accounts WHERE id=?').get(user.id).role,'user');
  assert.deepEqual(p.errors,[]);assert.deepEqual(reload.errors,[]);
});

test('listing review opens once, traps focus, retains edits across language and close, and saves one private draft',async t=>{
  const seller=completeSeller(),p=await page(t,{user:{id:'buyer',role:'user',username:'Buyer'},sellingState:seller,handler:sellerHandler(seller)});
  p.get('sellMode').click();await flush();await flush();
  const modal=p.get('listingReview');assert.equal(modal.hidden,false);assert.equal(p.get('listingReviewTitle').textContent,'挂牌信息');
  assert.equal(p.w.document.activeElement,modal.querySelector('.icon-button'));assert.equal(p.get('homePage').inert,true);
  assert.equal(p.get('listing-elevator').value,'false');
  p.get('listing-priceWan').value='520';p.get('listing-priceWan').dispatchEvent(new p.w.Event('input'));
  p.w.Nexthome.setLanguage('en');assert.equal(p.get('listing-priceWan').value,'520');assert.equal(p.get('listingReviewTitle').textContent,'Listing information');
  modal.querySelector('.icon-button').dispatchEvent(new p.w.KeyboardEvent('keydown',{key:'Tab',shiftKey:true,bubbles:true,cancelable:true}));
  assert.equal(p.w.document.activeElement,modal.querySelector('[type=submit]'));
  p.w.document.activeElement.dispatchEvent(new p.w.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
  assert.equal(modal.hidden,true);assert.equal(p.get('homePage').inert,undefined);assert.equal(p.requests.some(r=>r.url.endsWith('/confirm')),false);
  p.w.Nexthome.setLanguage('zh-CN');assert.equal(modal.hidden,true);
  [...p.get('sellerProfile').querySelectorAll('button')].find(b=>b.textContent.includes('查看挂牌信息')).click();assert.equal(p.get('listing-priceWan').value,'520');
  modal.querySelector('form').dispatchEvent(new p.w.Event('submit',{cancelable:true,bubbles:true}));await flush();await flush();
  assert.equal(seller.fields.priceWan,520);assert.match(p.get('listingReviewStatus').textContent,/已保存私密/);
  modal.querySelector('form').dispatchEvent(new p.w.Event('submit',{cancelable:true,bubbles:true}));await flush();assert.equal(seller.savedDraft.id,'one-draft');
  [...modal.querySelectorAll('button')].find(b=>b.textContent==='前往公开挂牌').click();assert.equal(p.get('listingModal').hidden,false);assert.doesNotMatch(p.get('propertyAddress').value,/1202/);
  assert.equal(p.requests.some(r=>r.url==='/api/listings'&&r.options.method==='POST'),false);assert.deepEqual(p.errors,[]);
});
test('late completion waits until returning to seller; reviewed drafts stay closed after reload and account changes clear modal',async t=>{
  let finish,account={id:'first',role:'user',username:'First'};const seller=completeSeller();
  const initial={...seller,fields:{city:'上海'},validation:{complete:false},workflow:{active:true}};
  const p=await page(t,{user:account,sellingState:initial,handler:sellerHandler(seller,async(url)=>{
    if(url==='/api/advisor/ai')return new Promise(resolve=>finish=resolve);
    if(url==='/api/auth/session')return response({user:account});
  })});
  p.get('sellMode').click();await flush();submitChat(p,'补充房屋信息');await flush();p.get('buyMode').click();
  finish(response({...structuredClone(seller),content:'信息齐全'}));await flush();assert.equal(p.get('listingReview').hidden,true);
  assert.equal(p.requests.filter(r=>r.url.endsWith('/review')).length,0);
  p.get('sellMode').click();await flush();assert.equal(p.get('listingReview').hidden,false);
  account={id:'second',role:'user',username:'Second'};await p.w.Nexthome.refreshSession();await flush();assert.equal(p.get('listingReview').hidden,true);
  const reload=await page(t,{user:{id:'first',role:'user'},sellingState:seller});reload.get('sellMode').click();await flush();assert.equal(reload.get('listingReview').hidden,true);
  assert.deepEqual(p.errors,[]);
});
test('save failure retains editable values and allows retry without losing draft',async t=>{
  const seller=completeSeller();let attempts=0;
  const p=await page(t,{user:{id:'buyer',role:'user'},sellingState:seller,handler:sellerHandler(seller,async(url)=>{
    if(url.endsWith('/confirm')&&attempts++===0)return response({error:'AI_UNAVAILABLE'},503);
  })});
  p.get('sellMode').click();await flush();p.get('listing-priceWan').value='530';p.get('listing-priceWan').dispatchEvent(new p.w.Event('input'));
  const submit=()=>p.get('listingReview').querySelector('form').dispatchEvent(new p.w.Event('submit',{cancelable:true,bubbles:true}));
  submit();await flush();await flush();assert.equal(p.get('listing-priceWan').value,'530');assert.equal(p.get('listingReviewStatus').dataset.kind,'error');
  submit();await flush();await flush();assert.match(p.get('listingReviewStatus').textContent,/已保存私密/);assert.equal(seller.fields.priceWan,530);assert.deepEqual(p.errors,[]);
});

test('late seller response and cached profile cannot cross a logout or account change', async t => {
  let account={id:'first',role:'user',username:'First'},finish;
  const p=await page(t,{user:account,handler:async(url)=>{
    if(url==='/api/auth/session')return response({user:account});
    if(url.startsWith('/api/advisor/draft?')&&account.id==='second')return response({draft:''});
    if(url==='/api/advisor/ai')return new Promise(resolve=>finish=resolve);
  }});
  p.get('sellMode').click();await flush();p.get('homeInput').value='私密地址';p.get('homeComposer').dispatchEvent(new p.w.Event('submit',{cancelable:true,bubbles:true}));await flush();
  account={id:'second',role:'user',username:'Second'};await p.w.Nexthome.refreshSession();await flush();
  finish(response({content:'第一人的私密回复',fields:{address:'私密地址'},revision:1,saved:true}));await flush();
  assert.doesNotMatch(p.get('sellerProfile').textContent,/私密/);assert.doesNotMatch(p.get('homeConversation').textContent,/私密/);assert.equal(p.get('homeInput').value,'');
  assert.equal(p.get('homeComposer').getAttribute('aria-busy'),'false');assert.deepEqual(p.errors,[]);
});

test('quick switching before hydration cannot erase saved drafts and typing cannot be replaced by a late load', async t => {
  const drafts={buy:'已保存买房草稿',sell:'已保存卖房草稿'},finishes={};
  const p=await page(t,{user:{id:'buyer',role:'user',username:'Buyer'},handler:async(url,options)=>{
    if(url.startsWith('/api/advisor/draft?')&&options.method!=='PUT')return new Promise(resolve=>{finishes[url.endsWith('buy')?'buy':'sell']=()=>resolve(response({draft:drafts[url.endsWith('buy')?'buy':'sell']}));});
  }});
  p.get('sellMode').click();await flush();p.get('buyMode').click();await flush();
  assert.equal(p.requests.filter(r=>r.url.startsWith('/api/advisor/draft?')&&r.options.method==='PUT').length,0);
  finishes.buy();finishes.sell();await flush();assert.equal(p.get('homeInput').value,'已保存买房草稿');
  p.get('sellMode').click();assert.equal(p.get('homeInput').value,'已保存卖房草稿');assert.deepEqual(p.errors,[]);
  let complete;
  const late=await page(t,{user:{id:'buyer',role:'user',username:'Buyer'},chatHistory:[{role:'user',content:'旧记录'}],handler:async(url,options)=>{
    if(url==='/api/advisor/draft?mode=buy'&&options.method!=='PUT')return new Promise(resolve=>complete=()=>resolve(response({draft:'旧草稿'})));
  }});
  late.get('homeInput').value='刚输入的新草稿';late.get('homeInput').dispatchEvent(new late.w.Event('input'));complete();await flush();
  assert.equal(late.get('homeInput').value,'刚输入的新草稿');assert.match(late.get('homeConversation').textContent,/旧记录/);assert.deepEqual(late.errors,[]);
});

test('switching seller properties restores distinct histories and composer drafts and sends the selected property ID',async t=>{
  const homes={primary:{propertyId:'primary',fields:{community:'第一小区'},revision:1,chatHistory:[{role:'user',content:'第一套对话'}]},second:{propertyId:'second',fields:{community:'第二小区'},revision:1,chatHistory:[{role:'user',content:'第二套对话'}]}};
  const drafts={primary:'第一套输入',second:'第二套输入'};
  for(const home of Object.values(homes))home.properties=[{propertyId:'primary',label:'第一小区'},{propertyId:'second',label:'第二小区'}];
  const p=await page(t,{user:{id:'buyer',role:'user'},sellingState:homes.primary,handler:async(url,options)=>{
    const parsed=new URL(url,'https://nexthome.test'),property=parsed.searchParams.get('propertyId')||'primary';
    if(parsed.pathname==='/api/advisor/selling')return response(structuredClone(homes[property]));
    if(parsed.pathname==='/api/advisor/draft'&&parsed.searchParams.get('mode')==='sell'){
      if(options.method==='PUT')drafts[property]=JSON.parse(options.body).draft;
      return response({draft:drafts[property]});
    }
    if(url==='/api/advisor/ai'){const data=JSON.parse(options.body);assert.equal(data.propertyId,'second');return response({...homes.second,content:'第二套回复'});}
  }});
  p.get('sellMode').click();await flush();assert.equal(p.get('homeInput').value,'第一套输入');
  const choose=async property=>{const select=p.get('sellerProfile').querySelector('select');select.value=property;select.dispatchEvent(new p.w.Event('change'));await flush();await flush();};
  await choose('second');assert.match(p.get('homeConversation').textContent,/第二套对话/);assert.doesNotMatch(p.get('homeConversation').textContent,/第一套/);assert.equal(p.get('homeInput').value,'第二套输入');
  submitChat(p,'第二套补充');await flush();assert.match(p.get('homeConversation').textContent,/第二套回复/);
  await choose('primary');assert.equal(p.get('homeInput').value,'第一套输入');assert.doesNotMatch(p.get('homeConversation').textContent,/第二套回复/);assert.deepEqual(p.errors,[]);
});

test('send shows a pending message immediately, preserves failures and retries without duplicate bubbles',async t=>{
  let finish;const p=await page(t,{user:{id:'buyer',role:'user'},handler:async url=>{if(url==='/api/advisor/ai')return new Promise(resolve=>finish=resolve);}});
  submitChat(p,'发送诊断原文');await flush();assert.match(p.get('homeConversation').textContent,/发送诊断原文/);assert.match(p.get('homeConversation').textContent,/发送中/);
  finish(response({error:'AI_EMPTY_RESPONSE'},502));await flush();assert.equal(p.get('homeInput').value,'发送诊断原文');assert.match(p.get('homeStatus').textContent,/为空或格式异常/);
  const retry=[...p.get('homeConversation').querySelectorAll('button')].find(b=>b.textContent==='重试发送');assert.equal(retry.disabled,false);retry.click();await flush();
  finish(response({content:'成功回复'}));await flush();assert.match(p.get('homeConversation').textContent,/成功回复/);assert.equal(p.get('homeConversation').querySelectorAll('[data-role="user"]').length,1);assert.equal(p.get('homeInput').value,'');assert.deepEqual(p.errors,[]);
});
test('malformed successful responses and network failures never clear the input, and auxiliary refresh cannot delay a valid reply',async t=>{
  let kind='malformed';const p=await page(t,{user:{id:'buyer',role:'user'},handler:async(url)=>{
    if(url==='/api/advisor/ai'){if(kind==='network')throw new TypeError('Failed to fetch');return response(kind==='valid'?{content:'有效回复'}:{});}
    if(url==='/api/advisor/state'&&kind==='valid')return new Promise(()=>{});
  }});
  submitChat(p,'原文保留');await flush();assert.equal(p.get('homeInput').value,'原文保留');assert.match(p.get('homeStatus').textContent,/为空或格式异常/);
  kind='network';submitChat(p,'原文保留');await flush();assert.match(p.get('homeStatus').textContent,/网络连接中断/);assert.equal(p.get('homeInput').value,'原文保留');
  kind='valid';submitChat(p,'原文保留');await flush();assert.match(p.get('homeConversation').textContent,/有效回复/);assert.equal(p.get('homeComposer').getAttribute('aria-busy'),'false');assert.equal(p.get('homeInput').value,'');assert.deepEqual(p.errors,[]);
});

test('a stalled response body times out visibly without erasing the draft or resending',async t=>{
  let calls=0;const p=await page(t,{user:{id:'buyer',role:'user'},handler:async url=>{if(url==='/api/advisor/ai'){calls++;return {ok:true,status:200,json:()=>new Promise(()=>{})};}}});
  const timer=p.w.setTimeout.bind(p.w);p.w.setTimeout=(fn,ms,...args)=>timer(fn,ms===65000?10:ms,...args);
  submitChat(p,'超时保留原文');await flush();await flush();assert.match(p.get('homeStatus').textContent,/请求等待超时/);assert.equal(p.get('homeInput').value,'超时保留原文');assert.equal(p.get('homeComposer').getAttribute('aria-busy'),'false');assert.equal(calls,1);assert.deepEqual(p.errors,[]);
});

test('late background draft-sync failure cannot overwrite the AI send failure',async t=>{
  let rejectDraft;const p=await page(t,{user:{id:'buyer',role:'user'},handler:async(url,options)=>{
    if(url.startsWith('/api/advisor/draft?')&&options.method==='PUT')return new Promise((_,reject)=>rejectDraft=reject);
    if(url==='/api/advisor/ai')return response({error:'AI_EMPTY_RESPONSE'},502);
  }});
  submitChat(p,'保留明确错误');await flush();assert.match(p.get('homeStatus').textContent,/为空或格式异常/);rejectDraft(Error('offline'));await flush();assert.match(p.get('homeStatus').textContent,/为空或格式异常/);assert.equal(p.get('homeInput').value,'保留明确错误');assert.deepEqual(p.errors,[]);
});

test('seller retry retains its send ID across a reload and aligns a lost response with saved history',async t=>{
  const key='nexthome.send.buyer:sell:primary', ids=[], message='有电梯，目前自住';
  const p=await page(t,{user:{id:'buyer',role:'user'},handler:async(url,options)=>{
    if(url==='/api/advisor/ai'){ids.push(JSON.parse(options.body).requestId);return response({error:'AI_EMPTY_RESPONSE'},502);}
  }});
  p.get('sellMode').click();await flush();submitChat(p,message);await flush();
  p.get('homeConversation').querySelector('button').click();await flush();
  assert.match(ids[0],/^[\w-]{1,80}$/);assert.equal(ids[0],ids[1]);
  const stored=p.w.localStorage.getItem(key);assert.equal(JSON.parse(stored).requestId,ids[0]);
  const chatHistory=[{role:'user',content:message},{role:'assistant',content:'已记录电梯和自住'}];
  const reloaded=await page(t,{user:{id:'buyer',role:'user'},storage:{[key]:stored},savedDrafts:{buy:'',sell:message},sellingState:{fields:{elevator:true,occupancy:'自住'},revision:1,chatHistory},handler:async(url,options)=>{
    if(url==='/api/advisor/ai'){assert.equal(JSON.parse(options.body).requestId,ids[0]);return response({content:'已记录电梯和自住',replayed:true,fields:{elevator:true,occupancy:'自住'},revision:1,chatHistory});}
  }});
  reloaded.get('sellMode').click();await flush();submitChat(reloaded,message);await flush();
  assert.equal(reloaded.get('homeConversation').querySelectorAll('article').length,2);assert.equal(reloaded.get('homeInput').value,'');
  assert.equal(reloaded.w.localStorage.getItem(key),null);assert.deepEqual(reloaded.errors,[]);
});

test('new seller content and another account never reuse an old send ID',async t=>{
  const key='nexthome.send.buyer:sell:primary',stored=JSON.stringify({requestId:'old-send',message:'有电梯，目前自住'}),ids=[];
  const p=await page(t,{user:{id:'buyer',role:'user'},storage:{[key]:stored},handler:async(url,options)=>{if(url==='/api/advisor/ai'){ids.push(JSON.parse(options.body).requestId);return response({error:'AI_EMPTY_RESPONSE'},502);}}});
  p.get('sellMode').click();await flush();p.get('homeInput').value='修改为出租';p.get('homeInput').dispatchEvent(new p.w.Event('input'));submitChat(p,'修改为出租');await flush();assert.notEqual(ids[0],'old-send');
  const other=await page(t,{user:{id:'another',role:'user'},storage:{[key]:stored},handler:async(url,options)=>{if(url==='/api/advisor/ai'){assert.notEqual(JSON.parse(options.body).requestId,'old-send');return response({content:'回复',fields:{},revision:1,chatHistory:[]});}}});
  other.get('sellMode').click();await flush();submitChat(other,'有电梯，目前自住');await flush();assert.equal(other.get('homeInput').value,'');assert.deepEqual(other.errors,[]);
});

test('the first pending message docks the existing mode control; failed sends stay docked until a new chat',async t=>{
  for(const selectedMode of ['buy','sell']){
    let finish;
    const p=await page(t,{user:{id:'buyer',role:'user'},handler:async url=>{
      if(url==='/api/advisor/ai')return new Promise(resolve=>finish=resolve);
    }});
    if(selectedMode==='sell'){p.get('sellMode').click();await flush();}
    const modeControl=p.get('assistantMode'),assistant=p.get('assistantPage'),welcome=p.get('homeWelcome');
    assert.equal(assistant.classList.contains('has-conversation'),false);
    assert.equal(welcome.getAttribute('aria-hidden'),'false');
    submitChat(p,'首次发送');
    assert.equal(assistant.classList.contains('has-conversation'),true);
    assert.equal(welcome.getAttribute('aria-hidden'),'true');assert.equal(welcome.inert,true);
    assert.equal(p.get('assistantMode'),modeControl);assert.equal(p.get('homeConversation').hidden,false);
    await flush();finish(response({error:'AI_UNAVAILABLE'},503));await flush();
    assert.equal(assistant.classList.contains('has-conversation'),true);
    assert.equal(p.get('homeInput').value,'首次发送');
    p.action('new');
    assert.equal(assistant.classList.contains('has-conversation'),false);
    assert.equal(welcome.getAttribute('aria-hidden'),'false');assert.equal(welcome.inert,false);
    assert.equal(p.get('homeConversation').hidden,true);assert.equal(p.get('assistantMode'),modeControl);
    assert.equal(p.w.document.activeElement,p.get('homeInput'));assert.deepEqual(p.errors,[]);
  }
});

test('each mode chooses its layout from its own conversation while preserving the other draft',async t=>{
  for(const historyMode of ['buy','sell']){
    const history=[{role:'user',content:'已有对话'}],emptyMode=historyMode==='buy'?'sell':'buy';
    const p=await page(t,{user:{id:'buyer',role:'user'},chatHistory:historyMode==='buy'?history:[],
      sellingState:{fields:{},revision:0,chatHistory:historyMode==='sell'?history:[]},savedDrafts:{buy:'买房草稿',sell:'卖房草稿'}});
    p.get(`${emptyMode}Mode`).click();await flush();
    assert.equal(p.get('assistantPage').classList.contains('has-conversation'),false);
    p.get('homeInput').value='未开始模式的输入';p.get('homeInput').dispatchEvent(new p.w.Event('input'));
    p.get(`${historyMode}Mode`).click();await flush();
    assert.equal(p.get('assistantPage').classList.contains('has-conversation'),true);
    assert.match(p.get('homeConversation').textContent,/已有对话/);
    assert.equal(p.get('homeInput').value,historyMode==='buy'?'买房草稿':'卖房草稿');
    p.action('new');assert.equal(p.get('assistantPage').classList.contains('has-conversation'),false);
    p.get(`${emptyMode}Mode`).click();
    assert.equal(p.get('assistantPage').classList.contains('has-conversation'),false);
    assert.equal(p.get('homeInput').value,'未开始模式的输入');
    assert.equal(p.get(`${emptyMode}Mode`).getAttribute('aria-selected'),'true');
    assert.equal(p.get('assistantContent').getAttribute('aria-labelledby'),`${emptyMode}Mode`);assert.deepEqual(p.errors,[]);
  }
});

test('restored history and continuing history use the chat layout, and another account starts from its own state',async t=>{
  let account={id:'first',role:'user',username:'First'};
  const p=await page(t,{user:account,chatHistory:[{role:'user',content:'第一位用户的对话'}],handler:async(url,options,state)=>{
    if(url==='/api/auth/session')return response({user:account});
    if(account.id==='second'&&url==='/api/advisor/state')return response({...state,chatHistory:[]});
    if(account.id==='second'&&url.startsWith('/api/advisor/draft?')&&options.method!=='PUT')return response({draft:''});
  }});
  assert.equal(p.get('assistantPage').classList.contains('has-conversation'),true);
  p.action('new');assert.equal(p.get('assistantPage').classList.contains('has-conversation'),false);
  p.action('history');await flush();
  [...p.get('homePanelOverlay').querySelectorAll('button')].find(button=>button.textContent==='继续对话').click();
  assert.equal(p.get('assistantPage').classList.contains('has-conversation'),true);
  assert.equal(p.get('homeWelcome').getAttribute('aria-hidden'),'true');assert.equal(p.get('homePanelOverlay').hidden,true);
  account={id:'second',role:'user',username:'Second'};await p.w.Nexthome.refreshSession();await flush();
  assert.equal(p.get('assistantPage').classList.contains('has-conversation'),false);
  assert.equal(p.get('homeWelcome').getAttribute('aria-hidden'),'false');assert.equal(p.get('homeConversation').hidden,true);
  assert.doesNotMatch(p.get('homeConversation').textContent,/第一位用户/);assert.equal(p.get('homeInput').value,'');
  p.get('sellMode').click();await flush();assert.equal(p.get('assistantPage').classList.contains('has-conversation'),false);
  assert.deepEqual(p.errors,[]);
});
