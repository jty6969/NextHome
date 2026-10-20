import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { access, mkdir, writeFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import net from 'node:net';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT || 3000);
const password = process.env.NEXTHOME_REMOTE_PASSWORD || randomBytes(18).toString('base64url');
const username = process.env.NEXTHOME_REMOTE_USER || 'nexthome';
const children = [];
let stopping = false, ownsStatus = false;
async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (!child.pid || child.exitCode !== null) continue;
    if (process.platform === 'win32') {
      // Only terminate the process trees created by this launcher.
      await new Promise(resolve => {
        const kill = spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' });
        kill.on('exit', resolve); kill.on('error', resolve);
      });
    } else child.kill('SIGTERM');
  }
  if (ownsStatus) await rm(path.join(root, '.local/mobile-access.json'), { force: true });
  process.exit(code);
}
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
function start(command, args, options = {}) {
  const child = spawn(command, args, { cwd: root, windowsHide: true, ...options });
  children.push(child);
  child.on('error', error => { console.error(error.message); stop(1); });
  child.on('exit', () => { if (!stopping) { console.error('Preview service stopped. Restart this launcher.'); stop(1); } });
  return child;
}
try {
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('PORT must be between 1024 and 65535.');
  await new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', () => reject(new Error(`Port ${port} is in use. Close the existing NextHome preview, then retry. No existing process was stopped.`)));
    probe.listen(port, '127.0.0.1', () => probe.close(resolve));
  });
  let cloudflared = process.env.NEXTHOME_CLOUDFLARED || 'cloudflared';
  const windowsBinary = 'C:\\Program Files (x86)\\cloudflared\\cloudflared.exe';
  if (process.platform === 'win32' && !process.env.NEXTHOME_CLOUDFLARED) {
    try { await access(windowsBinary); cloudflared = windowsBinary; } catch { /* Try PATH. */ }
  }
  const args = ['--watch', '--watch-path=worker', '--watch-path=scripts', 'scripts/dev.mjs', '--remote'];
  try { await access(path.join(root, 'legacy/victor/ai-config.json')); args.push('--victor-ai'); } catch { /* Environment API key remains supported. */ }
  console.log('\nNextHome mobile preview — keep this window open. Ctrl+C to stop.');
  start(process.execPath, args, { env: { ...process.env, PORT: String(port), NEXTHOME_REMOTE_USER: username, NEXTHOME_REMOTE_PASSWORD: password }, stdio: ['ignore', 'inherit', 'inherit'] });
  let ready = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    try { const response = await fetch(`http://127.0.0.1:${port}/api/dev-version`, { signal: AbortSignal.timeout(1000) }); ready = response.ok; } catch { /* Starting. */ }
    if (ready) break;
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  if (!ready) throw new Error('Local preview did not start. Check the error above.');
  const tunnel = start(cloudflared, ['tunnel', '--url', `http://127.0.0.1:${port}`, '--no-autoupdate'], { stdio: ['ignore', 'pipe', 'pipe'] });
  let reported = false, tail = '';
  async function output(chunk) {
    const value = chunk.toString();
    process.stdout.write(value);
    tail = (tail + value).slice(-8000);
    const match = tail.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (!reported && match) {
      reported = true;
      await mkdir(path.join(root, '.local'), { recursive: true });
      await writeFile(path.join(root, '.local/mobile-access.json'), JSON.stringify({ url: match[0], local: `http://127.0.0.1:${port}`, startedAt: new Date().toISOString() }, null, 2));
      ownsStatus = true;
      console.log(`\nIPHONE URL: ${match[0]}\nRemote username: ${username}\nRemote password: ${password}\nThen sign in with your NextHome account.\nSafari > Share > Add to Home Screen.\nEdit on PC; on iPhone use App > Refresh app.\nTemporary URL changes after restarting this launcher.\n`);
    }
  }
  for (const stream of [tunnel.stdout, tunnel.stderr]) stream.on('data', chunk => { output(chunk).catch(error => { console.error(error.message); stop(1); }); });
} catch (error) { console.error(error.message); await stop(1); }
