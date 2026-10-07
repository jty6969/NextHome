import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { mkdir, open, readFile, unlink } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { ListingSync } from './listing-sync-core.mjs';
import { createLocalSyncServer } from './listing-sync-server.mjs';

const args = process.argv.slice(2);
const option = name => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
if (args.includes('--help')) {
  console.log('npm run sync:listings -- --url https://YOUR-SITE --browser-bridge [--export-history] [--interval 5000]\nKeep the signed-in website open / 保持已登录的网站页面打开。');
  process.exit(0);
}
let origin;
try {
  const url = new URL(option('url') || process.env.NEXTHOME_URL);
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash
    || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))) throw new Error();
  origin = url.origin;
} catch { console.error('请指定网站根地址 / Specify the site origin using --url or NEXTHOME_URL.'); process.exit(1); }
const interval = Number(option('interval') || process.env.NEXTHOME_SYNC_INTERVAL_MS || 5000);
if (!Number.isInteger(interval) || interval < 1000 || interval > 15000) {
  console.error('轮询间隔必须为 1000–15000 ms / Poll interval must be 1000–15000 ms.'); process.exit(1);
}
const directory = fileURLToPath(new URL('../listing-data/', import.meta.url));
await mkdir(directory, { recursive: true, mode: 0o700 });
const lockPath = path.join(directory, '.sync.lock');
const bridgeMode = args.includes('--browser-bridge');
async function acquireLock() {
  try { const lock = await open(lockPath, 'wx', 0o600); await lock.writeFile(String(process.pid)); await lock.close(); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const pid = Number(await readFile(lockPath, 'utf8'));
    if (!Number.isInteger(pid) || pid < 1) throw new Error('lock');
    try { process.kill(pid, 0); throw new Error('running'); }
    catch (probe) { if (probe.code !== 'ESRCH') throw probe; }
    await unlink(lockPath); await acquireLock();
  }
}
try { await acquireLock(); }
catch { console.error('同步程序已运行或目录不可写 / Already running or directory unavailable.'); process.exit(1); }

let cookie = ''; let engine; let server; let timer; let stopping = false;
async function api(endpoint, body) {
  const response = await fetch(`${origin}${endpoint}`, {
    method: body ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(15000),
    headers: { origin, ...(cookie ? { cookie } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    const error = new Error('request_failed');
    error.code = response.status === 401 ? 'auth_required' : response.status === 403 ? 'access_blocked' : 'request_failed';
    throw error;
  }
  const result = await response.json();
  if (endpoint === '/api/auth/login') {
    const value = response.headers.getSetCookie().find(item => item.startsWith('nexthome_session='));
    if (!value || !result.user?.id) throw new Error('login_failed');
    cookie = value.split(';')[0];
  }
  return result;
}
async function hiddenPassword() {
  if (!process.stdin.isTTY || !process.stdin.setRawMode) throw new Error('interactive_terminal_required');
  process.stdout.write('密码 / Password: ');
  return new Promise((resolve, reject) => {
    let value = '';
    process.stdin.setRawMode(true); process.stdin.resume(); process.stdin.setEncoding('utf8');
    const finish = () => { process.stdin.off('data', listener); process.stdin.setRawMode(false); process.stdin.pause(); process.stdout.write('\n'); };
    const listener = chunk => {
      for (const char of chunk) {
        if (char === '\u0003') { finish(); reject(new Error('cancelled')); return; }
        if (char === '\r' || char === '\n') { finish(); resolve(value); value = ''; return; }
        if (char === '\u007f' || char === '\b') value = value.slice(0, -1);
        else if (char >= ' ') value += char;
      }
    };
    process.stdin.on('data', listener);
  });
}
async function signIn() {
  let username = option('username') || process.env.NEXTHOME_SYNC_USERNAME;
  if (!username) { const prompt = createInterface({ input: process.stdin, output: process.stdout }); username = await prompt.question('账号 / Username: '); prompt.close(); }
  let password = await hiddenPassword();
  try { return (await api('/api/auth/login', { username, password })).user; }
  finally { password = ''; }
}
async function stop() {
  if (stopping) return; stopping = true;
  clearTimeout(timer); server?.close();
  // Finish any atomic write/checkpoint before releasing the single-process lock.
  if (engine?.running) await engine.running;
  cookie = ''; await unlink(lockPath).catch(() => {}); process.exit(0);
}
process.on('SIGINT', stop); process.on('SIGTERM', stop);

let startupStage = 'login';
try {
  if (bridgeMode) {
    startupStage = 'local_server';
    server = createLocalSyncServer({ origin, bridge: {
      exportHistory: args.includes('--export-history'),
      async initialize(userId, cursor) {
        engine = new ListingSync({ directory, origin, userId, api: null });
        await engine.initializeFromBoundary(cursor);
        return engine;
      },
      historyComplete(count) { console.log(`历史房源导出完成：${count} 套 / Historical export complete: ${count} listings.`); },
    } });
  } else {
    const user = await signIn();
    startupStage = 'initialize';
    engine = new ListingSync({ directory, origin, userId: user.id, api });
    await engine.initialize();
    if (args.includes('--export-history')) {
      startupStage = 'history';
      const count = await engine.exportHistory();
      console.log(`历史房源导出完成：${count} 套 / Historical export complete: ${count} listings.`);
    }
    startupStage = 'local_server';
    server = createLocalSyncServer({ engine, origin });
  }
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(47831, '127.0.0.1', resolve); });
  console.log(`本地同步已启动 / Local sync started: ${directory}\n${bridgeMode ? '请保持已登录的网站页面打开 / Keep the signed-in website open.' : `每 ${interval / 1000} 秒检查新增房源 / Polls every ${interval / 1000}s.`} Ctrl+C stops.`);
  if (bridgeMode) await new Promise(() => {});
  let previous;
  async function cycle() {
    const status = await engine.poll();
    if (status !== previous) {
      console.log(status === 'ready' ? '连接正常 / Connected.' : status === 'auth_required'
        ? '登录已失效，请重启程序重新登录 / Session expired; restart and sign in again.'
        : '本地同步失败，将自动重试；云端房源保留 / Sync failed; retrying. Cloud listings remain saved.');
      previous = status;
    }
    if (!stopping) timer = setTimeout(cycle, interval);
  }
  if (!bridgeMode) await cycle();
} catch (error) {
  const reason = ['auth_required', 'access_blocked', 'request_failed', 'login_failed', 'interactive_terminal_required', 'cancelled']
    .includes(error?.code || error?.message) ? (error.code || error.message) : 'unavailable';
  console.error(`启动失败（${startupStage}/${reason}）：检查网址、账号、网络和文件夹权限后重试。 / Startup failed (${startupStage}/${reason}): check URL, account, network and folder permissions.`);
  await unlink(lockPath).catch(() => {}); cookie = ''; server?.close(); process.exit(1);
}
