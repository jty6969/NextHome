/* Local browsing preferences only: never label a selected city as GPS location. */
(() => {
  const cities = [['上海','Shanghai'],['北京','Beijing'],['深圳','Shenzhen'],['广州','Guangzhou'],['杭州','Hangzhou'],['成都','Chengdu'],['南京','Nanjing'],['苏州','Suzhou'],['武汉','Wuhan'],['重庆','Chongqing'],['西安',"Xi’an"],['天津','Tianjin']];
  const tr=(zh,en)=>document.documentElement.lang==='en'?en:zh;
  let selected='';
  try { const value=localStorage.getItem('nexthome.browse-city'); if(cities.some(c=>c[0]===value))selected=value; } catch {}
  const name=()=>cities.find(c=>c[0]===selected);
  const matches=property=>!selected || !!property && (String(property.city||'').replace(/市$/,'')===selected || String(property.address||'').includes(selected));
  window.NexthomeCity={get:()=>selected,matches};
  const header=document.querySelector('.header-inner'); if(!header)return;
  const tools=document.createElement('div');tools.className='city-toolbar';
  const cityButton=document.createElement('button');cityButton.type='button';cityButton.className='city-trigger';cityButton.setAttribute('aria-haspopup','dialog');
  const menuButton=document.createElement('button');menuButton.type='button';menuButton.className='mobile-menu-trigger';menuButton.setAttribute('aria-haspopup','dialog');
  tools.append(cityButton,menuButton);header.append(tools);
  function sheet(id){
    const dialog=document.createElement('dialog');dialog.id=id;dialog.className='navigation-sheet';dialog.setAttribute('aria-labelledby',id+'Title');
    const title=document.createElement('h2');title.id=id+'Title';const close=document.createElement('button');close.type='button';close.className='sheet-close';
    close.addEventListener('click',()=>dialog.close());dialog.append(close,title);document.body.append(dialog);
    dialog.addEventListener('click',event=>{if(event.target===dialog){const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog.close();}});
    return {dialog,title,close};
  }
  const city=sheet('cityPicker'),nav=sheet('mobileNavigation');
  cityButton.setAttribute('aria-controls',city.dialog.id);menuButton.setAttribute('aria-controls',nav.dialog.id);
  const note=document.createElement('p');const choices=document.createElement('div');choices.className='city-choices';city.dialog.append(note,choices);
  const navItems=document.createElement('div');navItems.className='navigation-choices';nav.dialog.append(navItems);
  function choose(value){selected=value;try{localStorage.setItem('nexthome.browse-city',value);}catch{}city.dialog.close();render();document.dispatchEvent(new CustomEvent('nexthome-citychange',{detail:{city:value}}));}
  function render(){
    const c=name();cityButton.textContent=(c?tr(...c):tr('全部城市','All cities'))+' ▾';cityButton.setAttribute('aria-label',tr('找房城市：','Browse city: ')+(c?tr(...c):tr('全部城市','All cities')));
    menuButton.textContent=tr('☰ 菜单','☰ Menu');city.title.textContent=tr('选择找房城市','Choose a city');nav.title.textContent=tr('常用功能','Navigation');
    for(const s of [city,nav])s.close.textContent=tr('关闭','Close');
    note.textContent=tr('手动选择 · 非 GPS 定位。仅筛选房源列表和地图，不修改 AI 中已保存的购房需求；城市未知的房源可在“全部城市”查看。','Manual selection, not GPS. Filters listings and map only; saved AI requirements stay unchanged. Homes with unknown cities appear under All cities.');
    choices.replaceChildren();for(const c of [['','All cities'],...cities]){const b=document.createElement('button');b.type='button';b.textContent=c[0]?tr(...c):tr('全部城市','All cities');b.setAttribute('aria-pressed',String(selected===c[0]));b.addEventListener('click',()=>choose(c[0]));choices.append(b);}
    navItems.replaceChildren();document.querySelectorAll('#homeSidebar [data-home-action]').forEach(source=>{const b=document.createElement('button');b.type='button';b.textContent=source.querySelector('.rail-label')?.textContent||source.getAttribute('aria-label');b.addEventListener('click',()=>{nav.dialog.close();source.click();});navItems.append(b);});
  }
  cityButton.addEventListener('click',()=>{render();city.dialog.showModal();});menuButton.addEventListener('click',()=>{render();nav.dialog.showModal();});
  document.addEventListener('languagechange',render);render();
  document.dispatchEvent(new CustomEvent('nexthome-citychange',{detail:{city:selected}}));
})();
