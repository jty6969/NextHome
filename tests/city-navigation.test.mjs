import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
const source=await readFile(new URL('../assets/city-navigation.js',import.meta.url),'utf8');
function page(stored){
  const d=new JSDOM('<html lang="zh-CN"><body><div class="header-inner"></div><aside id="homeSidebar"><button data-home-action="map"><span class="rail-label">地图找房</span></button></aside></body></html>',{url:'https://example.test',runScripts:'outside-only'});
  const w=d.window;w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};
  if(stored)w.localStorage.setItem('nexthome.browse-city',stored);
  w.eval(source);return d;
}
test('city picker persists manual choice, never infers GPS, and matches only known cities',()=>{
  const d=page();const w=d.window,doc=w.document;
  try{
    assert.equal(w.NexthomeCity.get(),'');assert.equal(w.NexthomeCity.matches({}),true);
    doc.querySelector('.city-trigger').click();assert.equal(doc.querySelector('#cityPicker').open,true);
    [...doc.querySelectorAll('.city-choices button')].find(b=>b.textContent==='北京').click();
    assert.equal(w.NexthomeCity.get(),'北京');assert.equal(w.localStorage.getItem('nexthome.browse-city'),'北京');
    assert.equal(w.NexthomeCity.matches({city:'北京市'}),true);assert.equal(w.NexthomeCity.matches({address:'上海市浦东新区'}),false);assert.equal(w.NexthomeCity.matches({}),false);
    assert.match(doc.querySelector('#cityPicker p').textContent,/非 GPS/);
    doc.documentElement.lang='en';doc.dispatchEvent(new w.Event('languagechange'));assert.match(doc.querySelector('.city-trigger').textContent,/Beijing/);
  }finally{d.window.close();}
});
test('menu delegates to existing navigation after closing, and invalid saved city is ignored',()=>{
  const d=page('unknown');const w=d.window,doc=w.document;
  try{
    assert.equal(w.NexthomeCity.get(),'');let called=false;
    doc.querySelector('[data-home-action]').addEventListener('click',()=>{called=true;assert.equal(doc.querySelector('#mobileNavigation').open,false);});
    doc.querySelector('.mobile-menu-trigger').click();doc.querySelector('.navigation-choices button').click();assert.equal(called,true);
  }finally{d.window.close();}
});
