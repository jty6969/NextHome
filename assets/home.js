(() => {
  'use strict';
  const site = window.Nexthome;
  const advisor = window.NexthomeAdvisor;
  if (!site || !advisor) return;
  const get = id => document.getElementById(id);
  const tr = (zh, en) => site.getLanguage() === 'en' ? en : zh;
  const el = (tag, text, className) => {
    const element = document.createElement(tag);
    if (text != null) element.textContent = text;
    if (className) element.className = className;
    return element;
  };
  const input = get('homeInput'), form = get('homeComposer'), send = get('homeSend');
  const voice = get('homeVoice'), quickMenu = get('homeQuickMenu'), plus = get('homePlus');
  const sidebar = get('homeSidebar'), toggle = get('sidebarToggle');
  const accountButton = get('authButton'), status = get('homeStatus');
  const messages = get('homeConversation'), welcome = get('homeWelcome');
  let recognition = null, selected = 'new';
  let panelFocus = null, panelType = null, panelRevision = 0, historyRows = [], historyLoading = false, historyError = null;
  let homeOwner = site.getUser()?.id || null;
  let mode = 'buy', ownerRevision = 0, propertySwitch = false;
  const freshMode = () => ({messages: [], draft: '', request: null, pending: false, notice: null, version: 0, draftVersion: 0, loaded: false, loading: null});
  let modes = {buy: freshMode(), sell: freshMode()}, sellerData = null, sellerProperty = 'primary';
  function restoreProperty(){try{const id=localStorage.getItem('nexthome.selling.'+homeOwner);if(/^[\w-]{1,80}$/.test(id||''))sellerProperty=id;}catch{}}
  restoreProperty();
  const active = () => modes[mode];
  const draftTimers = new Map(), draftQueues = new Map();
  const requestKey = (owner, property) => `nexthome.send.${owner}:sell:${property}`;
  function readSendRequest(owner, property) {
    try {const value=JSON.parse(localStorage.getItem(requestKey(owner,property)));return /^[\w-]{1,80}$/.test(value?.requestId||'')&&typeof value.message==='string'?value:null;} catch {return null;}
  }
  function forgetSendRequest(owner, property, requestId) {
    try {if(!requestId||readSendRequest(owner,property)?.requestId===requestId)localStorage.removeItem(requestKey(owner,property));}catch{}
  }
  function sellerRequest(target, message, owner, property) {
    const previous=target.request||readSendRequest(owner,property);
    const value=previous?.message===message?previous:{requestId:crypto.randomUUID(),message};
    target.request=value;try{localStorage.setItem(requestKey(owner,property),JSON.stringify(value));}catch{}
    return value.requestId;
  }

  function persistDraft(targetMode = mode) {
    if (!site.getUser()) return;
    if (!modes[targetMode].loaded && !modes[targetMode].draftVersion) return;
    const owner = site.getUser().id, revision = ownerRevision, value = modes[targetMode].draft;
    const property=targetMode==='sell'?sellerProperty:'primary';
    const key = `${owner}:${targetMode}:${property}`;
    clearTimeout(draftTimers.get(key));
    // Serialize writes per account/mode so older drafts never arrive last.
    const write = (draftQueues.get(key) || Promise.resolve()).catch(() => {}).then(async () => {
      if (ownerRevision !== revision || site.getUser()?.id !== owner) return;
      await advisor.saveDraft(targetMode, value, property);
    });
    draftQueues.set(key, write);
    write.catch(() => { if (ownerRevision === revision && mode === targetMode && !active().pending && active().notice?.[2]!=='error') setNotice('草稿暂未同步，请保留此页面后重试。', 'Draft has not synced. Keep this page open and retry.', 'error'); });
    return write;
  }
  function rememberInput() {
    active().draft = input.value; active().draftVersion++;
    if (!homeOwner) return;
    if(mode==='sell'&&(active().request||readSendRequest(homeOwner,sellerProperty))?.message!==input.value.trim()){
      active().request=null;forgetSendRequest(homeOwner,sellerProperty);
    }
    const key = `${homeOwner}:${mode}:${mode==='sell'?sellerProperty:'primary'}`, targetMode = mode;
    clearTimeout(draftTimers.get(key)); draftTimers.set(key, setTimeout(() => persistDraft(targetMode), 350));
  }
  async function selectSellerProperty(id) {
    if(modes.sell.pending||propertySwitch)return;
    propertySwitch=true;updateComposer();
    const generation=ownerRevision;
    if(mode==='sell'){modes.sell.draft=input.value;try{await persistDraft('sell');}catch{propertySwitch=false;updateComposer();return;}}
    if(generation!==ownerRevision||mode!=='sell'){propertySwitch=false;updateComposer();return;}
    window.NexthomeSelling.hide(true);sellerProperty=id;sellerData=null;modes.sell=freshMode();
    try{localStorage.setItem('nexthome.selling.'+homeOwner,id);}catch{}
    input.value='';renderConversation();renderSeller();try{await loadMode('sell');}finally{propertySwitch=false;updateComposer();renderSeller();}
  }
  function renderSeller() {
    const container=get('sellerProfile');container.hidden=mode!=='sell';
    if(mode!=='sell'||!window.NexthomeSelling)return;
    const generation=ownerRevision,owner=homeOwner,property=sellerProperty;
    const current=()=>generation===ownerRevision&&owner===homeOwner&&property===sellerProperty;
    window.NexthomeSelling.render(container,sellerData,{
      pending:modes.sell.pending||propertySwitch, buy:()=>switchMode('buy'), select:selectSellerProperty,
      review:async()=>{const latest=await advisor.reviewSelling(property);if(current()&&latest.revision>=sellerData.revision){sellerData=latest;if(mode==='sell')renderSeller();}},
      confirm:async(fields,revision)=>{
        try{
          const changed=Object.fromEntries(Object.entries(fields).filter(([key,value])=>sellerData.fields[key]!==value||Object.hasOwn(sellerData.pending||{},key)));
          let latest=sellerData;
          if(Object.keys(changed).length)latest=await advisor.saveSelling({propertyId:property,fields:changed,revision});
          if(!current())throw Error(tr('账号或房屋已切换。','Account or property changed.'));
          sellerData=latest;
          const saved=await advisor.confirmSelling({propertyId:property,revision:latest.revision,confirm:true});
          if(!current())throw Error(tr('账号或房屋已切换。','Account or property changed.'));
          sellerData=saved;
          if(mode==='sell')setNotice('私密房源草稿已保存，尚未公开发布。','Private listing draft saved. It has not been published.');
          return saved;
        }catch(error){
          if(current())try{const latest=await advisor.getSelling(property);if(current()){sellerData=latest;if(mode==='sell')renderSeller();}}catch{}
          throw error;
        }
      },
      publish:()=>{
        // Reuse the existing explicit public submission. Never copy a private door number.
        get('openListingModal').click();
        const address=get('propertyAddress');if(address)address.value=[sellerData.fields.city,sellerData.fields.district,sellerData.fields.community].filter(Boolean).join(' ');
      },
    });
  }
  async function loadMode(targetMode, force = false) {
    if (!homeOwner) { renderSeller(); return; }
    const target = modes[targetMode], generation = ownerRevision, version = target.version, property=sellerProperty;
    if (target.loading) return target.loading;
    if (target.loaded && !force) return;
    target.loading = (async () => {
      try {
        const [data, draft] = await Promise.all([targetMode === 'sell' ? advisor.getSelling(property) : advisor.getHistory(), advisor.getDraft(targetMode,targetMode==='sell'?property:'primary')]);
        if (generation !== ownerRevision || (targetMode==='sell'&&property!==sellerProperty)) return;
        if (targetMode === 'sell' && (!sellerData || data.revision>=sellerData.revision)) sellerData = data;
        if (version === target.version && !target.pending) {
          target.messages = targetMode === 'sell' ? data.chatHistory : data;
        }
        if (!target.draftVersion) target.draft = draft.draft || '';
        target.loaded = true;
        if (mode === targetMode) {input.value=target.draft;renderConversation({animateLayout:false});renderSeller();updateComposer();}
      } catch (error) {
        if (generation === ownerRevision && mode === targetMode) setNotice('历史或草稿加载失败，可切换回来重试。', 'History or draft could not load. Switch back to retry.', 'error');
      } finally { target.loading = null; }
    })();
    return target.loading;
  }
  function modeCopy() {
    const selling = mode === 'sell';
    get('sellMode').textContent = tr('卖房','Sell'); get('buyMode').textContent = tr('买房','Buy');
    get('assistantMode').setAttribute('aria-label', tr('助手模式','Assistant mode'));
    get('homeTitle').textContent = selling ? tr('让卖房更有计划','A clearer plan to sell') : tr('下一站，理想的家','Your next stop, a better home');
    document.querySelector('.home-subtitle').textContent = selling ? tr('从房屋情况到交房安排，一步步理清出售计划','From your property to handover, plan one step at a time') : tr('从一个问题开始，找到适合你的家','Start with a question. Find a home that fits you.');
    input.placeholder = selling ? tr('描述你想出售的房子，或告诉我你的卖房计划','Describe the home you want to sell, or your selling plans') : tr('询问购房助手','Ask your home advisor');
    input.setAttribute('aria-label',input.placeholder);form.setAttribute('aria-label',input.placeholder);
    document.querySelector('.home-hint').textContent = selling ? tr('先聊聊房子和出售目标，每次只补充一两项','Start with your home and sale goals. One or two details at a time.') : tr('描述预算、区域或通勤需求，让找房更有方向','Share your budget, location or commute to guide your search');
    const profileAction=document.querySelector('[data-home-action="profile"]');profileAction.hidden=selling;profileAction.textContent=tr('编辑购房需求','Edit buyer brief');
  }
  function switchMode(next) {
    if (next === mode) return;
    active().draft=input.value; persistDraft(); stopSpeech(); closeMenu(quickMenu,plus);
    mode=next;
    if(mode!=='sell')window.NexthomeSelling.hide(true);
    get('assistantMode').dataset.mode=mode;
    get('assistantMode').querySelectorAll('[role="tab"]').forEach(button=>{const selected=button.dataset.mode===mode;button.setAttribute('aria-selected',String(selected));button.tabIndex=selected?0:-1;});
    get('assistantContent').setAttribute('aria-labelledby',`${mode}Mode`);
    get('assistantContent').classList.remove('mode-enter'); void get('assistantContent').offsetWidth; get('assistantContent').classList.add('mode-enter');
    input.value=active().draft;modeCopy();renderConversation();renderSeller();updateComposer();
    status.hidden=!active().notice; status.textContent=active().notice?tr(...active().notice):''; status.dataset.kind=active().notice?.[2]||'info';
    loadMode(mode);
  }
  get('assistantMode').addEventListener('click',event=>{const tab=event.target.closest('[role="tab"]');if(tab)switchMode(tab.dataset.mode);});
  get('assistantMode').addEventListener('keydown',event=>{
    if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
    event.preventDefault();const next=event.key==='Home'?'sell':event.key==='End'?'buy':mode==='buy'?'sell':'buy';
    switchMode(next);get(`${next}Mode`).focus();
  });

  const accountMenu = el('div', null, 'home-popover account-menu');
  accountMenu.id = 'homeAccountMenu'; accountMenu.hidden = true;
  accountMenu.setAttribute('role', 'menu');
  const accountInfo = el('button'); accountInfo.type = 'button'; accountInfo.setAttribute('role', 'menuitem');
  const accountLogout = el('button'); accountLogout.type = 'button'; accountLogout.setAttribute('role', 'menuitem');
  accountMenu.append(accountInfo, accountLogout); document.querySelector('.header-inner').append(accountMenu);
  accountInfo.addEventListener('click', () => { closeMenu(accountMenu, accountButton); site.login(); });
  accountLogout.addEventListener('click', () => {
    closeMenu(accountMenu, accountButton);
    // The existing account dialog owns the logout request and recoverable errors.
    site.login(); get('logoutButton').click();
  });

  const panelOverlay = el('div', null, 'listing-modal home-panel-overlay');
  panelOverlay.id = 'homePanelOverlay'; panelOverlay.hidden = true;
  const panel = el('section', null, 'home-panel');
  panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-labelledby', 'homePanelTitle');
  const panelHeader = el('header', null, 'home-panel-header');
  const panelTitle = el('h2'); panelTitle.id = 'homePanelTitle';
  const panelClose = el('button', '×', 'icon-button'); panelClose.type = 'button';
  const panelBody = el('div', null, 'home-panel-body');
  panelHeader.append(panelTitle, panelClose); panel.append(panelHeader, panelBody);
  panelOverlay.append(panel); document.body.append(panelOverlay);
  panelClose.addEventListener('click', closePanel);
  panelOverlay.addEventListener('click', event => { if (event.target === panelOverlay) closePanel(); });

  function actionButton(zh, en, action) {
    const button = el('button', tr(zh, en), 'dialog-cancel'); button.type = 'button';
    button.addEventListener('click', action); return button;
  }
  function setNotice(zh, en, kind = 'info') {
    active().notice = zh ? [zh, en, kind] : null;
    status.hidden = !active().notice;
    status.textContent = active().notice ? tr(zh, en) : '';
    status.dataset.kind = kind;
  }
  function updateComposer() {
    const pending=active().pending||(mode==='sell'&&propertySwitch);
    const filled = Boolean(input.value.trim());
    send.hidden = !filled && !pending;
    send.disabled = pending;
    voice.hidden = filled && !recognition;
    input.readOnly = pending;
    plus.disabled = pending; voice.disabled = pending;
    form.setAttribute('aria-busy', String(pending));
    send.setAttribute('aria-label', pending ? tr('发送中', 'Sending') : tr('发送', 'Send'));
    voice.setAttribute('aria-pressed', String(Boolean(recognition)));
    voice.setAttribute('aria-label', recognition ? tr('停止录音', 'Stop recording') : tr('语音输入', 'Voice input'));
    input.style.height = '28px';
    input.style.height = `${Math.min(160, Math.max(28, input.scrollHeight))}px`;
    document.querySelector('[data-home-action="new"]').disabled = pending;
  }
  function setSelected(action) {
    selected = action;
    sidebar.querySelectorAll('[data-home-action]').forEach(button => {
      if (button.dataset.homeAction === action) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
  }
  function stopSpeech() {
    const active = recognition; recognition = null;
    active?.abort(); updateComposer();
  }
  function renderMessages(container, rows) {
    container.replaceChildren();
    for (const message of rows) {
      const bubble = el('article', null, 'home-message'); bubble.dataset.role = message.role;
      bubble.append(el('span', message.role === 'user' ? tr('你', 'You') : 'NextHome', 'message-label'));
      bubble.append(el('p', message.content));
      if(message.delivery==='pending')bubble.append(el('span',tr('发送中…','Sending…'),'message-delivery'));
      if(message.delivery==='failed'){
        bubble.append(el('span',tr('发送未完成，内容已保留。','Send did not complete. Your message is kept.'),'message-delivery message-failed'));
        const retry=actionButton('重试发送','Retry send',()=>{
          if(active().pending)return;
          input.value=message.content;rememberInput();form.requestSubmit();
        });retry.disabled=active().pending;bubble.append(retry);
      }
      for (const id of new Set([...message.content.matchAll(/\[([\w-]+)\]/g)].map(match => match[1]))) {
        const property = site.getListings().find(row => row.id === id);
        if (!property) continue;
        const button = actionButton(property.listingTitle || property.address || id, property.listingTitle || property.address || id,
          () => { if (!panelOverlay.hidden) closePanel(); site.openProperty(id); });
        button.className = 'property-reference'; bubble.append(button);
      }
      container.append(bubble);
    }
  }
  function renderConversation({animateLayout = true} = {}) {
    const page = get('assistantPage'), chatting = active().messages.length > 0;
    // Keep one tablist in the document so moving it never loses keyboard focus.
    if (!animateLayout) page.classList.add('layout-snap');
    page.classList.toggle('has-conversation', chatting);
    renderMessages(messages, active().messages);
    messages.hidden = !chatting;
    welcome.inert = chatting;
    welcome.setAttribute('aria-hidden', String(chatting));
    document.querySelector('.home-hint').setAttribute('aria-hidden', String(chatting));
    if (!animateLayout) {
      void page.offsetHeight;
      page.classList.remove('layout-snap');
    }
    messages.scrollTop = messages.scrollHeight;
  }
  function closeMenu(menu, opener, focus = false) {
    menu.hidden = true; opener.setAttribute('aria-expanded', 'false');
    if (focus) opener.focus();
  }
  function openMenu(menu, opener) {
    closeMenu(quickMenu, plus); closeMenu(accountMenu, accountButton);
    menu.hidden = false; opener.setAttribute('aria-expanded', 'true');
    menu.querySelector('button')?.focus();
  }
  function menuKeys(event, menu, opener) {
    if (menu.hidden) return;
    const buttons = [...menu.querySelectorAll('button:not(:disabled)')];
    const index = buttons.indexOf(document.activeElement);
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
        : (index + (event.key === 'ArrowUp' ? -1 : 1) + buttons.length) % buttons.length;
      buttons[next]?.focus();
    } else if (event.key === 'Escape') {
      event.preventDefault(); event.stopPropagation(); closeMenu(menu, opener, true);
    } else if (event.key === 'Tab') closeMenu(menu, opener);
  }
  plus.addEventListener('click', () => quickMenu.hidden ? openMenu(quickMenu, plus) : closeMenu(quickMenu, plus));
  quickMenu.addEventListener('keydown', event => menuKeys(event, quickMenu, plus));
  accountMenu.addEventListener('keydown', event => menuKeys(event, accountMenu, accountButton));
  document.addEventListener('click', event => {
    if (!quickMenu.contains(event.target) && !plus.contains(event.target)) closeMenu(quickMenu, plus);
    if (!accountMenu.contains(event.target) && !accountButton.contains(event.target)) closeMenu(accountMenu, accountButton);
  });
  [plus, accountButton].forEach(opener => opener.addEventListener('keydown', event => {
    if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return;
    if (opener === accountButton && !site.getUser()) return;
    event.preventDefault(); openMenu(opener === plus ? quickMenu : accountMenu, opener);
  }));

  function setExpanded(expanded) {
    document.body.classList.toggle('sidebar-expanded', expanded);
    toggle.setAttribute('aria-expanded', String(expanded));
    const label = expanded ? tr('收起侧边栏', 'Collapse sidebar') : tr('展开侧边栏', 'Expand sidebar');
    toggle.setAttribute('aria-label', label); toggle.querySelector('.rail-label').textContent = label;
    try { localStorage.setItem('nexthome.sidebar', String(expanded)); } catch { /* Optional preference. */ }
  }
  toggle.addEventListener('click', () => setExpanded(toggle.getAttribute('aria-expanded') !== 'true'));
  try { setExpanded(localStorage.getItem('nexthome.sidebar') === 'true'); } catch { setExpanded(false); }

  function backgroundInert(value) {
    document.querySelectorAll('#homePage,#detailPage,.home-sidebar,.footer,.header-actions > button').forEach(element => element.inert = value);
  }
  function closePanel() {
    panelRevision++;
    panelOverlay.hidden = true; panelType = null;
    document.body.style.overflow = ''; backgroundInert(false); panelFocus?.focus();
    syncRoute();
  }
  function renderPanel() {
    panelTitle.textContent = panelType === 'history' ? tr('历史记录', 'History') : tr('设置', 'Settings');
    panelClose.setAttribute('aria-label', tr('关闭', 'Close'));
    panelBody.replaceChildren();
    if (panelType === 'history') {
      if (historyLoading) panelBody.append(el('p', tr('加载中…', 'Loading…')));
      else if (historyError) panelBody.append(el('p', tr(...historyError)), actionButton('重试', 'Retry', () => showPanel('history')));
      else if (!site.getUser()) {
        panelBody.append(el('p', tr('登录后查看你的 AI 对话历史。', 'Sign in to view your AI conversation history.')),
          actionButton('登录 / 注册', 'Sign in / Register', () => { closePanel(); site.login(); }));
      } else if (!historyRows.length) panelBody.append(el('p', tr('暂无对话记录。', 'No conversations yet.')));
      else {
        panelBody.append(actionButton('继续对话', 'Continue conversation', () => {
          active().messages = historyRows.map(row => ({ ...row })); closePanel(); site.showHome();
          renderConversation({animateLayout:false}); input.focus({preventScroll:true});
        }));
        const history = el('div'); renderMessages(history, historyRows); panelBody.append(history);
      }
    } else {
      panelBody.append(el('p', tr('语言选择和侧边栏偏好会保存在此浏览器。', 'Your language and sidebar preferences are saved in this browser.')));
      const languages = el('div', null, 'settings-actions');
      for (const [value, label] of [['zh-CN', '简体中文'], ['en', 'English']]) {
        const button = actionButton(label, value === 'en' ? 'English' : 'Chinese', () => site.setLanguage(value));
        button.setAttribute('aria-pressed', String(site.getLanguage() === value)); languages.append(button);
      }
      const actions = el('div', null, 'settings-actions');
      actions.append(actionButton('账号与安全', 'Account & security', () => { closePanel(); site.login(); }),
        ...(mode==='buy'?[actionButton('编辑购房需求','Edit buyer brief',()=>{closePanel();advisor.show('profile');})]:[]),
        actionButton('购房与交易工作台', 'Home buying workspace', () => { closePanel(); advisor.show(site.getUser()?.role === 'seller' ? 'seller' : 'chat'); }));
      panelBody.append(languages, actions);
    }
  }
  async function showPanel(type) {
    stopSpeech(); panelFocus = document.activeElement; panelType = type; historyRows = []; historyError = null;
    historyLoading = type === 'history' && Boolean(site.getUser());
    const revision = ++panelRevision;
    panelOverlay.hidden = false; document.body.style.overflow = 'hidden'; backgroundInert(true);
    setSelected(type); renderPanel(); panelClose.focus();
    if (type === 'history' && site.getUser()) {
      try {
        const rows = mode === 'sell' ? (await advisor.getSelling(sellerProperty)).chatHistory : await advisor.getHistory();
        if (revision !== panelRevision) return;
        historyLoading = false; historyRows = rows; renderPanel();
      } catch (error) {
        if (revision !== panelRevision) return;
        historyLoading = false; historyError = error.copy || [error.message, error.message]; renderPanel();
      }
    }
  }
  function syncRoute() {
    const url = new URL(location.href);
    setSelected(url.searchParams.get('view') === 'map' ? 'map'
      : url.searchParams.has('listing') || url.searchParams.get('view') === 'list' || url.hash === '#listings' ? 'list' : 'new');
  }
  document.querySelectorAll('[data-home-action]').forEach(button => button.addEventListener('click', async () => {
    const action = button.dataset.homeAction;
    closeMenu(quickMenu, plus); stopSpeech();
    if (window.innerWidth <= 680) setExpanded(false);
    if (action === 'new') {
      if (active().pending) return;
      active().version++;active().draftVersion++; active().messages = []; active().draft=''; input.value = ''; persistDraft(); setNotice(); site.showHome(); renderConversation(); updateComposer(); input.focus({preventScroll:true});
    } else if (action === 'list') site.showResults();
    else if (action === 'map') get('openMap').click();
    else if (action === 'history' || action === 'settings') await showPanel(action);
    else if (action === 'listing') get('openListingModal').click();
    else if (action === 'profile' && mode === 'sell') {
      window.NexthomeSelling.open();
    } else {
      if (action === 'viewings') setSelected('viewings');
      await advisor.show(action === 'viewings' ? 'viewings' : action === 'profile' ? 'profile' : site.getUser()?.role === 'seller' ? 'seller' : 'chat');
    }
  }));

  input.addEventListener('input', () => { rememberInput(); if (!active().pending) setNotice(); updateComposer(); });
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); form.requestSubmit(); }
  });
  form.addEventListener('submit', async event => {
    event.preventDefault(); const message = input.value.trim();
    if (!message || active().pending || (mode==='sell'&&propertySwitch)) return;
    if (!site.getUser()) { site.login(); return; }
    stopSpeech(); const owner = site.getUser().id, generation=ownerRevision, targetMode=mode, target=active(), property=sellerProperty;
    const requestId=targetMode==='sell'?sellerRequest(target,message,owner,property):undefined;
    let userMessage=target.messages.at(-1);
    if(userMessage?.role!=='user'||userMessage.delivery!=='failed'||userMessage.content!==message){userMessage={role:'user',content:message};target.messages.push(userMessage);}
    userMessage.delivery='pending';
    target.version++;target.draftVersion++; target.draft=message; target.pending = true; persistDraft(); updateComposer();renderConversation();renderSeller(); setNotice('正在分析你的需求…', 'Analyzing your requirements…');
    try {
      const result = await advisor.sendMessage(message,targetMode,property,requestId);
      if (site.getUser()?.id !== owner || generation!==ownerRevision) return;
      userMessage.delivery='sent';
      if(targetMode==='sell'&&result.replayed&&Array.isArray(result.chatHistory))target.messages=result.chatHistory;
      else target.messages.push({ role: 'assistant', content: result.content });
      target.draft=''; target.request=null;target.notice=result.saved?['私密挂牌草稿已同步。','Private listing draft synced.','info']:null;
      const cleared=persistDraft(targetMode);
      // Keep the send ID until the empty draft is durable, including a reload after a lost response.
      if(targetMode==='sell')cleared?.then(()=>forgetSendRequest(owner,property,requestId)).catch(()=>{});
      if(targetMode==='sell')sellerData=result;
      if(mode===targetMode){input.value='';renderConversation();renderSeller();setNotice(...(target.notice||[]));}
    } catch (error) {
      if (site.getUser()?.id === owner && generation===ownerRevision) {
        userMessage.delivery='failed';
        target.notice=[...(error.copy || [error.message,error.message]),'error'];
        if(mode===targetMode){renderConversation();setNotice(...target.notice);}
      }
    } finally { target.pending = false; if(generation===ownerRevision&&mode===targetMode){updateComposer();renderConversation();renderSeller();} }
  });
  voice.addEventListener('click', () => {
    if (recognition) { stopSpeech(); setNotice(); return; }
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) { setNotice('此浏览器不支持语音输入，请使用文字。', 'Voice input is unavailable in this browser. Please type.', 'error'); return; }
    const microphone = new Recognition(); recognition = microphone;
    microphone.lang = site.getLanguage() === 'en' ? 'en-US' : 'zh-CN'; microphone.interimResults = false;
    microphone.onresult = event => {
      if (recognition !== microphone) return;
      const transcript = Array.from(event.results).filter(row => row.isFinal).map(row => row[0].transcript).join(' ');
      input.value = [input.value, transcript].filter(Boolean).join(' ').slice(0, 4000); rememberInput();updateComposer();
    };
    microphone.onerror = () => { if (recognition === microphone) setNotice('无法使用麦克风，请检查浏览器权限。', 'Microphone unavailable. Check browser permissions.', 'error'); };
    microphone.onend = () => { if (recognition === microphone) { recognition = null; if (active().notice?.[2] !== 'error') setNotice(); updateComposer(); } };
    try { microphone.start(); updateComposer(); setNotice('正在聆听，点击停止按钮结束录音。', 'Listening. Select stop to end recording.'); }
    catch { recognition = null; updateComposer(); setNotice('无法启动语音输入，请稍后重试。', 'Unable to start voice input. Please retry.', 'error'); }
  });
  function localize() {
    accountInfo.textContent = tr('账号信息', 'Account details'); accountLogout.textContent = tr('退出登录', 'Sign out');
    accountMenu.setAttribute('aria-label', tr('账号菜单', 'Account menu'));
    accountButton.setAttribute('aria-haspopup', site.getUser() ? 'menu' : 'dialog');
    accountButton.setAttribute('aria-controls', site.getUser() ? accountMenu.id : 'authModal');
    sidebar.querySelectorAll('[data-home-action]').forEach(button => {
      button.setAttribute('aria-label', button.querySelector('.rail-label').textContent);
    });
    modeCopy();renderSeller();setExpanded(toggle.getAttribute('aria-expanded') === 'true'); updateComposer(); renderConversation();
    if (active().notice) setNotice(...active().notice);
    if (!panelOverlay.hidden) renderPanel();
  }
  document.addEventListener('languagechange', () => { stopSpeech(); localize(); });
  document.addEventListener('nexthome-auth', () => {
    stopSpeech(); closeMenu(accountMenu, accountButton);
    const guestDraft=!homeOwner?input.value:'';
    ownerRevision++;propertySwitch=false; draftTimers.forEach(clearTimeout);draftTimers.clear();draftQueues.clear();
    window.NexthomeSelling.reset();modes={buy:freshMode(),sell:freshMode()};sellerData=null;sellerProperty='primary';get('sellerProfile').replaceChildren();
    homeOwner = site.getUser()?.id || null;restoreProperty(); input.value=guestDraft;active().draft=guestDraft;
    if(guestDraft){active().draftVersion++;persistDraft();}setNotice();
    if (!panelOverlay.hidden) closePanel(); localize();loadMode(mode);
  });
  document.addEventListener('nexthome-route', () => { stopSpeech(); closeMenu(quickMenu, plus); syncRoute(); });
  document.addEventListener('nexthome-advisor-close', syncRoute);
  window.addEventListener('resize', updateComposer);
  document.addEventListener('visibilitychange', () => { if (document.hidden) {stopSpeech();persistDraft();} });
  window.addEventListener('pagehide',()=>persistDraft());
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      if (!quickMenu.hidden) closeMenu(quickMenu, plus, true);
      else if (!accountMenu.hidden) closeMenu(accountMenu, accountButton, true);
      else if (!panelOverlay.hidden) closePanel();
      else if (recognition) { stopSpeech(); setNotice(); }
      else if (toggle.getAttribute('aria-expanded') === 'true') { setExpanded(false); toggle.focus(); }
    }
    const legacyModal = ['authModal','listingModal','adminModal'].map(get).find(modal => !modal.hidden);
    const activeDialog = !panelOverlay.hidden ? panel : legacyModal;
    if (event.key === 'Tab' && activeDialog) {
      const controls = [...get('languageSwitch').querySelectorAll('button'), ...activeDialog.querySelectorAll('button,a[href],input,textarea,select')]
        .filter(element => !element.disabled && !element.closest('[hidden]'));
      const i = controls.indexOf(document.activeElement);
      if (event.shiftKey && i <= 0) { event.preventDefault(); controls.at(-1)?.focus(); }
      else if (!event.shiftKey && (i < 0 || i === controls.length - 1)) { event.preventDefault(); controls[0]?.focus(); }
    }
  });
  window.NexthomeHome = { toggleAccount: () => {
    if (!site.getUser()) return;
    accountMenu.hidden ? openMenu(accountMenu, accountButton) : closeMenu(accountMenu, accountButton);
  } };
  const modalBackground = new MutationObserver(() => {
    const blocked = [...document.querySelectorAll('.listing-modal,.advisor-overlay,#mapModal')].some(modal => !modal.hidden);
    document.querySelectorAll('.home-sidebar,#homePage,#detailPage,.footer,.header-actions > button').forEach(element => element.inert = blocked);
    document.querySelector('.site-header').inert = !get('advisorOverlay').hidden;
    if (blocked) stopSpeech();
  });
  document.querySelectorAll('.listing-modal,.advisor-overlay,#mapModal').forEach(modal => modalBackground.observe(modal, { attributes: true, attributeFilter: ['hidden'] }));
  localize(); syncRoute();loadMode(mode);
})();
