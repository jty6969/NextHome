/* Nexthome - AI 对话页（双语） */
(function (global) {
  'use strict';

  var App = global.App;
  var Store = App.Store;
  var Utils = App.Utils;
  var API = global.API;

  App.Router.register('/chat', function () { render(); });

  function t(key, vars) { return App.I18n ? App.I18n.t(key, vars) : key; }
  function en() { return App.I18n && App.I18n.isEn(); }

  function render() {
    var inputPh = en()
      ? 'Type your home-buying question (Enter to send, Shift+Enter for newline)…'
      : '输入你想咨询的购房问题（Enter 发送，Shift+Enter 换行）…';
    var html = '' +
      '<div class="chat-layout">' +
        '<div class="chat-main">' +
          '<div class="chat-messages" id="chatMessages"></div>' +
          '<div class="chat-input-bar">' +
            '<textarea id="chatInput" placeholder="' + inputPh + '" rows="1"></textarea>' +
            '<button class="btn btn-outline chat-voice-btn" id="chatVoice" type="button" title="' + t('chat.voiceInput') + '" aria-label="' + t('chat.voiceInput') + '" aria-pressed="false">🎙️</button>' +
            '<button class="btn btn-primary" id="chatSend">' + t('common.send') + '</button>' +
          '</div>' +
          '<div class="chat-voice-status" id="chatVoiceStatus" aria-live="polite"></div>' +
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
      var hint = en()
        ? "Hi! I'm your AI home-buying advisor. Tell me about your situation and I'll help you find a home."
        : '你好！我是 AI 购房助手，告诉我你的情况，我来帮你找房子。';
      html += '' +
        '<div style="text-align:center;padding:30px 10px 20px;color:#999">' +
          '<div style="font-size:36px;margin-bottom:8px">🤖</div>' +
          '<p>' + hint + '</p>' +
          '<div style="margin-top:12px;display:flex;flex-wrap:wrap;gap:6px;justify-content:center">' +
            '<button class="btn btn-outline btn-sm" onclick="quickAsk(\'' + (en() ? 'I want to buy in Shanghai, budget around 15 million' : '我想在上海买房，预算1500万左右') + '\')">💰 ' + (en() ? 'Budget 15M' : '预算1500万买房') + '</button>' +
            '<button class="btn btn-outline btn-sm" onclick="quickAsk(\'' + (en() ? 'Family of three looking for high-rise lake view' : '三口之家想买湖景高层') + '\')">🏠 ' + (en() ? 'Lake view' : '湖景高层') + '</button>' +
            '<button class="btn btn-outline btn-sm" onclick="quickAsk(\'' + (en() ? 'How much down payment for a first home?' : '首套房首付大概要多少') + '\')">❓ ' + (en() ? 'Down payment' : '首付咨询') + '</button>' +
          '</div>' +
        '</div>';
    }

    history.forEach(function (msg) {
      if (msg.role === 'user') {
        html += '' +
          '<div style="display:flex;gap:8px;flex-direction:row-reverse">' +
            '<div class="chat-avatar avatar-user">' + t('common.me') + '</div>' +
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
    var escText = Utils.esc(text);
    escText = escText.replace(/\[([a-z0-9-]+)\]/gi, function (match, id) {
      return '<a href="#/property/' + id + '" style="color:#1677ff;font-weight:600">[' + id + ']</a>';
    });
    return escText;
  }

  // 聊天内联房源卡片
  function renderInlinePropCard(propId) {
    var cached = global._propCache || [];
    var p = cached.find(function (x) { return x.id === propId; });
    if (!p) return '<div class="ai-prop-card"><div class="ai-prop-card-head"><span>' + t('common.detail') + ' ' + propId + '</span></div></div>';

    return '' +
      '<div class="ai-prop-card" onclick="location.hash=\'#/property/' + p.id + '\'">' +
        '<div class="ai-prop-card-head">' +
          '<span style="font-weight:600">' + Utils.esc(p.community) + ' ' + Utils.esc(p.building) + ' ' + Utils.esc(p.unit) + '</span>' +
          '<span class="ai-prop-card-price">' + App.I18n.wan(p.totalPrice) + '</span>' +
        '</div>' +
        '<div class="ai-prop-card-info">' +
          p.area + 'm² | ' + App.I18n.rooms(p.rooms) + ' | ' +
          App.I18n.floor(p.floor) + ' | ' + p.orientation + ' | ' + t('common.unitPrice') + App.I18n.unitPrice(p.unitPrice) +
        '</div>' +
        '<div class="ai-prop-card-actions">' +
          '<a class="btn btn-primary btn-sm" href="#/property/' + p.id + '">📖 ' + t('common.detail') + '</a>' +
          '<a class="btn btn-outline btn-sm" href="#/messages/' + p.id + '">💬 ' + t('common.contactSeller').replace('💬 ', '') + '</a>' +
          '<a class="btn btn-outline btn-sm" href="#/viewing/' + p.id + '">📅 ' + (en() ? 'Book Viewing' : '预约看房') + '</a>' +
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

    row(t('common.community'), App.I18n.city(p.city || p.targetCity));
    row(t('home.f_view_t').replace('📅 ', ''), p.familySize ? p.familySize + (en() ? ' people' : ' 人') : null);
    row(en() ? 'First home' : '首套', p.firstHome != null ? App.I18n.yesNo(p.firstHome) : null);
    row(en() ? 'Budget' : '预算', p.budget ? App.I18n.wan(p.budget) : null);
    row(en() ? 'Down payment' : '首付', p.downPayment ? App.I18n.wan(p.downPayment) : null);
    row(en() ? 'Max monthly' : '月供上限', p.monthlyPaymentMax ? p.monthlyPaymentMax + (en() ? ' CNY' : ' 元') : null);
    row(t('common.layout'), r.roomCount ? r.roomCount + (en() ? ' BR' : ' 室') : null);
    row(en() ? 'Elevator' : '电梯', r.needElevator ? (en() ? 'Required' : '必须有') : null);
    row(t('common.area'), (r.minArea || p.minArea) ? (r.minArea || p.minArea) + '~' + (r.maxArea || t('common.noData')) + ' m²' : null);
    row(en() ? 'Floor preference' : '楼层偏好', r.floorPreference);
    row(t('common.orientation'), r.orientation);
    row(en() ? 'To metro' : '距地铁', r.metroDistance ? '≤' + r.metroDistance + ' m' : null);
    row(en() ? 'Work location' : '工作地', p.workAddress);

    var badgeColor = completeness >= 80 ? 'tag-green' : completeness >= 40 ? 'tag-blue' : 'tag-gray';
    var badgeText = completeness >= 80 ? (en() ? 'Ready for matches' : '可以推荐房源') : completeness >= 40 ? (en() ? 'Learning more' : '继续了解中') : (en() ? 'Just started' : '刚开始');

    var html = '' +
      '<div class="profile-panel">' +
        '<h4>👤 ' + (en() ? 'Buyer Profile' : '买家画像') + '</h4>' +
        (rows.length ? rows.join('') : '<p style="color:#999;padding:8px 0">' + (en() ? 'No information yet — start chatting with the AI' : '还没有信息，去和 AI 对话吧') + '</p>') +
        '<div class="profile-completeness">' +
          '<div class="profile-completeness-bar" style="width:' + completeness + '%"></div>' +
        '</div>' +
        '<div style="margin-top:6px;display:flex;justify-content:space-between;align-items:center">' +
          '<span class="profile-badge">' + (en() ? 'Completeness ' : '完整度 ') + completeness + '%</span>' +
          '<span class="tag ' + badgeColor + '">' + badgeText + '</span>' +
        '</div>' +
        '<div style="margin-top:12px;border-top:1px solid #eee;padding-top:10px">' +
          '<a href="#/properties" class="btn btn-outline btn-block btn-sm">' + (en() ? 'Browse all listings' : '浏览全部房源') + '</a>' +
        '</div>' +
      '</div>';

    document.getElementById('chatSide').innerHTML = html;
  }

  function bindInput() {
    var input = document.getElementById('chatInput');
    var sendBtn = document.getElementById('chatSend');
    var voiceBtn = document.getElementById('chatVoice');

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
    input.oninput = function () {
      resizeInput(input);
    };

    bindVoiceInput(input, voiceBtn);
  }

  function resizeInput(input) {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 100) + 'px';
  }

  function bindVoiceInput(input, voiceBtn) {
    var Recognition = global.SpeechRecognition || global.webkitSpeechRecognition;
    var status = document.getElementById('chatVoiceStatus');
    if (!Recognition) {
      voiceBtn.disabled = true;
      voiceBtn.title = t('chat.voiceUnsupported');
      voiceBtn.setAttribute('aria-label', t('chat.voiceUnsupported'));
      showVoiceStatus(status, t('chat.voiceUnsupported'), true);
      return;
    }

    var recognition = null;
    var listening = false;
    var initialText = '';
    var finalText = '';

    function setListening(active) {
      listening = active;
      voiceBtn.classList.toggle('is-listening', active);
      voiceBtn.setAttribute('aria-pressed', String(active));
      voiceBtn.textContent = active ? '⏹' : '🎙️';
      voiceBtn.title = active ? t('chat.voiceStop') : t('chat.voiceInput');
      voiceBtn.setAttribute('aria-label', voiceBtn.title);
      if (active) showVoiceStatus(status, t('chat.voiceListening'));
      else if (!status.classList.contains('is-error')) status.textContent = '';
    }

    voiceBtn.onclick = function () {
      if (listening && recognition) {
        recognition.stop();
        return;
      }

      recognition = new Recognition();
      recognition.lang = en() ? 'en-US' : 'zh-CN';
      recognition.continuous = false;
      recognition.interimResults = true;
      initialText = input.value.trim();
      finalText = '';

      recognition.onstart = function () { setListening(true); };
      recognition.onresult = function (event) {
        var interimText = '';
        for (var i = event.resultIndex; i < event.results.length; i++) {
          var transcript = event.results[i][0].transcript;
          if (event.results[i].isFinal) finalText += transcript;
          else interimText += transcript;
        }
        input.value = joinVoiceText(initialText, finalText + interimText);
        resizeInput(input);
      };
      recognition.onerror = function (event) {
        var message = event.error === 'not-allowed' || event.error === 'service-not-allowed'
          ? t('chat.voiceNoPermission')
          : t('chat.voiceError');
        showVoiceStatus(status, message, true);
      };
      recognition.onend = function () {
        if (finalText) input.value = joinVoiceText(initialText, finalText);
        resizeInput(input);
        setListening(false);
      };

      try { recognition.start(); }
      catch (err) { showVoiceStatus(status, t('chat.voiceError'), true); }
    };
  }

  function joinVoiceText(existing, spoken) {
    if (!existing) return spoken.trim();
    if (!spoken) return existing;
    return existing + (/[。！？.!?]$/.test(existing) ? ' ' : '，') + spoken.trim();
  }

  function showVoiceStatus(status, message, isError) {
    status.textContent = message;
    status.classList.toggle('is-error', !!isError);
  }

  function sendToAI(text) {
    // 保存用户消息
    Store.addChat({ role: 'user', content: text, time: new Date().toISOString() });
    // 从用户消息中提取画像信息
    API.updateProfileFromChat(text, '');
    renderMessages();
    renderSidePanel();

    showTyping();

    API.loadProperties().then(function (list) { global._propCache = list; }).catch(function () {});

    API.callAI(text).then(function (reply) {
      hideTyping();
      var propIds = API.extractPropertyIds(reply);
      Store.addChat({ role: 'ai', content: reply, propIds: propIds, time: new Date().toISOString() });
      renderMessages();
      renderSidePanel();
      Store.syncToServer().catch(function () {});
    }).catch(function (err) {
      hideTyping();
      var errMsg = err.message || String(err);
      var failText = en()
        ? ('⚠️ Sorry, the AI service is temporarily unavailable: ' + errMsg + '\n\nYou can browse listings or try again later.')
        : ('⚠️ 抱歉，AI 服务暂时不可用：' + errMsg + '\n\n你可以先浏览房源，或稍后再试。');
      Store.addChat({ role: 'ai', content: failText, time: new Date().toISOString() });
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
      '<div class="chat-bubble ai" style="color:#999">' + (en() ? 'Thinking...' : '正在思考中...') + '</div>';
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
