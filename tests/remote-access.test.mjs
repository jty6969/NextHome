import assert from 'node:assert/strict';
import test from 'node:test';
import { externalRequest, publicRequestOrigin, validRemoteAuthorization, remoteAccessCookie, validRemoteCookie } from '../scripts/remote-access.mjs';

test('remote access distinguishes loopback from a forwarded HTTPS hostname', () => {
  assert.equal(externalRequest({ host:'127.0.0.1:3000' }, true), false);
  assert.equal(externalRequest({ host:'127.0.0.1:3000', origin:'https://buyer.example.com' }, true), true);
  assert.equal(externalRequest({ host:'buyer.example.com', 'x-forwarded-proto':'https' }, true), true);
  assert.equal(externalRequest({ host:'buyer.example.com' }, false), false);
  assert.equal(externalRequest({ host:'buyer.example.com', 'x-forwarded-host':'localhost' }, true), true);
  assert.equal(externalRequest({ host:'localhost', 'cf-connecting-ip':'203.0.113.4' }, true), true);
  assert.equal(externalRequest({}, true), true);
  assert.equal(publicRequestOrigin({ host:'buyer.example.com', 'x-forwarded-proto':'https' }, 3000, true), 'https://buyer.example.com');
  assert.equal(publicRequestOrigin({ host:'127.0.0.1:3000', origin:'https://buyer.example.com' }, 3000, true), 'https://buyer.example.com');
  assert.equal(publicRequestOrigin({ host:'127.0.0.1:3000' }, 3000, false), 'http://127.0.0.1:3000');
});

test('remote access uses constant-time Basic credential comparison semantics', () => {
  const good = `Basic ${Buffer.from('nexthome:correct-horse-battery').toString('base64')}`;
  const bad = `Basic ${Buffer.from('nexthome:wrong-password-value').toString('base64')}`;
  assert.equal(validRemoteAuthorization(good, 'nexthome', 'correct-horse-battery'), true);
  assert.equal(validRemoteAuthorization(bad, 'nexthome', 'correct-horse-battery'), false);
  assert.equal(validRemoteAuthorization('', 'nexthome', 'correct-horse-battery'), false);
});

test('Home Screen remote cookie is signed, expiring, and revoked by a new launcher password', () => {
  const now = Date.now(), password = 'a-test-only-long-password';
  const cookie = remoteAccessCookie('nexthome', password, now).split(';')[0];
  assert.equal(validRemoteCookie(cookie, 'nexthome', password, now), true);
  assert.equal(validRemoteCookie(cookie, 'nexthome', 'changed-password', now), false);
  assert.equal(validRemoteCookie(cookie, 'another-user', password, now), false);
  assert.equal(validRemoteCookie(cookie + 'x', 'nexthome', password, now), false);
  assert.equal(validRemoteCookie(cookie, 'nexthome', password, now + 8 * 86400000), false);
  assert.equal(validRemoteCookie('', 'nexthome', password, now), false);
  assert.match(remoteAccessCookie('nexthome',password,now), /Secure; HttpOnly; SameSite=Lax/);
});
