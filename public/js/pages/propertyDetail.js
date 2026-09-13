/* Nexthome - 房源详情页 */
(function (global) {
  'use strict';

  var App = global.App;
  var Store = App.Store;
  var Utils = App.Utils;
  var API = global.API;

  App.Router.register('/property/:id', function (id) { render(id); });

  function render(id) {
    document.getElementById('page').innerHTML = '<div class="card card-pad" style="text-align:center;padding:40px"><div class="loading-spinner" style="margin:0 auto"></div><p style="margin-top:12px;color:#999">加载房源信息...</p></div>';

    API.loadProperty(id).then(function (p) {
      if (!p) {
        document.getElementById('page').innerHTML = '<div class="empty-state"><div class="empty-state-icon">😅</div><p>房源不存在</p><a href="#/properties" class="btn btn-primary mt-16">返回房源列表</a></div>';
        return;
      }
      // 记录浏览历史（同时写入 AI 行为记忆）
      Store.addBrowsing(p);
      renderDetail(p);
    }).catch(function () {
      document.getElementById('page').innerHTML = '<div class="empty-state"><div class="empty-state-icon">⚠️</div><p>加载失败</p></div>';
    });
  }

  function renderDetail(p) {
    var isFav = Store.isFavorite(p.id);
    var roomText = p.rooms.bedroom + '室' + p.rooms.livingRoom + '厅' + p.rooms.bathroom + '卫';
    var floorText = p.floor.level + '/' + p.floor.total + '层';
    var buildAge = 2026 - p.buildYear;

    var html = '' +
      // 返回链接
      '<div class="mb-16"><a href="#/properties" style="font-size:13px">← 返回房源列表</a></div>' +

      // 图库
      '<div class="detail-gallery">' +
        '<div class="gallery-main">' + Utils.esc(p.community) + '</div>' +
        '<div class="gallery-side">' +
          '<div>客厅</div><div>卧室</div><div>厨房</div>' +
        '</div>' +
      '</div>' +

      // 标题 + 操作
      '<div class="flex justify-between items-center mb-16">' +
        '<div>' +
          '<h2 style="font-size:20px;margin-bottom:4px">' + Utils.esc(p.community) + ' ' + Utils.esc(p.building) + ' ' + Utils.esc(p.unit) + '</h2>' +
          '<p style="color:#999;font-size:13px">' + Utils.esc(p.city) + ' · ' + Utils.esc(p.district) + ' · ' + Utils.esc(p.address) + '</p>' +
        '</div>' +
        '<div class="flex gap-8">' +
          '<button class="btn ' + (isFav ? 'btn-primary' : 'btn-outline') + '" id="favBtn" onclick="toggleFav(\'' + p.id + '\')">' + (isFav ? '⭐ 已收藏' : '☆ 收藏') + '</button>' +
        '</div>' +
      '</div>' +

      // 价格
      '<div class="card card-pad mb-16">' +
        '<div class="flex justify-between items-center">' +
          '<div>' +
            '<span style="font-size:28px;font-weight:700;color:#ff4d4f">' + p.totalPrice + '</span>' +
            '<span style="font-size:14px;color:#ff4d4f"> 万</span>' +
            '<span style="margin-left:16px;color:#999;font-size:13px">单价 ' + p.unitPrice + ' 万/㎡</span>' +
          '</div>' +
          '<div class="flex gap-8">' +
            '<span class="tag ' + (p.priceDropCount > 0 ? 'tag-green' : 'tag-gray') + '">挂牌 ' + p.daysOnMarket + ' 天</span>' +
            '<span class="tag ' + (p.priceDropCount > 0 ? 'tag-red' : 'tag-gray') + '">降价 ' + p.priceDropCount + ' 次</span>' +
          '</div>' +
        '</div>' +
        '<div style="margin-top:8px;font-size:12px;color:#999">历史调价：' +
          p.priceHistory.map(function (h) { return h.date + ' 报价 ' + h.price + ' 万'; }).join(' → ') +
        '</div>' +
      '</div>' +

      // 基本信息
      '<div class="card card-pad mb-16">' +
        '<h3 style="font-size:16px;margin-bottom:12px">🏠 基本信息</h3>' +
        '<div class="detail-info-grid">' +
          '<div class="info-item"><span class="label">小区</span><span>' + Utils.esc(p.community) + '</span></div>' +
          '<div class="info-item"><span class="label">楼栋单元</span><span>' + Utils.esc(p.building) + ' ' + Utils.esc(p.unit) + '</span></div>' +
          '<div class="info-item"><span class="label">面积</span><span>' + p.area + ' ㎡</span></div>' +
          '<div class="info-item"><span class="label">户型</span><span>' + roomText + '</span></div>' +
          '<div class="info-item"><span class="label">楼层</span><span>' + floorText + '</span></div>' +
          '<div class="info-item"><span class="label">朝向</span><span>' + p.orientation + '</span></div>' +
          '<div class="info-item"><span class="label">装修</span><span>' + p.decoration + '</span></div>' +
          '<div class="info-item"><span class="label">建成年份</span><span>' + p.buildYear + ' 年（' + buildAge + ' 年楼龄）</span></div>' +
          '<div class="info-item"><span class="label">产权</span><span>' + p.ownershipYears + ' 年住宅</span></div>' +
          '<div class="info-item"><span class="label">挂牌时间</span><span>' + p.listingDate + '</span></div>' +
        '</div>' +
      '</div>' +

      // 亮点 & 妥协点
      '<div class="card card-pad mb-16">' +
        '<h3 style="font-size:16px;margin-bottom:12px">💡 亮点与妥协</h3>' +
        '<div style="margin-bottom:10px">' +
          '<span style="font-weight:600;color:#52c41a">✅ 亮点</span>' +
          '<div style="margin-top:4px">' +
            (p.highlights || []).map(function (h) { return '<span class="tag tag-green" style="margin:2px">' + Utils.esc(h) + '</span>'; }).join('') +
          '</div>' +
        '</div>' +
        '<div>' +
          '<span style="font-weight:600;color:#faad14">⚠️ 妥协点</span>' +
          '<p style="margin-top:4px;color:#666;font-size:13px">' + Utils.esc(p.compromise || '暂无') + '</p>' +
        '</div>' +
        '<div style="margin-top:10px;padding:10px;background:#f6f6f6;border-radius:4px;font-size:13px">' +
          '<strong>卖家自述：</strong>' + Utils.esc(p.sellingPoint || '') +
        '</div>' +
      '</div>' +

      // 周边配套
      '<div class="card card-pad mb-16">' +
        '<h3 style="font-size:16px;margin-bottom:12px">📍 周边配套</h3>' +
        '<div style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px;font-size:13px">' +
          '<div>🚇 地铁：' + p.surrounding.metro.line + ' ' + p.surrounding.metro.station + ' 步行 ' + p.surrounding.metro.distance + ' 米</div>' +
          '<div>🛒 商场：' + (p.surrounding.mall || []).join('、') + '</div>' +
          '<div>🏫 学校：' + (p.surrounding.school || []).join('、') + '</div>' +
          '<div>🏥 医院：' + (p.surrounding.hospital || []).join('、') + '</div>' +
          '<div>🌳 公园：' + (p.surrounding.park || []).join('、') + '</div>' +
        '</div>' +
      '</div>' +

      // 小区信息
      '<div class="card card-pad mb-16">' +
        '<h3 style="font-size:16px;margin-bottom:12px">🏢 小区信息</h3>' +
        '<div class="detail-info-grid">' +
          '<div class="info-item"><span class="label">开发商</span><span>' + Utils.esc(p.communityInfo.developer) + '</span></div>' +
          '<div class="info-item"><span class="label">物业费</span><span>' + p.communityInfo.propertyFee + ' 元/㎡/月</span></div>' +
          '<div class="info-item"><span class="label">绿化率</span><span>' + p.communityInfo.greeningRate + '</span></div>' +
          '<div class="info-item"><span class="label">容积率</span><span>' + p.communityInfo.plotRatio + '</span></div>' +
          '<div class="info-item"><span class="label">总栋数</span><span>' + p.communityInfo.totalBuildings + ' 栋</span></div>' +
          '<div class="info-item"><span class="label">总户数</span><span>' + p.communityInfo.totalUnits + ' 户</span></div>' +
          '<div class="info-item"><span class="label">车位比</span><span>' + p.communityInfo.parkingRatio + '</span></div>' +
          '<div class="info-item"><span class="label">建成年份</span><span>' + p.communityInfo.buildYear + ' 年</span></div>' +
        '</div>' +
      '</div>' +

      // AI 分析
      '<div class="ai-analysis-box" id="aiAnalysis">' +
        '<h4>🤖 AI 综合分析</h4>' +
        '<div id="aiAnalysisContent" style="color:#666;font-size:13px">' +
          '<button class="btn btn-primary btn-sm" onclick="loadAIAnalysis(\'' + p.id + '\')">点击获取 AI 分析</button>' +
        '</div>' +
      '</div>' +

      // 卖家信息 + 操作
      '<div class="card card-pad mt-16">' +
        '<h3 style="font-size:16px;margin-bottom:12px">👤 卖家信息</h3>' +
        '<div class="flex items-center gap-12 mb-16">' +
          '<div class="chat-avatar avatar-seller">' + p.seller.avatar + '</div>' +
          '<div>' +
            '<div style="font-weight:600">' + Utils.esc(p.seller.name) + '</div>' +
            '<div style="color:#999;font-size:12px">' + p.seller.phone + '</div>' +
          '</div>' +
        '</div>' +
        '<div class="flex gap-8 flex-wrap">' +
          '<a class="btn btn-primary" href="#/messages/' + p.id + '">💬 联系卖家</a>' +
          '<a class="btn btn-outline" href="#/viewing/' + p.id + '">📅 预约看房</a>' +
          '<a class="btn btn-outline" href="#/chat">🤖 问 AI 这套房怎样</a>' +
        '</div>' +
      '</div>';

    document.getElementById('page').innerHTML = html;
  }

  // 收藏切换
  global.toggleFav = function (propId) {
    var added = Store.toggleFavorite(propId);
    Utils.toast(added ? '已收藏' : '已取消收藏', added ? 'success' : 'warn');
    var btn = document.getElementById('favBtn');
    if (btn) {
      btn.className = 'btn ' + (added ? 'btn-primary' : 'btn-outline');
      btn.textContent = added ? '⭐ 已收藏' : '☆ 收藏';
    }
    Store.syncToServer().catch(function () {});
  };

  // AI 分析
  global.loadAIAnalysis = function (propId) {
    var el = document.getElementById('aiAnalysisContent');
    el.innerHTML = '<div style="display:flex;align-items:center;gap:8px;color:#999"><div class="loading-spinner" style="width:20px;height:20px"></div> AI 正在分析房源...</div>';

    API.loadProperty(propId).then(function (p) {
      var prompt = '请分析这套房源：\n' +
        '小区：' + p.community + '\n' +
        '面积：' + p.area + '㎡，户型：' + p.rooms.bedroom + '室' + p.rooms.livingRoom + '厅' + p.rooms.bathroom + '卫\n' +
        '楼层：' + p.floor.level + '/' + p.floor.total + '层，朝向：' + p.orientation + '\n' +
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

      // 构建 AI 消息（带用户档案）
      var profileText = API.buildProfileText();
      var systemPrompt = '你是购房分析专家，客观分析房源优缺点。' + profileText;
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
        body: JSON.stringify({ messages: messages, timeoutMs: 30000 })
      });
    }).then(function (r) {
      if (!r.ok) return r.json().then(function (e) { throw new Error(e.error || 'AI 分析失败'); });
      return r.json();
    }).then(function (data) {
      var content = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
      el.innerHTML = '<div style="white-space:pre-wrap;line-height:1.8">' + Utils.esc(content) + '</div>';
    }).catch(function (err) {
      el.innerHTML = '<div style="color:#ff4d4f">⚠️ ' + Utils.esc(err.message) + '</div><button class="btn btn-outline btn-sm mt-8" onclick="loadAIAnalysis(\'' + propId + '\')">重试</button>';
    });
  };

})(window);
