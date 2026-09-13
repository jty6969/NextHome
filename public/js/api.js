/* Nexthome - AI API 客户端 */
(function (global) {
  'use strict';

  var App = global.App;
  var Store = App.Store;

  /* ============ 用户档案文本（AI 记忆文档） ============ */
  function buildProfileText() {
    var d = Store.get();
    var p = d.profile || {};
    var r = d.requirements || {};
    var lines = [];

    if (p.city || p.targetCity) lines.push('目标城市：' + (p.city || p.targetCity));
    if (p.familySize) lines.push('家庭人口：' + p.familySize + ' 人');
    if (p.maritalStatus) lines.push('婚姻状况：' + p.maritalStatus);
    if (p.hukou) lines.push('户籍：' + p.hukou);
    if (p.socialSecurityMonths != null) lines.push('社保月数：' + p.socialSecurityMonths);
    if (p.firstHome != null) lines.push('是否首套：' + (p.firstHome ? '是' : '否'));
    if (p.totalBudgetMin || p.budget) lines.push('预算：' + (p.totalBudgetMin || p.budget) + '~' + (p.totalBudgetMax || '不限') + ' 万');
    if (p.downPayment) lines.push('首付可出：' + p.downPayment + ' 万');
    if (p.monthlyPaymentMax) lines.push('月供上限：' + p.monthlyPaymentMax + ' 元');
    if (r.roomCount || p.roomCount) lines.push('户型需求：' + (r.roomCount || p.roomCount) + ' 室');
    if (r.minArea || p.minArea) lines.push('面积需求：' + (r.minArea || p.minArea) + '~' + (r.maxArea || '不限') + ' ㎡');
    if (r.floorPreference || p.floorPreference) lines.push('楼层偏好：' + (r.floorPreference || p.floorPreference));
    if (r.orientation || p.orientation) lines.push('朝向偏好：' + (r.orientation || p.orientation));
    if (r.metroDistance || p.metroDistance) lines.push('距地铁：≤' + (r.metroDistance || p.metroDistance) + ' 米');
    if (r.decorationPreference || p.decorationPreference) lines.push('装修偏好：' + (r.decorationPreference || p.decorationPreference));
    if (r.needElevator) lines.push('电梯要求：必须有电梯');
    if (p.workAddress || r.commuteAddress) lines.push('工作地点：' + (p.workAddress || r.commuteAddress));
    if (p.commuteMinutes) lines.push('通勤可承受：≤' + p.commuteMinutes + ' 分钟');
    if (r.surroundingReq) lines.push('配套要求：' + r.surroundingReq);
    if (r.otherReq) lines.push('其他要求：' + r.otherReq);
    if (p.notes) lines.push('备注：' + p.notes);

    if (!lines.length) return '【用户档案】暂无信息，请主动询问买家情况。';
    return '【用户档案】\n' + lines.join('\n');
  }

  /* ============ 房源数据缓存 ============ */
  var _propsCache = null;

  function loadProperties() {
    if (_propsCache) return Promise.resolve(_propsCache);
    return fetch('/api/properties').then(function (r) { return r.json(); }).then(function (list) {
      _propsCache = list;
      return list;
    });
  }

  function loadProperty(id) {
    return loadProperties().then(function (list) {
      return list.find(function (p) { return p.id === id; });
    });
  }

  /* ============ 房源列表文本（发给 AI） ============ */
  function buildPropertiesText() {
    return loadProperties().then(function (list) {
      var lines = list.map(function (p) {
        var parts = [
          '[' + p.id + '] ' + p.community + ' ' + p.building + ' ' + p.unit,
          p.totalPrice + '万',
          '单价' + p.unitPrice + '万/㎡',
          p.area + '㎡',
          p.rooms.bedroom + '室' + p.rooms.livingRoom + '厅' + p.rooms.bathroom + '卫',
          p.floor.level + '/' + p.floor.total + '层',
          p.orientation,
          p.decoration,
          (2026 - p.buildYear) + '年楼龄',
          (p.floor.total >= 7 || p.rooms.bedroom >= 3) ? '有电梯' : '无电梯',
          '距地铁' + p.surrounding.metro.distance + '米',
          '挂牌' + p.daysOnMarket + '天/降价' + p.priceDropCount + '次'
        ];
        if (p.highlights && p.highlights.length) parts.push('亮点:' + p.highlights.join('、'));
        if (p.compromise) parts.push('妥协点:' + p.compromise);
        return parts.join('，');
      });
      return '【在售房源共 ' + list.length + ' 套】\n' + lines.join('\n');
    });
  }

  /* ============ 用户行为记忆文本（专门给 AI 看的历史行为） ============ */
  function buildMemoryText() {
    var d = Store.get();
    var lines = [];

    // 最近行为（倒序取 15 条再正序展示）
    var mem = (d.aiMemory || []).slice(-15);
    if (mem.length) {
      lines.push('【买家近期行为记录】');
      mem.forEach(function (m) {
        var t = '';
        try { t = new Date(m.time).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' }); } catch (e) { t = ''; }
        lines.push('- [' + m.type + '] ' + m.text + '（' + t + '）');
      });
    }

    // 浏览过的房源（最近 8 套）
    var browsed = (d.browsingHistory || []).slice(0, 8);
    if (browsed.length) {
      lines.push('【买家浏览过的房源】');
      browsed.forEach(function (b) {
        lines.push('- ' + b.title + '（' + b.totalPrice + '万，' + b.area + '㎡）');
      });
    }

    // 收藏
    if (d.favorites && d.favorites.length) {
      lines.push('【收藏房源数】' + d.favorites.length + ' 套');
    }

    // 进行中的交易
    if (d.transactions && d.transactions.length) {
      lines.push('【交易进度】');
      d.transactions.forEach(function (tx) {
        var done = (tx.steps || []).filter(function (s) { return s.done; }).length;
        lines.push('- ' + tx.propertyTitle + '：成交价 ' + tx.agreedPrice + ' 万，流程进行到第 ' + (done + 1) + ' 步');
      });
    }

    return lines.length ? lines.join('\n') : '';
  }

  /* ============ 调用 AI ============ */
  function callAI(userMessage, options) {
    options = options || {};
    return Promise.all([
      Promise.resolve(buildProfileText()),
      buildPropertiesText(),
      Promise.resolve(buildMemoryText())
    ]).then(function (results) {
      var profileText = results[0];
      var propsText = results[1];
      var memoryText = results[2];

      var systemPrompt = [
        '你是 Nexthome AI 购房助手，专门帮助中国普通买家买房。',
        '你的工作流程：',
        '1. 了解买家情况（家庭、预算、户型、楼层、区域、通勤、配套偏好等）',
        '2. 信息不完整时主动追问，每次只问 1-2 个最关键的问题',
        '3. 信息足够后，从下方在售房源中推荐 2-3 套最匹配的',
        '4. 推荐时用 [房源ID] 格式引用房源（如 [lshy-1] 或 [smhb-3]），并说明推荐理由',
        '5. 对每套房源给出简短评价（优点和妥协点）',
        '',
        profileText,
        memoryText ? ('\n' + memoryText) : '',
        '',
        propsText,
        '',
        '注意：',
        '- 只推荐上述真实存在的房源，不要编造',
        '- 结合买家的浏览/收藏/议价行为给出连贯建议（例如买家已在某套议价，可主动问进展）',
        '- 如果买家预算和房源差距大，如实告知并建议调整',
        '- 回复用中文，语言亲切专业',
        '- 推荐房源时在回复中用 [房源ID] 标注，格式：[lshy-1]'
      ].join('\n');

      // 聊天历史（最近 8 条）
      var history = Store.get().chatHistory.slice(-8).map(function (m) {
        return { role: m.role === 'user' ? 'user' : 'assistant', content: m.content };
      });

      var messages = [
        { role: 'system', content: systemPrompt }
      ].concat(history);
      if (userMessage) {
        messages.push({ role: 'user', content: userMessage });
      }

      return fetch('/api/ai', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + (App.Auth ? App.Auth.token : '')
        },
        body: JSON.stringify({
          messages: messages,
          timeoutMs: options.timeoutMs || 30000
        })
      });
    }).then(function (r) {
      if (!r.ok) return r.json().then(function (e) { throw new Error(e.error || 'AI 请求失败'); });
      return r.json();
    }).then(function (data) {
      var content = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
      if (!content) throw new Error('AI 返回为空');
      return content;
    });
  }

  /* ============ 从 AI 回复中提取房源 ID ============ */
  function extractPropertyIds(text) {
    var ids = [];
    var regex = /\[([a-z0-9-]+)\]/gi;
    var match;
    while ((match = regex.exec(text)) !== null) {
      if (ids.indexOf(match[1]) < 0) ids.push(match[1]);
    }
    return ids;
  }

  /* ============ 卖家自动回复 ============ */
  function sellerReply(propertyId, message) {
    return fetch('/api/seller-reply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ propertyId: propertyId, message: message })
    }).then(function (r) { return r.json(); });
  }

  /* ============ 用户数据同步 ============ */
  function syncUser() {
    return Store.syncToServer();
  }

  /* ============ 画像提取（从 AI 回复中更新画像） ============ */

  // 中文数字转阿拉伯数字（支持 一~十）
  var CN_NUM = { '一': 1, '二': 2, '两': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10 };
  function cnToInt(s) { return CN_NUM[s] || parseInt(s); }

  function updateProfileFromChat(userText, aiText) {
    // 简单关键词提取：从用户消息中提取关键信息更新画像
    var d = Store.get();
    var p = d.profile, r = d.requirements;

    // 预算（支持中文数字，如"预算一千五百万"少见但"预算三百万"常见）
    var budgetMatch = userText.match(/预算\s*([一两二三四五六七八九十\d百]+)\s*万/) || userText.match(/([一两二三四五六七八九十\d百]+)\s*万\s*(?:左右|以内|预算)/);
    if (budgetMatch) {
      var bNum = parseCnAmount(budgetMatch[1]);
      if (bNum) { p.totalBudgetMin = Math.round(bNum * 0.9); p.totalBudgetMax = Math.round(bNum * 1.1); p.budget = bNum; }
    }

    // 首付
    var dpMatch = userText.match(/首付.*?([一两二三四五六七八九十\d百]+)\s*万/);
    if (dpMatch) { var dp = parseCnAmount(dpMatch[1]); if (dp) p.downPayment = dp; }

    // 面积
    var areaMatch = userText.match(/(\d+)\s*[-~到]\s*(\d+)\s*平/) || userText.match(/(\d+)\s*平/);
    if (areaMatch) { if (areaMatch[2]) { r.minArea = parseInt(areaMatch[1]); r.maxArea = parseInt(areaMatch[2]); } else r.minArea = parseInt(areaMatch[1]); }

    // 户型（支持"三室""3室""三房"）
    var roomMatch = userText.match(/([一两二三四五\d])\s*室/) || userText.match(/([一两二三四五\d])\s*房(?!价|源)/);
    if (roomMatch) r.roomCount = cnToInt(roomMatch[1]);

    // 楼层
    if (/高楼层|高层/.test(userText)) r.floorPreference = '高楼层';
    if (/低楼层|底层|低层/.test(userText)) r.floorPreference = '低楼层';
    if (/中楼层|中层/.test(userText)) r.floorPreference = '中楼层';

    // 朝向
    if (/朝南|南向/.test(userText)) r.orientation = '南';
    if (/朝北|北向/.test(userText)) r.orientation = '北';

    // 城市
    if (/上海/.test(userText)) p.city = '上海';
    if (/北京/.test(userText)) p.city = '北京';

    // 地铁
    var metroMatch = userText.match(/地铁.*?(\d+)\s*米/) || userText.match(/(\d+)\s*米.*?地铁/);
    if (metroMatch) r.metroDistance = parseInt(metroMatch[1]);

    // 月供
    var mpMatch = userText.match(/月供.*?(\d+)\s*万/) || userText.match(/月供.*?(\d+)/);
    if (mpMatch) p.monthlyPaymentMax = parseInt(mpMatch[1]) * (userText.indexOf('万') >= 0 ? 10000 : 1);

    // 首套
    if (/首套|第一套/.test(userText)) p.firstHome = true;
    if (/二套|第二套/.test(userText)) p.firstHome = false;

    // 家庭人口（支持"三口人""一家三口""3口人"）
    var famMatch = userText.match(/([一两二三四五六七八九十\d])\s*口人/) || userText.match(/一家\s*([一两二三四五六七八九十\d])\s*口/);
    if (famMatch) p.familySize = cnToInt(famMatch[1]);

    // 电梯
    if (/有电梯|要电梯|需要电梯/.test(userText)) r.needElevator = true;
    if (/不要电梯|无电梯/.test(userText)) r.needElevator = false;

    Store.save();
  }

  // 解析中文金额：如 "1500" → 1500，"三十" → 30，"一百五十" → 150（万为单位场景）
  function parseCnAmount(s) {
    if (/^\d+$/.test(s)) return parseInt(s);
    // 简单中文数字解析（百以内 + 含"百"的十位组合）
    var total = 0, num = 0;
    for (var i = 0; i < s.length; i++) {
      var ch = s[i];
      if (CN_NUM[ch] != null) {
        var v = CN_NUM[ch];
        if (ch === '十') { total += (num || 1) * 10; num = 0; }
        else num = v;
      } else if (ch === '百') { total += (num || 1) * 100; num = 0; }
      else return null; // 非中文数字字符
    }
    return total + num || null;
  }

  /* ============ 导出 ============ */
  global.API = {
    callAI: callAI,
    buildProfileText: buildProfileText,
    buildPropertiesText: buildPropertiesText,
    loadProperties: loadProperties,
    loadProperty: loadProperty,
    extractPropertyIds: extractPropertyIds,
    sellerReply: sellerReply,
    syncUser: syncUser,
    updateProfileFromChat: updateProfileFromChat
  };

})(window);
