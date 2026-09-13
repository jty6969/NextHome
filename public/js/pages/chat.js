/* Nexthome - AI 对话页 */
(function (global) {
  'use strict';

  var App = global.App;
  var Store = App.Store;
  var Utils = App.Utils;
  var API = global.API;

  App.Router.register('/chat', function () { render(); });

  function render() {
    var html = '' +
      '<div class="chat-layout">' +
        '<div class="chat-main">' +
          '<div class="chat-messages" id="chatMessages"></div>' +
          '<div class="chat-input-bar">' +
            '<textarea id="chatInput" placeholder="输入你想咨询的购房问题（Enter 发送，Shift+Enter 换行）…" rows="1"></textarea>' +
            '<button class="btn btn-primary" id="chatSend">发送</button>' +
          '</div>' +
        '</div>' +
        '<div class="chat-side" id="chatSide"></div>' +
      '</div>';
    document.getElementById('page').innerHTML = html;

    renderSidePanel();
    bindInput();
    // 先加载房源缓存再渲染消息（历史消息中的推荐卡片需要缓存才能显示详情）
    API.loadProperties().then(function (list) {
      global._propCache = list;
      renderMessages();
    }).catch(function () {
      renderMessages();
    });
  }

  function renderMessages() {
    var container = document.getElementById('chatMessages');
    var history = Store.get().chatHistory;
    var html = '';

    if (history.length === 0) {
      html += '' +
        '<div style="text-align:center;padding:30px 10px 20px;color:#999">' +
          '<div style="font-size:36px;margin-bottom:8px">🤖</div>' +
          '<p>你好！我是 AI 购房助手，告诉我你的情况，我来帮你找房子。</p>' +
          '<div style="margin-top:12px;display:flex;flex-wrap:wrap;gap:6px;justify-content:center">' +
            '<button class="btn btn-outline btn-sm" onclick="quickAsk(\'我想在上海买房，预算1500万左右\')">💰 预算1500万买房</button>' +
            '<button class="btn btn-outline btn-sm" onclick="quickAsk(\'三口之家想买汤臣一品\')">🏠 汤臣一品</button>' +
            '<button class="btn btn-outline btn-sm" onclick="quickAsk(\'首套房首付大概要多少\')">❓ 首付咨询</button>' +
          '</div>' +
        '</div>';
    }

    history.forEach(function (msg) {
      if (msg.role === 'user') {
        html += '' +
          '<div style="display:flex;gap:8px;flex-direction:row-reverse">' +
            '<div class="chat-avatar avatar-user">我</div>' +
            '<div class="chat-bubble user">' + Utils.esc(msg.content) + '</div>' +
          '</div>';
      } else if (msg.role === 'ai') {
        html += '' +
          '<div style="display:flex;gap:8px">' +
            '<div class="chat-avatar avatar-ai">AI</div>' +
            '<div style="display:flex;flex-direction:column;gap:0;max-width:75%">' +
              '<div class="chat-bubble ai">' + formatAIContent(msg.content) + '</div>';
        // 如果有推荐的房源卡片
        if (msg.propIds && msg.propIds.length) {
          msg.propIds.forEach(function (pid) {
            html += renderInlinePropCard(pid);
          });
        }
        html += '</div></div>';
      }
    });

    container.innerHTML = html;
    container.scrollTop = container.scrollHeight;
  }

  // AI 内容格式化：把 [propId] 变成可点击链接
  function formatAIContent(text) {
    var esc = Utils.esc(text);
    // 把 [tcyp-xxx] 替换成可点击的链接
    esc = esc.replace(/\[([a-z0-9-]+)\]/gi, function (match, id) {
      return '<a href="#/property/' + id + '" style="color:#1677ff;font-weight:600">[' + id + ']</a>';
    });
    return esc;
  }

  // 聊天内联房源卡片
  function renderInlinePropCard(propId) {
    var props = API.loadProperties ? null : null; // sync cache
    // 用缓存渲染（loadProperties 是 async，这里用同步缓存）
    var cached = global._propCache || [];
    var p = cached.find(function (x) { return x.id === propId; });
    if (!p) return '<div class="ai-prop-card"><div class="ai-prop-card-head"><span>房源 ' + propId + '</span></div></div>';

    return '' +
      '<div class="ai-prop-card" onclick="location.hash=\'#/property/' + p.id + '\'">' +
        '<div class="ai-prop-card-head">' +
          '<span style="font-weight:600">' + Utils.esc(p.community) + ' ' + Utils.esc(p.building) + ' ' + Utils.esc(p.unit) + '</span>' +
          '<span class="ai-prop-card-price">' + p.totalPrice + ' 万</span>' +
        '</div>' +
        '<div class="ai-prop-card-info">' +
          p.area + '㎡ | ' + p.rooms.bedroom + '室' + p.rooms.livingRoom + '厅' + p.rooms.bathroom + '卫 | ' +
          p.floor.level + '/' + p.floor.total + '层 | ' + p.orientation + ' | 单价' + p.unitPrice + '万/㎡' +
        '</div>' +
        '<div class="ai-prop-card-actions">' +
          '<a class="btn btn-primary btn-sm" href="#/property/' + p.id + '">📖 详情</a>' +
          '<a class="btn btn-outline btn-sm" href="#/messages/' + p.id + '">💬 联系卖家</a>' +
          '<a class="btn btn-outline btn-sm" href="#/viewing/' + p.id + '">📅 预约看房</a>' +
        '</div>' +
      '</div>';
  }

  function renderSidePanel() {
    var d = Store.get();
    var p = d.profile || {};
    var r = d.requirements || {};
    var completeness = Utils.profileCompleteness();

    var rows = [];
    function row(label, val) {
      if (val !== undefined && val !== null && val !== '') {
        rows.push('<div class="profile-row"><span class="label">' + label + '</span><span class="val">' + Utils.esc(String(val)) + '</span></div>');
      }
    }

    row('城市', p.city || p.targetCity);
    row('家庭人口', p.familySize ? p.familySize + ' 人' : null);
    row('首套', p.firstHome != null ? (p.firstHome ? '是' : '否') : null);
    row('预算', p.budget ? p.budget + ' 万' : null);
    row('首付', p.downPayment ? p.downPayment + ' 万' : null);
    row('月供上限', p.monthlyPaymentMax ? p.monthlyPaymentMax + ' 元' : null);
    row('户型', r.roomCount ? r.roomCount + ' 室' : null);
    row('电梯', r.needElevator ? '必须有' : null);
    row('面积', (r.minArea || p.minArea) ? (r.minArea || p.minArea) + '~' + (r.maxArea || '不限') + ' ㎡' : null);
    row('楼层偏好', r.floorPreference);
    row('朝向', r.orientation);
    row('距地铁', r.metroDistance ? '≤' + r.metroDistance + ' 米' : null);
    row('工作地', p.workAddress);

    var badgeColor = completeness >= 80 ? 'tag-green' : completeness >= 40 ? 'tag-blue' : 'tag-gray';
    var badgeText = completeness >= 80 ? '可以推荐房源' : completeness >= 40 ? '继续了解中' : '刚开始';

    var html = '' +
      '<div class="profile-panel">' +
        '<h4>👤 买家画像</h4>' +
        (rows.length ? rows.join('') : '<p style="color:#999;padding:8px 0">还没有信息，去和 AI 对话吧</p>') +
        '<div class="profile-completeness">' +
          '<div class="profile-completeness-bar" style="width:' + completeness + '%"></div>' +
        '</div>' +
        '<div style="margin-top:6px;display:flex;justify-content:space-between;align-items:center">' +
          '<span class="profile-badge">完整度 ' + completeness + '%</span>' +
          '<span class="tag ' + badgeColor + '">' + badgeText + '</span>' +
        '</div>' +
        '<div style="margin-top:12px;border-top:1px solid #eee;padding-top:10px">' +
          '<a href="#/properties" class="btn btn-outline btn-block btn-sm">浏览全部房源</a>' +
        '</div>' +
      '</div>';

    document.getElementById('chatSide').innerHTML = html;
  }

  function bindInput() {
    var input = document.getElementById('chatInput');
    var sendBtn = document.getElementById('chatSend');

    function send() {
      var text = input.value.trim();
      if (!text) return;
      input.value = '';
      input.style.height = 'auto';
      sendToAI(text);
    }

    sendBtn.onclick = send;
    input.onkeydown = function (e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        send();
      }
    };
    // 自动高度
    input.oninput = function () {
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 100) + 'px';
    };
  }

  function sendToAI(text) {
    // 保存用户消息
    Store.addChat({ role: 'user', content: text, time: new Date().toISOString() });
    // 从用户消息中提取画像信息
    API.updateProfileFromChat(text, '');
    renderMessages();
    renderSidePanel();

    // 显示 AI 正在输入
    showTyping();

    // 预加载房源缓存
    API.loadProperties().then(function (list) { global._propCache = list; }).catch(function () {});

    // 调用 AI
    API.callAI(text).then(function (reply) {
      hideTyping();
      // 提取房源 ID
      var propIds = API.extractPropertyIds(reply);
      Store.addChat({ role: 'ai', content: reply, propIds: propIds, time: new Date().toISOString() });
      renderMessages();
      renderSidePanel();
      // 同步到服务器
      Store.syncToServer().catch(function () {});
    }).catch(function (err) {
      hideTyping();
      var errMsg = err.message || String(err);
      Store.addChat({ role: 'ai', content: '⚠️ 抱歉，AI 服务暂时不可用：' + errMsg + '\n\n你可以先浏览房源，或稍后再试。', time: new Date().toISOString() });
      renderMessages();
    });
  }

  function showTyping() {
    var container = document.getElementById('chatMessages');
    var div = document.createElement('div');
    div.id = 'typingIndicator';
    div.style.cssText = 'display:flex;gap:8px';
    div.innerHTML = '' +
      '<div class="chat-avatar avatar-ai">AI</div>' +
      '<div class="chat-bubble ai" style="color:#999">正在思考中...</div>';
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
  }

  function hideTyping() {
    var el = document.getElementById('typingIndicator');
    if (el) el.remove();
  }

  // 快捷提问
  global.quickAsk = function (text) {
    var input = document.getElementById('chatInput');
    if (input) {
      input.value = text;
      document.getElementById('chatSend').click();
    }
  };

})(window);
