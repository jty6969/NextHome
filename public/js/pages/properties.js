/* Nexthome - 在售房源页 */
(function (global) {
  'use strict';

  var App = global.App;
  var Store = App.Store;
  var Utils = App.Utils;
  var API = global.API;

  // 页面状态
  var state = {
    loading: true,
    error: false,
    list: [],
    sortBy: 'default', // 'default' | 'price' | 'area' | 'unitPrice'
    dir: 'asc',        // 'asc' | 'desc'
    bedroom: 0         // 0 = 全部
  };

  App.Router.register('/properties', function () { render(); });

  function render() {
    state.loading = true;
    state.error = false;
    renderShell();
    API.loadProperties().then(function (list) {
      state.list = list || [];
      state.loading = false;
      renderFilterBar();
      renderGrid();
    }).catch(function () {
      state.loading = false;
      state.error = true;
      state.list = [];
      renderGrid();
    });
  }

  function renderShell() {
    var html = '' +
      '<div style="display:flex;align-items:center;gap:10px;margin-bottom:16px">' +
        '<h2 style="font-size:20px;font-weight:700">🏠 在售房源</h2>' +
        '<span class="tag tag-blue" id="propCount">-</span>' +
      '</div>' +
      '<div id="filterBar"></div>' +
      '<div id="propGrid" style="margin-top:16px"></div>';
    document.getElementById('page').innerHTML = html;
    renderFilterBar();
    renderGrid();
  }

  function renderFilterBar() {
    var bar = document.getElementById('filterBar');
    if (!bar) return;

    var sorts = [
      { key: 'default',   label: '默认' },
      { key: 'price',     label: sortLabel('price', '价格', '低→高', '高→低') },
      { key: 'area',      label: sortLabel('area', '面积', '小→大', '大→小') },
      { key: 'unitPrice', label: sortLabel('unitPrice', '单价', '低→高', '高→低') }
    ];
    var sortHtml = sorts.map(function (s) {
      var cls = state.sortBy === s.key ? 'btn btn-primary btn-sm' : 'btn btn-outline btn-sm';
      return '<button class="' + cls + '" onclick="propSort(\'' + s.key + '\')">' + s.label + '</button>';
    }).join('');

    var beds = [{ v: 0, label: '全部' }, { v: 2, label: '2室' }, { v: 3, label: '3室' }, { v: 4, label: '4室' }];
    var bedHtml = beds.map(function (b) {
      var cls = state.bedroom === b.v ? 'btn btn-primary btn-sm' : 'btn btn-outline btn-sm';
      return '<button class="' + cls + '" onclick="propFilterBed(' + b.v + ')">' + b.label + '</button>';
    }).join('');

    bar.innerHTML = '' +
      '<div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:12px 16px;background:var(--bg-white);border-radius:var(--radius);box-shadow:var(--shadow)">' +
        '<span style="font-size:13px;color:var(--text-light);font-weight:600">排序</span>' +
        sortHtml +
        '<span style="width:1px;height:20px;background:var(--border);margin:0 8px"></span>' +
        '<span style="font-size:13px;color:var(--text-light);font-weight:600">户型</span>' +
        bedHtml +
      '</div>';
  }

  function sortLabel(key, name, ascText, descText) {
    if (state.sortBy !== key) return name;
    return name + ' ' + (state.dir === 'asc' ? ascText : descText);
  }

  function getFilteredList() {
    var list = state.list.slice();
    if (state.bedroom > 0) {
      list = list.filter(function (p) { return p.rooms && p.rooms.bedroom === state.bedroom; });
    }
    if (state.sortBy !== 'default') {
      list.sort(function (a, b) {
        var va, vb;
        if (state.sortBy === 'price') { va = a.totalPrice; vb = b.totalPrice; }
        else if (state.sortBy === 'area') { va = a.area; vb = b.area; }
        else if (state.sortBy === 'unitPrice') { va = a.unitPrice; vb = b.unitPrice; }
        else return 0;
        return state.dir === 'asc' ? va - vb : vb - va;
      });
    }
    return list;
  }

  function renderGrid() {
    var grid = document.getElementById('propGrid');
    if (!grid) return;
    var countEl = document.getElementById('propCount');

    if (state.loading) {
      if (countEl) countEl.textContent = '加载中';
      grid.innerHTML = '' +
        '<div class="empty-state">' +
          '<div class="empty-state-icon">⏳</div>' +
          '<p>正在加载房源...</p>' +
        '</div>';
      return;
    }

    if (state.error) {
      if (countEl) countEl.textContent = '0 套';
      grid.innerHTML = '' +
        '<div class="empty-state">' +
          '<div class="empty-state-icon">⚠️</div>' +
          '<p>房源加载失败，请稍后重试</p>' +
        '</div>';
      return;
    }

    var list = getFilteredList();
    if (countEl) countEl.textContent = list.length + ' 套';

    if (list.length === 0) {
      grid.innerHTML = '' +
        '<div class="empty-state">' +
          '<div class="empty-state-icon">🏚️</div>' +
          '<p>暂无房源</p>' +
          '<p style="font-size:12px;margin-top:4px">试试调整筛选条件</p>' +
        '</div>';
      return;
    }

    grid.innerHTML = '<div class="grid grid-2">' + list.map(renderCard).join('') + '</div>';
  }

  function renderCard(p) {
    var fav = Store.isFavorite(p.id);
    var favIcon = fav ? '⭐' : '☆';

    var tags = [];
    if (p.highlights && p.highlights.length) {
      p.highlights.forEach(function (h) {
        tags.push('<span class="tag tag-orange">' + Utils.esc(h) + '</span>');
      });
    }
    if (p.decoration) {
      tags.push('<span class="tag tag-blue">' + Utils.esc(p.decoration) + '</span>');
    }
    if (p.surrounding && p.surrounding.metro) {
      var m = p.surrounding.metro;
      tags.push('<span class="tag tag-green">🚇 ' + Utils.esc(m.line) + ' ' + Utils.esc(m.station) + ' ' + m.distance + 'm</span>');
    }

    return '' +
      '<div class="prop-card" onclick="location.hash=\'#/property/' + p.id + '\'">' +
        '<div class="prop-card-img">' + Utils.esc(p.community) + '</div>' +
        '<div class="prop-card-body">' +
          '<div class="prop-card-title">' + Utils.esc(p.community) + ' ' + Utils.esc(p.building) + ' ' + Utils.esc(p.unit) + '</div>' +
          '<div class="prop-card-price">' + Utils.formatPrice(p.totalPrice) +
            ' <small>单价 ' + p.unitPrice + ' 万/㎡</small>' +
            '<button onclick="togglePropFavorite(event,\'' + p.id + '\')" style="float:right;border:none;background:none;cursor:pointer;font-size:18px;line-height:1;padding:0;margin-top:2px" title="收藏">' + favIcon + '</button>' +
          '</div>' +
          '<div class="prop-card-meta">' +
            p.area + ' ㎡ | ' + p.rooms.bedroom + '室' + p.rooms.livingRoom + '厅' + p.rooms.bathroom + '卫 | ' +
            p.floor.level + '/' + p.floor.total + '层 | ' + Utils.esc(p.orientation) +
          '</div>' +
          '<div class="prop-card-tags">' + tags.join('') + '</div>' +
        '</div>' +
      '</div>';
  }

  /* ============ 全局交互函数 ============ */

  // 排序切换：重复点击同一项时切换升降序
  global.propSort = function (key) {
    if (state.sortBy === key) {
      state.dir = state.dir === 'asc' ? 'desc' : 'asc';
    } else {
      state.sortBy = key;
      state.dir = (key === 'area') ? 'desc' : 'asc';
    }
    renderFilterBar();
    renderGrid();
  };

  // 户型筛选
  global.propFilterBed = function (b) {
    state.bedroom = b;
    renderFilterBar();
    renderGrid();
  };

  // 收藏切换（阻止冒泡，避免触发卡片跳转）
  global.togglePropFavorite = function (event, propId) {
    if (event && event.stopPropagation) event.stopPropagation();
    var added = Store.toggleFavorite(propId);
    Utils.toast(added ? '已收藏' : '已取消收藏', added ? 'success' : 'warn');
    renderGrid();
  };

})(window);
