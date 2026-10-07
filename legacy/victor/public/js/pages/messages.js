/* Nexthome - 消息/聊天页（双语，类微信） */
(function (global) {
  'use strict';

  var App = global.App;
  var Store = App.Store;
  var Utils = App.Utils;
  var API = global.API;
  var currentPropId = null;
  var chatPollTimer = null;

  function t(key, vars) { return App.I18n ? App.I18n.t(key, vars) : key; }
  function en() { return App.I18n && App.I18n.isEn(); }

  // 主路由：消息列表
  App.Router.register('/messages', function () { currentPropId = null; renderList(); });

  // 子路由：和某个房源的卖家聊天
  App.Router.register('/messages/:propId', function (propId) {
    currentPropId = propId;
    renderChat(propId);
  });

  function renderList() {
    var d = Store.get();
    var convs = d.conversations || {};
    var propIds = Object.keys(convs);

    // 也加上所有有看房记录的房源
    (d.viewingRecords || []).forEach(function (v) {
      if (propIds.indexOf(v.propertyId) < 0) propIds.push(v.propertyId);
    });

    var html = '<h2 style="font-size:20px;margin-bottom:16px">' + t('msg.title') + '</h2>';

    if (propIds.length === 0) {
      html += '<div class="empty-state"><div class="empty-state-icon">💬</div><p>' + t('msg.empty') + '</p><p style="font-size:13px;margin-top:4px">' + t('msg.emptyHint') + '</p><a href="#/properties" class="btn btn-primary mt-16">' + t('msg.browse') + '</a></div>';
      document.getElementById('page').innerHTML = html;
      return;
    }

    // 加载房源信息渲染列表
    API.loadProperties().then(function (props) {
      global._propCache = props;
      var items = propIds.map(function (pid) {
        var p = props.find(function (x) { return x.id === pid; });
        if (!p) return null;
        var msgs = convs[pid] || [];
        var lastMsg = msgs[msgs.length - 1];
        var lastText = lastMsg ? (lastMsg.role === 'system' ? t('common.system') + ' ' : '') + (lastMsg.content || '').slice(0, 40) : t('msg.startConv');
        var unread = msgs.filter(function (m) { return m.role === 'seller' && !m.read; }).length;

        return '' +
          '<div class="msg-list-item" onclick="location.hash=\'#/messages/' + pid + '\'">' +
            '<div class="chat-avatar avatar-seller">' + p.seller.avatar + '</div>' +
            '<div class="flex-1">' +
              '<div class="flex justify-between">' +
                '<span style="font-weight:600">' + Utils.esc(p.seller.name) + '</span>' +
                (unread ? '<span class="tag tag-red">' + t('msg.unreadN', { n: unread }) + '</span>' : '<span style="color:#ccc;font-size:12px">' + (lastMsg ? Utils.formatDate(lastMsg.time) : '') + '</span>') +
              '</div>' +
              '<div style="color:#999;font-size:12px;margin-top:2px">' + Utils.esc(p.community) + ' ' + Utils.esc(p.building) + ' ' + Utils.esc(p.unit) + '</div>' +
              '<div style="color:#666;font-size:12px;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + Utils.esc(lastText) + '</div>' +
            '</div>' +
          '</div>';
      }).filter(Boolean);

      html += '<div class="card">' + items.join('') + '</div>';
      document.getElementById('page').innerHTML = html;
    });
  }

  function renderChat(propId) {
    API.loadProperty(propId).then(function (p) {
      if (!p) {
        document.getElementById('page').innerHTML = '<div class="empty-state"><p>' + t('msg.notExist') + '</p><a href="#/messages" class="btn btn-primary mt-16">' + t('common.back') + '</a></div>';
        return;
      }

      var html = '' +
        '<div style="margin-bottom:12px"><a href="#/messages" style="font-size:13px">' + t('msg.backToList') + '</a></div>' +
        '<div class="chat-layout">' +
          '<div class="chat-main">' +
            // 聊天头部
            '<div style="padding:10px 14px;border-bottom:1px solid #e8e8e8;display:flex;align-items:center;gap:10px">' +
              '<div class="chat-avatar avatar-seller">' + p.seller.avatar + '</div>' +
              '<div>' +
                '<div style="font-weight:600;font-size:14px">' + Utils.esc(p.seller.name) + ' ' + t('msg.sellerTag') + '</div>' +
                '<div style="color:#999;font-size:12px">' + Utils.esc(p.community) + ' ' + Utils.esc(p.building) + ' ' + Utils.esc(p.unit) + ' · ' + App.I18n.wan(p.totalPrice) + '</div>' +
              '</div>' +
              '<div style="margin-left:auto">' +
                '<a class="btn btn-outline btn-sm" href="#/property/' + p.id + '">📖 ' + t('common.detail') + '</a>' +
                '<a class="btn btn-outline btn-sm" href="#/viewing/' + p.id + '" style="margin-left:4px">📅 ' + t('view.title').replace('📅 ', '') + '</a>' +
              '</div>' +
            '</div>' +
            // 消息区域
            '<div class="chat-messages" id="chatMessages"></div>' +
            // 快捷操作
            '<div style="padding:6px 12px;border-top:1px solid #e8e8e8;display:flex;gap:6px;flex-wrap:wrap;background:#fafafa">' +
              '<button class="btn btn-outline btn-sm" onclick="sendQuickMsg(\'' + p.id + '\',\'' + t('msg.quickAvailMsg') + '\')">' + t('msg.quickAvail') + '</button>' +
              '<button class="btn btn-outline btn-sm" onclick="sendQuickMsg(\'' + p.id + '\',\'' + t('msg.quickPriceMsg') + '\')">' + t('msg.quickPrice') + '</button>' +
              '<button class="btn btn-outline btn-sm" onclick="sendQuickMsg(\'' + p.id + '\',\'' + t('msg.quickLightMsg') + '\')">' + t('msg.quickLight') + '</button>' +
              '<button class="btn btn-primary btn-sm" onclick="startDeal(\'' + p.id + '\')">' + t('msg.startNeg') + '</button>' +
            '</div>' +
            // 输入栏
            '<div class="chat-input-bar">' +
              '<textarea id="chatInput" placeholder="' + t('msg.inputPh') + '" rows="1"></textarea>' +
              '<button class="btn btn-primary" id="chatSend">' + t('common.send') + '</button>' +
            '</div>' +
          '</div>' +
          '<div class="chat-side" id="chatSide">' +
            '<div class="profile-panel">' +
              '<h4>' + t('msg.propInfo') + '</h4>' +
              '<div class="profile-row"><span class="label">' + t('common.community') + '</span><span class="val">' + Utils.esc(p.community) + '</span></div>' +
              '<div class="profile-row"><span class="label">' + t('common.area') + '</span><span class="val">' + p.area + ' ㎡</span></div>' +
              '<div class="profile-row"><span class="label">' + t('common.layout') + '</span><span class="val">' + App.I18n.rooms(p.rooms) + '</span></div>' +
              '<div class="profile-row"><span class="label">' + t('msg.listPrice') + '</span><span class="val text-danger fw-bold">' + App.I18n.wan(p.totalPrice) + '</span></div>' +
              '<div class="profile-row"><span class="label">' + t('common.floor') + '</span><span class="val">' + App.I18n.floor(p.floor) + '</span></div>' +
              '<div class="profile-row"><span class="label">' + t('common.orientation') + '</span><span class="val">' + Utils.esc(p.orientation) + '</span></div>' +
              '<div style="margin-top:10px">' +
                '<a class="btn btn-outline btn-block btn-sm" href="#/viewing/' + p.id + '">' + t('common.bookViewing') + '</a>' +
              '</div>' +
              '<div style="margin-top:6px">' +
                '<a class="btn btn-outline btn-block btn-sm" href="#/chat">' + t('msg.askAI') + '</a>' +
              '</div>' +
            '</div>' +
          '</div>' +
        '</div>';

      document.getElementById('page').innerHTML = html;
      renderChatMessages(propId);
      bindChatInput(propId);

      // 轮询：卖家手动回复 / 看房审批 / 议价受理结果会实时显示
      if (chatPollTimer) clearInterval(chatPollTimer);
      chatPollTimer = setInterval(function () {
        if (currentPropId !== propId || !document.getElementById('chatMessages')) {
          clearInterval(chatPollTimer);
          chatPollTimer = null;
          return;
        }
        Store.loadFromServer().then(function () { renderChatMessages(propId); }).catch(function () {});
      }, 5000);
    });
  }

  function renderChatMessages(propId) {
    var container = document.getElementById('chatMessages');
    if (!container) return;
    var msgs = Store.getConversation(propId);

    if (msgs.length === 0) {
      container.innerHTML = '<div style="text-align:center;padding:30px;color:#999">' + t('msg.startHint') + '</div>';
      return;
    }

    var html = '';
    var locale = en() ? 'en-US' : 'zh-CN';
    msgs.forEach(function (msg) {
      var time = msg.time ? new Date(msg.time).toLocaleString(locale, { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';

      if (msg.role === 'system') {
        html += '<div style="text-align:center;color:#ccc;font-size:11px;padding:4px">--- ' + Utils.esc(msg.content) + ' ---</div>';
      } else if (msg.role === 'buyer') {
        html += '' +
          '<div style="display:flex;gap:8px;flex-direction:row-reverse">' +
            '<div class="chat-avatar avatar-user">' + t('common.me') + '</div>' +
            '<div style="max-width:75%">' +
              (msg.type === 'deal' ? renderDealCard(msg) : '<div class="chat-bubble buyer">' + Utils.esc(msg.content) + '</div>') +
              '<div style="text-align:right;color:#ccc;font-size:10px;margin-top:2px">' + time + '</div>' +
            '</div>' +
          '</div>';
      } else if (msg.role === 'seller') {
        html += '' +
          '<div style="display:flex;gap:8px">' +
            '<div class="chat-avatar avatar-seller">' + (msg.avatar || 'S') + '</div>' +
            '<div style="max-width:75%">' +
              (msg.type === 'deal' ? renderDealCard(msg) : '<div class="chat-bubble seller">' + Utils.esc(msg.content) + '</div>') +
              '<div style="color:#ccc;font-size:10px;margin-top:2px">' + time + '</div>' +
            '</div>' +
          '</div>';
      }
    });

    container.innerHTML = html;
    container.scrollTop = container.scrollHeight;

    // 标记已读
    var d = Store.get();
    var changed = false;
    (d.conversations[propId] || []).forEach(function (m) {
      if (m.role === 'seller' && !m.read) { m.read = true; changed = true; }
    });
    if (changed) Store.save();
  }

  function renderDealCard(msg) {
    var d = msg.deal || {};
    var statusColor = d.status === 'accepted' ? 'tag-green' : d.status === 'rejected' ? 'tag-red' : d.status === 'countered' ? 'tag-orange' : 'tag-yellow';
    var statusText;
    if (d.status === 'accepted') statusText = t('msg.dealAccepted');
    else if (d.status === 'rejected') statusText = t('msg.dealRejected');
    else if (d.status === 'countered') statusText = t('msg.dealCountered');
    else statusText = t('msg.dealPending');

    return '' +
      '<div class="deal-card">' +
        '<div class="deal-card-title">' + t('msg.dealTitle') + '</div>' +
        '<div class="deal-card-row"><span>' + t('msg.dealOffer') + '</span><span class="text-danger fw-bold">' + App.I18n.wan(d.price || '?') + '</span></div>' +
        (d.reason ? '<div class="deal-card-row"><span>' + t('msg.dealReason') + '</span><span>' + Utils.esc(d.reason) + '</span></div>' : '') +
        (d.counterPrice ? '<div class="deal-card-row"><span>' + t('msg.dealCounter') + '</span><span class="fw-bold">' + App.I18n.wan(d.counterPrice) + '</span></div>' : '') +
        '<div style="margin-top:6px"><span class="tag ' + statusColor + '">' + statusText + '</span></div>' +
        (d.status === 'accepted' ? '<div style="margin-top:6px"><a class="btn btn-primary btn-sm" href="#/transaction">' + t('msg.enterFlow') + '</a></div>' : '') +
      '</div>';
  }

  function bindChatInput(propId) {
    var input = document.getElementById('chatInput');
    var sendBtn = document.getElementById('chatSend');
    if (!input || !sendBtn) return;

    function send() {
      var text = input.value.trim();
      if (!text) return;
      input.value = '';
      input.style.height = 'auto';
      sendMessage(propId, text);
    }

    sendBtn.onclick = send;
    input.onkeydown = function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
    };
    input.oninput = function () {
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 80) + 'px';
    };
  }

  function sendMessage(propId, text) {
    // 先拉取最新状态，避免覆盖卖家刚发的回复，再追加买家消息
    Store.loadFromServer().catch(function () {}).then(function () {
      Store.addMessage(propId, { role: 'buyer', content: text, time: new Date().toISOString(), sellerRead: false });
      renderChatMessages(propId);
      Store.syncToServer().catch(function () {});
      Utils.toast(t('msg.sent'), 'info');
    });
  }

  // 快捷消息
  global.sendQuickMsg = function (propId, text) {
    sendMessage(propId, text);
  };

  // 发起议价
  global.startDeal = function (propId) {
    var p = (global._propCache || []).find(function (x) { return x.id === propId; });
    var currentPrice = p ? p.totalPrice : '';
    var suggested = Math.round(currentPrice * 0.95);

    var html = '' +
      '<div style="padding:16px">' +
        '<h3 style="margin-bottom:12px">' + t('msg.dealTitle') + '</h3>' +
        '<div style="margin-bottom:10px;color:#999;font-size:13px">' + t('msg.curPrice') + App.I18n.wan(currentPrice) + '</div>' +
        '<div class="form-group">' +
          '<label class="form-label">' + t('msg.yourOffer') + '</label>' +
          '<input type="number" class="form-input" id="dealPrice" placeholder="' + suggested + '" value="' + suggested + '">' +
        '</div>' +
        '<div class="form-group">' +
          '<label class="form-label">' + t('msg.reasonLabel') + '</label>' +
          '<textarea class="form-textarea" id="dealReason" placeholder="' + t('msg.reasonPh') + '"></textarea>' +
        '</div>' +
        '<div class="flex gap-8">' +
          '<button class="btn btn-primary" onclick="submitDeal(\'' + propId + '\')">' + t('msg.sendOffer') + '</button>' +
          '<button class="btn btn-outline" onclick="cancelDeal()">' + t('common.cancel') + '</button>' +
        '</div>' +
      '</div>';

    var overlay = document.createElement('div');
    overlay.id = 'dealOverlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.4);z-index:9999;display:flex;align-items:center;justify-content:center';
    overlay.innerHTML = '<div class="card" style="width:400px;max-width:90%">' + html + '</div>';
    document.body.appendChild(overlay);
  };

  global.submitDeal = function (propId) {
    var price = parseInt(document.getElementById('dealPrice').value);
    var reason = document.getElementById('dealReason').value.trim();
    if (!price || price <= 0) { Utils.toast(t('msg.invalidPrice'), 'warn'); return; }

    cancelDeal();
    Store.loadFromServer().catch(function () {}).then(function () {
      Store.addMessage(propId, {
        role: 'buyer', type: 'deal', content: t('msg.dealContent', { price: price }),
        deal: { price: price, reason: reason, status: 'pending' },
        time: new Date().toISOString(), sellerRead: false
      });
      renderChatMessages(propId);
      Store.syncToServer().catch(function () {});
    });
    Utils.toast(t('msg.offerSent'), 'success');
  };

  global.cancelDeal = function () {
    var el = document.getElementById('dealOverlay');
    if (el) el.remove();
  };

})(window);
