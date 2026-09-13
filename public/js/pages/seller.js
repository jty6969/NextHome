/* Nexthome - 卖家中心（处理消息、看房申请、议价、交易流程） */
(function (global) {
  'use strict';

  var App = global.App;
  var Utils = App.Utils;
  var Auth = App.Auth;
  var esc = Utils.esc;

  var pollTimer = null;
  var currentTab = 'listings';
  var cache = { listings: [], threads: [], viewings: [], offers: [], deals: [] };

  App.Router.register('/seller', function () { render(); });

  function api(url, opts) {
    return Auth.request(url, opts).then(function (r) {
      return r.json().then(function (d) {
        if (!r.ok) throw new Error(d.error || '请求失败');
        return d;
      });
    });
  }

  function post(url, body) {
    return api(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {})
    });
  }

  /* ============ 主框架 ============ */
  function render() {
    clearInterval(pollTimer);
    var u = Auth.getUser();
    var html = '' +
      '<div class="flex items-center justify-between mb-16">' +
        '<h2 style="font-size:20px;font-weight:600">🏠 卖家中心</h2>' +
        '<span style="color:#999;font-size:13px">欢迎，' + esc(u.name) + '（卖家）</span>' +
      '</div>' +
      '<div class="seller-tabs" style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap">' +
        tabBtn('listings', '📢 我的房源') +
        tabBtn('messages', '💬 消息回复') +
        tabBtn('viewings', '📅 看房申请') +
        tabBtn('offers', '💰 议价受理') +
        tabBtn('deals', '📋 交易流程') +
      '</div>' +
      '<div id="sellerBody"><div class="card card-pad">加载中...</div></div>';
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
      var unread = cache.threads.reduce(function (s, t) { return s + (t.unread || 0); }, 0);
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
        '<div class="card card-pad" style="color:#c00">加载失败：' + esc(e.message) + '</div>';
    });
  }

  function renderBody() {
    // 重绘标签上的角标
    var tabsEl = document.querySelector('.seller-tabs');
    if (tabsEl) {
      tabsEl.innerHTML = [
        tabBtn('listings', '📢 我的房源'),
        tabBtn('messages', '💬 消息回复'),
        tabBtn('viewings', '📅 看房申请'),
        tabBtn('offers', '💰 议价受理'),
        tabBtn('deals', '📋 交易流程')
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
    else if (currentTab === 'thread') body.innerHTML = '<div class="card card-pad">加载中...</div>';
    bindActions();
  }

  /* ============ 我的房源 ============ */
  function renderListings() {
    if (!cache.listings.length) return '<div class="card card-pad empty-state">暂无在售房源</div>';
    var html = '<div style="color:#999;font-size:13px;margin-bottom:8px">共 ' + cache.listings.length + ' 套在售</div>';
    html += cache.listings.map(function (p) {
      return '<div class="card card-pad mb-16">' +
        '<div class="flex items-center justify-between">' +
          '<div style="font-weight:600">' + esc(p.title) + '</div>' +
          '<div class="text-danger fw-bold" style="font-size:18px">' + p.totalPrice + ' 万</div>' +
        '</div>' +
        '<div class="text-light" style="font-size:12px;margin-top:4px">' +
          p.area + '㎡ | ' + p.rooms.bedroom + '室' + p.rooms.livingRoom + '厅' + p.rooms.bathroom + '卫 | ' +
          p.floor.level + '/' + p.floor.total + '层 | 单价 ' + p.unitPrice + ' 万/㎡' +
        '</div>' +
      '</div>';
    }).join('');
    return html;
  }

  /* ============ 消息列表 ============ */
  function renderThreads() {
    if (!cache.threads.length) {
      return '<div class="card card-pad"><div class="empty-state"><div class="empty-state-icon">💬</div><p>暂无买家消息</p><p style="font-size:13px;margin-top:4px">买家联系你后会显示在这里</p></div></div>';
    }
    return cache.threads.map(function (t) {
      return '<div class="card card-pad mb-8" style="cursor:pointer" data-action="openThread" data-buyer="' + esc(t.buyerUsername) + '" data-prop="' + esc(t.propertyId) + '">' +
        '<div class="flex items-center justify-between">' +
          '<div style="font-weight:600">👤 ' + esc(t.buyerName) +
            (t.unread ? ' <span class="tag tag-red">' + t.unread + ' 条未读</span>' : '') +
          '</div>' +
          '<span class="text-light" style="font-size:12px">' + (t.lastTime ? Utils.formatDate(t.lastTime) : '') + '</span>' +
        '</div>' +
        '<div class="text-light" style="font-size:12px;margin-top:4px">🏠 ' + esc(t.propertyTitle) + '</div>' +
        '<div style="font-size:13px;margin-top:4px;color:#555">' + esc(t.lastContent || '') + '</div>' +
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
          ? '<div class="deal-card"><div class="deal-card-title">💰 议价</div>' +
            '<div class="deal-card-row"><span>' + (right ? '还价/回复' : '买家出价') + '</span><span class="text-danger fw-bold">' +
            (m.deal ? (m.deal.price || '') : '') + ' 万</span></div>' +
            (m.deal && m.deal.counterPrice ? '<div class="deal-card-row"><span>还价</span><span class="fw-bold">' + m.deal.counterPrice + ' 万</span></div>' : '') +
            '<div style="margin-top:6px"><span class="tag ' + dealTag(m.deal && m.deal.status) + '">' + dealText(m.deal && m.deal.status) + '</span></div></div>'
          : '<div class="chat-bubble ' + (right ? 'buyer' : 'seller') + '">' + esc(m.content) + '</div>';
        return '<div style="display:flex;gap:8px;flex-direction:' + (right ? 'row-reverse' : 'row') + ';margin-bottom:10px">' +
          '<div class="chat-avatar ' + (right ? 'avatar-user' : 'avatar-seller') + '">' + (right ? '我' : '买') + '</div>' +
          '<div style="max-width:75%">' + bubble +
            '<div style="color:#ccc;font-size:10px;margin-top:2px">' + (m.time ? new Date(m.time).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '') + '</div>' +
          '</div></div>';
      }).join('');

      body.innerHTML =
        '<div style="margin-bottom:12px"><button class="btn btn-outline btn-sm" data-action="backThreads">← 返回消息列表</button></div>' +
        '<div class="card mb-16"><div class="card-pad" style="border-bottom:1px solid #eee">' +
          '<div style="font-weight:600">👤 ' + esc(d.buyerName) + '</div>' +
          '<div class="text-light" style="font-size:12px">🏠 ' + esc(d.propertyTitle) + '</div>' +
        '</div>' +
        '<div id="threadMsgs" style="padding:16px;max-height:420px;overflow-y:auto">' + (msgs || '<div style="color:#999;text-align:center;padding:30px">暂无消息</div>') + '</div>' +
        '<div class="chat-input-bar" style="position:static;border-top:1px solid #eee">' +
          '<textarea id="threadInput" placeholder="回复买家...（Enter 发送）" rows="1"></textarea>' +
          '<button class="btn btn-primary" id="threadSend">发送</button>' +
        '</div></div>';

      var container = document.getElementById('threadMsgs');
      container.scrollTop = container.scrollHeight;

      document.querySelector('[data-action="backThreads"]').onclick = function () { currentTab = 'messages'; render(); };
      function sendReply() {
        var input = document.getElementById('threadInput');
        var text = input.value.trim();
        if (!text) return;
        input.value = '';
        post('/api/seller/reply', { buyerUsername: buyer, propertyId: propId, content: text }).then(function () {
          Utils.toast('已回复', 'success');
          openThread(propId, buyer);
        }).catch(function (e) { Utils.toast(e.message, 'error'); });
      }
      document.getElementById('threadSend').onclick = sendReply;
      document.getElementById('threadInput').onkeydown = function (e) {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendReply(); }
      };
    }).catch(function (e) {
      document.getElementById('sellerBody').innerHTML = '<div class="card card-pad" style="color:#c00">加载失败：' + esc(e.message) + '</div>';
    });
  }

  function dealTag(status) {
    return status === 'accepted' ? 'tag-green' : status === 'rejected' ? 'tag-red' : status === 'countered' ? 'tag-orange' : 'tag-yellow';
  }
  function dealText(status) {
    return status === 'accepted' ? '✅ 已接受' : status === 'rejected' ? '❌ 已拒绝' : status === 'countered' ? '🔁 已还价' : '⏳ 待回复';
  }

  /* ============ 看房申请 ============ */
  var VIEW_STATUS = { pending: ['待确认', 'tag-yellow'], confirmed: ['已确认', 'tag-green'], completed: ['已完成', 'tag-gray'], cancelled: ['已婉拒/取消', 'tag-red'] };
  function renderViewings() {
    if (!cache.viewings.length) {
      return '<div class="card card-pad"><div class="empty-state"><div class="empty-state-icon">📅</div><p>暂无看房申请</p></div></div>';
    }
    return cache.viewings.slice().sort(function (a, b) {
      return (a.status === 'pending' ? 0 : 1) - (b.status === 'pending' ? 0 : 1);
    }).map(function (v) {
      var meta = VIEW_STATUS[v.status] || VIEW_STATUS.pending;
      var actions = '';
      if (v.status === 'pending') {
        actions = '<div class="flex gap-8 mt-8">' +
          '<button class="btn btn-primary btn-sm" data-action="confirmView" data-buyer="' + esc(v.buyerUsername) + '" data-prop="' + esc(v.propertyId) + '" data-id="' + esc(v.id) + '">✅ 确认预约</button>' +
          '<button class="btn btn-danger btn-sm" data-action="rejectView" data-buyer="' + esc(v.buyerUsername) + '" data-prop="' + esc(v.propertyId) + '" data-id="' + esc(v.id) + '">❌ 婉拒</button>' +
        '</div>';
      }
      return '<div class="card card-pad mb-12">' +
        '<div class="flex items-center justify-between">' +
          '<div style="font-weight:600">👤 ' + esc(v.buyerName) + ' · ' + esc(v.propertyTitle) + '</div>' +
          '<span class="tag ' + meta[1] + '">' + meta[0] + '</span>' +
        '</div>' +
        '<div class="text-light" style="font-size:13px;margin-top:6px">📅 ' + esc(v.date) + '　⏰ ' + esc(v.timeSlot) + '</div>' +
        '<div style="font-size:13px;margin-top:4px">留言：' + esc(v.note || '无') + '</div>' +
        (v.sellerNote ? '<div style="font-size:13px;margin-top:4px;color:#888">卖家备注：' + esc(v.sellerNote) + '</div>' : '') +
        actions +
      '</div>';
    }).join('');
  }

  /* ============ 议价受理 ============ */
  function renderOffers() {
    if (!cache.offers.length) {
      return '<div class="card card-pad"><div class="empty-state"><div class="empty-state-icon">💰</div><p>暂无议价申请</p></div></div>';
    }
    return cache.offers.slice().sort(function (a, b) {
      return (a.status === 'pending' ? 0 : 1) - (b.status === 'pending' ? 0 : 1);
    }).map(function (o) {
      var actions = '';
      if (o.status === 'pending') {
        actions = '<div class="flex gap-8 mt-8 flex-wrap">' +
          '<button class="btn btn-primary btn-sm" data-action="acceptOffer" data-buyer="' + esc(o.buyerUsername) + '" data-prop="' + esc(o.propertyId) + '">✅ 接受出价</button>' +
          '<button class="btn btn-outline btn-sm" data-action="counterOffer" data-buyer="' + esc(o.buyerUsername) + '" data-prop="' + esc(o.propertyId) + '" data-price="' + o.price + '" data-list="' + o.listPrice + '">🔁 还价</button>' +
          '<button class="btn btn-danger btn-sm" data-action="rejectOffer" data-buyer="' + esc(o.buyerUsername) + '" data-prop="' + esc(o.propertyId) + '">❌ 拒绝</button>' +
        '</div>';
      }
      return '<div class="card card-pad mb-12">' +
        '<div class="flex items-center justify-between">' +
          '<div style="font-weight:600">👤 ' + esc(o.buyerName) + ' · ' + esc(o.propertyTitle) + '</div>' +
          '<span class="tag ' + dealTag(o.status) + '">' + dealText(o.status) + '</span>' +
        '</div>' +
        '<div class="flex gap-16 mt-8" style="font-size:14px">' +
          '<span>挂牌价：<b>' + o.listPrice + ' 万</b></span>' +
          '<span>买家出价：<b class="text-danger">' + o.price + ' 万</b>（' + (o.price >= o.listPrice * 0.93 ? '出价接近挂牌价' : '约挂牌价 ' + Math.round(o.price / o.listPrice * 100) + '%') + '）</span>' +
          (o.counterPrice ? '<span>已还价：<b>' + o.counterPrice + ' 万</b></span>' : '') +
        '</div>' +
        (o.reason ? '<div style="font-size:13px;margin-top:6px;color:#666">出价理由：' + esc(o.reason) + '</div>' : '') +
        actions +
        (o.status === 'accepted' ? '<div style="margin-top:8px"><span class="tag tag-green">已生成交易，请到「交易流程」跟进</span></div>' : '') +
      '</div>';
    }).join('');
  }

  /* ============ 交易流程 ============ */
  function renderDeals() {
    if (!cache.deals.length) {
      return '<div class="card card-pad"><div class="empty-state"><div class="empty-state-icon">📋</div><p>暂无进行中的交易</p><p style="font-size:13px;margin-top:4px">在「议价受理」中接受买家出价后自动生成</p></div></div>';
    }
    return cache.deals.map(function (t) {
      var total = (t.steps || []).length;
      var cur = t.currentStep || 0;
      var done = cur >= total;
      var curStep = !done ? t.steps[cur] : null;
      var stepsHtml = (t.steps || []).map(function (s, i) {
        var cls = i < cur ? 'done' : (i === cur ? 'current' : '');
        var icon = i < cur ? '✅' : (i === cur ? '🔵' : String(i + 1));
        // 当前环节显示双方确认进度
        var confirmLine = '';
        if (i === cur && curStep) {
          confirmLine = '<div class="tx-step-desc" style="margin-top:4px">' +
            '<span class="tag ' + (s.sellerConfirmed ? 'tag-green' : 'tag-gray') + '" style="margin-right:6px">卖家' + (s.sellerConfirmed ? '已确认 ✓' : '待确认') + '</span>' +
            '<span class="tag ' + (s.buyerConfirmed ? 'tag-green' : 'tag-gray') + '">买家' + (s.buyerConfirmed ? '已确认 ✓' : '待确认') + '</span>' +
            (s.buyerConfirmed && !s.sellerConfirmed ? '<span style="color:#e8840c;font-size:12px;margin-left:8px">买家已确认，请尽快确认</span>' : '') +
            '</div>';
        }
        return '<div class="tx-step ' + cls + '"><div class="tx-step-icon">' + icon + '</div><div class="tx-step-content"><div class="tx-step-title">' + esc(s.title) + '</div><div class="tx-step-desc">' + esc(s.desc) + '</div>' + confirmLine + '</div></div>';
      }).join('');
      var actionHtml = '';
      if (!done) {
        if (curStep.sellerConfirmed) {
          actionHtml = '<div class="mt-16"><span class="tag tag-yellow">✅ 你已确认「' + esc(curStep.title) + '」，等待买家确认</span></div>';
        } else {
          actionHtml = '<div class="mt-16 flex items-center gap-8 flex-wrap">' +
            '<button class="btn btn-primary btn-sm" data-action="advanceDeal" data-buyer="' + esc(t.buyerUsername) + '" data-prop="' + esc(t.propertyId) + '">🤝 我确认完成：' + esc(curStep.title) + '</button>' +
            (curStep.buyerConfirmed ? '<span class="tag tag-orange">买家已确认，只差你确认</span>' : '<span class="tag tag-gray">需双方确认后进入下一步</span>') +
          '</div>';
        }
      }
      return '<div class="card card-pad mb-16">' +
        '<div class="flex items-center justify-between mb-16">' +
          '<div><div style="font-size:16px;font-weight:600">👤 ' + esc(t.buyerName) + '</div><div class="text-light" style="font-size:12px;margin-top:2px">' + esc(t.propertyTitle) + '</div></div>' +
          '<div class="text-right"><div class="text-danger fw-bold" style="font-size:18px">' + t.agreedPrice + ' 万</div>' +
            '<span class="tag ' + (done ? 'tag-gray' : 'tag-green') + '">' + (done ? '已完成' : '第 ' + (cur + 1) + '/' + total + ' 步') + '</span></div>' +
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
          .then(function () { Utils.toast('已确认看房预约', 'success'); loadAndRender(); })
          .catch(function (err) { Utils.toast(err.message, 'error'); });
      }
      if (action === 'rejectView') {
        var note = window.prompt('婉拒原因（可留空，买家会看到）：', '该时段已有安排，建议换个时间');
        if (note === null) return;
        post('/api/seller/viewing', { buyerUsername: buyer, propertyId: prop, viewingId: btn.getAttribute('data-id'), action: 'reject', note: note })
          .then(function () { Utils.toast('已婉拒', 'warn'); loadAndRender(); })
          .catch(function (err) { Utils.toast(err.message, 'error'); });
      }
      if (action === 'acceptOffer') {
        if (!window.confirm('确认接受买家出价？接受后将自动生成交易流程。')) return;
        post('/api/seller/offer', { buyerUsername: buyer, propertyId: prop, action: 'accept' })
          .then(function () { Utils.toast('🎉 已接受出价，交易已生成', 'success'); loadAndRender(); })
          .catch(function (err) { Utils.toast(err.message, 'error'); });
      }
      if (action === 'counterOffer') {
        var cp = window.prompt('您的还价（万元）：', String(Math.round((parseFloat(btn.getAttribute('data-list')) + parseFloat(btn.getAttribute('data-price'))) / 2 / 5) * 5));
        if (cp === null) return;
        post('/api/seller/offer', { buyerUsername: buyer, propertyId: prop, action: 'counter', counterPrice: parseInt(cp, 10) })
          .then(function () { Utils.toast('已还价', 'success'); loadAndRender(); })
          .catch(function (err) { Utils.toast(err.message, 'error'); });
      }
      if (action === 'rejectOffer') {
        var rn = window.prompt('拒绝原因（可留空）：', '');
        if (rn === null) return;
        post('/api/seller/offer', { buyerUsername: buyer, propertyId: prop, action: 'reject', note: rn })
          .then(function () { Utils.toast('已拒绝该出价', 'warn'); loadAndRender(); })
          .catch(function (err) { Utils.toast(err.message, 'error'); });
      }
      if (action === 'advanceDeal') {
        post('/api/seller/deal-step', { buyerUsername: buyer, propertyId: prop })
          .then(function (d) { Utils.toast(d.advanced ? '🎉 双方已确认，交易进入下一环节' : '已确认，等待买家确认', 'success'); loadAndRender(); })
          .catch(function (err) { Utils.toast(err.message, 'error'); });
      }
    };
  }

})(window);
