import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import worker from '../worker/app.js';
import { openDatabase, d1, root } from './local-db.mjs';
import { migrateVictor } from './migrate-victor.mjs';
const db = await openDatabase(path.join(root, process.argv.includes('--isolated') ? `.local/check-${Date.now()}.sqlite` : '.local/nexthome.sqlite'));
const mime = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.json':'application/json; charset=utf-8', '.png':'image/png' };
const env = { DB:d1(db), DEEPSEEK_API_KEY:process.env.DEEPSEEK_API_KEY || '', ASSETS:{
  async fetch(request) {
    let relative = new URL(request.url).pathname;
    if (relative === '/') relative = '/index.html';
    if (relative !== '/index.html' && !relative.startsWith('/assets/')) return new Response('Not found', { status:404 });
    const file = path.resolve(root, '.' + relative);
    if (!file.startsWith(root + path.sep)) return new Response('Forbidden', { status:403 });
    try { return new Response(await readFile(file), { headers:{'content-type':mime[path.extname(file)] || 'application/octet-stream'} }); }
    catch { return new Response('Not found', { status:404 }); }
  },
} };
await worker.fetch(new Request('http://127.0.0.1/api/listings'), env);
if (process.argv.includes('--import-victor')) console.log('Legacy migration:', await migrateVictor(db));
if (process.argv.includes('--victor-ai')) {
  const config = JSON.parse(await readFile(path.join(root, 'NextHome-Victor/ai-config.json'), 'utf8'));
  env.DEEPSEEK_API_KEY = config.apiKey;
}
const port = Number(process.env.PORT || 3000);
const server = http.createServer(async (req, res) => {
  try {
    const chunks = []; let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 65536) { res.writeHead(413); res.end(); return; }
      chunks.push(chunk);
    }
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) if (value) headers.set(key, Array.isArray(value) ? value.join(',') : value);
    const request = new Request(`http://127.0.0.1:${port}${req.url}`, { method:req.method, headers,
      ...(['GET','HEAD'].includes(req.method) ? {} : { body:Buffer.concat(chunks) }) });
    const response = await worker.fetch(request, env);
    const output = Object.fromEntries(response.headers);
    if (output['set-cookie']) output['set-cookie'] = output['set-cookie'].replace(/; Secure/g, '');
    res.writeHead(response.status, output);
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch { res.writeHead(500); res.end('Local request failed'); }
});
server.listen(port, '127.0.0.1', () => console.log(`Nexthome merged preview: http://127.0.0.1:${port}`));
process.on('SIGINT', () => server.close(() => { db.close(); process.exit(0); }));
