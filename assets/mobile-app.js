(() => {
  const tr = (zh, en) => document.documentElement.lang === 'en' ? en : zh;
  const installed = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const menu = document.createElement('details');
  menu.className = 'app-menu';
  menu.innerHTML = '<summary>App</summary><div class="app-menu-panel"><p class="app-state"></p><button type="button" class="app-install"></button><button type="button" class="app-refresh"></button><p class="app-help" hidden></p><small class="app-version"></small></div>';
  document.querySelector('.header-actions')?.append(menu);
  const status = menu.querySelector('.app-state'), install = menu.querySelector('.app-install');
  const refresh = menu.querySelector('.app-refresh'), help = menu.querySelector('.app-help');
  const versionLabel = menu.querySelector('.app-version');
  // Keep the existing admin button and its permission checks; only relocate it on phones.
  const adminEntry = document.getElementById('openAdminModal');
  const originalAdminParent = adminEntry?.parentElement;
  const originalAdminNext = adminEntry?.nextSibling;
  function placeAdminEntry() {
    if (!adminEntry) return;
    if (window.innerWidth <= 768) menu.querySelector('.app-menu-panel').insertBefore(adminEntry, refresh);
    else originalAdminParent.insertBefore(adminEntry, originalAdminNext);
  }
  adminEntry?.addEventListener('click', () => { menu.open = false; });
  window.addEventListener('resize', placeAdminEntry);
  placeAdminEntry();
  // iOS's software keyboard shrinks the visual viewport, not necessarily 100dvh.
  function fitKeyboardViewport() {
    const viewport = window.visualViewport;
    if (!viewport || viewport.scale !== 1) return;
    document.documentElement.style.setProperty('--app-viewport-height', `${viewport.height}px`);
    document.documentElement.style.setProperty('--app-viewport-top', `${viewport.offsetTop}px`);
  }
  window.visualViewport?.addEventListener('resize', fitKeyboardViewport);
  window.visualViewport?.addEventListener('scroll', fitKeyboardViewport);
  fitKeyboardViewport();
  let version = document.querySelector('meta[name="nexthome-version"]')?.content || '';
  let updateAvailable = false, checking = false, swUnavailable = false;
  // Keep drafts in their existing controls, not in a new persistent private-data cache.
  const edited = new Map();
  document.addEventListener('input', event => {
    if (event.target.matches('input:not([type=password]),textarea,select')) edited.set(event.target, event.target.value);
  });
  function render() {
    menu.querySelector('summary').textContent = updateAvailable ? tr('更新', 'Update') : 'App';
    status.textContent = !navigator.onLine ? tr('当前网络已断开', 'You are offline') :
      installed() ? tr('已从桌面打开', 'Opened from Home Screen') : tr('NextHome 手机应用', 'NextHome mobile app');
    install.textContent = tr('添加到 iPhone 主屏幕', 'Add to iPhone Home Screen');
    install.hidden = installed();
    refresh.textContent = updateAvailable ? tr('有新版本 · 点击更新', 'New version · Update') : tr('刷新版本', 'Refresh app');
    help.textContent = tr('在 iPhone 的 Safari 打开此网址 → 分享 → 添加到主屏幕 → 如有“作为网页 App 打开”，将其开启 → 添加。此入口仍需要电脑和预览服务保持运行。', 'Open this URL in Safari on iPhone → Share → Add to Home Screen → enable Open as Web App if shown → Add. Keep the computer and preview service running.');
    versionLabel.textContent = swUnavailable ? tr('离线提示不可用，联网使用不受影响', 'Offline screen unavailable; online use still works') : version ? tr('当前版本 ', 'Current version ') + version : '';
    menu.classList.toggle('has-update', updateAvailable);
  }
  install.addEventListener('click', () => { help.hidden = !help.hidden; });
  refresh.addEventListener('click', () => {
    const hasDraft = [...edited].some(([el]) => el.isConnected && el.value.trim());
    if (hasDraft && !window.confirm(tr('刷新会清除尚未提交的输入。已保存的数据不受影响。现在刷新吗？', 'Refreshing clears unsent input. Saved data is safe. Refresh now?'))) return;
    location.reload();
  });
  document.addEventListener('click', event => { if (!menu.contains(event.target)) menu.open = false; });
  document.addEventListener('keydown', event => { if (event.key === 'Escape') menu.open = false; });
  async function checkVersion() {
    if (document.hidden || checking || !navigator.onLine || !version) return;
    checking = true;
    try {
      const response = await fetch('/api/dev-version', { cache: 'no-store', signal: AbortSignal.timeout(5000) });
      if (response.ok) {
        const next = await response.json();
        if (typeof next.version === 'string' && next.version !== version) updateAvailable = true;
      }
    } catch { /* A restart or disconnected tunnel must not interrupt input. */ }
    finally { checking = false; render(); }
  }
  for (const event of ['online', 'offline']) window.addEventListener(event, render);
  document.addEventListener('languagechange', render);
  document.addEventListener('visibilitychange', checkVersion);
  window.addEventListener('focus', checkVersion);
  setInterval(checkVersion, 15000);
  if ('serviceWorker' in navigator && window.isSecureContext) {
    navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' })
      .catch(() => { swUnavailable = true; render(); });
  }
  render();
})();
