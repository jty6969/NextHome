import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('page script parses and element ids remain unique', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match => match[1]);
  assert.equal(scripts.length, 1);
  assert.doesNotThrow(() => new Function(scripts[0]));

  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(new Set(ids).size, ids.length);
  for (const requiredId of ['authButton', 'authModal', 'listingModal', 'openAdminModal', 'adminModal', 'listingGrid']) {
    assert.ok(ids.includes(requiredId), `missing #${requiredId}`);
  }
  assert.doesNotMatch(html, /openCollectModal|收录房源/);
});
