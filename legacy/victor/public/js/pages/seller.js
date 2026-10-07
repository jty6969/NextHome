/* Nexthome - 卖家中心（双语：处理消息、看房申请、议价、交易流程） */
(function (global) {
  'use strict';

  var App = global.App;
  var Utils = App.Utils;
  var Auth = App.Auth;
  var esc = Utils.esc;

  var pollTimer = null;
  var currentTab = 'listings';
  var cache = { listings: [], threads: [], viewings: [], offers: [], deals: [] };

  function t(key, vars) { return App.I18n ? App.I18n.t(key, vars) : key; }
  function en() { return App.I18n && App.I18n.isEn(); }
  function langParam() { return { language: en() ? 'en' : 'zh' }; }

  App.Router.register('/seller', function () { render(); });

  function api(url, opts) {
    return Auth.request(url, opts).then(function (r) {
      return r.json().then(function (d) {
        if (!r.ok) throw new Error(d.error || t('auth.opFailed'));
        return d;
      });
    });
  }

  function post(url, body) {
    body = body || {};
    if (!body.language) body.language = en() ? 'en' : 'zh';
    return api(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
  }

  /* ============ 主框架 ============ */
  function render() {
    clearInterval(pollTimer);
    var u = Auth.getUser();
    var html = '' +
      '<div class="flex items-center justify-between mb-16">' +
        '<h2 style="font-size:20px;font-weight:600">' + t('seller.title') + '</h2>' +
        '<span style="color:#999;font-size:13px">' + t('seller.welcome', { name: esc(u.name) }) + '</span>' +
      '</div>' +
      '<div class="seller-tabs" style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap">' +
        tabBtn('listings', t('seller.tabListings')) +
        tabBtn('messages', t('seller.tabMessages')) +
        tabBtn('viewings', t('seller.tabViewings')) +
        tabBtn('offers', t('seller.tabOffers')) +
        tabBtn('deals', t('seller.tabDeals')) +
      '</div>' +
      '<div id="sellerBody"><div class="card card-pad">' + t('common.loading') + '</div></div>';
    document.getElementById('page').innerHTML = html;

    document.querySelectorAll('.seller-tabs [data-tab]').forEach(function (b) {
      b.onclick = function () { currentTab = b.getAttribute('data-tab'); render(); };
    });

    loadAndRender();
    // 每 5 秒自动刷新收件箱
    pollTimer = setInterval(function () {
      if (!document.getElementById('sellerBody')) { clearInterval(pollTimer); return; }
      if (currentTab !== 'thread') loadAndRender(true);
    }, 5000);
  }

  function tabBtn(key, label) {
    var active = currentTab === key || (key === 'messages' && currentTab === 'thread');
    var count = '';
    if (key === 'messages') {
      var unread = cache.threads.reduce(function (s, th) { return s + (th.unread || 0); }, 0);
      if (unread) count = ' <span class="tag tag-red">' + unread + '</span>';
    } else if (key === 'viewings') {
      var pv = cache.viewings.filter(function (v) { return v.status === 'pending'; }).length;
      if (pv) count = ' <span class="tag tag-red">' + pv + '</span>';
    } else if (key === 'offers') {
      var po = cache.offers.filter(function (o) { return o.status === 'pending'; }).length;
      if (po) count = ' <span class="tag tag-red">' + po + '</span>';
    }
    return '<button class="btn ' + (active ? 'btn-primary' : 'btn-outline') + ' btn-sm" data-tab="' + key + '">' + label + count + '</button>';
  }

  function loadAndRender(silent) {
    api('/api/seller/overview').then(function (d) {
      cache = d;
      renderBody();
    }).catch(function (e) {
      if (!silent) document.getElementById('sellerBody').innerHTML =
        '<div class="card card-pad" style="color:#c00">' + t('seller.loadFail') + esc(e.message) + '</div>';
    });
  }

  function renderBody() {
    // 重绘标签上的角标
    var tabsEl = document.querySelector('.seller-tabs');
    if (tabsEl) {
      tabsEl.innerHTML = [
        tabBtn('listings', t('seller.tabListings')),
        tabBtn('messages', t('seller.tabMessages')),
        tabBtn('viewings', t('seller.tabViewings')),
        tabBtn('offers', t('seller.tabOffers')),
        tabBtn('deals', t('seller.tabDeals'))
      ].join('');
      tabsEl.querySelectorAll('[data-tab]').forEach(function (b) {
        b.onclick = function () { currentTab = b.getAttribute('data-tab'); render(); };
      });
    }

    var body = document.getElementById('sellerBody');
    if (!body) return;
    if (currentTab === 'listings') body.innerHTML = renderListings();
    else if (currentTab === 'messages') body.innerHTML = renderThreads();
    else if (currentTab === 'viewings') body.innerHTML = renderViewings();
    else if (currentTab === 'offers') body.innerHTML = renderOffers();
    else if (currentTab === 'deals') body.innerHTML = renderDeals();
    else if (currentTab === 'thread') body.innerHTML = '<div class="card card-pad">' + t('common.loading') + '</div>';
    bindActions();
  }

  /* ============ 我的房源 ============ */
  function renderListings() {
    if (!cache.listings.length) return '<div class="card card-pad empty-state">' + t('seller.noListings') + '</div>';
    var html = '<div style="color:#999;font-size:13px;margin-bottom:8px">' + t('seller.listCount', { n: cache.listings.length }) + '</div>';
    html += cache.listings.map(function (p) {
      return '<div class="card card-pad mb-16">' +
        '<div class="flex items-center justify-between">' +
          '<div style="font-weight:600">' + esc(p.title) + '</div>' +
          '<div class="text-danger fw-bold" style="font-size:18px">' + App.I18n.wan(p.totalPrice) + '</div>' +
        '</div>' +
        '<div class="text-light" style="font-size:12px;margin-top:4px">' +
          p.area + '㎡ | ' + App.I18n.rooms(p.rooms) + ' | ' +
          App.I18n.floor(p.floor) + ' | ' + t('common.unitPrice') + App.I18n.unitPrice(p.unitPrice) +
        '</div>' +
      '</div>';
    }).join('');
    return html;
  }

  /* ============ 消息列表 ============ */
  function renderThreads() {
    if (!cache.threads.length) {
      return '<div class="card card-pad"><div class="empty-state"><div class="empty-state-icon">💬</div><p>' + t('seller.noThreads') + '</p><p style="font-size:13px;margin-top:4px">' + t('seller.noThreadsHint') + '</p></div></div>';
    }
    return cache.threads.map(function (th) {
      return '<div class="card card-pad mb-8" style="cursor:pointer" data-action="openThread" data-buyer="' + esc(th.buyerUsername) + '" data-prop="' + esc(th.propertyId) + '">' +
        '<div class="flex items-center justify-between">' +
          '<div style="font-weight:600">👤 ' + esc(th.buyerName) +
            (th.unread ? ' <span class="tag tag-red">' + t('seller.unreadSuffix', { n: th.unread }) + '</span>' : '') +
          '</div>' +
          '<span class="text-light" style="font-size:12px">' + (th.lastTime ? Utils.formatDate(th.lastTime) : '') + '</span>' +
        '</div>' +
        '<div class="text-light" style="font-size:12px;margin-top:4px">🏠 ' + esc(th.propertyTitle) + '</div>' +
        '<div style="font-size:13px;margin-top:4px;color:#555">' + esc(th.lastContent || '') + '</div>' +
      '</div>';
    }).join('');
  }

  /* ============ 会话详情 + 回复 ============ */
  function openThread(propId, buyer) {
    currentTab = 'thread';
    render();
    api('/api/seller/thread/' + propId + '/' + buyer).then(function (d) {
      var body = document.getElementById('sellerBody');
      if (!body) return;
      var msgs = (d.messages || []).map(function (m) {
        if (m.role === 'system') {
          return '<div style="text-align:center;color:#bbb;font-size:11px;padding:4px">--- ' + esc(m.content) + ' ---</div>';
        }
        var right = m.role === 'seller';
        var bubble = m.type === 'deal'
          ? '<div class="deal-card"><div class="deal-card-title">' + t('msg.dealTitle') + '</div>' +
            '<div class="deal-card-row"><span>' + (right ? t('seller.counterReply') : t('seller.buyerOfferLabel')) + '</span><span class="text-danger fw-bold">' +
            (m.deal ? (m.deal.price || '') : '') + ' ' + (en() ? 'wan' : '万') + '</span></div>' +
            (m.deal && m.deal.counterPrice ? '<div class="deal-card-row"><span>' + t('msg.dealCounter') + '</span><span class="fw-bold">' + m.deal.counterPrice + ' ' + (en() ? 'wan' : '万') + '</span></div>' : '') +
            '<div style="margin-top:6px"><span class="tag ' + dealTag(m.deal && m.deal.status) + '">' + dealText(m.deal && m.deal.status) + '</span></div></div>'
          : '<div class="chat-bubble ' + (right ? 'buyer' : 'seller') + '">' + esc(m.content) + '</div>';
        return '<div style="display:flex;gap:8px;flex-direction:' + (right ? 'row-reverse' : 'row') + ';margin-bottom:10px">' +
          '<div class="chat-avatar ' + (right ? 'avatar-user' : 'avatar-seller') + '">' + (right ? t('common.me') : t('common.buyer')) + '</div>' +
          '<div style="max-width:75%">' + bubble +
            '<div style="color:#ccc;font-size:10px;margin-top:2px">' + (m.time ? new Date(m.time).toLocaleString(en() ? 'en-US' : 'zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '') + '</div>' +
          '</div></div>';
      }).join('');

      body.innerHTML =
        '<div style="margin-bottom:12px"><button class="btn btn-outline btn-sm" data-action="backThreads">' + t('seller.backThreads') + '</button></div>' +
        '<div class="card mb-16"><div class="card-pad" style="border-bottom:1px solid #eee">' +
          '<div style="font-weight:600">👤 ' + esc(d.buyerName) + '</div>' +
          '<div class="text-light" style="font-size:12px">🏠 ' + esc(d.propertyTitle) + '</div>' +
        '</div>' +
        '<div id="threadMsgs" style="padding:16px;max-height:420px;overflow-y:auto">' + (msgs || '<div style="color:#999;text-align:center;padding:30px">' + t('seller.noMessages') + '</div>') + '</div>' +
        '<div class="chat-input-bar" style="position:static;border-top:1px solid #eee">' +
          '<textarea id="threadInput" placeholder="' + t('seller.replyPh') + '" rows="1"></textarea>' +
          '<button class="btn btn-primary" id="threadSend">' + t('common.send') + '</button>' +
        '</div></div>';

      var container = document.getElementById('threadMsgs');
      container.scrollTop = container.scrollHeight;

      document.querySelector('[data-action="backThreads"]').onclick = function () { currentTab = 'messages'; render(); };
      function sendReply() {
        var input = document.getElementById('threadInput');
        var text = input.value.trim();
        if (!text) return;
        input.value = '';
        var body2 = langParam();
        body2.buyerUsername = buyer; body2.propertyId = propId; body2.content = text;
        post('/api/seller/reply', body2).then(function () {
          Utils.toast(t('seller.replied'), 'success');
          openThread(propId, buyer);
        }).catch(function (e) { Utils.toast(e.message, 'error'); });
      }
      document.getElementById('threadSend').onclick = sendReply;
      document.getElementById('threadInput').onkeydown = function (e) {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendReply(); }
      };
    }).catch(function (e) {
      document.getElementById('sellerBody').innerHTML = '<div class="card card-pad" style="color:#c00">' + t('seller.loadFail') + esc(e.message) + '</div>';
    });
  }

  function dealTag(status) {
    return status === 'accepted' ? 'tag-green' : status === 'rejected' ? 'tag-red' : status === 'countered' ? 'tag-orange' : 'tag-yellow';
  }
  function dealText(status) {
    return status === 'accepted' ? t('msg.dealAccepted') : status === 'rejected' ? t('msg.dealRejected') : status === 'countered' ? t('msg.dealCountered') : t('msg.dealPending');
  }

  /* ============ 看房申请 ============ */
  function viewStatusMeta(status) {
    if (status === 'pending') return [t('view.s_pending'), 'tag-yellow'];
    if (status === 'confirmed') return [t('view.s_confirmed'), 'tag-green'];
    if (status === 'completed') return [t('view.s_completed'), 'tag-gray'];
    if (status === 'cancelled') return [en() ? 'Declined/Cancelled' : '已婉拒/取消', 'tag-red'];
    return [t('view.s_pending'), 'tag-yellow'];
  }

  function renderViewings() {
    if (!cache.viewings.length) {
      return '<div class="card card-pad"><div class="empty-state"><div class="empty-state-icon">📅</div><p>' + t('seller.noViewings') + '</p></div></div>';
    }
    return cache.viewings.slice().sort(function (a, b) {
      return (a.status === 'pending' ? 0 : 1) - (b.status === 'pending' ? 0 : 1);
    }).map(function (v) {
      var meta = viewStatusMeta(v.status);
      var actions = '';
      if (v.status === 'pending') {
        actions = '<div class="flex gap-8 mt-8">' +
          '<button class="btn btn-primary btn-sm" data-action="confirmView" data-buyer="' + esc(v.buyerUsername) + '" data-prop="' + esc(v.propertyId) + '" data-id="' + esc(v.id) + '">' + t('seller.confirmView') + '</button>' +
          '<button class="btn btn-danger btn-sm" data-action="rejectView" data-buyer="' + esc(v.buyerUsername) + '" data-prop="' + esc(v.propertyId) + '" data-id="' + esc(v.id) + '">' + t('seller.rejectView') + '</button>' +
        '</div>';
      }
      return '<div class="card card-pad mb-12">' +
        '<div class="flex items-center justify-between">' +
          '<div style="font-weight:600">👤 ' + esc(v.buyerName) + ' · ' + esc(v.propertyTitle) + '</div>' +
          '<span class="tag ' + meta[1] + '">' + meta[0] + '</span>' +
        '</div>' +
        '<div class="text-light" style="font-size:13px;margin-top:6px">📅 ' + esc(v.date) + '　⏰ ' + esc(v.timeSlot) + '</div>' +
        '<div style="font-size:13px;margin-top:4px">' + t('view.noteLabel') + esc(v.note || t('common.none')) + '</div>' +
        (v.sellerNote ? '<div style="font-size:13px;margin-top:4px;color:#888">' + t('seller.sellerNote') + esc(v.sellerNote) + '</div>' : '') +
        actions +
      '</div>';
    }).join('');
  }

  /* ============ 议价受理 ============ */
  function renderOffers() {
    if (!cache.offers.length) {
      return '<div class="card card-pad"><div class="empty-state"><div class="empty-state-icon">💰</div><p>' + t('seller.noOffers') + '</p></div></div>';
    }
    return cache.offers.slice().sort(function (a, b) {
      return (a.status === 'pending' ? 0 : 1) - (b.status === 'pending' ? 0 : 1);
    }).map(function (o) {
      var actions = '';
      if (o.status === 'pending') {
        actions = '<div class="flex gap-8 mt-8 flex-wrap">' +
          '<button class="btn btn-primary btn-sm" data-action="acceptOffer" data-buyer="' + esc(o.buyerUsername) + '" data-prop="' + esc(o.propertyId) + '">' + t('seller.acceptOffer') + '</button>' +
          '<button class="btn btn-outline btn-sm" data-action="counterOffer" data-buyer="' + esc(o.buyerUsername) + '" data-prop="' + esc(o.propertyId) + '" data-price="' + o.price + '" data-list="' + o.listPrice + '">' + t('seller.counterOffer') + '</button>' +
          '<button class="btn btn-danger btn-sm" data-action="rejectOffer" data-buyer="' + esc(o.buyerUsername) + '" data-prop="' + esc(o.propertyId) + '">' + t('seller.rejectOffer') + '</button>' +
        '</div>';
      }
      var nearText = o.price >= o.listPrice * 0.93
        ? t('seller.nearList')
        : t('seller.pctOfList', { n: Math.round(o.price / o.listPrice * 100) });
      return '<div class="card card-pad mb-12">' +
        '<div class="flex items-center justify-between">' +
          '<div style="font-weight:600">👤 ' + esc(o.buyerName) + ' · ' + esc(o.propertyTitle) + '</div>' +
          '<span class="tag ' + dealTag(o.status) + '">' + dealText(o.status) + '</span>' +
        '</div>' +
        '<div class="flex gap-16 mt-8" style="font-size:14px">' +
          '<span>' + t('seller.listPriceLabel') + '<b>' + App.I18n.wan(o.listPrice) + '</b></span>' +
          '<span>' + t('seller.buyerOfferFull') + '<b class="text-danger">' + App.I18n.wan(o.price) + '</b>（' + nearText + '）</span>' +
          (o.counterPrice ? '<span>' + t('msg.dealCounter') + ': <b>' + App.I18n.wan(o.counterPrice) + '</b></span>' : '') +
        '</div>' +
        (o.reason ? '<div style="font-size:13px;margin-top:6px;color:#666">' + t('seller.offerReason') + esc(o.reason) + '</div>' : '') +
        actions +
        (o.status === 'accepted' ? '<div style="margin-top:8px"><span class="tag tag-green">' + t('seller.dealCreated') + '</span></div>' : '') +
      '</div>';
    }).join('');
  }

  /* ============ 交易流程 ============ */
  function renderDeals() {
    if (!cache.deals.length) {
      return '<div class="card card-pad"><div class="empty-state"><div class="empty-state-icon">📋</div><p>' + t('seller.noDeals') + '</p><p style="font-size:13px;margin-top:4px">' + t('seller.noDealsHint') + '</p></div></div>';
    }
    return cache.deals.map(function (d) {
      var total = (d.steps || []).length;
      var cur = d.currentStep || 0;
      var done = cur >= total;
      var curStep = !done ? d.steps[cur] : null;
      var stepsHtml = (d.steps || []).map(function (s, i) {
        var cls = i < cur ? 'done' : (i === cur ? 'current' : '');
        var icon = i < cur ? '✅' : (i === cur ? '🔵' : String(i + 1));
        // 当前环节显示双方确认进度
        var confirmLine = '';
        if (i === cur && curStep) {
          confirmLine = '<div class="tx-step-desc" style="margin-top:4px">' +
            '<span class="tag ' + (s.sellerConfirmed ? 'tag-green' : 'tag-gray') + '" style="margin-right:6px">' + (s.sellerConfirmed ? t('tx.sellerConfirmed') : t('tx.sellerWaiting')) + '</span>' +
            '<span class="tag ' + (s.buyerConfirmed ? 'tag-green' : 'tag-gray') + '">' + (s.buyerConfirmed ? t('tx.buyerConfirmed') : t('tx.buyerWaiting')) + '</span>' +
            (s.buyerConfirmed && !s.sellerConfirmed ? '<span style="color:#e8840c;font-size:12px;margin-left:8px">' + t('seller.buyerHurry') + '</span>' : '') +
            '</div>';
        }
        return '<div class="tx-step ' + cls + '"><div class="tx-step-icon">' + icon + '</div><div class="tx-step-content"><div class="tx-step-title">' + esc(s.title) + '</div><div class="tx-step-desc">' + esc(s.desc) + '</div>' + confirmLine + '</div></div>';
      }).join('');
      var actionHtml = '';
      if (!done) {
        if (curStep.sellerConfirmed) {
          actionHtml = '<div class="mt-16"><span class="tag tag-yellow">' + t('seller.youConfirmedWait', { step: esc(curStep.title) }) + '</span></div>';
        } else {
          actionHtml = '<div class="mt-16 flex items-center gap-8 flex-wrap">' +
            '<button class="btn btn-primary btn-sm" data-action="advanceDeal" data-buyer="' + esc(d.buyerUsername) + '" data-prop="' + esc(d.propertyId) + '">' + t('seller.confirmBtn', { step: esc(curStep.title) }) + '</button>' +
            (curStep.buyerConfirmed ? '<span class="tag tag-orange">' + t('seller.buyerOnlyYou') + '</span>' : '<span class="tag tag-gray">' + t('tx.needBoth') + '</span>') +
          '</div>';
        }
      }
      return '<div class="card card-pad mb-16">' +
        '<div class="flex items-center justify-between mb-16">' +
          '<div><div style="font-size:16px;font-weight:600">👤 ' + esc(d.buyerName) + '</div><div class="text-light" style="font-size:12px;margin-top:2px">' + esc(d.propertyTitle) + '</div></div>' +
          '<div class="text-right"><div class="text-danger fw-bold" style="font-size:18px">' + App.I18n.wan(d.agreedPrice) + '</div>' +
            '<span class="tag ' + (done ? 'tag-gray' : 'tag-green') + '">' + (done ? t('tx.completed') : t('seller.stepN', { cur: cur + 1, total: total })) + '</span></div>' +
        '</div>' +
        '<div class="tx-steps">' + stepsHtml + '</div>' +
        actionHtml +
      '</div>';
    }).join('');
  }

  /* ============ 动作绑定 ============ */
  function bindActions() {
    var root = document.getElementById('sellerBody');
    if (!root) return;
    root.onclick = function (e) {
      var btn = e.target.closest('[data-action]');
      if (!btn) return;
      var action = btn.getAttribute('data-action');
      var buyer = btn.getAttribute('data-buyer');
      var prop = btn.getAttribute('data-prop');

      if (action === 'openThread') { openThread(prop, buyer); return; }

      if (action === 'confirmView') {
        post('/api/seller/viewing', { buyerUsername: buyer, propertyId: prop, viewingId: btn.getAttribute('data-id'), action: 'confirm' })
          .then(function () { Utils.toast(en() ? 'Viewing confirmed' : '已确认看房预约', 'success'); loadAndRender(); })
          .catch(function (err) { Utils.toast(err.message, 'error'); });
      }
      if (action === 'rejectView') {
        var note = window.prompt(t('seller.rejectReasonPrompt'), t('seller.rejectReasonDefault'));
        if (note === null) return;
        post('/api/seller/viewing', { buyerUsername: buyer, propertyId: prop, viewingId: btn.getAttribute('data-id'), action: 'reject', note: note })
          .then(function () { Utils.toast(en() ? 'Declined' : '已婉拒', 'warn'); loadAndRender(); })
          .catch(function (err) { Utils.toast(err.message, 'error'); });
      }
      if (action === 'acceptOffer') {
        if (!window.confirm(t('seller.acceptConfirm'))) return;
        post('/api/seller/offer', { buyerUsername: buyer, propertyId: prop, action: 'accept' })
          .then(function () { Utils.toast(t('seller.offerAccepted'), 'success'); loadAndRender(); })
          .catch(function (err) { Utils.toast(err.message, 'error'); });
      }
      if (action === 'counterOffer') {
        var defaultCp = String(Math.round((parseFloat(btn.getAttribute('data-list')) + parseFloat(btn.getAttribute('data-price'))) / 2 / 5) * 5);
        var cp = window.prompt(t('seller.counterPrompt'), defaultCp);
        if (cp === null) return;
        post('/api/seller/offer', { buyerUsername: buyer, propertyId: prop, action: 'counter', counterPrice: parseInt(cp, 10) })
          .then(function () { Utils.toast(en() ? 'Counteroffer sent' : '已还价', 'success'); loadAndRender(); })
          .catch(function (err) { Utils.toast(err.message, 'error'); });
      }
      if (action === 'rejectOffer') {
        var rn = window.prompt(t('seller.rejectPrompt'), '');
        if (rn === null) return;
        post('/api/seller/offer', { buyerUsername: buyer, propertyId: prop, action: 'reject', note: rn })
          .then(function () { Utils.toast(t('seller.offerRejected'), 'warn'); loadAndRender(); })
          .catch(function (err) { Utils.toast(err.message, 'error'); });
      }
      if (action === 'advanceDeal') {
        post('/api/seller/deal-step', { buyerUsername: buyer, propertyId: prop })
          .then(function (d) { Utils.toast(d.advanced ? t('tx.advanced') : t('tx.waitBuyer'), 'success'); loadAndRender(); })
          .catch(function (err) { Utils.toast(err.message, 'error'); });
      }
    };
  }

})(window);
