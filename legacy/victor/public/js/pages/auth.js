/* Nexthome - 登录/注册页（双语） */
(function (global) {
  'use strict';

  var App = global.App;
  var Store = App.Store;
  var Utils = App.Utils;
  var Auth = App.Auth;

  App.Router.register('/login', function () { render('login'); });

  function t(key) { return App.I18n ? App.I18n.t(key) : key; }

  function render(mode) {
    var html = '' +
      '<div style="max-width:400px;margin:40px auto">' +
        '<div class="card" style="overflow:hidden">' +
          '<div style="display:flex">' +
            '<div class="auth-tab" data-tab="login" style="flex:1;padding:14px;text-align:center;cursor:pointer;font-weight:600;border-bottom:2px solid ' + (mode === 'login' ? '#1677ff' : 'transparent') + ';color:' + (mode === 'login' ? '#1677ff' : '#999') + '">' + t('auth.login') + '</div>' +
            '<div class="auth-tab" data-tab="register" style="flex:1;padding:14px;text-align:center;cursor:pointer;font-weight:600;border-bottom:2px solid ' + (mode === 'register' ? '#1677ff' : 'transparent') + ';color:' + (mode === 'register' ? '#1677ff' : '#999') + '">' + t('auth.register') + '</div>' +
          '</div>' +
          '<div class="card-pad">' +
            (mode === 'login' ? loginForm() : registerForm()) +
          '</div>' +
        '</div>' +
        '<div style="text-align:center;margin-top:16px;color:#999;font-size:12px">' +
          t('auth.testAccount') +
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
        if (!username || !password) { Utils.toast(t('auth.enterUserPass'), 'warn'); return; }

        submitBtn.disabled = true;
        submitBtn.textContent = t('auth.pleaseWait');

        var action;
        if (mode === 'login') {
          action = Auth.login(username, password);
        } else {
          var name = document.getElementById('authName').value.trim() || username;
          var password2 = document.getElementById('authPassword2').value;
          if (password.length < 6) { Utils.toast(t('auth.passMin6'), 'warn'); submitBtn.disabled = false; submitBtn.textContent = t('auth.register'); return; }
          if (password !== password2) { Utils.toast(t('auth.passMismatch'), 'warn'); submitBtn.disabled = false; submitBtn.textContent = t('auth.register'); return; }
          action = Auth.register(username, password, name);
        }

        action.then(function (user) {
          Utils.toast((mode === 'login' ? t('auth.welcomeBack') : t('auth.registerOk')) + user.name + '！', 'success');
          // 登录后先拉取该账号的服务器状态，再进入首页
          Store.loadFromServer().catch(function () {}).finally(function () {
            App.Router.navigate('/');
          });
        }).catch(function (err) {
          Utils.toast(err.message || t('auth.opFailed'), 'error');
          submitBtn.disabled = false;
          submitBtn.textContent = mode === 'login' ? t('auth.login') : t('auth.register');
        });
      };
    }
  }

  function loginForm() {
    return '' +
      '<div class="form-group"><label class="form-label">' + t('auth.username') + '</label>' +
        '<input type="text" class="form-input" id="authUsername" placeholder="' + t('auth.usernamePh') + '"></div>' +
      '<div class="form-group"><label class="form-label">' + t('auth.password') + '</label>' +
        '<input type="password" class="form-input" id="authPassword" placeholder="' + t('auth.passwordPh') + '"></div>' +
      '<button class="btn btn-primary btn-block" id="authSubmit">' + t('auth.login') + '</button>';
  }

  function registerForm() {
    return '' +
      '<div class="form-group"><label class="form-label">' + t('auth.nickname') + '</label>' +
        '<input type="text" class="form-input" id="authName" placeholder="' + t('auth.nicknamePh') + '"></div>' +
      '<div class="form-group"><label class="form-label">' + t('auth.username') + '</label>' +
        '<input type="text" class="form-input" id="authUsername" placeholder="' + t('auth.loginUsernamePh') + '"></div>' +
      '<div class="form-group"><label class="form-label">' + t('auth.password') + '</label>' +
        '<input type="password" class="form-input" id="authPassword" placeholder="' + t('auth.passAtLeast') + '"></div>' +
      '<div class="form-group"><label class="form-label">' + t('auth.confirmPassword') + '</label>' +
        '<input type="password" class="form-input" id="authPassword2" placeholder="' + t('auth.confirmPasswordPh') + '"></div>' +
      '<button class="btn btn-primary btn-block" id="authSubmit">' + t('auth.registerBtn') + '</button>';
  }

})(window);
