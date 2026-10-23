(() => {
  'use strict';
  const groups = [
    ['房屋基本信息','Property basics',[
      ['city','城市','City'],['district','区域','District'],['community','小区','Community'],['address','房屋地址（仅草稿可见）','Address (private in draft)'],
      ['areaSqm','面积（平方米）','Area (m²)','number'],['layout','户型','Layout'],['floorLevel','所在楼层','Floor','number'],['floorTotal','总楼层','Total floors','number'],
      ['orientation','朝向','Orientation'],['elevator','是否有电梯','Elevator','boolean'],['decoration','装修情况','Decoration'],['occupancy','当前居住状态','Occupancy','occupancy'],
    ]],
    ['出售相关信息','Sale details',[
      ['reason','出售原因（可选、仅草稿可见）','Reason for sale (optional, private)'],['priceWan','期望售价（万元人民币）','Asking price (CNY 10,000)','number'],
    ]],
  ];
  const tr = (zh,en)=>window.Nexthome.getLanguage()==='en'?en:zh;
  const node=(tag,text,cls)=>{const e=document.createElement(tag);if(text!=null)e.textContent=text;if(cls)e.className=cls;return e;};
  const button=(zh,en,fn)=>{const b=node('button',tr(zh,en),'dialog-cancel');b.type='button';b.onclick=fn;return b;};
  let data=null, hooks=null, currentKey=null, returnFocus=null, busy=false, error=null;
  const buffers=new Map(), shown=new Set();
  let inertBefore=[], oldOverflow='';
  const overlay=node('div',null,'listing-modal listing-review-overlay');overlay.id='listingReview';overlay.hidden=true;
  const dialog=node('section',null,'listing-review-dialog');dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');dialog.setAttribute('aria-labelledby','listingReviewTitle');
  const header=node('header',null,'home-panel-header'), title=node('h2');title.id='listingReviewTitle';
  const close=button('×','×',()=>hide());close.className='icon-button';header.append(title,close);
  const form=node('form',null,'listing-review-form');form.noValidate=true;
  const body=node('div',null,'listing-review-body'), message=node('p',null,'listing-review-status');message.id='listingReviewStatus';message.setAttribute('role','status');message.setAttribute('aria-live','polite');
  const footer=node('footer',null,'listing-review-actions');
  const back=button('返回修改','Back to chat',()=>hide()), save=node('button',null,'dialog-submit');save.type='submit';
  const publish=button('前往公开挂牌','Continue to public listing',()=>{hide();hooks.publish?.(data);});
  footer.append(back,save,publish);form.append(body,message,footer);dialog.append(header,form);overlay.append(dialog);document.body.append(overlay);
  const dirty=()=>buffers.get(currentKey)||{};
  function setBusy(value){busy=value;form.setAttribute('aria-busy',String(value));form.querySelectorAll('input,select,button').forEach(e=>e.disabled=value);close.disabled=false;back.disabled=false;save.textContent=value?tr('保存中…','Saving…'):tr('确认保存','Confirm save');}
  function hide(reset=false){
    if(overlay.hidden)return;
    overlay.hidden=true;inertBefore.forEach(([e,v])=>e.inert=v);inertBefore=[];document.body.style.overflow=oldOverflow;
    if(!reset)returnFocus?.focus();
  }
  function show(){
    if(!data?.workflow?.active)return;
    if(overlay.hidden){returnFocus=document.activeElement;oldOverflow=document.body.style.overflow;
      inertBefore=[...document.body.children].filter(e=>e!==overlay&&e.tagName!=='SCRIPT').map(e=>[e,e.inert]);inertBefore.forEach(([e])=>e.inert=true);
    }
    overlay.hidden=false;document.body.style.overflow='hidden';renderDialog();close.focus();
  }
  function renderDialog(){
    const previousFocus=document.activeElement?.dataset?.listingField;
    title.textContent=tr('挂牌信息','Listing information');close.setAttribute('aria-label',tr('关闭挂牌信息','Close listing information'));
    back.textContent=tr('返回修改','Back to chat');publish.textContent=tr('前往公开挂牌','Continue to public listing');
    body.replaceChildren();body.append(node('p',tr('核对后保存为私密房源草稿。详细地址不会默认公开；公开挂牌需另行提交确认。','Review and save a private listing draft. Detailed addresses are not public by default. Public listing requires a separate submission.'),'seller-privacy'));
    for(const [zh,en,fields] of groups){
      const section=node('fieldset');section.append(node('legend',tr(zh,en)));
      for(const [key,zhLabel,enLabel,type] of fields){
        const label=node('label',tr(zhLabel,enLabel),'listing-review-field');label.htmlFor=`listing-${key}`;
        const input=node(type==='boolean'||type==='occupancy'?'select':'input');input.id=`listing-${key}`;input.dataset.listingField=key;input.required=key!=='reason';
        if(type==='boolean'||type==='occupancy'){
          const choices=type==='boolean'?[['','待补充','To add'],['true','有','Yes'],['false','无','No']]:[['','待补充','To add'],['自住','自住','Owner-occupied'],['空置','空置','Vacant'],['出租','出租','Rented']];
          for(const [value,zhText,enText]of choices){const option=node('option',tr(zhText,enText));option.value=value;input.append(option);}
        }else{input.type=type||'text';input.maxLength=500;if(type==='number'){input.min=key.startsWith('floor')?'1':'0.01';input.max=key.startsWith('floor')?'1000':key==='areaSqm'?'100000':'1000000';input.step=key.startsWith('floor')?'1':'any';}}
        let value=Object.hasOwn(dirty(),key)?dirty()[key]:data.fields[key];
        if(type==='occupancy')value=({'owner-occupied':'自住',vacant:'空置',rented:'出租'})[value]||value;
        input.value=value==null?'':String(value);input.placeholder=tr('待补充','To add');
        input.oninput=()=>{input.setCustomValidity('');const next=input.value.trim();buffers.set(currentKey,{...dirty(),[key]:!next?null:type==='number'?Number(next):type==='boolean'?next==='true':next});publish.hidden=true;error=null;message.textContent=tr('有修改，确认保存后更新私密房源草稿。','Changes will update the private listing draft after confirmation.');};
        if(data.pending?.[key]!=null){const hint=node('small',tr('存在待确认冲突，请核对并修改此项。','A conflicting value needs your confirmation. Edit this field to resolve it.'));label.append(hint);}
        label.append(input);section.append(label);
      }
      body.append(section);
    }
    if(data.fields.replacement)body.append(node('p',`${tr('置换需求：','Replacement plans: ')}${data.fields.replacement}`));
    const saved=data.savedDraft && data.savedDraft.source_revision===data.revision && !Object.keys(dirty()).length;
    message.dataset.kind=error?'error':'info';message.textContent=error?tr(...error):saved?tr('已保存私密房源草稿，尚未公开发布。','Private listing draft saved. It has not been published.'):tr('面积使用平方米；售价使用万元人民币，例如 500 表示 500 万元。','Area uses m². Price uses CNY 10,000: 500 means CNY 5 million.');
    publish.hidden=!saved;setBusy(busy);if(previousFocus)body.querySelector(`[data-listing-field="${previousFocus}"]`)?.focus();
  }
  form.onsubmit=async event=>{
    event.preventDefault();if(busy||!data)return;
    const floor=body.querySelector('[data-listing-field="floorLevel"]'),total=body.querySelector('[data-listing-field="floorTotal"]');
    floor.setCustomValidity(Number(floor.value)>Number(total.value)?tr('所在楼层不能高于总楼层。','Floor cannot exceed total floors.'):'');
    if(!form.reportValidity())return;
    const key=currentKey,owner=window.Nexthome.getUser()?.id;setBusy(true);error=null;message.textContent=tr('正在保存私密草稿…','Saving private draft…');
    try{
      const fields={};body.querySelectorAll('[data-listing-field]').forEach(input=>{const k=input.dataset.listingField;fields[k]=k==='reason'&&!input.value.trim()?null:input.tagName==='SELECT'&&k==='elevator'?input.value==='true':input.type==='number'?Number(input.value):input.value.trim();});
      const latest=await hooks.confirm(fields,data.revision);
      if(key!==currentKey||owner!==window.Nexthome.getUser()?.id)return;
      data=latest;buffers.delete(key);error=null;
    }catch(e){if(key===currentKey&&owner===window.Nexthome.getUser()?.id)error=e.copy||[e.message,e.message];}
    finally{busy=false;if(key===currentKey&&!overlay.hidden){renderDialog();save.focus();}}
  };
  overlay.onclick=event=>{if(event.target===overlay)hide();};
  dialog.onkeydown=event=>{
    if(event.key==='Escape'){event.preventDefault();event.stopPropagation();hide();}
    if(event.key==='Tab'){const controls=[...dialog.querySelectorAll('button,input,select')].filter(e=>!e.disabled&&!e.closest('[hidden]'));const i=controls.indexOf(document.activeElement);if(event.shiftKey&&i<=0){event.preventDefault();controls.at(-1)?.focus();}else if(!event.shiftKey&&(i<0||i===controls.length-1)){event.preventDefault();controls[0]?.focus();}event.stopPropagation();}
  };
  window.NexthomeSelling={
    hide,
    reset(){hide(true);buffers.clear();shown.clear();data=null;currentKey=null;error=null;busy=false;},
    open:show,
    render(container,next,callbacks){
      const owner=window.Nexthome.getUser()?.id,key=`${owner}:${next?.propertyId||'primary'}`;
      if(key!==currentKey){hide(true);currentKey=key;error=null;}
      else if(data&&next){const edits={...dirty()};for(const field of Object.keys(edits))if(data.fields[field]!==next.fields[field])delete edits[field];buffers.set(key,edits);}
      data=next;hooks=callbacks;container.replaceChildren();
      if(!owner||!data){container.hidden=true;return;}
      container.hidden=false;
      const tools=node('div',null,'listing-draft-tools');
      const label=node('label',tr('当前房屋','Current home'));const select=node('select');select.setAttribute('aria-label',tr('选择房屋草稿','Select property draft'));
      for(const property of data.properties||[{propertyId:data.propertyId||'primary',label:tr('当前房屋','Current home')}]){const option=node('option',property.label||tr(`房屋 ${property.number}`,`Home ${property.number}`));option.value=property.propertyId;select.append(option);}select.value=data.propertyId||'primary';select.disabled=callbacks.pending||busy;
      select.onchange=()=>callbacks.select(select.value);label.append(select);tools.append(label,button('新增房屋','Add a home',()=>callbacks.select(`home-${crypto.randomUUID()}`)));
      tools.lastChild.disabled=callbacks.pending||busy;
      if(data.workflow?.active&&(data.workflow.reviewed||data.validation?.complete))tools.append(button('查看挂牌信息','View listing information',show));
      if(data.fields.replacement)tools.append(button('继续规划买房 →','Plan your next purchase →',callbacks.buy));
      container.append(tools);
      if(!overlay.hidden)renderDialog();
      if(data.workflow?.active&&data.validation?.complete&&!data.workflow.reviewed&&!shown.has(key)){
        shown.add(key);show();callbacks.review().catch(()=>{});
      }
    },
  };
})();
