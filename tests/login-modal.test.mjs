import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM, VirtualConsole } from 'jsdom';
import test from 'node:test';

const htmlPath = new URL('../index.html', import.meta.url);

async function createPage({ sessionFails = false, withoutListingTemplate = false } = {}) {
  let html = await readFile(htmlPath, 'utf8');
  if (withoutListingTemplate) {
    html = html.replace(/<article class="listing-card"[\s\S]*?<\/article>/g, '');
  }
  const scriptErrors = [];
  const consoleErrors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', error => scriptErrors.push(error));
  virtualConsole.on('error', error => consoleErrors.push(error));

  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    url: 'https://nexthome.test/',
    virtualConsole,
    beforeParse(window) {
      window.HTMLElement.prototype.scrollIntoView = () => {};
      window.fetch = async input => {
        const path = typeof input === 'string' ? input : input.url;
        if (path === '/api/auth/session' && sessionFails) {
          return { ok: false, status: 503, json: async () => ({ error: 'temporary failure' }) };
        }
        if (path === '/api/auth/session') {
          return { ok: true, status: 200, json: async () => ({ user: null }) };
        }
        if (path === '/api/listings') {
          return { ok: true, status: 200, json: async () => ({ table: [] }) };
        }
        throw new Error(`Unexpected request: ${path}`);
      };
    },
  });
  await new Promise(resolve => dom.window.setTimeout(resolve, 0));
  return { dom, document: dom.window.document, scriptErrors, consoleErrors };
}

test('page script initializes and login button opens the modal', async () => {
  const page = await createPage();
  assert.deepEqual(page.scriptErrors, []);
  const modal = page.document.getElementById('authModal');
  assert.equal(modal.hidden, true);
  page.document.getElementById('authButton').click();
  assert.equal(modal.hidden, false);
  page.dom.window.close();
});

test('login button remains usable when the session endpoint fails', async () => {
  const page = await createPage({ sessionFails: true });
  assert.deepEqual(page.scriptErrors, []);
  assert.deepEqual(page.consoleErrors, []);
  const modal = page.document.getElementById('authModal');
  assert.equal(page.document.getElementById('authButton').disabled, false);
  page.document.getElementById('authButton').click();
  assert.equal(modal.hidden, false);
  page.dom.window.close();
});

test('login modal initialization is isolated from listing template initialization', async () => {
  const page = await createPage({ sessionFails: true, withoutListingTemplate: true });
  const modal = page.document.getElementById('authModal');
  page.document.getElementById('authButton').click();
  assert.equal(modal.hidden, false);
  page.dom.window.close();
});

test('cancel, backdrop, and Escape close the login modal', async () => {
  const page = await createPage();
  const modal = page.document.getElementById('authModal');
  const open = () => page.document.getElementById('authButton').click();

  open();
  page.document.getElementById('closeAuthModal').click();
  assert.equal(modal.hidden, true);

  open();
  modal.dispatchEvent(new page.dom.window.MouseEvent('click', { bubbles: true }));
  assert.equal(modal.hidden, true);

  open();
  page.document.dispatchEvent(new page.dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(modal.hidden, true);
  page.dom.window.close();
});
