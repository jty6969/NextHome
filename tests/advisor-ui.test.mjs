import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
const script=await readFile(new URL('../assets/advisor.js',import.meta.url),'utf8');
const flush=()=>new Promise(r=>setTimeout(r,30));
function fixture(t,logged=true){
  const dom=new JSDOM('<div class="site-header"><div class="header-actions"></div></div><main id="homePage"></main><div id="detailPage"><div id="detailContent"></div></div><div id="loginFields"></div>',{url:'https://nexthome.test/',runScripts:'outside-only'});
  t.after(()=>dom.window.close());const w=dom.window;
  let user=logged?{id:'buyer',role:'user'}:null,language='zh',favorites=['guest-home'];
  const requests=[],state={profile:{},requirements:{},gate:{count:0,ready:false},favorites:['lshy-1'],events:[],chatHistory:[],threads:[],viewings:[],offers:[],deals:[]};
  w.Nexthome={getUser:()=>user,getListings:()=>[{id:'lshy-1',listingTitle:'测试房源'}],getLanguage:()=>language,closeLogin(){},login(){},refreshSession:async()=>{user={id:'seller',role:'seller'};},setFavorites:ids=>favorites=[...ids],favorites:()=>[...favorites],toast(){},openProperty(){}};
  w.Nexthome.setLanguage=value=>{language=value;w.document.dispatchEvent(new w.Event('languagechange'));};
  w.fetch=async(url,options={})=>{const data=options.body?JSON.parse(options.body):null;requests.push({url,data,method:options.method});
    if(url.endsWith('/ai'))return {ok:false,status:503,json:async()=>({error:'AI_UNAVAILABLE'})};
    if(url.endsWith('/auth/register'))return {ok:true,status:200,json:async()=>({user:{role:data.role}})};
    if(url.endsWith('/seller'))return {ok:true,json:async()=>({...state,listings:[]})};
    return {ok:true,status:200,json:async()=>structuredClone(state)};
  };
  w.eval(script);
  const click=label=>{const el=[...w.document.querySelectorAll('#advisorOverlay button')].find(e=>e.textContent===label);assert.ok(el,`button ${label}`);el.click();};
  return {w,requests,state,click,setLanguage(value){language=value;w.document.dispatchEvent(new w.Event('languagechange'));},logout(){user=null;w.document.dispatchEvent(new w.Event('nexthome-auth'));},favorites:()=>favorites};
}
test('advisor renders bilingual chat, retains failed AI drafts and closes accessibly',async t=>{
  const c=fixture(t);await flush();c.w.document.getElementById('advisorOpen').click();await flush();
  const input=c.w.document.getElementById('advisorChatInput');input.value='预算800万，月供10000元';c.click('发送');await flush();
  assert.equal(input.value,'预算800万，月供10000元');assert.match(c.w.document.querySelector('.advisor-notice').textContent,/暂时不可用/);
  c.click('English');assert.equal(c.w.document.getElementById('advisorChatInput').value,input.value);assert.match(c.w.document.getElementById('advisorTitle').textContent,/Home buying/);
  c.click('中文');assert.equal(c.w.document.getElementById('advisorChatInput').value,input.value);assert.match(c.w.document.getElementById('advisorTitle').textContent,/购房/);
  assert.equal(c.w.document.getElementById('homePage').inert,true);
  c.w.document.dispatchEvent(new c.w.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));assert.equal(c.w.document.getElementById('advisorOverlay').hidden,true);assert.equal(c.w.document.getElementById('homePage').inert,false);
});
test('registration submits selected role and authenticated favorites do not replace guest favorites',async t=>{
  const c=fixture(t,false);c.w.document.getElementById('advisorRegister').click();await flush();
  const fields=c.w.document.querySelectorAll('#advisorBody input');fields[0].value='new_seller';fields[1].value='张先生';fields[2].value='long-password';c.w.document.querySelector('#advisorBody select').value='seller';
  c.setLanguage('en');assert.equal(c.w.document.querySelector('#advisorBody input').value,'new_seller');c.click('Register and sign in');await flush();
  const submitted=c.requests.find(r=>r.url.endsWith('/auth/register'));assert.equal(submitted.data.role,'seller');assert.equal(submitted.data.username,'new_seller');assert.deepEqual(c.favorites(),['lshy-1']);
  c.logout();assert.deepEqual(c.favorites(),['guest-home']);
});
test('detail browse events, escaped messages and microphone recognition work in the added script',async t=>{
  const c=fixture(t);await flush();c.w.document.dispatchEvent(new c.w.CustomEvent('nexthome-detail',{detail:{id:'lshy-1'}}));await flush();
  assert.equal(c.w.document.querySelectorAll('#advisorDetailActions button').length,2);assert.ok(c.requests.some(r=>r.url.endsWith('/browse')&&r.data.listingId==='lshy-1'));
  c.state.chatHistory=[{role:'assistant',content:'<img src=x onerror=alert(1)>'}];c.w.document.getElementById('advisorOpen').click();await flush();assert.equal(c.w.document.querySelector('#advisorChatHistory img'),null);
  let recognition;c.w.SpeechRecognition=class{constructor(){recognition=this;}start(){}abort(){this.aborted=true;}};
  c.click('语音输入');assert.equal(recognition.lang,'zh-CN');recognition.onresult({results:[Object.assign([{transcript:'三室一厅'}],{isFinal:true})]});assert.equal(c.w.document.getElementById('advisorChatInput').value,'三室一厅');
  c.w.document.dispatchEvent(new c.w.KeyboardEvent('keydown',{key:'Escape'}));assert.equal(recognition.aborted,true);
});
