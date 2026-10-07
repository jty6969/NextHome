import http from 'node:http';
import { validId } from './listing-sync-core.mjs';

export function createLocalSyncServer({ engine, origin, port = 47831, bridge = null }) {
  let currentEngine = engine;
  async function readJson(request) {
    let body = '';
    for await (const chunk of request) {
      body += chunk;
      if (body.length > 10 * 1024 * 1024) throw new Error('payload_too_large');
    }
    return JSON.parse(body);
  }
  return http.createServer(async (request, response) => {
    const send = (status, data) => { response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store',
      'access-control-allow-origin': origin, 'vary': 'Origin', 'access-control-allow-methods': 'GET, POST, OPTIONS',
      'access-control-allow-headers': 'content-type', 'access-control-allow-private-network': 'true' }); response.end(status === 204 ? undefined : JSON.stringify(data)); };
    // Exact origin and Host checks prevent cross-site requests and DNS rebinding.
    const actualPort = port || request.socket.localPort;
    if (request.headers.origin !== origin || request.headers.host !== `127.0.0.1:${actualPort}`) return send(403, {});
    if (request.method === 'OPTIONS') return send(204, null);
    const url = new URL(request.url, `http://127.0.0.1:${actualPort}`);
    try {
      if (bridge && url.pathname === '/bridge/state' && request.method === 'GET') {
        return send(200, { userId: currentEngine?.userId ?? null, cursor: currentEngine?.state?.cursor ?? null,
          startCursor: currentEngine?.state?.startCursor ?? null, historyCursor: currentEngine?.state?.historyCursor ?? '',
          historyComplete: Boolean(currentEngine?.state?.historyComplete), exportHistory: bridge.exportHistory });
      }
      if (bridge && url.pathname === '/bridge/initialize' && request.method === 'POST') {
        const body = await readJson(request);
        if (!validId(body?.userId) || !Number.isSafeInteger(body?.cursor) || body.cursor < 0) return send(400, {});
        currentEngine = await bridge.initialize(body.userId, body.cursor);
        return send(200, { userId: currentEngine.userId, cursor: currentEngine.state.cursor,
          startCursor: currentEngine.state.startCursor });
      }
      if (bridge && ['/bridge/history', '/bridge/events'].includes(url.pathname) && request.method === 'POST') {
        if (!currentEngine) return send(409, {});
        const body = await readJson(request);
        if (url.pathname === '/bridge/history') await currentEngine.acceptHistoryPage(body);
        else await currentEngine.acceptLivePage(body);
        if (url.pathname === '/bridge/history' && body.done) bridge.historyComplete?.(currentEngine.state.historyCount || 0);
        return send(200, { ok: true, cursor: currentEngine.state.cursor });
      }
    } catch { return send(503, { state: 'failed' }); }
    const id = url.searchParams.get('id');
    if (!validId(id)) return send(400, {});
    try {
      if (url.pathname === '/retry' && request.method === 'POST' && request.headers['content-type'] === 'application/json') {
        if (!bridge && currentEngine) await currentEngine.poll();
      } else if (url.pathname !== '/status' || request.method !== 'GET') return send(404, {});
      send(200, { userId: currentEngine?.userId ?? null, state: currentEngine ? await currentEngine.listingStatus(id) : 'pending' });
    } catch { send(503, { state: 'failed' }); }
  });
}
