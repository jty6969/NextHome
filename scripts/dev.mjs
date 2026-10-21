import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import worker from '../worker/app.js';
import { openDatabase, d1, root } from './local-db.mjs';
import { migrateVictor } from './migrate-victor.mjs';
import { externalRequest, publicRequestOrigin, validRemoteAuthorization, remoteAccessCookie, validRemoteCookie } from './remote-access.mjs';
import { developmentVersion } from './dev-version.mjs';
const remoteMode = process.argv.includes('--remote');
const remoteUsername = process.env.NEXTHOME_REMOTE_USER || 'nexthome';
const remotePassword = process.env.NEXTHOME_REMOTE_PASSWORD || '';
if (remoteMode && remotePassword.length < 16) throw new Error('NEXTHOME_REMOTE_PASSWORD must contain at least 16 characters in remote mode.');
const db = await openDatabase(process.env.NEXTHOME_DB_PATH || path.join(root, process.argv.includes('--isolated') ? `.local/check-${Date.now()}.sqlite` : '.local/nexthome.sqlite'));
const localAIKey = process.env.DEEPSEEK_API_KEY?.trim() || await readFile(path.join(root, '.local/deepseek-api-key.txt'), 'utf8')
  .then(value => value.trim()).catch(error => { if (error.code === 'ENOENT') return ''; throw error; });
const mime = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.json':'application/json; charset=utf-8', '.webmanifest':'application/manifest+json', '.png':'image/png' };
const env = { DB:d1(db), DEEPSEEK_API_KEY:localAIKey, DEEPSEEK_MODEL:process.env.DEEPSEEK_MODEL?.trim() || 'deepseek-flash', ASSETS:{
  async fetch(request) {
    let relative = new URL(request.url).pathname;
    if (relative === '/') relative = '/index.html';
    if (!['/index.html', '/manifest.webmanifest', '/sw.js'].includes(relative) && !relative.startsWith('/assets/')) return new Response('Not found', { status:404 });
    const file = path.resolve(root, '.' + relative);
    if (!file.startsWith(root + path.sep)) return new Response('Forbidden', { status:403 });
    try {
      let content = await readFile(file);
      if (relative === '/index.html') content = content.toString().replace('</head>', `<meta name="nexthome-version" content="${await developmentVersion(root)}"></head>`);
      return new Response(content, { headers:{'content-type':mime[path.extname(file)] || 'application/octet-stream', 'cache-control':'no-store'} });
    }
    catch { return new Response('Not found', { status:404 }); }
  },
} };
await worker.fetch(new Request('http://127.0.0.1/api/listings'), env);
if (process.argv.includes('--import-victor')) console.log('Legacy migration:', await migrateVictor(db));
if (process.argv.includes('--victor-ai')) {
  const config = JSON.parse(await readFile(path.join(root, 'legacy/victor/ai-config.json'), 'utf8'));
  env.DEEPSEEK_API_KEY = config.apiKey;
}
const port = Number(process.env.PORT || 3000);
const server = http.createServer(async (req, res) => {
  try {
    const needsRemoteAuth = externalRequest(req.headers, remoteMode);
    const basicAuthorized = needsRemoteAuth && validRemoteAuthorization(req.headers.authorization, remoteUsername, remotePassword);
    if (needsRemoteAuth && !basicAuthorized && !validRemoteCookie(req.headers.cookie, remoteUsername, remotePassword)) {
      res.writeHead(401, { 'content-type':'text/plain; charset=utf-8', 'cache-control':'no-store', 'www-authenticate':'Basic realm="NextHome Remote", charset="UTF-8"' });
      res.end('Remote access authentication required.');
      return;
    }
    const chunks = []; let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 65536) { res.writeHead(413); res.end(); return; }
      chunks.push(chunk);
    }
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) if (value) headers.set(key, Array.isArray(value) ? value.join(',') : value);
    if (needsRemoteAuth) headers.delete('authorization');
    const requestOrigin = publicRequestOrigin(req.headers, port, remoteMode);
    const request = new Request(`${requestOrigin}${req.url}`, { method:req.method, headers,
      ...(['GET','HEAD'].includes(req.method) ? {} : { body:Buffer.concat(chunks) }) });
    const response = new URL(request.url).pathname === '/api/dev-version' && req.method === 'GET'
      ? Response.json({ version: await developmentVersion(root) }, { headers:{'cache-control':'no-store'} })
      : await worker.fetch(request, env);
    const output = Object.fromEntries(response.headers);
    const secure = new URL(request.url).protocol === 'https:';
    const cookies = response.headers.getSetCookie().map(cookie => secure ? cookie : cookie.replace(/; Secure/g, ''));
    if (basicAuthorized && secure) cookies.push(remoteAccessCookie(remoteUsername, remotePassword));
    if (cookies.length) output['set-cookie'] = cookies;
    res.writeHead(response.status, output);
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch { res.writeHead(500); res.end('Local request failed'); }
});
server.listen(port, '127.0.0.1', () => console.log(`Nexthome merged preview: http://127.0.0.1:${port}`));
process.on('SIGINT', () => server.close(() => { db.close(); process.exit(0); }));
