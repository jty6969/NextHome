// Network-first, cache-free: never persist accounts, listings or AI conversations here.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', event => {
  if (event.request.mode !== 'navigate' || event.request.method !== 'GET' ||
      new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith(fetch(event.request).catch(() => new Response(`<!doctype html>
<html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>NextHome · 暂时无法连接</title><style>body{font:16px system-ui;line-height:1.7;background:#f5f7fa;color:#0e2a4c;padding:12vh 24px;max-width:480px;margin:auto}button{background:#0e2a4c;color:white;border:0;padding:14px 24px;border-radius:12px;font:inherit}</style>
<h1>NextHome</h1><h2>暂时无法连接电脑</h2><p>请确认电脑已开机、联网，并且手机预览服务正在运行。临时网址在重新启动后可能变化。</p>
<p>Can't connect. Check your computer, network and preview service. Temporary links may change after a restart.</p>
<button onclick="location.reload()">重新连接 / Retry</button></html>`, {
    status: 503, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  })));
});
