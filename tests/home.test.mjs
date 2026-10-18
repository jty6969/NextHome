import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { JSDOM, VirtualConsole } from 'jsdom';

const [html, advisor, home, selling] = await Promise.all(['index.html','assets/advisor.js','assets/home.js','assets/selling-profile.js'].map(file => readFile(new URL(`../${file}`, import.meta.url), 'utf8')));
const flush = () => new Promise(resolve => setTimeout(resolve, 20));
const response = (data, status = 200) => ({ ok: status < 400, status, json: async () => data });
async function page(t, { user = null, preference, blockedStorage = false, handler, chatHistory = [], sellingState = {fields:{},revision:0,chatHistory:[]}, savedDrafts = {buy:'',sell:''}, url = 'https://nexthome.test/' } = {}) {
  const requests = [], errors = [];
  const console = new VirtualConsole(); console.on('jsdomError', error => errors.push(error));
  const state = {profile:{},requirements:{},gate:{count:0,ready:false},favorites:[],events:[],chatHistory,threads:[],viewings:[],offers:[],deals:[]};
  const dom = new JSDOM(html, { url, runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: console,
    beforeParse(w) {
      w.scrollTo = () => {}; w.HTMLElement.prototype.scrollIntoView = () => {};
      if (preference) w.localStorage.setItem('nexthome.language', preference);
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
  assert.match(p.get('sellerProfile').textContent,/待补充/);
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
  p.get('sellMode').click();assert.match(p.get('homeConversation').textContent,/可以何时看房/);assert.match(p.get('sellerProfile').textContent,/520/);
  finishes.buy(response({content:'买房回复'}));await flush();
  assert.doesNotMatch(p.get('homeConversation').textContent,/买房回复/);
  p.get('buyMode').click();assert.match(p.get('homeConversation').textContent,/买房回复/);assert.equal(p.get('homeInput').value,'');assert.deepEqual(p.errors,[]);
});

test('saved buyer history, seller profile and per-mode drafts restore; seller history stays separate', async t => {
  const p=await page(t,{user:{id:'buyer',role:'user',username:'Buyer'},chatHistory:[{role:'user',content:'旧买房对话'}],
    sellingState:{fields:{replacement:'卖旧买新',mortgage:false},revision:3,chatHistory:[{role:'user',content:'旧卖房对话'}]},savedDrafts:{buy:'买房存档草稿',sell:'卖房存档草稿'}});
  assert.match(p.get('homeConversation').textContent,/旧买房/);assert.equal(p.get('homeInput').value,'买房存档草稿');
  p.get('sellMode').click();await flush();assert.match(p.get('homeConversation').textContent,/旧卖房/);assert.doesNotMatch(p.get('homeConversation').textContent,/旧买房/);
  assert.equal(p.get('homeInput').value,'卖房存档草稿');assert.match(p.get('sellerProfile').textContent,/卖旧买新/);
  p.action('history');await flush();assert.match(p.get('homePanelOverlay').textContent,/旧卖房/);assert.doesNotMatch(p.get('homePanelOverlay').textContent,/旧买房/);
  p.get('homePanelOverlay').querySelector('.icon-button').click();
  [...p.get('sellerProfile').querySelectorAll('button')].find(b=>b.textContent.includes('继续规划买房')).click();assert.equal(p.get('assistantMode').dataset.mode,'buy');
  assert.deepEqual(p.errors,[]);
});

test('seller brief saves and clears single fields with revisions and retains unsaved edits on language change', async t => {
  const seller={fields:{priceWan:500,city:'上海'},revision:1,chatHistory:[]};
  const p=await page(t,{user:{id:'buyer',role:'user',username:'Buyer'},sellingState:seller,handler:async(url,options)=>{
    if(url==='/api/advisor/selling'&&options.method==='PATCH') {
      const data=JSON.parse(options.body);assert.equal(data.revision,seller.revision);
      for(const [k,v]of Object.entries(data.fields)){if(v===null)delete seller.fields[k];else seller.fields[k]=v;}seller.revision++;
      return response(structuredClone(seller));
    }
  }});
  p.get('sellMode').click();await flush();p.get('sellerProfile').querySelector('details').open=true;
  let row=p.get('sellerProfile').querySelector('[data-seller-field="priceWan"]').closest('.seller-field');row.querySelector('.seller-field-edit').click();
  row.querySelector('input').value='520';p.choose('en');
  row=p.get('sellerProfile').querySelector('[data-seller-field="priceWan"]').closest('.seller-field');assert.equal(row.querySelector('form').hidden,false);assert.equal(row.querySelector('input').value,'520');
  row.querySelector('form').dispatchEvent(new p.w.Event('submit',{cancelable:true,bubbles:true}));await flush();
  assert.equal(seller.fields.priceWan,520);assert.equal(seller.fields.city,'上海');assert.match(p.get('homeStatus').textContent,/saved/);
  row=p.get('sellerProfile').querySelector('[data-seller-field="priceWan"]').closest('.seller-field');row.querySelector('.seller-field-edit').click();
  [...row.querySelectorAll('button')].find(b=>b.textContent==='Clear').click();await flush();
  assert.equal(seller.fields.priceWan,undefined);assert.equal(seller.fields.city,'上海');assert.deepEqual(p.errors,[]);
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
