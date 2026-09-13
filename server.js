/* Nexthome - AI 购房助手 本地服务器（含用户账号体系） */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = path.join(__dirname, 'data');
const USERS_DIR = path.join(DATA_DIR, 'users');
const SESSIONS_PATH = path.join(DATA_DIR, 'sessions.json');
const PROPS_DIR = path.join(DATA_DIR, 'properties');
const PROPERTIES_PATH = path.join(DATA_DIR, 'properties.json');

[DATA_DIR, USERS_DIR].forEach(function (d) {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
});

/* ============ MIME ============ */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2'
};

/* ============ AI 配置（服务器私有，含 Key） ============ */
const AI_CONFIG_PATH = path.join(__dirname, 'ai-config.json');
let aiConfig = null;
try { aiConfig = JSON.parse(fs.readFileSync(AI_CONFIG_PATH, 'utf8')); } catch (e) { aiConfig = null; }

/* ============ 房源数据（data/properties/ 文件夹，每套房一个 JSON） ============ */
let properties = [];
function loadProperties() {
  properties = [];
  if (fs.existsSync(PROPS_DIR)) {
    fs.readdirSync(PROPS_DIR).filter(function (f) { return f.endsWith('.json'); }).forEach(function (f) {
      try { properties.push(JSON.parse(fs.readFileSync(path.join(PROPS_DIR, f), 'utf8'))); }
      catch (e) { console.error('房源文件解析失败: ' + f + ' - ' + e.message); }
    });
  }
  // 文件夹为空时回退到旧的 properties.json
  if (!properties.length && fs.existsSync(PROPERTIES_PATH)) {
    try { properties = JSON.parse(fs.readFileSync(PROPERTIES_PATH, 'utf8')); } catch (e) { properties = []; }
  }
}
loadProperties();

/* ============ 工具 ============ */
function readBody(req) {
  return new Promise(function (resolve) {
    var chunks = [];
    req.on('data', function (c) { chunks.push(c); });
    req.on('end', function () { resolve(Buffer.concat(chunks).toString('utf8')); });
  });
}
function sendJSON(res, code, data) {
  res.writeHead(code, { 'Content-Type': MIME['.json'] });
  res.end(JSON.stringify(data));
}
function serveStatic(req, res, urlPath) {
  var filePath = path.join(PUBLIC_DIR, urlPath === '/' ? 'index.html' : urlPath);
  if (!filePath.startsWith(PUBLIC_DIR)) { sendJSON(res, 403, { error: 'forbidden' }); return; }
  fs.readFile(filePath, function (err, data) {
    if (err) {
      fs.readFile(path.join(PUBLIC_DIR, 'index.html'), function (e2, d2) {
        if (e2) { res.writeHead(404); res.end('Not Found'); return; }
        res.writeHead(200, { 'Content-Type': MIME['.html'] });
        res.end(d2);
      });
      return;
    }
    var ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

/* ============ 密码与会话 ============ */
function makeSalt() { return crypto.randomBytes(16).toString('hex'); }
function hashPassword(password, salt) {
  return crypto.pbkdf2Sync(String(password), salt, 100000, 32, 'sha256').toString('hex');
}
function makeToken() { return crypto.randomBytes(24).toString('hex'); }

function userFile(username) { return path.join(USERS_DIR, username + '.json'); }

function loadUserFile(username) {
  try { return JSON.parse(fs.readFileSync(userFile(username), 'utf8')); } catch (e) { return null; }
}
function saveUserFile(username, data) {
  fs.writeFileSync(userFile(username), JSON.stringify(data, null, 2), 'utf8');
}
function userExists(username) { return fs.existsSync(userFile(username)); }

// 用户状态默认结构
function defaultState() {
  return {
    profile: {},
    requirements: {},
    chatHistory: [],
    favorites: [],
    browsingHistory: [],
    viewingRecords: [],
    transactions: [],
    conversations: {},
    aiMemory: []
  };
}

// 会话持久化（重启服务器不丢登录态）
let sessions = {};
try { sessions = JSON.parse(fs.readFileSync(SESSIONS_PATH, 'utf8')); } catch (e) { sessions = {}; }
function saveSessions() {
  fs.writeFileSync(SESSIONS_PATH, JSON.stringify(sessions, null, 2), 'utf8');
}

// 从请求解析当前登录用户（返回 {username, user} 或 null）
function authFromReq(req) {
  var auth = req.headers['authorization'] || '';
  var token = auth.indexOf('Bearer ') === 0 ? auth.slice(7) : '';
  var sess = token && sessions[token];
  if (!sess) return null;
  var uf = loadUserFile(sess.username);
  if (!uf) return null;
  return { token: token, username: sess.username, user: uf };
}

// 种子 administrator 账号
function seedAdmin() {
  if (userExists('administrator')) return;
  var salt = makeSalt();
  var uf = {
    account: {
      username: 'administrator',
      name: '管理员',
      role: 'admin',
      salt: salt,
      passwordHash: hashPassword('admin123', salt),
      createdAt: new Date().toISOString()
    },
    state: defaultState()
  };
  saveUserFile('administrator', uf);
  console.log('已创建初始管理员账号: administrator / admin123');
}
seedAdmin();

// 为每套房源的卖家自动创建账号（role=seller，统一密码 seller123）
function seedSellers() {
  var count = 0;
  properties.forEach(function (p) {
    var uname = p.seller && p.seller.username;
    if (!uname || userExists(uname)) return;
    var salt = makeSalt();
    var st = defaultState();
    st.sellerProfile = { listings: [p.id], createdAt: new Date().toISOString() };
    saveUserFile(uname, {
      account: {
        username: uname, name: p.seller.name, role: 'seller',
        salt: salt, passwordHash: hashPassword('seller123', salt),
        createdAt: new Date().toISOString()
      },
      state: st
    });
    count++;
  });
  if (count) console.log('已创建 ' + count + ' 个卖家账号（密码统一 seller123）');
}
seedSellers();

// 列出所有买家账号（role 不是 seller 的用户）
function listBuyerUsers() {
  var buyers = [];
  fs.readdirSync(USERS_DIR).filter(function (f) { return f.endsWith('.json'); }).forEach(function (f) {
    var uname = f.slice(0, -5);
    var uf = loadUserFile(uname);
    if (uf && uf.account && uf.account.role !== 'seller') {
      buyers.push({ username: uname, name: uf.account.name, uf: uf });
    }
  });
  return buyers;
}

// 校验当前登录者为某套房源的卖家，返回房源或 null
function propertyOfSeller(username, propertyId) {
  return properties.find(function (p) {
    return p.id === propertyId && p.seller && p.seller.username === username;
  });
}

// 交易步骤（买卖双方共用）；每个环节需双方都确认才推进
function dealSteps(price) {
  return [
    { title: '达成意向', desc: '双方就价格达成一致（' + price + ' 万）', done: true, sellerConfirmed: true, buyerConfirmed: true },
    { title: '签约定金', desc: '买方支付定金，签订意向书', done: false, sellerConfirmed: false, buyerConfirmed: false },
    { title: '网签备案', desc: '在房管局系统进行网上签约备案', done: false, sellerConfirmed: false, buyerConfirmed: false },
    { title: '资金监管+贷款审批', desc: '首付款进入监管账户，银行审批贷款', done: false, sellerConfirmed: false, buyerConfirmed: false },
    { title: '过户', desc: '到房地产交易中心办理过户手续', done: false, sellerConfirmed: false, buyerConfirmed: false },
    { title: '交房交接', desc: '物业交接、水电煤过户、钥匙交接', done: false, sellerConfirmed: false, buyerConfirmed: false }
  ];
}

/* ============ AI 转发 ============ */
function forwardToAI(endpoint, apiKey, model, messages, timeoutMs) {
  return new Promise(function (resolve, reject) {
    var u = new URL(endpoint);
    var isHttps = u.protocol === 'https:';
    var mod = isHttps ? require('https') : require('http');
    var bodyStr = JSON.stringify({ model: model, messages: messages, temperature: 0.7 });
    var opts = {
      method: 'POST', hostname: u.hostname, port: u.port || (isHttps ? 443 : 80),
      path: u.pathname + u.search,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bodyStr),
        'Authorization': 'Bearer ' + apiKey
      }
    };
    var req = mod.request(opts, function (res) {
      var chunks = [];
      res.on('data', function (c) { chunks.push(c); });
      res.on('end', function () {
        var raw = Buffer.concat(chunks).toString('utf8');
        var status = res.statusCode;
        if (status >= 200 && status < 300) {
          try { resolve(JSON.parse(raw)); }
          catch (e) { reject(new Error('AI_RESPONSE_PARSE_ERROR: ' + raw.slice(0, 300))); }
        } else {
          reject(new Error('AI_HTTP_' + status + ': ' + raw.slice(0, 500)));
        }
      });
    });
    req.setTimeout(timeoutMs || 30000, function () {
      req.destroy(new Error('AI_TIMEOUT: 请求超时(' + (timeoutMs || 30000) + 'ms)'));
    });
    req.on('error', function (e) {
      var code = e.code || 'UNKNOWN';
      var msg = e.message || String(e);
      if (code === 'ENOTFOUND') reject(new Error('NETWORK_DNS: 无法解析 ' + u.hostname + ' (' + msg + ')'));
      else if (code === 'ECONNREFUSED') reject(new Error('NETWORK_REFUSED: 连接被拒绝 (' + msg + ')'));
      else if (code === 'ETIMEDOUT') reject(new Error('NETWORK_TIMEOUT: 连接超时'));
      else if (code === 'ECONNRESET') reject(new Error('NETWORK_RESET: 连接被重置'));
      else reject(new Error('NETWORK_' + code + ': ' + msg));
    });
    req.write(bodyStr);
    req.end();
  });
}

/* ============ 路由 ============ */
async function handleAPI(req, res, urlPath, method) {

  /* ---- 房源（公开） ---- */
  if (urlPath === '/api/properties' && method === 'GET') {
    return sendJSON(res, 200, properties);
  }
  var propMatch = urlPath.match(/^\/api\/properties\/([\w-]+)$/);
  if (propMatch && method === 'GET') {
    var prop = properties.find(function (p) { return p.id === propMatch[1]; });
    if (prop) return sendJSON(res, 200, prop);
    return sendJSON(res, 404, { error: '房源不存在' });
  }

  /* ---- 注册 ---- */
  if (urlPath === '/api/auth/register' && method === 'POST') {
    var body = JSON.parse(await readBody(req) || '{}');
    var username = String(body.username || '').trim();
    var password = String(body.password || '');
    var name = String(body.name || '').trim() || username;
    if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
      return sendJSON(res, 400, { error: '用户名需为 3-20 位字母、数字或下划线' });
    }
    if (password.length < 6) return sendJSON(res, 400, { error: '密码至少 6 位' });
    if (userExists(username)) return sendJSON(res, 409, { error: '用户名已存在' });

    var salt = makeSalt();
    var uf = {
      account: {
        username: username, name: name, role: 'user',
        salt: salt, passwordHash: hashPassword(password, salt),
        createdAt: new Date().toISOString()
      },
      state: defaultState()
    };
    saveUserFile(username, uf);

    var token = makeToken();
    sessions[token] = { username: username, createdAt: new Date().toISOString() };
    saveSessions();
    return sendJSON(res, 200, { token: token, user: { username: username, name: name, role: 'user' } });
  }

  /* ---- 登录 ---- */
  if (urlPath === '/api/auth/login' && method === 'POST') {
    var lbody = JSON.parse(await readBody(req) || '{}');
    var lu = String(lbody.username || '').trim();
    var lp = String(lbody.password || '');
    var lf = loadUserFile(lu);
    if (!lf || lf.account.passwordHash !== hashPassword(lp, lf.account.salt)) {
      return sendJSON(res, 401, { error: '用户名或密码错误' });
    }
    var ltoken = makeToken();
    sessions[ltoken] = { username: lu, createdAt: new Date().toISOString() };
    saveSessions();
    return sendJSON(res, 200, {
      token: ltoken,
      user: { username: lu, name: lf.account.name, role: lf.account.role }
    });
  }

  /* ---- 登出 ---- */
  if (urlPath === '/api/auth/logout' && method === 'POST') {
    var auth = authFromReq(req);
    if (auth) { delete sessions[auth.token]; saveSessions(); }
    return sendJSON(res, 200, { ok: true });
  }

  /* ---- 当前用户 ---- */
  if (urlPath === '/api/auth/me' && method === 'GET') {
    var me = authFromReq(req);
    if (!me) return sendJSON(res, 401, { error: '未登录' });
    return sendJSON(res, 200, {
      user: { username: me.username, name: me.user.account.name, role: me.user.account.role }
    });
  }

  /* ---- 读取当前用户全部状态（需登录） ---- */
  if (urlPath === '/api/state' && method === 'GET') {
    var g = authFromReq(req);
    if (!g) return sendJSON(res, 401, { error: '未登录' });
    return sendJSON(res, 200, g.user.state);
  }

  /* ---- 保存当前用户全部状态（需登录） ---- */
  if (urlPath === '/api/state' && method === 'PUT') {
    var p = authFromReq(req);
    if (!p) return sendJSON(res, 401, { error: '未登录' });
    var incoming = JSON.parse(await readBody(req) || '{}');
    var state = defaultState();
    // 只合并已知字段，防止客户端写入垃圾数据
    Object.keys(state).forEach(function (key) {
      if (incoming[key] !== undefined) state[key] = incoming[key];
    });
    p.user.state = state;
    saveUserFile(p.username, p.user);
    return sendJSON(res, 200, state);
  }

  /* ---- AI（登录后可用，自动注入该用户的画像与行为记忆） ---- */
  if (urlPath === '/api/ai' && method === 'POST') {
    try {
      var aiBody = JSON.parse(await readBody(req) || '{}');
      var cur = authFromReq(req);
      var localCfg = aiConfig || {};
      var endpoint = aiBody.endpoint || localCfg.endpoint;
      var apiKey = aiBody.apiKey || localCfg.apiKey;
      var model = aiBody.model || localCfg.model || 'deepseek-chat';
      var timeoutMs = aiBody.timeoutMs || localCfg.timeoutMs || 30000;
      var messages = aiBody.messages || [];
      if (!endpoint || !apiKey) {
        return sendJSON(res, 400, { error: 'AI 未配置：请在服务器目录放置 ai-config.json' });
      }
      var result = await forwardToAI(endpoint, apiKey, model, messages, timeoutMs);
      return sendJSON(res, 200, result);
    } catch (e) {
      var errMsg = e.message || String(e);
      var errCode = 500;
      if (errMsg.indexOf('AI_HTTP_4') === 0) errCode = 502;
      if (errMsg.indexOf('AI_HTTP_5') === 0) errCode = 502;
      if (errMsg.indexOf('NETWORK_') === 0) errCode = 503;
      return sendJSON(res, errCode, { error: errMsg });
    }
  }

  /* ---- 卖家自动回复（公开） ---- */
  if (urlPath === '/api/seller-reply' && method === 'POST') {
    var srBody = JSON.parse(await readBody(req) || '{}');
    var sProp = properties.find(function (x) { return x.id === srBody.propertyId; });
    if (!sProp) return sendJSON(res, 404, { error: '房源不存在' });
    var userMsg = srBody.message || '';
    var reply;
    if (/价格|多少钱|便宜|砍|降/.test(userMsg)) {
      reply = '您好，目前报价 ' + sProp.totalPrice + ' 万，价格还有商量空间。如果诚意要，' + Math.round(sProp.totalPrice * 0.95) + ' 万左右我们可以谈谈。';
    } else if (/看房|预约|什么时候/.test(userMsg)) {
      reply = '好的，您可以看看我开放的看房时间段，选一个合适的预约就行。一般周末比较方便。';
    } else if (/面积|多大|户型|几室/.test(userMsg)) {
      reply = '这套房 ' + sProp.area + ' ㎡，' + sProp.rooms.bedroom + '室' + sProp.rooms.livingRoom + '厅' + sProp.rooms.bathroom + '卫，' + (sProp.decoration || '装修可以实地看') + '，您可以直接来感受一下。';
    } else if (/江景|视野|采光|朝向/.test(userMsg)) {
      reply = sProp.sellingPoint || '这套房的亮点您可以实地来看，照片和现场感觉不一样。';
    } else {
      reply = '您好，感谢关注这套房。有什么问题可以直接问我，看房可以预约时间。';
    }
    return sendJSON(res, 200, { reply: reply, sellerName: sProp.seller.name });
  }

  /* ============ 卖家中心接口（需卖家账号） ============ */
  function requireSeller(req, res) {
    var auth = authFromReq(req);
    if (!auth) { sendJSON(res, 401, { error: '未登录' }); return null; }
    if (auth.user.account.role !== 'seller') { sendJSON(res, 403, { error: '该接口仅卖家可用' }); return null; }
    return auth;
  }

  // 房源标题
  function propTitle(p) { return p.community + ' ' + (p.building || '') + (p.unit || ''); }

  /* ---- 卖家总览：我的房源 + 消息 + 看房申请 + 议价 + 交易 ---- */
  if (urlPath === '/api/seller/overview' && method === 'GET') {
    var me = requireSeller(req, res);
    if (!me) return;
    var myProps = properties.filter(function (p) { return p.seller && p.seller.username === me.username; });
    var idMap = {};
    myProps.forEach(function (p) { idMap[p.id] = p; });

    var threads = [], viewings = [], offers = [], deals = [];
    listBuyerUsers().forEach(function (b) {
      var st = b.uf.state || {};
      var convs = st.conversations || {};
      Object.keys(convs).forEach(function (pid) {
        if (!idMap[pid] || !convs[pid].length) return;
        var msgs = convs[pid];
        var last = msgs[msgs.length - 1];
        threads.push({
          buyerUsername: b.username, buyerName: b.name,
          propertyId: pid, propertyTitle: propTitle(idMap[pid]),
          count: msgs.length,
          unread: msgs.filter(function (m) { return m.role === 'buyer' && !m.sellerRead; }).length,
          lastContent: last.type === 'deal' ? '[议价] ' + last.content : last.content,
          lastRole: last.role, lastTime: last.time
        });
        // 买家最近一条议价
        for (var i = msgs.length - 1; i >= 0; i--) {
          var mm = msgs[i];
          if (mm.type === 'deal' && mm.role === 'buyer') {
            offers.push({
              buyerUsername: b.username, buyerName: b.name, propertyId: pid,
              propertyTitle: propTitle(idMap[pid]), listPrice: idMap[pid].totalPrice,
              price: mm.deal ? mm.deal.price : null, reason: mm.deal ? mm.deal.reason : '',
              status: mm.deal ? mm.deal.status : 'pending',
              counterPrice: mm.deal ? mm.deal.counterPrice : null, time: mm.time
            });
            break;
          }
        }
      });
      (st.viewingRecords || []).forEach(function (v) {
        if (!idMap[v.propertyId]) return;
        viewings.push({
          id: v.id, buyerUsername: b.username, buyerName: b.name,
          propertyId: v.propertyId, propertyTitle: v.propertyTitle || propTitle(idMap[v.propertyId]),
          date: v.date, timeSlot: v.timeSlot, note: v.note,
          status: v.status, createdAt: v.createdAt, sellerNote: v.sellerNote
        });
      });
      (st.transactions || []).forEach(function (t) {
        if (!idMap[t.propertyId]) return;
        deals.push({
          buyerUsername: b.username, buyerName: b.name,
          propertyId: t.propertyId, propertyTitle: t.propertyTitle,
          agreedPrice: t.agreedPrice, currentStep: t.currentStep,
          steps: t.steps, createdAt: t.createdAt
        });
      });
    });

    threads.sort(function (a, b) { return (b.unread - a.unread) || (b.lastTime > a.lastTime ? 1 : -1); });
    return sendJSON(res, 200, {
      listings: myProps.map(function (p) {
        return { id: p.id, title: propTitle(p), totalPrice: p.totalPrice, unitPrice: p.unitPrice, area: p.area, rooms: p.rooms, floor: p.floor };
      }),
      threads: threads, viewings: viewings, offers: offers, deals: deals
    });
  }

  /* ---- 某个会话的完整消息（卖家查看） ---- */
  var threadMatch = urlPath.match(/^\/api\/seller\/thread\/([\w-]+)\/([\w-]+)$/);
  if (threadMatch && method === 'GET') {
    var tMe = requireSeller(req, res);
    if (!tMe) return;
    var tProp = propertyOfSeller(tMe.username, threadMatch[1]);
    if (!tProp) return sendJSON(res, 404, { error: '房源不存在或不属于该卖家' });
    var tBuyer = loadUserFile(threadMatch[2]);
    if (!tBuyer) return sendJSON(res, 404, { error: '买家不存在' });
    var tConv = (tBuyer.state.conversations && tBuyer.state.conversations[threadMatch[1]]) || [];
    return sendJSON(res, 200, {
      propertyTitle: propTitle(tProp),
      buyerName: tBuyer.account.name,
      messages: tConv
    });
  }

  /* ---- 卖家回复消息 ---- */
  if (urlPath === '/api/seller/reply' && method === 'POST') {
    var rMe = requireSeller(req, res);
    if (!rMe) return;
    var rBody = JSON.parse(await readBody(req) || '{}');
    var rProp = propertyOfSeller(rMe.username, rBody.propertyId);
    if (!rProp) return sendJSON(res, 404, { error: '房源不存在或不属于该卖家' });
    var rBuyer = loadUserFile(String(rBody.buyerUsername || ''));
    if (!rBuyer) return sendJSON(res, 404, { error: '买家不存在' });
    var content = String(rBody.content || '').trim();
    if (!content) return sendJSON(res, 400, { error: '回复内容不能为空' });

    if (!rBuyer.state.conversations[rBody.propertyId]) rBuyer.state.conversations[rBody.propertyId] = [];
    var conv = rBuyer.state.conversations[rBody.propertyId];
    conv.forEach(function (m) { if (m.role === 'buyer') m.sellerRead = true; });
    conv.push({
      role: 'seller', content: content,
      avatar: rMe.user.account.name[0],
      time: new Date().toISOString(), read: false, manual: true
    });
    saveUserFile(rBuyer.account.username, rBuyer);
    return sendJSON(res, 200, { ok: true });
  }

  /* ---- 卖家审批看房申请：action = confirm / reject ---- */
  if (urlPath === '/api/seller/viewing' && method === 'POST') {
    var vMe = requireSeller(req, res);
    if (!vMe) return;
    var vBody = JSON.parse(await readBody(req) || '{}');
    var vProp = propertyOfSeller(vMe.username, vBody.propertyId);
    if (!vProp) return sendJSON(res, 404, { error: '房源不存在或不属于该卖家' });
    var vBuyer = loadUserFile(String(vBody.buyerUsername || ''));
    if (!vBuyer) return sendJSON(res, 404, { error: '买家不存在' });

    var rec = (vBuyer.state.viewingRecords || []).find(function (x) { return x.id === vBody.viewingId; });
    if (!rec) return sendJSON(res, 404, { error: '看房申请不存在' });
    if (rec.status !== 'pending') return sendJSON(res, 400, { error: '该申请已处理' });

    var note = String(vBody.note || '').trim();
    var sysText;
    if (vBody.action === 'confirm') {
      rec.status = 'confirmed';
      rec.sellerNote = note || '卖家已确认';
      sysText = '✅ 卖家已确认看房预约：' + rec.date + ' ' + rec.timeSlot + '，请准时到达。';
    } else {
      rec.status = 'cancelled';
      rec.sellerNote = note || '该时段已有安排';
      sysText = '❌ 卖家婉拒了看房申请' + (note ? '：' + note : '，建议换个时段重新预约。');
    }
    if (!vBuyer.state.conversations[vBody.propertyId]) vBuyer.state.conversations[vBody.propertyId] = [];
    vBuyer.state.conversations[vBody.propertyId].push({ role: 'system', content: sysText, time: new Date().toISOString() });
    saveUserFile(vBuyer.account.username, vBuyer);
    return sendJSON(res, 200, { ok: true, status: rec.status });
  }

  /* ---- 卖家受理议价：action = accept / counter / reject ---- */
  if (urlPath === '/api/seller/offer' && method === 'POST') {
    var oMe = requireSeller(req, res);
    if (!oMe) return;
    var oBody = JSON.parse(await readBody(req) || '{}');
    var oProp = propertyOfSeller(oMe.username, oBody.propertyId);
    if (!oProp) return sendJSON(res, 404, { error: '房源不存在或不属于该卖家' });
    var oBuyer = loadUserFile(String(oBody.buyerUsername || ''));
    if (!oBuyer) return sendJSON(res, 404, { error: '买家不存在' });

    var oConv = oBuyer.state.conversations && oBuyer.state.conversations[oBody.propertyId];
    var dealMsg = null;
    if (oConv) {
      for (var k = oConv.length - 1; k >= 0; k--) {
        if (oConv[k].type === 'deal' && oConv[k].role === 'buyer') { dealMsg = oConv[k]; break; }
      }
    }
    if (!dealMsg) return sendJSON(res, 404, { error: '没有待处理的议价' });
    if (dealMsg.deal.status !== 'pending') return sendJSON(res, 400, { error: '该议价已处理' });

    var nowIso = new Date().toISOString();
    var sellerMsg = { role: 'seller', type: 'deal', avatar: oMe.user.account.name[0], time: nowIso, read: false };

    if (oBody.action === 'accept') {
      var price = dealMsg.deal.price;
      dealMsg.deal.status = 'accepted';
      sellerMsg.content = '接受出价 ' + price + ' 万，达成交易！';
      sellerMsg.deal = { price: price, reason: dealMsg.deal.reason, status: 'accepted' };
      // 创建/更新交易流程
      var txData = {
        propertyId: oBody.propertyId, propertyTitle: propTitle(oProp),
        agreedPrice: price, currentStep: 1, steps: dealSteps(price), createdAt: nowIso
      };
      var txs = oBuyer.state.transactions;
      var existing = txs.find(function (t) { return t.propertyId === oBody.propertyId; });
      if (existing) Object.assign(existing, txData); else txs.push(txData);
      // 写入 AI 行为记忆
      oBuyer.state.aiMemory.push({ type: '成交议价', text: '就 ' + propTitle(oProp) + ' 达成 ' + price + ' 万（卖家受理）', time: nowIso });
    } else if (oBody.action === 'counter') {
      var cp = parseInt(oBody.counterPrice, 10);
      if (!cp || cp <= 0) return sendJSON(res, 400, { error: '请填写有效的还价金额' });
      dealMsg.deal.status = 'countered';
      dealMsg.deal.counterPrice = cp;
      sellerMsg.content = '还价 ' + cp + ' 万，这个价格比较有诚意。';
      sellerMsg.deal = { price: dealMsg.deal.price, status: 'countered', counterPrice: cp };
    } else {
      var rnote = String(oBody.note || '').trim();
      dealMsg.deal.status = 'rejected';
      sellerMsg.content = '这个出价暂时无法接受' + (rnote ? '：' + rnote : '，欢迎继续沟通。');
      sellerMsg.deal = { price: dealMsg.deal.price, status: 'rejected' };
    }
    oConv.push(sellerMsg);
    saveUserFile(oBuyer.account.username, oBuyer);
    return sendJSON(res, 200, { ok: true, deal: sellerMsg.deal });
  }

  /* ---- 卖家确认交易环节（需买卖双方都确认才进入下一步） ---- */
  if (urlPath === '/api/seller/deal-step' && method === 'POST') {
    var dMe = requireSeller(req, res);
    if (!dMe) return;
    var dBody = JSON.parse(await readBody(req) || '{}');
    var dProp = propertyOfSeller(dMe.username, dBody.propertyId);
    if (!dProp) return sendJSON(res, 404, { error: '房源不存在或不属于该卖家' });
    var dBuyer = loadUserFile(String(dBody.buyerUsername || ''));
    if (!dBuyer) return sendJSON(res, 404, { error: '买家不存在' });

    var tx = (dBuyer.state.transactions || []).find(function (t) { return t.propertyId === dBody.propertyId; });
    if (!tx) return sendJSON(res, 404, { error: '交易记录不存在' });
    if (tx.currentStep >= tx.steps.length) return sendJSON(res, 400, { error: '交易已完成所有步骤' });

    var step = tx.steps[tx.currentStep];
    if (!dBuyer.state.conversations[dBody.propertyId]) dBuyer.state.conversations[dBody.propertyId] = [];
    var conv = dBuyer.state.conversations[dBody.propertyId];
    var nowIso2 = new Date().toISOString();
    var advanced = false;

    if (step.sellerConfirmed) {
      return sendJSON(res, 400, { error: '你已确认过该环节，等待买家确认' });
    }
    step.sellerConfirmed = true;
    if (step.buyerConfirmed) {
      // 买家此前已确认 → 双方齐了，推进
      step.done = true;
      tx.currentStep = tx.currentStep + 1;
      advanced = true;
      conv.push({ role: 'system', content: '🤝 买卖双方均已确认完成「' + step.title + '」，交易进入下一环节。', time: nowIso2 });
    } else {
      conv.push({ role: 'system', content: '✅ 卖家已确认完成「' + step.title + '」，等待买家确认。', time: nowIso2 });
    }
    saveUserFile(dBuyer.account.username, dBuyer);
    return sendJSON(res, 200, { ok: true, currentStep: tx.currentStep, advanced: advanced });
  }

  /* ---- 买家确认交易环节（与卖家确认共同生效） ---- */
  if (urlPath === '/api/deal/confirm' && method === 'POST') {
    var cMe = authFromReq(req);
    if (!cMe) return sendJSON(res, 401, { error: '未登录' });
    if (cMe.user.account.role === 'seller') return sendJSON(res, 403, { error: '卖家请在卖家中心确认交易环节' });
    var cBody = JSON.parse(await readBody(req) || '{}');
    var cTx = (cMe.user.state.transactions || []).find(function (t) { return t.propertyId === cBody.propertyId; });
    if (!cTx) return sendJSON(res, 404, { error: '交易记录不存在' });
    if (cTx.currentStep >= cTx.steps.length) return sendJSON(res, 400, { error: '交易已完成所有步骤' });

    var cStep = cTx.steps[cTx.currentStep];
    if (!cMe.user.state.conversations[cBody.propertyId]) cMe.user.state.conversations[cBody.propertyId] = [];
    var cConv = cMe.user.state.conversations[cBody.propertyId];
    var cNow = new Date().toISOString();
    var cAdvanced = false;

    if (cStep.buyerConfirmed) {
      return sendJSON(res, 400, { error: '你已确认过该环节，等待卖家确认' });
    }
    cStep.buyerConfirmed = true;
    if (cStep.sellerConfirmed) {
      cStep.done = true;
      cTx.currentStep = cTx.currentStep + 1;
      cAdvanced = true;
      cConv.push({ role: 'system', content: '🤝 买卖双方均已确认完成「' + cStep.title + '」，交易进入下一环节。', time: cNow });
    } else {
      cConv.push({ role: 'system', content: '✅ 你已确认完成「' + cStep.title + '」，等待卖家确认。', time: cNow });
    }
    saveUserFile(cMe.username, cMe.user);
    return sendJSON(res, 200, { ok: true, currentStep: cTx.currentStep, advanced: cAdvanced });
  }

  return sendJSON(res, 404, { error: 'API not found: ' + urlPath });
}

/* ============ 主服务器 ============ */
var server = http.createServer(async function (req, res) {
  var urlPath = req.url.split('?')[0];
  var method = req.method;
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  if (urlPath.indexOf('/api/') === 0) {
    try { await handleAPI(req, res, urlPath, method); }
    catch (e) { sendJSON(res, 500, { error: e.message || String(e) }); }
    return;
  }
  serveStatic(req, res, urlPath);
});

server.listen(PORT, '0.0.0.0', function () {
  console.log('Nexthome AI 购房助手 运行中: http://127.0.0.1:' + PORT);
  console.log('房源数量: ' + properties.length + ' 套');
  console.log('AI 配置: ' + (aiConfig ? aiConfig.model : '未配置'));
  console.log('管理员账号: administrator / admin123');
});
