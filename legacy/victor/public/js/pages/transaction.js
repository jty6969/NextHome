/* Nexthome - 交易流程页（双语） */
(function (global) {
  'use strict';

  var App = global.App;
  var Store = App.Store;
  var Utils = App.Utils;
  var Router = App.Router;
  var API = global.API;

  function t(key, vars) { return App.I18n ? App.I18n.t(key, vars) : key; }
  function en() { return App.I18n && App.I18n.isEn(); }

  /* 基于 currentStep 的 AI 助手提示 */
  function aiTip(i) {
    if (i < 0) i = 0;
    if (i > 5) i = 5;
    return t('tx.tip' + i);
  }

  /* ============ 空状态 ============ */
  function renderEmpty() {
    return '<div class="empty-state">' +
      '<div class="empty-state-icon">📋</div>' +
      '<p>' + t('tx.empty') + '</p>' +
      '<a href="#/properties" class="btn btn-primary mt-16">' + t('tx.goProps') + '</a>' +
    '</div>';
  }

  /* ============ 单个步骤 ============ */
  function renderStep(step, i, currentStep, total) {
    var state, icon;
    if (currentStep >= total) {
      state = 'done'; icon = '✅';
    } else if (i < currentStep) {
      state = 'done'; icon = '✅';
    } else if (i === currentStep) {
      state = 'current'; icon = '🔵';
    } else {
      state = 'pending'; icon = String(i + 1);
    }
    // 当前环节：显示双方确认进度
    var confirmLine = '';
    if (i === currentStep && currentStep < total) {
      var sOk = step.sellerConfirmed, bOk = step.buyerConfirmed;
      confirmLine = '<div class="tx-step-desc" style="margin-top:4px">' +
        '<span class="tag ' + (sOk ? 'tag-green' : 'tag-gray') + '" style="margin-right:6px">' + (sOk ? t('tx.sellerConfirmed') : t('tx.sellerWaiting')) + '</span>' +
        '<span class="tag ' + (bOk ? 'tag-green' : 'tag-gray') + '">' + (bOk ? t('tx.buyerConfirmed') : t('tx.buyerWaiting')) + '</span>' +
        (sOk && !bOk ? '<span style="color:#e8840c;font-size:12px;margin-left:8px">' + t('tx.sellerHurry') + '</span>' : '') +
        '</div>';
    }
    return '<div class="tx-step ' + state + '">' +
      '<div class="tx-step-icon">' + icon + '</div>' +
      '<div class="tx-step-content">' +
        '<div class="tx-step-title">' + Utils.esc(step.title) + '</div>' +
        '<div class="tx-step-desc">' + Utils.esc(step.desc) + '</div>' +
        confirmLine +
      '</div>' +
    '</div>';
  }

  /* ============ 交易卡片 ============ */
  function renderCard(tx) {
    var steps = tx.steps || [];
    var cur = tx.currentStep || 0;
    var total = steps.length;
    var completed = cur >= total;
    var tipIdx = completed ? 5 : cur;

    var html = '<div class="card card-pad mb-16">';

    // 顶部：房源标题 + 成交价
    html += '<div class="flex items-center justify-between mb-16">';
    html += '<div>';
    html += '<div style="font-size:16px;font-weight:600">' + Utils.esc(tx.propertyTitle) + '</div>';
    html += '<div style="color:#999;font-size:12px;margin-top:2px">' + t('tx.agreedPrice') + '</div>';
    html += '</div>';
    html += '<div class="text-right">';
    html += '<div class="text-danger fw-bold" style="font-size:18px">' + App.I18n.wan(tx.agreedPrice) + '</div>';
    html += '<span class="tag ' + (completed ? 'tag-gray' : 'tag-green') + '">' + (completed ? t('tx.completed') : t('tx.inProgress')) + '</span>';
    html += '</div>';
    html += '</div>';

    // 垂直步骤时间线
    html += '<div class="tx-steps">';
    html += steps.map(function (s, i) { return renderStep(s, i, cur, total); }).join('');
    html += '</div>';

    // AI 助手提示
    html += '<div class="ai-analysis-box">';
    html += '<h4>' + t('tx.aiTipTitle') + '</h4>';
    html += '<p style="color:#444;font-size:13px;line-height:1.7">' + Utils.esc(aiTip(tipIdx)) + '</p>';
    html += '</div>';

    // 操作按钮（每个环节需买卖双方都确认才进入下一步）
    html += '<div class="flex gap-8 flex-wrap mt-16">';
    if (!completed) {
      var curStepObj = steps[cur];
      if (curStepObj.buyerConfirmed) {
        html += '<span class="tag tag-yellow">' + t('tx.youConfirmedWait', { step: Utils.esc(curStepObj.title) }) + '</span>';
      } else {
        html += '<button class="btn btn-primary" onclick="txConfirm(\'' + tx.propertyId + '\')">' + t('tx.confirmBtn', { step: Utils.esc(curStepObj.title) }) + '</button>';
        if (curStepObj.sellerConfirmed) {
          html += '<span class="tag tag-orange" style="align-self:center">' + t('tx.sellerOnlyYou') + '</span>';
        } else {
          html += '<span class="tag tag-gray" style="align-self:center">' + t('tx.needBoth') + '</span>';
        }
      }
    }
    html += '<button class="btn btn-outline" onclick="txAsk(\'' + tx.propertyId + '\')">' + t('tx.askAI') + '</button>';
    html += '<button class="btn btn-outline" onclick="txContact()">' + t('tx.contactSeller') + '</button>';
    html += '</div>';

    html += '</div>';
    return html;
  }

  /* ============ 主渲染 ============ */
  function render() {
    var transactions = Store.get().transactions || [];
    var html = '<div class="flex items-center justify-between mb-16">' +
      '<h2 style="font-size:20px;font-weight:600">' + t('tx.title') + '</h2>' +
      '<span class="tag tag-blue">' + t('tx.total', { n: transactions.length }) + '</span>' +
    '</div>';

    if (!transactions.length) {
      html += renderEmpty();
    } else {
      html += transactions.map(renderCard).join('');
    }

    document.getElementById('page').innerHTML = html;
  }

  /* ============ 买家确认当前环节（需卖家也确认才推进） ============ */
  global.txConfirm = function (propId) {
    var tx = Store.get().transactions.find(function (x) { return x.propertyId === propId; });
    if (!tx) return;
    var steps = tx.steps || [];
    if (tx.currentStep >= steps.length) {
      Utils.toast(t('tx.allDone'), 'warn');
      return;
    }
    var stepTitle = steps[tx.currentStep].title;
    if (!window.confirm(t('tx.confirmDialog1', { step: stepTitle }) + '\n' + t('tx.confirmDialog2'))) return;

    App.Auth.request('/api/deal/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ propertyId: propId, language: en() ? 'en' : 'zh' })
    }).then(function (r) {
      return r.json().then(function (d) {
        if (!r.ok) throw new Error(d.error || t('auth.opFailed'));
        return d;
      });
    }).then(function (d) {
      Utils.toast(d.advanced ? t('tx.advanced') : t('tx.waitSeller'), 'success');
      Store.loadFromServer().then(render).catch(render);
    }).catch(function (err) {
      Utils.toast(err.message, 'error');
    });
  };

  /* ============ 向 AI 提问 ============ */
  global.txAsk = function (propId) {
    var tx = Store.get().transactions.find(function (x) { return x.propertyId === propId; });
    var question = window.prompt(t('tx.askPrompt'));
    if (question === null) return;
    question = (question || '').trim();
    if (!question) return;

    var context = '';
    if (tx) {
      var curStep = tx.steps && tx.steps[tx.currentStep];
      context = t('tx.ctx1') + tx.propertyTitle + t('tx.ctx2') +
        App.I18n.wan(tx.agreedPrice) + t('tx.ctx3') +
        (curStep ? curStep.title : t('tx.ctxDone')) + '。';
    }
    var full = context + '\n' + t('tx.myQuestion') + question;

    Utils.showLoading(t('tx.aiThinking'));
    API.callAI(full).then(function (resp) {
      Utils.hideLoading();
      window.alert(resp);
    }).catch(function (err) {
      Utils.hideLoading();
      Utils.toast(t('tx.aiFail') + (err && err.message ? err.message : ''), 'error');
    });
  };

  /* ============ 联系卖家 ============ */
  global.txContact = function () {
    Router.navigate('/messages');
  };

  /* ============ 路由注册 ============ */
  var txTimer = null;
  App.Router.register('/transaction', function () {
    render();
    // 轮询：卖家推进交易步骤后实时更新
    if (txTimer) clearInterval(txTimer);
    txTimer = setInterval(function () {
      if (App.Router.currentPath !== '/transaction') {
        clearInterval(txTimer); txTimer = null;
        return;
      }
      Store.loadFromServer().then(render).catch(function () {});
    }, 5000);
  });

})(window);
