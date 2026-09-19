/* Nexthome - 房源详情页（双语） */
(function (global) {
  'use strict';

  var App = global.App;
  var Store = App.Store;
  var Utils = App.Utils;
  var API = global.API;

  App.Router.register('/property/:id', function (id) { render(id); });

  function t(key, vars) { return App.I18n ? App.I18n.t(key, vars) : key; }
  function en() { return App.I18n && App.I18n.isEn(); }

  function render(id) {
    document.getElementById('page').innerHTML = '<div class="card card-pad" style="text-align:center;padding:40px"><div class="loading-spinner" style="margin:0 auto"></div><p style="margin-top:12px;color:#999">' + t('pd.loading') + '</p></div>';

    API.loadProperty(id).then(function (p) {
      if (!p) {
        document.getElementById('page').innerHTML = '<div class="empty-state"><div class="empty-state-icon">😅</div><p>' + t('pd.notExist') + '</p><a href="#/properties" class="btn btn-primary mt-16">' + t('pd.backProps') + '</a></div>';
        return;
      }
      // 记录浏览历史（同时写入 AI 行为记忆）
      Store.addBrowsing(p);
      renderDetail(p);
    }).catch(function () {
      document.getElementById('page').innerHTML = '<div class="empty-state"><div class="empty-state-icon">⚠️</div><p>' + t('pd.loadFail') + '</p></div>';
    });
  }

  function renderDetail(p) {
    var isFav = Store.isFavorite(p.id);
    var buildAge = 2026 - p.buildYear;

    var html = '' +
      // 返回链接
      '<div class="mb-16"><a href="#/properties" style="font-size:13px">' + t('pd.backList') + '</a></div>' +

      // 图库
      '<div class="detail-gallery">' +
        '<div class="gallery-main">' + Utils.esc(p.community) + '</div>' +
        '<div class="gallery-side">' +
          '<div>' + t('pd.galleryLiving') + '</div><div>' + t('pd.galleryBedroom') + '</div><div>' + t('pd.galleryKitchen') + '</div>' +
        '</div>' +
      '</div>' +

      // 标题 + 操作
      '<div class="flex justify-between items-center mb-16">' +
        '<div>' +
          '<h2 style="font-size:20px;margin-bottom:4px">' + Utils.esc(p.community) + ' ' + Utils.esc(p.building) + ' ' + Utils.esc(p.unit) + '</h2>' +
          '<p style="color:#999;font-size:13px">' + Utils.esc(p.city) + ' · ' + Utils.esc(p.district) + ' · ' + Utils.esc(p.address) + '</p>' +
        '</div>' +
        '<div class="flex gap-8">' +
          '<button class="btn ' + (isFav ? 'btn-primary' : 'btn-outline') + '" id="favBtn" onclick="toggleFav(\'' + p.id + '\')">' + (isFav ? t('common.favAdded') : t('common.favAdd')) + '</button>' +
        '</div>' +
      '</div>' +

      // 价格
      '<div class="card card-pad mb-16">' +
        '<div class="flex justify-between items-center">' +
          '<div>' +
            '<span style="font-size:28px;font-weight:700;color:#ff4d4f">' + p.totalPrice + '</span>' +
            '<span style="font-size:14px;color:#ff4d4f"> ' + (en() ? 'wan' : '万') + '</span>' +
            '<span style="margin-left:16px;color:#999;font-size:13px">' + t('common.unitPrice') + ' ' + App.I18n.unitPrice(p.unitPrice) + '</span>' +
          '</div>' +
          '<div class="flex gap-8">' +
            '<span class="tag ' + (p.priceDropCount > 0 ? 'tag-blue' : 'tag-gray') + '">' + t('pd.listedDays', { n: p.daysOnMarket }) + '</span>' +
            '<span class="tag ' + (p.priceDropCount > 0 ? 'tag-red' : 'tag-gray') + '">' + t('pd.droppedN', { n: p.priceDropCount }) + '</span>' +
          '</div>' +
        '</div>' +
        '<div style="margin-top:8px;font-size:12px;color:#999">' + t('pd.priceHistory') +
          p.priceHistory.map(function (h) { return t('pd.quoteAt', { date: h.date, price: h.price }); }).join(' → ') +
        '</div>' +
      '</div>' +

      // 基本信息
      '<div class="card card-pad mb-16">' +
        '<h3 style="font-size:16px;margin-bottom:12px">' + t('pd.basic') + '</h3>' +
        '<div class="detail-info-grid">' +
          '<div class="info-item"><span class="label">' + t('common.community') + '</span><span>' + Utils.esc(p.community) + '</span></div>' +
          '<div class="info-item"><span class="label">' + t('pd.building') + '</span><span>' + Utils.esc(p.building) + ' ' + Utils.esc(p.unit) + '</span></div>' +
          '<div class="info-item"><span class="label">' + t('common.area') + '</span><span>' + p.area + ' m²</span></div>' +
          '<div class="info-item"><span class="label">' + t('common.layout') + '</span><span>' + App.I18n.rooms(p.rooms) + '</span></div>' +
          '<div class="info-item"><span class="label">' + t('common.floor') + '</span><span>' + App.I18n.floor(p.floor) + '</span></div>' +
          '<div class="info-item"><span class="label">' + t('common.orientation') + '</span><span>' + Utils.esc(p.orientation) + '</span></div>' +
          '<div class="info-item"><span class="label">' + t('common.decoration') + '</span><span>' + Utils.esc(p.decoration) + '</span></div>' +
          '<div class="info-item"><span class="label">' + t('pd.buildYear') + '</span><span>' + t('pd.buildYearVal', { year: p.buildYear, age: buildAge }) + '</span></div>' +
          '<div class="info-item"><span class="label">' + t('pd.ownership') + '</span><span>' + t('pd.ownershipVal', { n: p.ownershipYears }) + '</span></div>' +
          '<div class="info-item"><span class="label">' + t('pd.listingDate') + '</span><span>' + Utils.esc(p.listingDate) + '</span></div>' +
        '</div>' +
      '</div>' +

      // 亮点 & 妥协点
      '<div class="card card-pad mb-16">' +
        '<h3 style="font-size:16px;margin-bottom:12px">' + t('pd.highlightsTitle') + '</h3>' +
        '<div style="margin-bottom:10px">' +
          '<span style="font-weight:600;color:#52c41a">' + t('pd.highlight') + '</span>' +
          '<div style="margin-top:4px">' +
            (p.highlights || []).map(function (h) { return '<span class="tag tag-green" style="margin:2px">' + Utils.esc(h) + '</span>'; }).join('') +
          '</div>' +
        '</div>' +
        '<div>' +
          '<span style="font-weight:600;color:#faad14">' + t('pd.compromise') + '</span>' +
          '<p style="margin-top:4px;color:#666;font-size:13px">' + Utils.esc(p.compromise || t('common.noData')) + '</p>' +
        '</div>' +
        '<div style="margin-top:10px;padding:10px;background:#f6f6f6;border-radius:4px;font-size:13px">' +
          t('pd.sellerWords') + Utils.esc(p.sellingPoint || '') +
        '</div>' +
      '</div>' +

      // 周边配套
      '<div class="card card-pad mb-16">' +
        '<h3 style="font-size:16px;margin-bottom:12px">' + t('pd.around') + '</h3>' +
        '<div style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px;font-size:13px">' +
          '<div>' + t('pd.metroText', { line: Utils.esc(p.surrounding.metro.line), station: Utils.esc(p.surrounding.metro.station), distance: p.surrounding.metro.distance }) + '</div>' +
          '<div>' + t('pd.mall') + (p.surrounding.mall || []).join('、') + '</div>' +
          '<div>' + t('pd.school') + (p.surrounding.school || []).join('、') + '</div>' +
          '<div>' + t('pd.hospital') + (p.surrounding.hospital || []).join('、') + '</div>' +
          '<div>' + t('pd.park') + (p.surrounding.park || []).join('、') + '</div>' +
        '</div>' +
      '</div>' +

      // 小区信息
      '<div class="card card-pad mb-16">' +
        '<h3 style="font-size:16px;margin-bottom:12px">' + t('pd.communityTitle') + '</h3>' +
        '<div class="detail-info-grid">' +
          '<div class="info-item"><span class="label">' + t('pd.developer') + '</span><span>' + Utils.esc(p.communityInfo.developer) + '</span></div>' +
          '<div class="info-item"><span class="label">' + t('pd.propertyFee') + '</span><span>' + t('pd.propertyFeeVal', { n: p.communityInfo.propertyFee }) + '</span></div>' +
          '<div class="info-item"><span class="label">' + t('pd.greening') + '</span><span>' + Utils.esc(p.communityInfo.greeningRate) + '</span></div>' +
          '<div class="info-item"><span class="label">' + t('pd.plotRatio') + '</span><span>' + Utils.esc(p.communityInfo.plotRatio) + '</span></div>' +
          '<div class="info-item"><span class="label">' + t('pd.totalBuildings') + '</span><span>' + t('pd.totalBuildingsVal', { n: p.communityInfo.totalBuildings }) + '</span></div>' +
          '<div class="info-item"><span class="label">' + t('pd.totalUnits') + '</span><span>' + t('pd.totalUnitsVal', { n: p.communityInfo.totalUnits }) + '</span></div>' +
          '<div class="info-item"><span class="label">' + t('pd.parking') + '</span><span>' + Utils.esc(p.communityInfo.parkingRatio) + '</span></div>' +
          '<div class="info-item"><span class="label">' + t('pd.buildYear') + '</span><span>' + Utils.esc(p.communityInfo.buildYear) + (en() ? '' : ' 年') + '</span></div>' +
        '</div>' +
      '</div>' +

      // AI 分析
      '<div class="ai-analysis-box" id="aiAnalysis">' +
        '<h4>' + t('pd.aiTitle') + '</h4>' +
        '<div id="aiAnalysisContent" style="color:#666;font-size:13px">' +
          '<button class="btn btn-primary btn-sm" onclick="loadAIAnalysis(\'' + p.id + '\')">' + t('pd.getAi') + '</button>' +
        '</div>' +
      '</div>' +

      // 卖家信息 + 操作
      '<div class="card card-pad mt-16">' +
        '<h3 style="font-size:16px;margin-bottom:12px">' + t('pd.sellerTitle') + '</h3>' +
        '<div class="flex items-center gap-12 mb-16">' +
          '<div class="chat-avatar avatar-seller">' + p.seller.avatar + '</div>' +
          '<div>' +
            '<div style="font-weight:600">' + Utils.esc(p.seller.name) + '</div>' +
            '<div style="color:#999;font-size:12px">' + p.seller.phone + '</div>' +
          '</div>' +
        '</div>' +
        '<div class="flex gap-8 flex-wrap">' +
          '<a class="btn btn-primary" href="#/messages/' + p.id + '">' + t('common.contactSeller') + '</a>' +
          '<a class="btn btn-outline" href="#/viewing/' + p.id + '">' + t('common.bookViewing') + '</a>' +
          '<a class="btn btn-outline" href="#/chat">' + t('pd.askAiThis') + '</a>' +
        '</div>' +
      '</div>';

    document.getElementById('page').innerHTML = html;
  }

  // 收藏切换
  global.toggleFav = function (propId) {
    var added = Store.toggleFavorite(propId);
    Utils.toast(added ? t('common.favDone') : t('common.favUndone'), added ? 'success' : 'warn');
    var btn = document.getElementById('favBtn');
    if (btn) {
      btn.className = 'btn ' + (added ? 'btn-primary' : 'btn-outline');
      btn.textContent = added ? t('common.favAdded') : t('common.favAdd');
    }
    Store.syncToServer().catch(function () {});
  };

  // AI 分析
  global.loadAIAnalysis = function (propId) {
    var el = document.getElementById('aiAnalysisContent');
    el.innerHTML = '<div style="display:flex;align-items:center;gap:8px;color:#999"><div class="loading-spinner" style="width:20px;height:20px"></div> ' + t('pd.aiAnalyzing') + '</div>';

    API.loadProperty(propId).then(function (p) {
      var prompt, systemPrompt;
      if (en()) {
        prompt = 'Please analyze this listing:\n' +
          'Community: ' + p.community + '\n' +
          'Area: ' + p.area + 'm², Layout: ' + App.I18n.rooms(p.rooms) + '\n' +
          'Floor: ' + App.I18n.floor(p.floor) + ', Orientation: ' + p.orientation + '\n' +
          'Total price: ' + p.totalPrice + ' wan, Unit price: ' + p.unitPrice + ' wan/m²\n' +
          'Decoration: ' + p.decoration + ', Age: ' + (2026 - p.buildYear) + ' years\n' +
          'Metro: ' + p.surrounding.metro.line + ' ' + p.surrounding.metro.station + ' ' + p.surrounding.metro.distance + 'm walk\n' +
          'Highlights: ' + (p.highlights || []).join(', ') + '\n' +
          'Trade-off: ' + (p.compromise || 'None') + '\n' +
          'Listed ' + p.daysOnMarket + ' days, price cuts ' + p.priceDropCount + '\n\n' +
          'Please analyze from these 4 angles (2-3 sentences each):\n' +
          '1. 📊 Price assessment (fairness, bargaining room)\n' +
          '2. 🏫 Surrounding amenities\n' +
          '3. ⚠️ Risk warnings\n' +
          '4. 💡 Purchase recommendation';
        systemPrompt = 'You are a real-estate analysis expert; objectively analyze the pros and cons of listings. Output must be in English only.';
      } else {
        prompt = '请分析这套房源：\n' +
          '小区：' + p.community + '\n' +
          '面积：' + p.area + '㎡，户型：' + App.I18n.rooms(p.rooms) + '\n' +
          '楼层：' + App.I18n.floor(p.floor) + '，朝向：' + p.orientation + '\n' +
          '总价：' + p.totalPrice + '万，单价：' + p.unitPrice + '万/㎡\n' +
          '装修：' + p.decoration + '，楼龄：' + (2026 - p.buildYear) + '年\n' +
          '地铁：' + p.surrounding.metro.line + p.surrounding.metro.station + ' 步行' + p.surrounding.metro.distance + '米\n' +
          '亮点：' + (p.highlights || []).join('、') + '\n' +
          '妥协点：' + (p.compromise || '无') + '\n' +
          '挂牌' + p.daysOnMarket + '天，降价' + p.priceDropCount + '次\n\n' +
          '请从以下 4 个角度分析（每个 2-3 句话）：\n' +
          '1. 📊 价格评估（是否合理，砍价空间）\n' +
          '2. 🏫 周边配套评价\n' +
          '3. ⚠️ 风险提示\n' +
          '4. 💡 购买建议';
        systemPrompt = '你是购房分析专家，客观分析房源优缺点。只用中文回复。';
      }
      if (API.buildProfileText) systemPrompt += ' ' + API.buildProfileText();

      var messages = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt }
      ];

      return fetch('/api/ai', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + (App.Auth ? App.Auth.token : '')
        },
        body: JSON.stringify({ messages: messages, language: en() ? 'en' : 'zh', timeoutMs: 30000 })
      });
    }).then(function (r) {
      if (!r.ok) return r.json().then(function (e) { throw new Error(e.error || t('pd.aiFail')); });
      return r.json();
    }).then(function (data) {
      var content = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
      el.innerHTML = '<div style="white-space:pre-wrap;line-height:1.8">' + Utils.esc(content) + '</div>';
    }).catch(function (err) {
      el.innerHTML = '<div style="color:#ff4d4f">⚠️ ' + Utils.esc(err.message) + '</div><button class="btn btn-outline btn-sm mt-8" onclick="loadAIAnalysis(\'' + propId + '\')">' + t('common.retry') + '</button>';
    });
  };

})(window);
