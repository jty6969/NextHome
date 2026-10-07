import { mkdir, open, readFile, rename, link, unlink } from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

export const digest = value => createHash('sha256').update(value).digest('hex');
export const validId = id => typeof id === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(id)
  && !/^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i.test(id);

async function durableTemp(directory, content) {
  const temporary = path.join(directory, `.sync-${randomUUID()}.tmp`);
  const handle = await open(temporary, 'wx', 0o600);
  try { await handle.writeFile(content, 'utf8'); await handle.sync(); }
  catch (error) { await handle.close(); await unlink(temporary).catch(() => {}); throw error; }
  await handle.close();
  return temporary;
}

export async function writeListing(directory, listing) {
  if (!validId(listing?.id)) throw new Error('invalid_listing');
  // Export the cloud snapshot verbatim; undefined is represented as null.
  const content = JSON.stringify(listing, (_, value) => value === undefined ? null : value, 2) + '\n';
  const destination = path.join(directory, `${listing.id}.json`);
  const temporary = await durableTemp(directory, content);
  try {
    // Linking publishes a complete file atomically and never replaces an
    // existing listing. Retries verify identical bytes instead of overwriting.
    try { await link(temporary, destination); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (await readFile(destination, 'utf8') !== content) throw new Error('file_conflict');
    }
  } finally { await unlink(temporary).catch(() => {}); }
  return digest(content);
}

export class ListingSync {
  constructor({ directory, origin, userId, api, writer = writeListing }) {
    Object.assign(this, { directory, origin, userId, api, writer });
    this.statePath = path.join(directory, `.state-${digest(`${origin}\0${userId}`)}.json`);
    this.status = 'pending'; this.lastSuccess = 0; this.running = null;
  }
  async initialize() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    try { this.state = JSON.parse(await readFile(this.statePath, 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw new Error('invalid_state'); }
    if (this.state) {
      if (this.state.origin !== this.origin || this.state.userId !== this.userId
        || !Number.isSafeInteger(this.state.cursor) || this.state.cursor < 0 || !this.state.saved
        || !Number.isSafeInteger(this.state.startCursor)) throw new Error('invalid_state');
      return;
    }
    const baseline = await this.api('/api/sync/listings');
    this.validatePage(baseline);
    this.state = { origin: this.origin, userId: this.userId, startCursor: baseline.cursor, cursor: baseline.cursor, saved: {} };
    await this.persist(this.state);
  }
  async initializeFromBoundary(cursor) {
    if (!Number.isSafeInteger(cursor) || cursor < 0) throw new Error('invalid_feed');
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    try { this.state = JSON.parse(await readFile(this.statePath, 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw new Error('invalid_state'); }
    if (this.state) {
      if (this.state.origin !== this.origin || this.state.userId !== this.userId
        || !Number.isSafeInteger(this.state.cursor) || this.state.cursor < 0 || !this.state.saved
        || !Number.isSafeInteger(this.state.startCursor)) throw new Error('invalid_state');
    } else {
      this.state = { origin: this.origin, userId: this.userId, startCursor: cursor, cursor, saved: {} };
      await this.persist(this.state);
    }
  }
  validatePage(page) {
    if (page?.userId !== this.userId || !Number.isSafeInteger(page.cursor) || page.cursor < 0 || !Array.isArray(page.listings)) throw new Error('invalid_feed');
  }
  validateHistoryPage(page) {
    if (page?.userId !== this.userId || typeof page.cursor !== 'string' || typeof page.done !== 'boolean'
      || !Array.isArray(page.listings) || (page.cursor && !validId(page.cursor))) throw new Error('invalid_history_feed');
  }
  async persist(state) {
    const temporary = await durableTemp(this.directory, JSON.stringify(state) + '\n');
    try { await rename(temporary, this.statePath); }
    finally { await unlink(temporary).catch(() => {}); }
  }
  poll() {
    if (this.running) return this.running;
    this.running = this.performPoll().finally(() => { this.running = null; });
    return this.running;
  }
  async exportHistory() {
    if (!this.state) await this.initialize();
    let cursor = '';
    let count = 0;
    for (let pageNumber = 0; pageNumber < 10000; pageNumber++) {
      const page = await this.api(`/api/sync/listings?history=1&before=${this.state.startCursor}&after=${encodeURIComponent(cursor)}`);
      this.validateHistoryPage(page);
      if (!page.done && page.cursor === cursor) throw new Error('stalled_history_feed');
      const saved = { ...this.state.saved };
      for (const listing of page.listings) {
        saved[listing.id] = await this.writer(this.directory, listing);
        count += 1;
      }
      this.state = { ...this.state, saved };
      await this.persist(this.state);
      cursor = page.cursor;
      if (page.done) {
        this.lastSuccess = Date.now(); this.status = 'ready';
        return count;
      }
    }
    throw new Error('history_feed_too_large');
  }
  async acceptHistoryPage(page) {
    this.validateHistoryPage(page);
    const previous = this.state.historyCursor || '';
    if (previous && page.cursor < previous) throw new Error('invalid_history_feed');
    const saved = { ...this.state.saved };
    let historyCount = this.state.historyCount || 0;
    for (const listing of page.listings) {
      if (!saved[listing.id]) historyCount += 1;
      saved[listing.id] = await this.writer(this.directory, listing);
    }
    this.state = { ...this.state, saved, historyCount, historyCursor: page.cursor, historyComplete: page.done };
    await this.persist(this.state);
    this.lastSuccess = Date.now(); this.status = 'ready';
  }
  async acceptLivePage(page) {
    this.validatePage(page);
    if (page.cursor < this.state.cursor) throw new Error('invalid_feed');
    const saved = { ...this.state.saved };
    for (const listing of page.listings) saved[listing.id] = await this.writer(this.directory, listing);
    this.state = { ...this.state, saved, cursor: page.cursor };
    await this.persist(this.state);
    this.lastSuccess = Date.now(); this.status = 'ready';
  }
  async performPoll() {
    try {
      if (!this.state) await this.initialize();
      // Drain bounded pages so bursts and offline backlogs cannot be truncated.
      for (let pageNumber = 0; pageNumber < 20; pageNumber++) {
        const page = await this.api(`/api/sync/listings?after=${this.state.cursor}`);
        this.validatePage(page);
        if (page.cursor < this.state.cursor) throw new Error('invalid_feed');
        const saved = { ...this.state.saved };
        for (const listing of page.listings) saved[listing.id] = await this.writer(this.directory, listing);
        const next = { ...this.state, cursor: page.cursor, saved };
        await this.persist(next);
        const previousCursor = this.state.cursor;
        this.state = next;
        this.lastSuccess = Date.now(); this.status = 'ready';
        if (page.cursor === previousCursor) break;
      }
    } catch (error) {
      this.status = error.code === 'auth_required' ? 'auth_required' : 'failed';
      // Raw exceptions can contain URLs, tokens or listing values. Do not log.
    }
    return this.status;
  }
  async listingStatus(id) {
    if (!validId(id)) return 'failed';
    if (this.status === 'auth_required') return 'auth_required';
    const hash = this.state?.saved[id];
    if (hash) {
      try {
        if (digest(await readFile(path.join(this.directory, `${id}.json`))) !== hash) return 'failed';
        // A successful file does not imply a stopped/stale program is healthy.
        return this.lastSuccess && Date.now() - this.lastSuccess < 30000 ? 'synced' : 'failed';
      } catch { return 'failed'; }
    }
    if (this.state && this.status === 'ready' && this.api) {
      try {
        const metadata = await this.api(`/api/sync/listings?lookup=${encodeURIComponent(id)}`);
        if (metadata.userId !== this.userId) return 'auth_required';
        if (metadata.sequence <= this.state.startCursor) return 'before_start';
      } catch (error) { return error.code === 'auth_required' ? 'auth_required' : 'failed'; }
    }
    return this.status === 'failed' ? 'failed' : 'pending';
  }
}
