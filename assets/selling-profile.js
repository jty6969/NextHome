(() => {
  'use strict';
  const fields = [
    ['房屋基本情况', 'Property', [
      ['city','城市','City'], ['district','区域','District'], ['community','小区','Community'], ['address','房屋地址','Address'],
      ['areaSqm','面积（㎡）','Area (m²)','number'], ['layout','户型','Layout'], ['floor','楼层','Floor'], ['orientation','朝向','Orientation'],
      ['elevator','电梯','Elevator','boolean'], ['decoration','装修情况','Decoration'], ['occupancy','自住、空置或出租','Occupancy'],
    ]],
    ['出售目标', 'Sale goals', [
      ['reason','出售原因','Reason for sale'], ['priceWan','期望售价（万元）','Asking price (CNY 10,000)','number'],
      ['timeline','希望售出时间','Sale timeline'], ['deadline','明确截止日期','Deadline'], ['priority','价格、速度或交房安排','Price, speed or handover priority'],
      ['replacement','置换及后续购房需求','Replacement purchase plans'],
    ]],
    ['贷款与交付安排', 'Mortgage & handover', [
      ['mortgage','是否有未结清贷款','Outstanding mortgage','boolean'], ['mortgageWan','剩余贷款（万元，可暂不提供）','Mortgage balance (CNY 10,000, optional)','number'],
      ['handover','预计可交房时间','Expected handover'], ['viewing','可看房日期或时段','Viewing availability'], ['restrictions','特殊要求或限制','Other requirements'],
    ]],
  ];
  window.NexthomeSelling = { render(container, data, {save, login, buy, retry}) {
    const tr = (zh,en) => window.Nexthome.getLanguage() === 'en' ? en : zh;
    const node = (tag,text,cls) => {const e=document.createElement(tag); if(text)e.textContent=text;if(cls)e.className=cls;return e;};
    const previous = container.querySelector('details');
    const expanded = previous?.open || false;
    const drafts = new Map([...container.querySelectorAll('[data-editing] [data-seller-field]')].map(input=>[input.dataset.sellerField,input.value]));
    const editing = new Set([...container.querySelectorAll('[data-editing]')].map(row=>row.dataset.editing));
    container.replaceChildren();
    const card=node('details',null,'seller-brief'); card.open=expanded;
    const count=Object.values(data?.fields||{}).filter(v=>v!=null).length;
    const summary=node('summary',tr('卖房需求档案','Seller brief'));
    summary.append(node('span',`${count}/22`, 'seller-brief-count'));card.append(summary);container.append(card);
    if(!window.Nexthome.getUser()) {
      card.append(node('p',tr('登录后保存你的私密卖房档案。','Sign in to save your private seller brief.')));
      const button=node('button',tr('登录 / 注册','Sign in / Register'),'dialog-cancel');button.type='button';button.onclick=login;card.append(button);return;
    }
    if(!data) {
      card.append(node('p',tr('档案尚未加载。','Brief has not loaded yet.')));
      const button=node('button',tr('加载档案','Load brief'),'dialog-cancel');button.type='button';button.onclick=retry;card.append(button);return;
    }
    card.append(node('p',tr('仅对你可见，不会自动发布为房源。金额单位：万元。','Private to you. Never automatically published as a listing. Prices use CNY 10,000.'),'seller-privacy'));
    for(const [zh,en,group] of fields) {
      card.append(node('h3',tr(zh,en)));
      for(const [key,zhLabel,enLabel,type] of group) {
        const row=node('div',null,'seller-field');const label=tr(zhLabel,enLabel), value=data.fields[key];
        const display=node('div',null,'seller-field-display');display.append(node('span',label,'seller-field-label'));
        display.append(node('span',value==null?tr('待补充','To add'):typeof value==='boolean'?tr(value?'是':'否',value?'Yes':'No'):String(value),value==null?'seller-unknown':''));
        const edit=node('button',tr('编辑','Edit'),'seller-field-edit');edit.type='button';edit.setAttribute('aria-label',tr(`编辑${zhLabel}`,`Edit ${enLabel}`));
        const form=node('form',null,'seller-field-form');form.hidden=true;
        const input=type==='boolean'?node('select'):node('input'); input.dataset.sellerField=key;input.setAttribute('aria-label',label);
        if(type==='boolean')for(const [v,zhText,enText]of [['','待补充','To add'],['true','是','Yes'],['false','否','No']]) {const option=node('option',tr(zhText,enText));option.value=v;input.append(option);}
        else {input.type=type||'text';input.maxLength=500;if(type==='number'){input.min=key==='mortgageWan'?'0':'0.01';input.max='1000000';input.step='any';}}
        input.value=drafts.get(key)??(value==null?'':String(value));
        const submit=node('button',tr('保存','Save'),'dialog-cancel');submit.type='submit';
        const clear=node('button',tr('清空','Clear'),'dialog-cancel');clear.type='button';
        const cancel=node('button',tr('取消','Cancel'),'dialog-cancel');cancel.type='button';
        const show=()=>{form.hidden=false;row.dataset.editing=key;edit.hidden=true;};
        const hide=()=>{form.hidden=true;delete row.dataset.editing;edit.hidden=false;};
        edit.onclick=()=>{show();input.focus();};cancel.onclick=hide;
        async function persist(next) {
          const owner=window.Nexthome.getUser()?.id;
          [submit,clear,cancel,input].forEach(e=>e.disabled=true);
          try {await save(key,next,data.revision);}
          finally {if(owner===window.Nexthome.getUser()?.id)[submit,clear,cancel,input].forEach(e=>e.disabled=false);}
        }
        form.onsubmit=event=>{event.preventDefault();persist(!input.value.trim()?null:type==='number'?Number(input.value):type==='boolean'?input.value==='true':input.value.trim()).catch(()=>{});};
        clear.onclick=()=>persist(null).catch(()=>{});
        form.append(input,submit,clear,cancel);row.append(display,edit,form);card.append(row);if(editing.has(key))show();
      }
    }
    if(data.fields.replacement){const button=node('button',tr('继续规划买房 →','Plan your next purchase →'),'dialog-cancel');button.type='button';button.onclick=buy;card.append(button);}
  }};
})();
