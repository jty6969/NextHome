/* Nexthome - 看房预约页（双语） */
(function (global) {
  'use strict';

  var App = global.App;
  var API = global.API;
  var Store = App.Store;
  var Utils = App.Utils;
  var Router = App.Router;

  /* ============ 状态元数据 ============ */
  function statusMeta(status) {
    var map = {
      pending: ['view.s_pending', 'tag-yellow'],
      confirmed: ['view.s_confirmed', 'tag-green'],
      completed: ['view.s_completed', 'tag-gray'],
      cancelled: ['view.s_cancelled', 'tag-red']
    };
    var item = map[status] || map.pending;
    return { label: t(item[0]), tag: item[1] };
  }
  var STATUS_ORDER = ['pending', 'confirmed', 'completed', 'cancelled'];

  function t(key, vars) { return App.I18n ? App.I18n.t(key, vars) : key; }
  function en() { return App.I18n && App.I18n.isEn(); }

  /* ============ 工具 ============ */
  function buildPropertyTitle(p) {
    var building = (p.building || '').replace(/\s/g, '');
    var unit = (p.unit || '').replace(/\s/g, '');
    return (p.community + ' ' + building + ' ' + unit).trim();
  }

  /* ============ 看房预约列表页 ============ */
  function renderRecordCard(rec) {
    var meta = statusMeta(rec.status);
    var esc = Utils.esc;

    var actions = '';
    if (rec.status === 'pending') {
      actions = '<button class="btn btn-danger btn-sm" data-action="cancel" data-id="' + esc(rec.id) + '">' + t('view.cancel') + '</button>';
    } else if (rec.status === 'confirmed') {
      actions = '<button class="btn btn-outline btn-sm" data-action="messages">' + t('view.toMessages') + '</button>';
    }

    var noteText = rec.note ? esc(rec.note) : t('common.none');

    return ''
      + '<div class="card card-pad" style="margin-bottom:12px;">'
      +   '<div class="flex items-center justify-between mb-8">'
      +     '<div class="fw-600">' + esc(rec.propertyTitle) + '</div>'
      +     '<span class="tag ' + meta.tag + '">' + meta.label + '</span>'
      +   '</div>'
      +   '<div class="text-light" style="font-size:12px;">'
      +     '📅 ' + esc(Utils.formatDate(rec.date)) + '　⏰ ' + esc(rec.timeSlot)
      +   '</div>'
      +   '<div class="text-light" style="font-size:12px;margin-top:4px;">' + t('view.noteLabel') + noteText + '</div>'
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

    var html = '<h2 class="mb-16">' + t('view.title') + '</h2>';
    html += '<h3 class="mb-16">' + t('view.mySchedule') + '</h3>';

    if (!records.length) {
      html += '<div class="card card-pad">'
        +   '<div class="empty-state">'
        +     '<div class="empty-state-icon">📭</div>'
        +     '<p>' + t('view.empty') + '</p>'
        +     '<p class="mt-16"><a href="#/properties">' + t('view.goProps') + '</a></p>'
        +   '</div>'
        + '</div>';
    } else {
      STATUS_ORDER.forEach(function (status) {
        var group = records.filter(function (r) { return r.status === status; });
        if (!group.length) return;
        var meta = statusMeta(status);
        html += '<div class="mb-16">'
          + '<div class="mb-8 flex items-center gap-8">'
          +   '<span class="tag ' + meta.tag + '">' + meta.label + '</span>'
          +   '<span class="text-light" style="font-size:12px;">' + t('view.recordsN', { n: group.length }) + '</span>'
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
      Utils.toast(t('view.cancelled'), 'warn');
      renderListPage();
    } else if (action === 'messages') {
      location.hash = '#/messages';
    }
  }

  /* ============ 预约日历页 ============ */
  function renderBookingPage(propId) {
    var pageEl = document.getElementById('page');
    pageEl.innerHTML = '<div class="empty-state"><div class="empty-state-icon">⏳</div><p>' + t('common.loading') + '</p></div>';

    API.loadProperty(propId).then(function (p) {
      if (!p) {
        pageEl.innerHTML = '<div class="empty-state">'
          + '<div class="empty-state-icon">❓</div>'
          + '<p>' + t('view.notFound') + '</p>'
          + '<p class="mt-16"><a href="#/properties">' + t('view.backProps') + '</a></p>'
          + '</div>';
        return;
      }

      var slots = (p.seller && p.seller.availableSlots) || [];
      var propTitle = buildPropertyTitle(p);
      var esc = Utils.esc;

      var html = '<h2 class="mb-16">' + t('view.title') + '</h2>';

      // 房源信息
      html += '<div class="card card-pad mb-16">'
        +   '<div class="fw-600" style="font-size:16px;">' + esc(propTitle) + '</div>'
        +   '<div class="text-light" style="font-size:12px;margin-top:4px;">'
        +     t('view.sellerLabel') + esc(p.seller ? p.seller.name : '—')
        +   '</div>'
        + '</div>';

      // 选择时段
      html += '<div class="card card-pad">';
      html += '<h3 class="mb-8">' + t('view.chooseTime') + '</h3>';

      if (!slots.length) {
        html += '<div class="empty-state">'
          + '<div class="empty-state-icon">🙅</div>'
          + '<p>' + t('view.noSlots') + '</p>'
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
          + '<label class="form-label">' + t('view.noteOpt') + '</label>'
          + '<textarea class="form-textarea" id="viewingNote" placeholder="' + t('view.notePh') + '"></textarea>'
          + '</div>';

        html += '<button class="btn btn-primary btn-block" id="submitViewing">' + t('view.submit') + '</button>';
      }

      html += '</div>';

      pageEl.innerHTML = html;
      bindBookingEvents(pageEl, p, propTitle);
    }).catch(function (err) {
      pageEl.innerHTML = '<div class="empty-state">'
        + '<div class="empty-state-icon">⚠️</div>'
        + '<p>' + t('view.loadFail') + Utils.esc(err && err.message ? err.message : t('common.none')) + '</p>'
        + '</div>';
    });
  }

  function bindBookingEvents(root, property, propTitle) {
    var submitBtn = root.querySelector('#submitViewing');
    if (!submitBtn) return;

    submitBtn.addEventListener('click', function () {
      var selected = root.querySelector('input[name="slot"]:checked');
      if (!selected) {
        Utils.toast(t('view.chooseFirst'), 'warn');
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
        content: t('view.appointment') + date + ' ' + timeSlot,
        time: new Date().toISOString()
      });

      Utils.toast(t('view.submitted'), 'success');
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
