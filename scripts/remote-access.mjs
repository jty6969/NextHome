import { createHmac, timingSafeEqual } from 'node:crypto';

const first = value => Array.isArray(value) ? value[0] : String(value || '').split(',')[0].trim();
const localHost = value => /^(?:localhost|127(?:\.\d{1,3}){3}|\[::1\])(?::\d{1,5})?$/i.test(value || '');
const safeHost = value => /^[a-z0-9.-]+(?::\d{1,5})?$/i.test(value || '');

function parsedOrigin(value) {
  try {
    const url = new URL(first(value));
    return ['http:', 'https:'].includes(url.protocol) ? url : null;
  } catch { return null; }
}

export function externalRequest(headers, remoteMode) {
  if (!remoteMode) return false;
  const forwardedHost = first(headers['x-forwarded-host']);
  const host = first(headers.host);
  const origin = parsedOrigin(headers.origin);
  return Boolean(!host || !localHost(host) || (forwardedHost && !localHost(forwardedHost)) ||
    headers['cf-connecting-ip'] || headers['cf-ray'] ||
    (origin && !localHost(origin.host)));
}

export function publicRequestOrigin(headers, port, remoteMode) {
  if (!remoteMode) return `http://127.0.0.1:${port}`;
  const origin = parsedOrigin(headers.origin);
  const forwardedHost = first(headers['x-forwarded-host']);
  const host = forwardedHost || first(headers.host);
  if ((!host || localHost(host)) && origin && !localHost(origin.host)) return origin.origin;
  if (!safeHost(host)) return `http://127.0.0.1:${port}`;
  let protocol = first(headers['x-forwarded-proto']).toLowerCase();
  if (!['http', 'https'].includes(protocol)) {
    try { protocol = JSON.parse(first(headers['cf-visitor'])).scheme; } catch { protocol = ''; }
  }
  if (!['http', 'https'].includes(protocol)) protocol = localHost(host) ? 'http' : 'https';
  return `${protocol}://${host}`;
}

export function validRemoteAuthorization(value, username, password) {
  if (!value || !/^Basic\s+/i.test(value) || !username || !password) return false;
  let supplied;
  try { supplied = Buffer.from(value.replace(/^Basic\s+/i, ''), 'base64').toString('utf8'); }
  catch { return false; }
  const expected = `${username}:${password}`;
  const suppliedBytes = Buffer.from(supplied);
  const expectedBytes = Buffer.from(expected);
  return suppliedBytes.length === expectedBytes.length && timingSafeEqual(suppliedBytes, expectedBytes);
}

const remoteCookieName = '__Host-nexthome_remote';
const remoteSignature = (expires, username, password) => createHmac('sha256', password)
  .update(`NextHome remote\n${username}\n${expires}`).digest('base64url');

// Safari can transfer cookies to a Home Screen app; HTTP Basic credentials may not transfer.
export function remoteAccessCookie(username, password, now = Date.now()) {
  const expires = Math.floor(now / 1000) + 7 * 86400;
  return `${remoteCookieName}=${expires}.${remoteSignature(expires, username, password)}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=604800`;
}

export function validRemoteCookie(cookie, username, password, now = Date.now()) {
  if (!username || !password) return false;
  const value = String(cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith(remoteCookieName + '='))?.slice(remoteCookieName.length + 1);
  if (!value || !/^\d{10}\.[a-zA-Z0-9_-]{43}$/.test(value)) return false;
  const [expires, signature] = value.split('.');
  if (Number(expires) <= Math.floor(now / 1000) || Number(expires) > Math.floor(now / 1000) + 7 * 86400) return false;
  return timingSafeEqual(Buffer.from(signature), Buffer.from(remoteSignature(expires, username, password)));
}
