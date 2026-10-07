import { pbkdf2Async } from '@noble/hashes/pbkdf2.js';
import { sha256 } from '@noble/hashes/sha2.js';

const encoder = new TextEncoder();

export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const bytes = encoder.encode(password);
  const derived = await pbkdf2Async(sha256, bytes, salt, { c: 210000, dkLen: 32 });
  const encode = value => btoa(String.fromCharCode(...value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  try { return `pbkdf2_sha256$210000$${encode(salt)}$${encode(derived)}`; }
  finally { bytes.fill(0); derived.fill(0); }
}

function decodeBase64Url(value) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Invalid password hash encoding');
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4);
  return Uint8Array.from(atob(padded), character => character.charCodeAt(0));
}

export async function verifyPassword(password, storedHash) {
  const parts = storedHash.split('$');
  const [algorithm, iterationText, saltText, expectedText] = parts;
  const iterations = Number(iterationText);
  if (parts.length !== 4 || algorithm !== 'pbkdf2_sha256' || !Number.isInteger(iterations)
      || iterations < 100000 || iterations > 1000000) {
    throw new Error('Invalid password hash parameters');
  }
  const salt = decodeBase64Url(saltText);
  const expected = decodeBase64Url(expectedText);
  if (salt.length < 16 || expected.length !== 32) throw new Error('Invalid password hash length');
  const passwordBytes = encoder.encode(password);
  let actual;
  try {
    const key = await crypto.subtle.importKey('raw', passwordBytes, 'PBKDF2', false, ['deriveBits']);
    try {
      actual = new Uint8Array(await crypto.subtle.deriveBits(
        { name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256,
      ));
    } catch (error) {
      // Hosted Workers can cap native PBKDF2 at 100,000 iterations. Compute
      // the SAME derivation with an audited implementation, without reducing
      // the work factor, changing the stored hash, or chaining separate KDFs.
      if (error?.name !== 'NotSupportedError'
          && !/iteration counts above .*not supported/i.test(error?.message || '')) throw error;
      actual = await pbkdf2Async(sha256, passwordBytes, salt, { c: iterations, dkLen: 32 });
    }
    if (actual.length !== expected.length) throw new Error('Invalid password derivation length');
    let difference = 0;
    for (let index = 0; index < actual.length; index += 1) difference |= actual[index] ^ expected[index];
    return difference === 0;
  } finally {
    passwordBytes.fill(0);
    actual?.fill(0);
  }
}
