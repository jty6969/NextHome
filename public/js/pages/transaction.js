/* Nexthome - 交易流程页 */
(function (global) {
  'use strict';

  var App = global.App;
  var Store = App.Store;
  var Utils = App.Utils;
  var Router = App.Router;
  var API = global.API;

  /* 基于 currentStep 的 AI 助手提示 */
  var AI_TIPS = [
    '恭喜达成意向！建议尽快支付定金锁定房源...',
    '定金已付，下一步需在7天内完成网签备案。需准备：身份证、户口本、结婚证...',
    '网签已完成，请尽快联系银行办理贷款审批...',
    '贷款审批中，同时安排资金监管...',
    '即将过户，请携带所有原件到交易中心...',
    '过户完成！安排物业交接...'
  ];

  /* ============ 空状态 ============ */
  function renderEmpty() {
    return '<div class="empty-state">' +
      '<div class="empty-state-icon">📋</div>' +
      '<p>还没有进行中的交易，去和卖家达成意向吧</p>' +
      '<a href="#/properties" class="btn btn-primary mt-16">去看看房源</a>' +
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
        '<span class="tag ' + (sOk ? 'tag-green' : 'tag-gray') + '" style="margin-right:6px">卖家' + (sOk ? '已确认 ✓' : '待确认') + '</span>' +
        '<span class="tag ' + (bOk ? 'tag-green' : 'tag-gray') + '">买家' + (bOk ? '已确认 ✓' : '待确认') + '</span>' +
        (sOk && !bOk ? '<span style="color:#e8840c;font-size:12px;margin-left:8px">卖家已确认，请尽快确认</span>' : '') +
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
    var tipIdx = completed ? AI_TIPS.length - 1 : cur;

    var html = '<div class="card card-pad mb-16">';

    // 顶部：房源标题 + 成交价
    html += '<div class="flex items-center justify-between mb-16">';
    html += '<div>';
    html += '<div style="font-size:16px;font-weight:600">' + Utils.esc(tx.propertyTitle) + '</div>';
    html += '<div style="color:#999;font-size:12px;margin-top:2px">成交价</div>';
    html += '</div>';
    html += '<div class="text-right">';
    html += '<div class="text-danger fw-bold" style="font-size:18px">' + Utils.formatPrice(tx.agreedPrice) + '</div>';
    html += '<span class="tag ' + (completed ? 'tag-gray' : 'tag-green') + '">' + (completed ? '已完成' : '交易中') + '</span>';
    html += '</div>';
    html += '</div>';

    // 垂直步骤时间线
    html += '<div class="tx-steps">';
    html += steps.map(function (s, i) { return renderStep(s, i, cur, total); }).join('');
    html += '</div>';

    // AI 助手提示
    html += '<div class="ai-analysis-box">';
    html += '<h4>💡 AI 助手提示</h4>';
    html += '<p style="color:#444;font-size:13px;line-height:1.7">' + Utils.esc(AI_TIPS[tipIdx]) + '</p>';
    html += '</div>';

    // 操作按钮（每个环节需买卖双方都确认才进入下一步）
    html += '<div class="flex gap-8 flex-wrap mt-16">';
    if (!completed) {
      var curStepObj = steps[cur];
      if (curStepObj.buyerConfirmed) {
        html += '<span class="tag tag-yellow">✅ 你已确认「' + Utils.esc(curStepObj.title) + '」，等待卖家确认</span>';
      } else {
        html += '<button class="btn btn-primary" onclick="txConfirm(\'' + tx.propertyId + '\')">✅ 我确认完成：' + Utils.esc(curStepObj.title) + '</button>';
        if (curStepObj.sellerConfirmed) {
          html += '<span class="tag tag-orange" style="align-self:center">卖家已确认，只差你确认</span>';
        } else {
          html += '<span class="tag tag-gray" style="align-self:center">需双方确认后进入下一步</span>';
        }
      }
    }
    html += '<button class="btn btn-outline" onclick="txAsk(\'' + tx.propertyId + '\')">💬 向 AI 提问</button>';
    html += '<button class="btn btn-outline" onclick="txContact()">💬 联系卖家</button>';
    html += '</div>';

    html += '</div>';
    return html;
  }

  /* ============ 主渲染 ============ */
  function render() {
    var transactions = Store.get().transactions || [];
    var html = '<div class="flex items-center justify-between mb-16">' +
      '<h2 style="font-size:20px;font-weight:600">📋 交易流程</h2>' +
      '<span class="tag tag-blue">共 ' + transactions.length + ' 笔交易</span>' +
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
    var tx = Store.get().transactions.find(function (t) { return t.propertyId === propId; });
    if (!tx) return;
    var steps = tx.steps || [];
    if (tx.currentStep >= steps.length) {
      Utils.toast('交易已完成所有步骤', 'warn');
      return;
    }
    var stepTitle = steps[tx.currentStep].title;
    if (!window.confirm('确认已完成「' + stepTitle + '」？\n确认后需卖家也确认，交易才会进入下一环节。')) return;

    App.Auth.request('/api/deal/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ propertyId: propId })
    }).then(function (r) {
      return r.json().then(function (d) {
        if (!r.ok) throw new Error(d.error || '确认失败');
        return d;
      });
    }).then(function (d) {
      Utils.toast(d.advanced ? '🎉 双方已确认，交易进入下一环节' : '已确认，等待卖家确认', 'success');
      Store.loadFromServer().then(render).catch(render);
    }).catch(function (err) {
      Utils.toast(err.message, 'error');
    });
  };

  /* ============ 向 AI 提问 ============ */
  global.txAsk = function (propId) {
    var tx = Store.get().transactions.find(function (t) { return t.propertyId === propId; });
    var question = window.prompt('向 AI 提问关于此交易的问题：');
    if (question === null) return;
    question = (question || '').trim();
    if (!question) return;

    var context = '';
    if (tx) {
      var curStep = tx.steps && tx.steps[tx.currentStep];
      context = '我正在交易房源【' + tx.propertyTitle + '】，成交价 ' +
        Utils.formatPrice(tx.agreedPrice) + '，当前进度：' +
        (curStep ? curStep.title : '已完成') + '。';
    }
    var full = context + '\n我的问题：' + question;

    Utils.showLoading('AI 思考中...');
    API.callAI(full).then(function (resp) {
      Utils.hideLoading();
      window.alert(resp);
    }).catch(function (err) {
      Utils.hideLoading();
      Utils.toast('AI 请求失败：' + (err && err.message ? err.message : ''), 'error');
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
