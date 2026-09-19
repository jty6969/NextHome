/* Nexthome - 首页（双语） */
(function (global) {
  'use strict';

  var App = global.App;
  var Utils = App.Utils;
  var Router = App.Router;

  function t(key, vars) { return App.I18n ? App.I18n.t(key, vars) : key; }

  /* ============ Hero 区 ============ */
  function renderHero() {
    return [
      '<section class="hero" style="margin-bottom:24px;padding:56px 24px;text-align:center;border-radius:8px;background:linear-gradient(135deg,#667eea,#764ba2);color:#fff;">',
        '<h1 style="font-size:30px;font-weight:700;margin-bottom:12px;">' + t('home.heroTitle') + '</h1>',
        '<p style="font-size:15px;opacity:.9;margin-bottom:24px;">' + t('home.heroSub') + '</p>',
        '<button class="btn btn-primary" style="font-size:16px;padding:12px 32px;" onclick="location.hash=\'#/chat\'">' + t('home.startChat') + '</button>',
      '</section>'
    ].join('');
  }

  /* ============ 核心功能 ============ */
  function renderFeatures() {
    var features = [
      { icon: '🤖', titleKey: 'home.f_ai_t', descKey: 'home.f_ai_d', path: '/chat' },
      { icon: '🏠', titleKey: 'home.f_rec_t', descKey: 'home.f_rec_d', path: '/properties' },
      { icon: '💬', titleKey: 'home.f_msg_t', descKey: 'home.f_msg_d', path: '/messages' },
      { icon: '📅', titleKey: 'home.f_view_t', descKey: 'home.f_view_d', path: '/viewing' }
    ];
    var cards = features.map(function (f) {
      return [
        '<div class="card card-pad" style="text-align:center;cursor:pointer;" onclick="location.hash=\'#' + f.path + '\'">',
          '<div style="font-size:36px;margin-bottom:8px;">' + f.icon + '</div>',
          '<div style="font-size:15px;font-weight:600;margin-bottom:4px;">' + t(f.titleKey) + '</div>',
          '<div style="font-size:12px;color:var(--text-light);">' + t(f.descKey) + '</div>',
        '</div>'
      ].join('');
    }).join('');
    return [
      '<section style="margin-bottom:24px;">',
        '<h2 style="font-size:18px;font-weight:600;margin-bottom:16px;">' + t('home.featuresTitle') + '</h2>',
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
    var price = App.I18n ? App.I18n.wan(p.totalPrice) : Utils.formatPrice(p.totalPrice);
    var unit = t('common.unitPrice') + ' ' + Utils.formatUnitPrice(p.unitPrice);
    var meta = p.area + ' m² | ' +
      App.I18n.rooms(p.rooms) + ' | ' +
      App.I18n.floor(p.floor) + ' | ' + Utils.esc(p.orientation);
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
      '<div class="empty-state-icon">⏳</div>' + t('home.loading') + '</div>';
  }

  function emptyHTML() {
    return '<div class="empty-state" style="grid-column:1/-1;">' +
      '<div class="empty-state-icon">🏠</div>' + t('home.empty') + '</div>';
  }

  function errorHTML() {
    return '<div class="empty-state" style="grid-column:1/-1;">' +
      '<div class="empty-state-icon">⚠️</div>' + t('home.loadFail') + '</div>';
  }

  /* ============ 精选房源加载 ============ */
  async function loadFeatured() {
    var container = document.getElementById('featuredProps');
    if (!container) return;
    try {
      var list = await global.API.loadProperties();
      var featured = (list || []).slice(0, 3);
      if (!featured.length) {
        container.innerHTML = emptyHTML();
        return;
      }
      container.innerHTML = featured.map(propCardHTML).join('');
    } catch (e) {
      container.innerHTML = errorHTML();
      Utils.toast(t('home.loadFail'), 'error');
    }
  }

  /* ============ 路由注册 ============ */
  Router.register('/', function () {
    var html = renderHero() + renderFeatures() + [
      '<section>',
        '<div class="flex items-center justify-between mb-16">',
          '<h2 style="font-size:18px;font-weight:600;">' + t('home.featured') + '</h2>',
          '<a href="#/properties">' + t('home.viewAll') + '</a>',
        '</div>',
        '<div id="featuredProps" class="grid grid-3">' + loadingHTML() + '</div>',
      '</section>'
    ].join('');
    document.getElementById('page').innerHTML = html;

    loadFeatured();
  });

})(window);
