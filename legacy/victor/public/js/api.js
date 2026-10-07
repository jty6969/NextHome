/* Nexthome - AI API 客户端（系统提示词随界面语言切换） */
(function (global) {
  'use strict';

  var App = global.App;
  var Store = App.Store;

  function en() { return App.I18n && App.I18n.isEn(); }

  /* ============ 档案/房源文本标签（中英双表，避免中文片段引导 AI 输出中文） ============ */
  var LABELS = {
    zh: {
      targetCity: '目标城市', familySize: '家庭人口', people: '人',
      marital: '婚姻状况', hukou: '户籍', ssMonths: '社保月数',
      firstHome: '是否首套', yes: '是', no: '否',
      budget: '预算', unlimited: '不限', wan: '万',
      downPayment: '首付可出', maxMonthly: '月供上限', yuan: '元',
      rooms: '户型需求', roomUnit: '室',
      area: '面积需求', floor: '楼层偏好', orient: '朝向偏好',
      metro: '距地铁', meterLe: '米', deco: '装修偏好',
      elevator: '电梯要求', elevatorMust: '必须有电梯',
      work: '工作地点', commute: '通勤可承受', minutes: '分钟',
      surround: '配套要求', other: '其他要求', notes: '备注',
      profileEmpty: '【用户档案】暂无信息，请主动询问买家情况。',
      profileHeader: '【用户档案】',
      unitPrice: '单价', perSqm: '万/㎡', age: '年楼龄',
      hasElevator: '有电梯', noElevator: '无电梯',
      metroDist: '距地铁', meters: '米',
      listed: '挂牌', days: '天', cuts: '降价', times: '次',
      highlights: '亮点:', tradeoff: '妥协点:',
      listHeader: '【在售房源共 {n} 套】',
      memActions: '【买家近期行为记录】',
      memBrowsed: '【买家浏览过的房源】',
      memFav: '【收藏房源数】', memFavUnit: '套',
      memDeals: '【交易进度】',
      dealProgress: '成交价 {price} 万，流程进行到第 {step} 步'
    },
    en: {
      targetCity: 'Target city', familySize: 'Family size', people: 'people',
      marital: 'Marital status', hukou: 'Hukou', ssMonths: 'Social security (months)',
      firstHome: 'First home', yes: 'Yes', no: 'No',
      budget: 'Budget', unlimited: 'no limit', wan: 'wan',
      downPayment: 'Down payment available', maxMonthly: 'Max monthly payment', yuan: 'CNY',
      rooms: 'Rooms needed', roomUnit: 'BR',
      area: 'Area needed', floor: 'Floor preference', orient: 'Orientation preference',
      metro: 'Distance to metro', meterLe: 'm', deco: 'Decoration preference',
      elevator: 'Elevator', elevatorMust: 'Elevator required',
      work: 'Work location', commute: 'Max commute', minutes: 'min',
      surround: 'Surrounding requirements', other: 'Other requirements', notes: 'Notes',
      profileEmpty: '[Buyer Profile] No information yet; please proactively ask the buyer about their situation.',
      profileHeader: '[Buyer Profile]',
      unitPrice: 'Unit price', perSqm: 'wan/m²', age: 'years old',
      hasElevator: 'elevator', noElevator: 'no elevator',
      metroDist: 'Metro distance', meters: 'm',
      listed: 'Listed', days: 'days', cuts: 'price cuts', times: '',
      highlights: 'Highlights: ', tradeoff: 'Trade-off: ',
      listHeader: '[{n} on-sale listings]',
      memActions: '[Recent buyer actions]',
      memBrowsed: '[Browsed listings]',
      memFav: '[Saved listings]', memFavUnit: '',
      memDeals: '[Deal progress]',
      dealProgress: 'agreed price {price} wan, currently at step {step}'
    }
  };
  function L() { return en() ? LABELS.en : LABELS.zh; }

  /* 行为类型英文化（AI 记忆文本） */
  var ACTION_EN = {
    '收藏': 'Saved listing', '取消收藏': 'Unsaved listing', '浏览': 'Browsed listing',
    '预约看房': 'Booked viewing', '成交议价': 'Reached deal'
  };

  /* ============ 用户档案文本（AI 记忆文档） ============ */
  function buildProfileText() {
    var d = Store.get();
    var p = d.profile || {};
    var r = d.requirements || {};
    var t = L();
    var lines = [];

    if (p.city || p.targetCity) lines.push(t.targetCity + ': ' + App.I18n.city(p.city || p.targetCity));
    if (p.familySize) lines.push(t.familySize + ': ' + p.familySize + ' ' + t.people);
    if (p.maritalStatus) lines.push(t.marital + ': ' + p.maritalStatus);
    if (p.hukou) lines.push(t.hukou + ': ' + p.hukou);
    if (p.socialSecurityMonths != null) lines.push(t.ssMonths + ': ' + p.socialSecurityMonths);
    if (p.firstHome != null) lines.push(t.firstHome + ': ' + (p.firstHome ? t.yes : t.no));
    if (p.totalBudgetMin || p.budget) lines.push(t.budget + ': ' + (p.totalBudgetMin || p.budget) + '~' + (p.totalBudgetMax || t.unlimited) + ' ' + t.wan);
    if (p.downPayment) lines.push(t.downPayment + ': ' + p.downPayment + ' ' + t.wan);
    if (p.monthlyPaymentMax) lines.push(t.maxMonthly + ': ' + p.monthlyPaymentMax + ' ' + t.yuan);
    if (r.roomCount || p.roomCount) lines.push(t.rooms + ': ' + (r.roomCount || p.roomCount) + ' ' + t.roomUnit);
    if (r.minArea || p.minArea) lines.push(t.area + ': ' + (r.minArea || p.minArea) + '~' + (r.maxArea || t.unlimited) + ' m²');
    if (r.floorPreference || p.floorPreference) lines.push(t.floor + ': ' + (r.floorPreference || p.floorPreference));
    if (r.orientation || p.orientation) lines.push(t.orient + ': ' + (r.orientation || p.orientation));
    if (r.metroDistance || p.metroDistance) lines.push(t.metro + ': ≤' + (r.metroDistance || p.metroDistance) + ' ' + t.meterLe);
    if (r.decorationPreference || p.decorationPreference) lines.push(t.deco + ': ' + (r.decorationPreference || p.decorationPreference));
    if (r.needElevator) lines.push(t.elevator + ': ' + t.elevatorMust);
    if (p.workAddress || r.commuteAddress) lines.push(t.work + ': ' + (p.workAddress || r.commuteAddress));
    if (p.commuteMinutes) lines.push(t.commute + ': ≤' + p.commuteMinutes + ' ' + t.minutes);
    if (r.surroundingReq) lines.push(t.surround + ': ' + r.surroundingReq);
    if (r.otherReq) lines.push(t.other + ': ' + r.otherReq);
    if (p.notes) lines.push(t.notes + ': ' + p.notes);

    if (!lines.length) return t.profileEmpty;
    return t.profileHeader + '\n' + lines.join('\n');
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
      var t = L();
      var lines = list.map(function (p) {
        var parts = [
          '[' + p.id + '] ' + p.community + ' ' + p.building + ' ' + p.unit,
          p.totalPrice + t.wan,
          t.unitPrice + p.unitPrice + t.perSqm,
          p.area + 'm²',
          App.I18n.rooms(p.rooms),
          App.I18n.floor(p.floor),
          p.orientation,
          p.decoration,
          (2026 - p.buildYear) + ' ' + t.age,
          (p.floor.total >= 7 || p.rooms.bedroom >= 3) ? t.hasElevator : t.noElevator,
          t.metroDist + ' ' + p.surrounding.metro.distance + t.meters,
          t.listed + p.daysOnMarket + t.days + ' / ' + t.cuts + p.priceDropCount + t.times
        ];
        if (p.highlights && p.highlights.length) parts.push(t.highlights + p.highlights.join('、'));
        if (p.compromise) parts.push(t.tradeoff + p.compromise);
        return parts.join(', ');
      });
      return t.listHeader.replace('{n}', list.length) + '\n' + lines.join('\n');
    });
  }

  /* ============ 用户行为记忆文本（专门给 AI 看的历史行为） ============ */
  function buildMemoryText() {
    var d = Store.get();
    var t = L();
    var lines = [];

    // 最近行为（倒序取 15 条再正序展示）
    var mem = (d.aiMemory || []).slice(-15);
    if (mem.length) {
      lines.push(t.memActions);
      mem.forEach(function (m) {
        var dateStr = '';
        try { dateStr = new Date(m.time).toLocaleDateString(en() ? 'en-US' : 'zh-CN', { month: '2-digit', day: '2-digit' }); } catch (e) { dateStr = ''; }
        var typeText = en() && ACTION_EN[m.type] ? ACTION_EN[m.type] : m.type;
        lines.push('- [' + typeText + '] ' + m.text + ' (' + dateStr + ')');
      });
    }

    // 浏览过的房源（最近 8 套）
    var browsed = (d.browsingHistory || []).slice(0, 8);
    if (browsed.length) {
      lines.push(t.memBrowsed);
      browsed.forEach(function (b) {
        lines.push('- ' + b.title + ' (' + b.totalPrice + t.wan + ', ' + b.area + 'm²)');
      });
    }

    // 收藏
    if (d.favorites && d.favorites.length) {
      lines.push(t.memFav + ' ' + d.favorites.length + ' ' + t.memFavUnit);
    }

    // 进行中的交易
    if (d.transactions && d.transactions.length) {
      lines.push(t.memDeals);
      d.transactions.forEach(function (tx) {
        var done = (tx.steps || []).filter(function (s) { return s.done; }).length;
        lines.push('- ' + tx.propertyTitle + ': ' + t.dealProgress
          .replace('{price}', tx.agreedPrice).replace('{step}', done + 1));
      });
    }

    return lines.length ? lines.join('\n') : '';
  }

  /* ============ 咨询阶段检查（防止过早推荐） ============ */
  function buildConsultationStatus() {
    var d = Store.get();
    var p = d.profile || {};
    var r = d.requirements || {};
    var checks = [
      {
        zh: '家庭与购房目的（家庭成员、现在/未来居住安排、是否首套）',
        en: 'Household and purchase purpose (family, current/future living plan, first-home status)',
        done: !!(p.familySize || p.maritalStatus || p.firstHome != null || p.notes)
      },
      {
        zh: '总预算与资金方案（总价、首付现金或月供上限）',
        en: 'Budget and funding plan (total budget plus down payment or monthly-payment limit)',
        done: !!((p.totalBudgetMin || p.budget) && (p.downPayment || p.monthlyPaymentMax))
      },
      {
        zh: '目标区域与通勤（工作/学校地点、通勤时长或偏好板块）',
        en: 'Location and commute (work/school location, commute limit, or preferred area)',
        done: !!(p.workAddress || r.commuteAddress || p.commuteMinutes || r.surroundingReq)
      },
      {
        zh: '房屋规格（户型、面积或房间功能）',
        en: 'Home specifications (layout, size, or room use)',
        done: !!((r.roomCount || p.roomCount) && (r.minArea || p.minArea))
      },
      {
        zh: '不可妥协条件与生活配套（如地铁、学区、商场、楼层、电梯、停车、装修）',
        en: 'Non-negotiables and amenities (metro, school, shops, floor, elevator, parking, decoration)',
        done: !!(r.metroDistance || r.needElevator || r.floorPreference || r.orientation || r.decorationPreference || r.surroundingReq || r.otherReq)
      }
    ];
    var missing = checks.filter(function (item) { return !item.done; });
    var labels = missing.map(function (item) { return en() ? item.en : item.zh; });
    if (en()) {
      return '[Consultation status] ' + (checks.length - missing.length) + '/' + checks.length + ' decision areas are known. '
        + (labels.length ? 'Still missing: ' + labels.join('; ') + '.' : 'All decision areas are covered; you may move to a shortlist.');
    }
    return '【咨询阶段】已了解 ' + (checks.length - missing.length) + '/' + checks.length + ' 类决策信息。'
      + (labels.length ? '仍缺：' + labels.join('；') + '。' : '关键信息已齐，可以进入房源初筛。');
  }

  /* ============ 系统提示词（中英双版本） ============ */
  function buildSystemPrompt(profileText, memoryText, propsText, consultationStatus) {
    if (en()) {
      return [
        'You are the Nexthome AI home-buying advisor, helping ordinary home buyers in China.',
        'Act like a careful, experienced buyer-side advisor — not a listing vending machine.',
        'Consultation workflow:',
        '1. First understand the buyer. Build a decision brief across: household/purchase purpose, total budget and funding plan, location/commute, home specifications, and non-negotiables/amenities.',
        '2. At the start of every turn, silently check what is already known and what is missing. Never ask for information that is already in the profile or conversation.',
        '3. When information is incomplete, briefly acknowledge what you understood, explain why the next question matters, and ask only 1-2 high-value, specific questions. Prefer questions that reveal trade-offs, not generic questionnaires.',
        '4. Treat budget as more than total price: clarify down payment, mortgage/monthly-payment comfort, taxes/fees and emergency reserve when relevant. For China-specific eligibility, sensitively clarify first-home status, hukou/social-security eligibility only if it affects the buyer’s case.',
        '5. Separate non-negotiables from preferences. Surface conflicts early (for example, school/commute versus area/budget) and help the buyer choose a trade-off.',
        '6. Only after the recommendation gate below is passed, summarize the confirmed brief and recommend 2-3 best-matching listings. Then cite each listing as [ListingID], explain fit, trade-offs, and one concrete verification question for the seller/viewing.',
        'Recommendation gate (strict): Do NOT mention, tag, rank, or recommend any specific listing ID until all five decision areas are reasonably understood: (a) household/purpose, (b) budget AND funding plan, (c) location/commute, (d) layout AND area, and (e) at least one non-negotiable or amenity. This rule applies even if the buyer asks for recommendations early. Instead, explain the smallest missing information needed and continue discovery.',
        'If the gate is passed but the buyer has not explicitly asked for listings, present a concise requirement summary and ask whether they want a shortlist now.',
        '',
        profileText,
        consultationStatus,
        memoryText ? ('\n' + memoryText) : '',
        '',
        propsText,
        '',
        'Notes:',
        '- Only recommend the real listings listed above; never invent listings',
        '- Give coherent advice based on the buyer browsing/saving/negotiation history',
        '- If the buyer budget is far from the listings, say so honestly and suggest adjustments',
        '- When recommending, always tag listings as [lshy-1] with brackets',
        '- Source listing names, addresses, and historical records may be in Chinese. Keep a Chinese proper name only when needed for identification, but write every explanation, label, and complete sentence in English.',
        '- Output must be in English only, with a friendly and professional tone. Do not mirror the language of older chat history.'
      ].join('\n');
    }
    return [
      '你是 Nexthome AI 购房助手，专门帮助中国普通买家买房。',
      '请像审慎、专业的买方顾问一样工作，而不是用户说几句就机械推房。',
      '咨询工作流：',
      '1. 先建立购房决策简报，系统了解五类信息：家庭与购房目的、总预算与资金方案、区域与通勤、房屋规格、不可妥协条件与生活配套。',
      '2. 每一轮都在心里检查已知和缺失信息；用户已经说过或档案中已有的内容不要重复问。',
      '3. 信息不完整时，先简短复述你理解到的重点，再说明下一问为什么影响选择；每次只问 1-2 个信息价值最高、具体且能帮助做取舍的问题，避免像填问卷一样连环追问。',
      '4. 预算不能只问总价：在适合的时机了解首付现金、可接受月供、税费/装修预留。若确实影响方案，再谨慎了解首套、户籍/社保等购房资格；不要无缘无故索要敏感信息。',
      '5. 区分“必须满足”和“最好有”，尽早指出冲突（例如学区/通勤与面积/预算的冲突），帮助买家选择妥协方案。',
      '6. 只有通过下方推荐门槛后，先总结确认过的需求，再推荐 2-3 套房源；每套用 [房源ID] 标注，说明匹配点、妥协点，以及看房或联系卖家时最该核实的一个问题。',
      '推荐门槛（严格执行）：在以下五类信息都已基本了解前，禁止点名、标注、排序或推荐任何具体房源 ID：(a) 家庭/购房目的；(b) 总预算且有资金方案；(c) 区域/通勤；(d) 户型且有面积；(e) 至少一个不可妥协条件或生活配套。即使用户过早要求推荐，也要说明还差的最少关键信息，并继续了解，不得给出房源 ID。',
      '若门槛已满足、但用户尚未明确要看房源，先用简短清单确认需求，再询问是否现在开始初筛。',
      '',
      profileText,
      consultationStatus,
      memoryText ? ('\n' + memoryText) : '',
      '',
      propsText,
      '',
      '注意：',
      '- 只推荐上述真实存在的房源，不要编造',
      '- 结合买家的浏览/收藏/议价行为给出连贯建议（例如买家已在某套议价，可主动问进展）',
      '- 如果买家预算和房源差距大，如实告知并建议调整',
      '- 推荐房源时在回复中用 [房源ID] 标注，格式：[lshy-1]',
      '- 只用中文回复，语言亲切专业。'
    ].join('\n');
  }

  /* ============ 调用 AI ============ */
  function callAI(userMessage, options) {
    options = options || {};
    return Promise.all([
      Promise.resolve(buildProfileText()),
      buildPropertiesText(),
      Promise.resolve(buildMemoryText()),
      Promise.resolve(buildConsultationStatus())
    ]).then(function (results) {
      var systemPrompt = buildSystemPrompt(results[0], results[2], results[1], results[3]);

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
          language: en() ? 'en' : 'zh',
          timeoutMs: options.timeoutMs || 30000
        })
      });
    }).then(function (r) {
      if (!r.ok) return r.json().then(function (e) { throw new Error(e.error || (en() ? 'AI request failed' : 'AI 请求失败')); });
      return r.json();
    }).then(function (data) {
      var content = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
      if (!content) throw new Error(en() ? 'AI returned empty content' : 'AI 返回为空');
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
    var d = Store.get();
    var p = d.profile, r = d.requirements;

    // 预算（中文）
    var budgetMatch = userText.match(/预算\s*([一两二三四五六七八九十\d百]+)\s*万/) || userText.match(/([一两二三四五六七八九十\d百]+)\s*万\s*(?:左右|以内|预算)/);
    if (budgetMatch) {
      var bNum = parseCnAmount(budgetMatch[1]);
      if (bNum) { p.totalBudgetMin = Math.round(bNum * 0.9); p.totalBudgetMax = Math.round(bNum * 1.1); p.budget = bNum; }
    }

    // 英语预算：budget 15 million / 1500 wan
    var enBudget = userText.match(/budget\s*(?:is|:)?\s*(\d{2,5})\s*(?:wan|million|m)?/i);
    if (enBudget && !budgetMatch) {
      var bv = parseInt(enBudget[1], 10);
      // million 场景：15 million = 1500 万
      if (/million|\bm\b/i.test(enBudget[0]) && bv < 100) bv = bv * 100;
      if (bv >= 100) { p.totalBudgetMin = Math.round(bv * 0.9); p.totalBudgetMax = Math.round(bv * 1.1); p.budget = bv; }
    }

    // 首付
    var dpMatch = userText.match(/首付.*?([一两二三四五六七八九十\d百]+)\s*万/);
    if (dpMatch) { var dp = parseCnAmount(dpMatch[1]); if (dp) p.downPayment = dp; }

    // 面积
    var areaMatch = userText.match(/(\d+)\s*[-~到]\s*(\d+)\s*平/) || userText.match(/(\d+)\s*平/)
      || userText.match(/(\d+)\s*(?:m2|m²|sqm)/i);
    if (areaMatch) { if (areaMatch[2]) { r.minArea = parseInt(areaMatch[1]); r.maxArea = parseInt(areaMatch[2]); } else r.minArea = parseInt(areaMatch[1]); }

    // 户型
    var roomMatch = userText.match(/([一两二三四五\d])\s*室/) || userText.match(/([一二三四五\d])\s*bed/i);
    if (roomMatch) r.roomCount = cnToInt(roomMatch[1]);

    // 楼层
    if (/高楼层|高层|high floor/i.test(userText)) r.floorPreference = en() ? 'High floor' : '高楼层';
    if (/低楼层|底层|低层|low floor/i.test(userText)) r.floorPreference = en() ? 'Low floor' : '低楼层';
    if (/中楼层|中层|mid(?:dle)? floor/i.test(userText)) r.floorPreference = en() ? 'Middle floor' : '中楼层';

    // 朝向
    if (/朝南|南向|south/i.test(userText)) r.orientation = en() ? 'South' : '南';
    if (/朝北|北向|north/i.test(userText)) r.orientation = en() ? 'North' : '北';

    // 城市
    if (/上海|shanghai/i.test(userText)) p.city = '上海';
    if (/北京|beijing/i.test(userText)) p.city = '北京';

    // 地铁
    var metroMatch = userText.match(/地铁.*?(\d+)\s*米/) || userText.match(/(\d+)\s*米.*?地铁/)
      || userText.match(/metro.*?(\d+)\s*m/i);
    if (metroMatch) r.metroDistance = parseInt(metroMatch[1], 10);

    // 月供
    var mpMatch = userText.match(/月供.*?(\d+)\s*万/) || userText.match(/月供.*?(\d+)/);
    if (mpMatch) p.monthlyPaymentMax = parseInt(mpMatch[1], 10) * (userText.indexOf('万') >= 0 ? 10000 : 1);

    // 首套
    if (/首套|第一套|first home/i.test(userText)) p.firstHome = true;
    if (/二套|第二套|second home/i.test(userText)) p.firstHome = false;

    // 家庭人口
    var famMatch = userText.match(/([一两二三四五六七八九十\d])\s*口人/) || userText.match(/一家\s*([一二三四五六七八九十\d])\s*口/)
      || userText.match(/family of (\d)/i);
    if (famMatch) p.familySize = cnToInt(famMatch[1]);

    // 电梯
    if (/有电梯|要电梯|需要电梯|elevator/i.test(userText)) r.needElevator = true;
    if (/不要电梯|无电梯|no elevator/i.test(userText)) r.needElevator = false;

    Store.save();
  }

  // 解析中文金额
  function parseCnAmount(s) {
    if (/^\d+$/.test(s)) return parseInt(s, 10);
    var total = 0, num = 0;
    for (var i = 0; i < s.length; i++) {
      var ch = s[i];
      if (CN_NUM[ch] != null) {
        var v = CN_NUM[ch];
        if (ch === '十') { total += (num || 1) * 10; num = 0; }
        else num = v;
      } else if (ch === '百') { total += (num || 1) * 100; num = 0; }
      else return null;
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
