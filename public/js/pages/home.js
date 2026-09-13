/* Nexthome - 首页 */
(function (global) {
  'use strict';

  var App = global.App;
  var Utils = App.Utils;
  var Router = App.Router;

  /* ============ Hero 区 ============ */
  function renderHero() {
    return [
      '<section class="hero" style="margin-bottom:24px;padding:56px 24px;text-align:center;border-radius:8px;background:linear-gradient(135deg,#667eea,#764ba2);color:#fff;">',
        '<h1 style="font-size:30px;font-weight:700;margin-bottom:12px;">让 AI 帮你买房，从了解你开始</h1>',
        '<p style="font-size:15px;opacity:.9;margin-bottom:24px;">智能匹配真实房源 · 全流程陪伴购房决策</p>',
        '<button class="btn btn-primary" style="font-size:16px;padding:12px 32px;" onclick="location.hash=\'#/chat\'">开始 AI 对话</button>',
      '</section>'
    ].join('');
  }

  /* ============ 核心功能 ============ */
  function renderFeatures() {
    var features = [
      { icon: '🤖', title: 'AI 咨询', desc: '智能问答，购房全程指导', path: '/chat' },
      { icon: '🏠', title: '房源推荐', desc: 'AI 匹配真实在售房源', path: '/properties' },
      { icon: '💬', title: '在线沟通', desc: '与卖家直接对话议价', path: '/messages' },
      { icon: '📅', title: '预约看房', desc: '在线选时段预约看房', path: '/viewing' }
    ];
    var cards = features.map(function (f) {
      return [
        '<div class="card card-pad" style="text-align:center;cursor:pointer;" onclick="location.hash=\'#' + f.path + '\'">',
          '<div style="font-size:36px;margin-bottom:8px;">' + f.icon + '</div>',
          '<div style="font-size:15px;font-weight:600;margin-bottom:4px;">' + f.title + '</div>',
          '<div style="font-size:12px;color:var(--text-light);">' + f.desc + '</div>',
        '</div>'
      ].join('');
    }).join('');
    return [
      '<section style="margin-bottom:24px;">',
        '<h2 style="font-size:18px;font-weight:600;margin-bottom:16px;">核心功能</h2>',
        '<div class="grid grid-4">' + cards + '</div>',
      '</section>'
    ].join('');
  }

  /* ============ 房源卡片 ============ */
  function propCardHTML(p) {
    var tagClasses = ['tag-blue', 'tag-green', 'tag-orange'];
    var tags = (p.highlights || []).slice(0, 3).map(function (h, i) {
      return '<span class="tag ' + tagClasses[i % tagClasses.length] + '">' + Utils.esc(h) + '</span>';
    }).join('');
    var title = Utils.esc(p.community + ' ' + p.building + ' ' + p.unit);
    var price = Utils.formatPrice(p.totalPrice);
    var unit = '单价 ' + Utils.formatUnitPrice(p.unitPrice);
    var meta = p.area + ' ㎡ | ' +
      p.rooms.bedroom + '室' + p.rooms.livingRoom + '厅' + p.rooms.bathroom + '卫 | ' +
      p.floor.level + '/' + p.floor.total + '层 | ' + Utils.esc(p.orientation);
    return [
      '<div class="prop-card" onclick="location.hash=\'#/property/' + p.id + '\'">',
        '<div class="prop-card-img">' + Utils.esc(p.community) + '</div>',
        '<div class="prop-card-body">',
          '<div class="prop-card-title">' + title + '</div>',
          '<div class="prop-card-price">' + price + ' <small>' + unit + '</small></div>',
          '<div class="prop-card-meta">' + meta + '</div>',
          '<div class="prop-card-tags">' + tags + '</div>',
        '</div>',
      '</div>'
    ].join('');
  }

  function loadingHTML() {
    return '<div class="empty-state" style="grid-column:1/-1;">' +
      '<div class="empty-state-icon">⏳</div>加载房源中...</div>';
  }

  function emptyHTML() {
    return '<div class="empty-state" style="grid-column:1/-1;">' +
      '<div class="empty-state-icon">🏠</div>暂无房源</div>';
  }

  function errorHTML() {
    return '<div class="empty-state" style="grid-column:1/-1;">' +
      '<div class="empty-state-icon">⚠️</div>房源加载失败</div>';
  }

  /* ============ 精选房源加载 ============ */
  async function loadFeatured() {
    var container = document.getElementById('featuredProps');
    if (!container) return;
    try {
      var list = await API.loadProperties();
      var featured = (list || []).slice(0, 3);
      if (!featured.length) {
        container.innerHTML = emptyHTML();
        return;
      }
      container.innerHTML = featured.map(propCardHTML).join('');
    } catch (e) {
      container.innerHTML = errorHTML();
      Utils.toast('房源加载失败', 'error');
    }
  }

  /* ============ 路由注册 ============ */
  App.Router.register('/', function () {
    var html = renderHero() + renderFeatures() + [
      '<section>',
        '<div class="flex items-center justify-between mb-16">',
          '<h2 style="font-size:18px;font-weight:600;">精选房源</h2>',
          '<a href="#/properties">查看全部 ›</a>',
        '</div>',
        '<div id="featuredProps" class="grid grid-3">' + loadingHTML() + '</div>',
      '</section>'
    ].join('');
    document.getElementById('page').innerHTML = html;

    loadFeatured();
  });

})(window);
