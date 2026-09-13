/* Nexthome - 登录/注册页 */
(function (global) {
  'use strict';

  var App = global.App;
  var Store = App.Store;
  var Utils = App.Utils;
  var Auth = App.Auth;

  App.Router.register('/login', function () { render('login'); });

  function render(mode) {
    var html = '' +
      '<div style="max-width:400px;margin:40px auto">' +
        '<div class="card" style="overflow:hidden">' +
          '<div style="display:flex">' +
            '<div class="auth-tab" data-tab="login" style="flex:1;padding:14px;text-align:center;cursor:pointer;font-weight:600;border-bottom:2px solid ' + (mode === 'login' ? '#1677ff' : 'transparent') + ';color:' + (mode === 'login' ? '#1677ff' : '#999') + '">登录</div>' +
            '<div class="auth-tab" data-tab="register" style="flex:1;padding:14px;text-align:center;cursor:pointer;font-weight:600;border-bottom:2px solid ' + (mode === 'register' ? '#1677ff' : 'transparent') + ';color:' + (mode === 'register' ? '#1677ff' : '#999') + '">注册</div>' +
          '</div>' +
          '<div class="card-pad">' +
            (mode === 'login' ? loginForm() : registerForm()) +
          '</div>' +
        '</div>' +
        '<div style="text-align:center;margin-top:16px;color:#999;font-size:12px">' +
          '测试账号：administrator / admin123' +
        '</div>' +
      '</div>';
    document.getElementById('page').innerHTML = html;

    document.querySelectorAll('.auth-tab').forEach(function (tab) {
      tab.onclick = function () { render(tab.getAttribute('data-tab')); };
    });

    var submitBtn = document.getElementById('authSubmit');
    if (submitBtn) {
      submitBtn.onclick = function () {
        var username = document.getElementById('authUsername').value.trim();
        var password = document.getElementById('authPassword').value;
        if (!username || !password) { Utils.toast('请输入用户名和密码', 'warn'); return; }

        submitBtn.disabled = true;
        submitBtn.textContent = '请稍候...';

        var action;
        if (mode === 'login') {
          action = Auth.login(username, password);
        } else {
          var name = document.getElementById('authName').value.trim() || username;
          var password2 = document.getElementById('authPassword2').value;
          if (password.length < 6) { Utils.toast('密码至少 6 位', 'warn'); submitBtn.disabled = false; submitBtn.textContent = '注册'; return; }
          if (password !== password2) { Utils.toast('两次输入的密码不一致', 'warn'); submitBtn.disabled = false; submitBtn.textContent = '注册'; return; }
          action = Auth.register(username, password, name);
        }

        action.then(function (user) {
          Utils.toast((mode === 'login' ? '欢迎回来，' : '注册成功，') + user.name + '！', 'success');
          // 登录后先拉取该账号的服务器状态，再进入首页
          Store.loadFromServer().catch(function () {}).finally(function () {
            App.Router.navigate('/');
          });
        }).catch(function (err) {
          Utils.toast(err.message || '操作失败', 'error');
          submitBtn.disabled = false;
          submitBtn.textContent = mode === 'login' ? '登录' : '注册';
        });
      };
    }
  }

  function loginForm() {
    return '' +
      '<div class="form-group"><label class="form-label">用户名</label>' +
        '<input type="text" class="form-input" id="authUsername" placeholder="用户名（3-20位字母/数字/下划线）"></div>' +
      '<div class="form-group"><label class="form-label">密码</label>' +
        '<input type="password" class="form-input" id="authPassword" placeholder="密码"></div>' +
      '<button class="btn btn-primary btn-block" id="authSubmit">登录</button>';
  }

  function registerForm() {
    return '' +
      '<div class="form-group"><label class="form-label">昵称</label>' +
        '<input type="text" class="form-input" id="authName" placeholder="怎么称呼你？（选填）"></div>' +
      '<div class="form-group"><label class="form-label">用户名</label>' +
        '<input type="text" class="form-input" id="authUsername" placeholder="用于登录的用户名，3-20位字母/数字/下划线"></div>' +
      '<div class="form-group"><label class="form-label">密码</label>' +
        '<input type="password" class="form-input" id="authPassword" placeholder="至少 6 位"></div>' +
      '<div class="form-group"><label class="form-label">确认密码</label>' +
        '<input type="password" class="form-input" id="authPassword2" placeholder="再输入一次密码"></div>' +
      '<button class="btn btn-primary btn-block" id="authSubmit">注册并登录</button>';
  }

})(window);
