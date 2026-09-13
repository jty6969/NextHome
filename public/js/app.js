/* Nexthome - 核心模块 (Auth / Store / Router / Utils) */
(function (global) {
  'use strict';

  var TOKEN_KEY = 'nexthome_token';
  var USER_KEY = 'nexthome_user';

  /* ============ Auth（账号/会话） ============ */
  var Auth = {
    get token() { return localStorage.getItem(TOKEN_KEY); },
    setToken: function (t) { localStorage.setItem(TOKEN_KEY, t); },
    getUser: function () {
      try { return JSON.parse(localStorage.getItem(USER_KEY)); } catch (e) { return null; }
    },
    setUser: function (u) { localStorage.setItem(USER_KEY, JSON.stringify(u)); },
    isLoggedIn: function () { return !!localStorage.getItem(TOKEN_KEY); },

    request: function (url, options) {
      options = options || {};
      options.headers = options.headers || {};
      options.headers['Authorization'] = 'Bearer ' + (this.token || '');
      return fetch(url, options);
    },

    login: function (username, password) {
      return fetch('/api/auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username, password: password })
      }).then(function (r) {
        return r.json().then(function (d) {
          if (!r.ok) throw new Error(d.error || '登录失败');
          return d;
        });
      }).then(function (d) {
        Auth.setToken(d.token); Auth.setUser(d.user); return d.user;
      });
    },

    register: function (username, password, name) {
      return fetch('/api/auth/register', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username, password: password, name: name })
      }).then(function (r) {
        return r.json().then(function (d) {
          if (!r.ok) throw new Error(d.error || '注册失败');
          return d;
        });
      }).then(function (d) {
        Auth.setToken(d.token); Auth.setUser(d.user); return d.user;
      });
    },

    logout: function () {
      fetch('/api/auth/logout', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + (Auth.token || '') }
      }).catch(function () {});
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
      Store._data = null;
    }
  };

  /* ============ Store（按账号的全部状态，服务器持久化） ============ */
  function defaultState() {
    return {
      profile: {}, requirements: {}, chatHistory: [], favorites: [],
      browsingHistory: [], viewingRecords: [], transactions: [],
      conversations: {}, aiMemory: []
    };
  }

  var Store = {
    _data: null,
    _saveTimer: null,

    get: function () {
      if (this._data) return this._data;
      this._data = defaultState();
      return this._data;
    },

    save: function () {
      if (!Auth.isLoggedIn()) return; // 未登录不持久化
      var snapshot = JSON.parse(JSON.stringify(this._data));
      // 防抖：高频改动合并为一次请求
      clearTimeout(this._saveTimer);
      this._saveTimer = setTimeout(function () {
        Auth.request('/api/state', {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(snapshot)
        }).catch(function () {});
      }, 300);
    },

    // 兼容旧页面调用：save() 已自动防抖同步到服务器
    syncToServer: function () { this.save(); return Promise.resolve(this._data); },

    // 登录后从服务器拉取该账号的全部状态
    loadFromServer: function () {
      var self = this;
      return Auth.request('/api/state').then(function (r) {
        if (!r.ok) throw new Error('state load failed');
        return r.json();
      }).then(function (d) {
        var base = defaultState();
        Object.keys(base).forEach(function (k) {
          if (d[k] !== undefined) base[k] = d[k];
        });
        self._data = base;
        return base;
      });
    },

    /* ---- 用户画像/需求 ---- */
    updateProfile: function (key, val) { this.get().profile[key] = val; this.save(); },
    updateRequirements: function (key, val) { this.get().requirements[key] = val; this.save(); },

    /* ---- AI 聊天记录 ---- */
    addChat: function (msg) {
      var d = this.get();
      d.chatHistory.push(msg);
      if (d.chatHistory.length > 200) d.chatHistory = d.chatHistory.slice(-200);
      this.save();
    },

    /* ---- 收藏 ---- */
    toggleFavorite: function (propId, title) {
      var d = this.get();
      var idx = d.favorites.indexOf(propId);
      var added;
      if (idx >= 0) { d.favorites.splice(idx, 1); added = false; this.logBehavior('取消收藏', '取消收藏 ' + (title || propId)); }
      else { d.favorites.push(propId); added = true; this.logBehavior('收藏', '收藏了 ' + (title || propId)); }
      this.save();
      return added;
    },
    isFavorite: function (propId) { return this.get().favorites.indexOf(propId) >= 0; },

    /* ---- 浏览记录（专门记录给 AI 看的历史行为） ---- */
    addBrowsing: function (prop) {
      var d = this.get();
      // 同一天同一套只保留一条（去重后前置）
      d.browsingHistory = d.browsingHistory.filter(function (b) { return b.propertyId !== prop.id; });
      d.browsingHistory.unshift({
        propertyId: prop.id,
        title: prop.community + ' ' + prop.building + ' ' + prop.unit,
        totalPrice: prop.totalPrice, area: prop.area,
        time: new Date().toISOString()
      });
      if (d.browsingHistory.length > 50) d.browsingHistory = d.browsingHistory.slice(0, 50);
      this.logBehavior('浏览', '浏览了 ' + prop.community + ' ' + prop.building + prop.unit + '（' + prop.totalPrice + '万）');
      this.save();
    },

    /* ---- AI 行为记忆（用户做过什么，都记下来，喂给 AI） ---- */
    logBehavior: function (type, text) {
      var d = this.get();
      d.aiMemory.push({ type: type, text: text, time: new Date().toISOString() });
      if (d.aiMemory.length > 60) d.aiMemory = d.aiMemory.slice(-60);
    },

    /* ---- 看房预约 ---- */
    addViewing: function (record) {
      var d = this.get();
      d.viewingRecords.push(record);
      this.logBehavior('预约看房', '预约 ' + (record.propertyTitle || '') + '：' + record.date + ' ' + record.timeSlot);
      this.save();
    },
    updateViewing: function (id, updates) {
      var d = this.get();
      for (var i = 0; i < d.viewingRecords.length; i++) {
        if (d.viewingRecords[i].id === id) { Object.assign(d.viewingRecords[i], updates); break; }
      }
      this.save();
    },

    /* ---- 交易流程 ---- */
    addTransaction: function (tx) {
      var d = this.get();
      var existing = d.transactions.find(function (t) { return t.propertyId === tx.propertyId; });
      if (existing) { Object.assign(existing, tx); }
      else { d.transactions.push(tx); }
      this.logBehavior('成交议价', '就 ' + (tx.propertyTitle || tx.propertyId) + ' 达成 ' + tx.agreedPrice + ' 万');
      this.save();
    },
    getTransaction: function (propId) {
      return this.get().transactions.find(function (t) { return t.propertyId === propId; });
    },
    updateTransaction: function (propId, updates) {
      var d = this.get();
      for (var i = 0; i < d.transactions.length; i++) {
        if (d.transactions[i].propertyId === propId) { Object.assign(d.transactions[i], updates); break; }
      }
      this.save();
    },

    /* ---- 和卖家的对话 ---- */
    getConversation: function (propId) {
      var d = this.get();
      if (!d.conversations[propId]) d.conversations[propId] = [];
      return d.conversations[propId];
    },
    addMessage: function (propId, msg) {
      var d = this.get();
      if (!d.conversations[propId]) d.conversations[propId] = [];
      d.conversations[propId].push(msg);
      this.save();
    }
  };

  /* ============ Utils ============ */
  var Utils = {
    $: function (sel) { return document.querySelector(sel); },
    $$: function (sel) { return document.querySelectorAll(sel); },

    toast: function (msg, type) {
      var el = document.getElementById('toast');
      el.textContent = msg;
      el.className = 'toast show' + (type ? ' ' + type : '');
      clearTimeout(this._toastTimer);
      this._toastTimer = setTimeout(function () { el.className = 'toast'; }, 3000);
    },
    showLoading: function (text) {
      document.getElementById('loadingText').textContent = text || '加载中...';
      document.getElementById('loading').style.display = 'flex';
    },
    hideLoading: function () { document.getElementById('loading').style.display = 'none'; },

    formatPrice: function (w) { return w + ' 万'; },
    formatDate: function (d) {
      if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}/.test(d)) return d.slice(0, 10);
      var dt = new Date(d);
      return dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0');
    },
    esc: function (s) {
      var div = document.createElement('div');
      div.textContent = s || '';
      return div.innerHTML;
    },

    profileCompleteness: function () {
      var p = Store.get().profile || {};
      var r = Store.get().requirements || {};
      var fields = [
        p.city || p.targetCity, p.familySize, p.totalBudgetMin || p.budget,
        p.downPayment, r.roomCount || p.roomCount, r.minArea || p.minArea,
        r.floorPreference || p.floorPreference, r.orientation || p.orientation,
        r.metroDistance || p.metroDistance, p.workAddress || r.commuteAddress
      ];
      var filled = fields.filter(function (f) { return f !== undefined && f !== null && f !== ''; }).length;
      return Math.round((filled / fields.length) * 100);
    },
    uid: function () { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  };

  /* ============ Router（含登录守卫） ============ */
  var Router = {
    routes: {},
    currentPath: '',

    register: function (path, handler) { this.routes[path] = handler; },

    parse: function () { return location.hash.slice(1) || '/'; },
    navigate: function (path) { location.hash = path; },

    render: function () {
      var path = this.parse();
      this.currentPath = path;

      // 登录守卫：除 /login 外都需要登录
      if (path !== '/login' && !Auth.isLoggedIn()) {
        location.hash = '#/login';
        return;
      }
      if (path === '/login' && Auth.isLoggedIn()) {
        location.hash = Auth.getUser().role === 'seller' ? '#/seller' : '#/';
        return;
      }
      // 角色守卫：卖家只能进卖家中心，买家不能进卖家中心
      var role = Auth.getUser() ? Auth.getUser().role : null;
      if (role === 'seller' && path !== '/seller') {
        location.hash = '#/seller';
        return;
      }
      if (path === '/seller' && role !== 'seller') {
        location.hash = '#/';
        return;
      }

      // 导航高亮
      renderNav();
      document.querySelectorAll('.nav-links a').forEach(function (a) {
        var href = a.getAttribute('href').slice(1);
        a.classList.toggle('active', path === href || (href !== '/' && path.indexOf(href) === 0));
      });
      renderNavUser();

      var handler = this.routes[path];
      if (!handler) {
        for (var route in this.routes) {
          if (route.indexOf(':') >= 0) {
            var regex = new RegExp('^' + route.replace(/:[^/]+/g, '([^/]+)') + '$');
            var match = path.match(regex);
            if (match) { handler = this.routes[route]; handler.apply(null, match.slice(1)); return; }
          }
        }
        handler = this.routes['/'];
        if (!handler) { document.getElementById('page').innerHTML = '<div class="empty-state">页面不存在</div>'; return; }
        handler();
        return;
      }
      handler();
    }
  };

  /* ============ 导航栏用户信息 ============ */
  var NAV_ITEMS = [
    { path: '/', label: '首页' },
    { path: '/chat', label: 'AI 对话' },
    { path: '/properties', label: '房源' },
    { path: '/messages', label: '消息' },
    { path: '/viewing', label: '看房' },
    { path: '/transaction', label: '交易' }
  ];
  var SELLER_NAV_ITEMS = [
    { path: '/seller', label: '卖家中心' }
  ];

  function renderNav() {
    var u = Auth.getUser();
    var items = (u && u.role === 'seller') ? SELLER_NAV_ITEMS : NAV_ITEMS;
    document.getElementById('navLinks').innerHTML = items.map(function (item) {
      return '<a href="#' + item.path + '">' + item.label + '</a>';
    }).join('');
  }

  function renderNavUser() {
    var el = document.getElementById('navUser');
    if (!el) return;
    var u = Auth.getUser();
    if (u) {
      var roleTag = u.role === 'seller' ? '<span class="tag tag-orange" style="margin-right:8px">卖家</span>'
        : u.role === 'admin' ? '<span class="tag tag-blue" style="margin-right:8px">管理员</span>' : '';
      el.innerHTML = roleTag +
        '<span style="color:#666;font-size:13px;margin-right:10px">👤 ' + Utils.esc(u.name) + '</span>' +
        '<button class="btn btn-outline btn-sm" onclick="App.doLogout()">退出登录</button>';
    } else {
      el.innerHTML = '<a href="#/login" class="btn btn-outline btn-sm">登录 / 注册</a>';
    }
  }

  /* ============ App ============ */
  var App = {
    Store: Store, Utils: Utils, Router: Router, Auth: Auth,
    NAV_ITEMS: NAV_ITEMS,

    doLogout: function () {
      Auth.logout();
      Utils.toast('已退出登录', 'success');
      setTimeout(function () { location.hash = '#/login'; }, 300);
    },

    boot: function () {
      window.addEventListener('hashchange', function () { Router.render(); });

      if (Auth.isLoggedIn()) {
        // 已登录：先拉服务器上该账号的状态，再渲染
        Store.loadFromServer().catch(function () {}).finally(function () { Router.render(); });
      } else {
        Router.render(); // 会跳转到 /login
      }
    }
  };

  global.App = App;
})(window);
