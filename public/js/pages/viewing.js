/* Nexthome - 看房预约页 */
(function (global) {
  'use strict';

  var App = global.App;
  var API = global.API;
  var Store = App.Store;
  var Utils = App.Utils;
  var Router = App.Router;

  /* ============ 状态元数据 ============ */
  var STATUS_META = {
    pending: { label: '待确认', tag: 'tag-yellow' },
    confirmed: { label: '已确认', tag: 'tag-green' },
    completed: { label: '已完成', tag: 'tag-gray' },
    cancelled: { label: '已取消', tag: 'tag-red' }
  };
  var STATUS_ORDER = ['pending', 'confirmed', 'completed', 'cancelled'];

  /* ============ 工具 ============ */
  function buildPropertyTitle(p) {
    var building = (p.building || '').replace(/\s/g, '');
    var unit = (p.unit || '').replace(/\s/g, '');
    return (p.community + ' ' + building + ' ' + unit).trim();
  }

  /* ============ 看房预约列表页 ============ */
  function renderRecordCard(rec) {
    var meta = STATUS_META[rec.status] || STATUS_META.pending;
    var esc = Utils.esc;

    var actions = '';
    if (rec.status === 'pending') {
      actions = '<button class="btn btn-danger btn-sm" data-action="cancel" data-id="' + esc(rec.id) + '">取消预约</button>';
    } else if (rec.status === 'confirmed') {
      actions = '<button class="btn btn-outline btn-sm" data-action="messages">导航到消息</button>';
    }

    var noteText = rec.note ? esc(rec.note) : '无';

    return ''
      + '<div class="card card-pad" style="margin-bottom:12px;">'
      +   '<div class="flex items-center justify-between mb-8">'
      +     '<div class="fw-600">' + esc(rec.propertyTitle) + '</div>'
      +     '<span class="tag ' + meta.tag + '">' + meta.label + '</span>'
      +   '</div>'
      +   '<div class="text-light" style="font-size:12px;">'
      +     '📅 ' + esc(Utils.formatDate(rec.date)) + '　⏰ ' + esc(rec.timeSlot)
      +   '</div>'
      +   '<div class="text-light" style="font-size:12px;margin-top:4px;">留言：' + noteText + '</div>'
      +   (actions ? '<div class="mt-8 flex gap-8">' + actions + '</div>' : '')
      + '</div>';
  }

  function renderListPage() {
    var records = (Store.get().viewingRecords || []).slice().sort(function (a, b) {
      var ao = STATUS_ORDER.indexOf(a.status);
      var bo = STATUS_ORDER.indexOf(b.status);
      if (ao !== bo) return ao - bo;
      return a.date < b.date ? -1 : (a.date > b.date ? 1 : 0);
    });

    var html = '<h2 class="mb-16">📅 看房预约</h2>';
    html += '<h3 class="mb-16">我的看房安排</h3>';

    if (!records.length) {
      html += '<div class="card card-pad">'
        +   '<div class="empty-state">'
        +     '<div class="empty-state-icon">📭</div>'
        +     '<p>还没有看房预约，去房源页预约吧</p>'
        +     '<p class="mt-16"><a href="#/properties">去房源页 →</a></p>'
        +   '</div>'
        + '</div>';
    } else {
      STATUS_ORDER.forEach(function (status) {
        var group = records.filter(function (r) { return r.status === status; });
        if (!group.length) return;
        var meta = STATUS_META[status];
        html += '<div class="mb-16">'
          + '<div class="mb-8 flex items-center gap-8">'
          +   '<span class="tag ' + meta.tag + '">' + meta.label + '</span>'
          +   '<span class="text-light" style="font-size:12px;">' + group.length + ' 条</span>'
          + '</div>';
        group.forEach(function (rec) {
          html += renderRecordCard(rec);
        });
        html += '</div>';
      });
    }

    var pageEl = document.getElementById('page');
    pageEl.innerHTML = '<div class="viewing-list">' + html + '</div>';

    var listRoot = pageEl.querySelector('.viewing-list');
    if (listRoot) {
      listRoot.addEventListener('click', onListClick);
    }
  }

  function onListClick(e) {
    var btn = e.target.closest('[data-action]');
    if (!btn) return;
    var action = btn.getAttribute('data-action');
    if (action === 'cancel') {
      var id = btn.getAttribute('data-id');
      Store.updateViewing(id, { status: 'cancelled' });
      Utils.toast('已取消预约', 'warn');
      renderListPage();
    } else if (action === 'messages') {
      location.hash = '#/messages';
    }
  }

  /* ============ 预约日历页 ============ */
  function renderBookingPage(propId) {
    var pageEl = document.getElementById('page');
    pageEl.innerHTML = '<div class="empty-state"><div class="empty-state-icon">⏳</div><p>加载中...</p></div>';

    API.loadProperty(propId).then(function (p) {
      if (!p) {
        pageEl.innerHTML = '<div class="empty-state">'
          + '<div class="empty-state-icon">❓</div>'
          + '<p>未找到该房源</p>'
          + '<p class="mt-16"><a href="#/properties">返回房源列表</a></p>'
          + '</div>';
        return;
      }

      var slots = (p.seller && p.seller.availableSlots) || [];
      var propTitle = buildPropertyTitle(p);
      var esc = Utils.esc;

      var html = '<h2 class="mb-16">📅 预约看房</h2>';

      // 房源信息
      html += '<div class="card card-pad mb-16">'
        +   '<div class="fw-600" style="font-size:16px;">' + esc(propTitle) + '</div>'
        +   '<div class="text-light" style="font-size:12px;margin-top:4px;">'
        +     '卖家：' + esc(p.seller ? p.seller.name : '—')
        +   '</div>'
        + '</div>';

      // 选择时段
      html += '<div class="card card-pad">';
      html += '<h3 class="mb-8">选择看房时间</h3>';

      if (!slots.length) {
        html += '<div class="empty-state">'
          + '<div class="empty-state-icon">🙅</div>'
          + '<p>卖家暂未开放可预约时段</p>'
          + '</div>';
      } else {
        html += '<div class="form-group">';
        slots.forEach(function (day) {
          day.slots.forEach(function (slot) {
            var val = day.date + '|' + slot;
            html += '<label class="flex items-center gap-8" style="padding:8px 0;border-bottom:1px solid var(--border);cursor:pointer;">'
              + '<input type="radio" name="slot" value="' + esc(val) + '" style="margin-right:8px;">'
              + '<span>📅 ' + esc(Utils.formatDate(day.date)) + '</span>'
              + '<span class="text-light">　⏰ ' + esc(slot) + '</span>'
              + '</label>';
          });
        });
        html += '</div>';

        html += '<div class="form-group">'
          + '<label class="form-label">留言（可选）</label>'
          + '<textarea class="form-textarea" id="viewingNote" placeholder="给卖家留言，例如希望了解哪些细节..."></textarea>'
          + '</div>';

        html += '<button class="btn btn-primary btn-block" id="submitViewing">提交预约</button>';
      }

      html += '</div>';

      pageEl.innerHTML = html;
      bindBookingEvents(pageEl, p, propTitle);
    }).catch(function (err) {
      pageEl.innerHTML = '<div class="empty-state">'
        + '<div class="empty-state-icon">⚠️</div>'
        + '<p>加载失败：' + Utils.esc(err && err.message ? err.message : '未知错误') + '</p>'
        + '</div>';
    });
  }

  function bindBookingEvents(root, property, propTitle) {
    var submitBtn = root.querySelector('#submitViewing');
    if (!submitBtn) return;

    submitBtn.addEventListener('click', function () {
      var selected = root.querySelector('input[name="slot"]:checked');
      if (!selected) {
        Utils.toast('请先选择看房时间', 'warn');
        return;
      }
      var parts = selected.value.split('|');
      var date = parts[0];
      var timeSlot = parts[1];
      var note = (root.querySelector('#viewingNote').value || '').trim();

      var record = {
        id: Utils.uid(),
        propertyId: property.id,
        propertyTitle: propTitle,
        date: date,
        timeSlot: timeSlot,
        note: note,
        status: 'pending',
        createdAt: new Date().toISOString()
      };

      Store.addViewing(record);
      Store.addMessage(property.id, {
        role: 'system',
        content: '看房预约：' + date + ' ' + timeSlot,
        time: new Date().toISOString()
      });

      Utils.toast('预约已提交，等待卖家确认', 'success');
      Router.navigate('/viewing');
    });
  }

  /* ============ 路由注册 ============ */
  var listTimer = null;
  Router.register('/viewing', function () {
    renderListPage();
    // 轮询：卖家确认/婉拒后实时更新
    if (listTimer) clearInterval(listTimer);
    listTimer = setInterval(function () {
      if (!document.querySelector('.viewing-list')) {
        clearInterval(listTimer); listTimer = null;
        return;
      }
      Store.loadFromServer().then(renderListPage).catch(function () {});
    }, 5000);
  });

  Router.register('/viewing/:propId', function (propId) {
    if (listTimer) { clearInterval(listTimer); listTimer = null; }
    renderBookingPage(propId);
  });

})(window);
