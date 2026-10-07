import { index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const accounts = sqliteTable(
  'accounts',
  {
    id: text('id').primaryKey(),
    username: text('username').notNull(),
    passwordHash: text('password_hash').notNull(),
    role: text('role').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [uniqueIndex('accounts_username_unique').on(table.username)],
);

export const sessions = sqliteTable(
  'sessions',
  {
    tokenHash: text('token_hash').primaryKey(),
    accountId: text('account_id').notNull(),
    createdAt: text('created_at').notNull(),
    expiresAt: text('expires_at').notNull(),
  },
  (table) => [index('idx_sessions_account_id').on(table.accountId), index('idx_sessions_expires_at').on(table.expiresAt)],
);

export const loginRateLimits = sqliteTable('login_rate_limits', {
  key: text('key').primaryKey(),
  attempts: integer('attempts').notNull(),
  windowStartedAt: text('window_started_at').notNull(),
  blockedUntil: text('blocked_until'),
});

// Append-only creation feed; existing listings are never backfilled.
export const listingSyncEvents = sqliteTable('listing_sync_events', {
  sequence: integer('sequence').primaryKey({ autoIncrement: true }),
  listingId: text('listing_id').notNull(),
  creatorAccountId: text('creator_account_id').notNull(),
  payload: text('payload').notNull(),
}, table => [uniqueIndex('idx_sync_listing_id').on(table.listingId)]);

export const listings = sqliteTable(
  'listings',
  {
    id: text('id').primaryKey(),
    ownerName: text('owner_name').notNull(),
    contactPhone: text('contact_phone').notNull(),
    address: text('address').notNull(),
    community: text('community'),
    building: text('building'),
    unit: text('unit'),
    areaSqm: real('area_sqm'),
    bedrooms: integer('bedrooms'),
    livingRooms: integer('living_rooms'),
    bathrooms: integer('bathrooms'),
    floorLevel: integer('floor_level'),
    floorTotal: integer('floor_total'),
    orientation: text('orientation'),
    decoration: text('decoration'),
    totalPriceWan: real('total_price_wan'),
    unitPriceWanPerSqm: real('unit_price_wan_per_sqm'),
    unitPriceCalculated: integer('unit_price_calculated', { mode: 'boolean' }).notNull().default(false),
    elevator: text('elevator'),
    listedDate: text('listed_date'),
    createdAt: text('created_at').notNull(),
    submissionSource: text('submission_source').notNull(),
    creatorAccountId: text('creator_account_id'),
    creatorRole: text('creator_role'),
    updatedAt: text('updated_at'),
    updaterAccountId: text('updater_account_id'),
    extraData: text('extra_data'),
    sourceOrder: integer('source_order'),
  },
  (table) => [index('idx_listings_created_at').on(table.createdAt)],
);

// Seller capability is additive: existing account roles and sessions stay valid.
export const advisorAccounts = sqliteTable('advisor_accounts', {
  accountId: text('account_id').primaryKey(), displayName: text('display_name'),
  seller: integer('seller').notNull().default(0),
  profile: text('profile').notNull().default('{}'), requirements: text('requirements').notNull().default('{}'),
});
export const listingSellers = sqliteTable('listing_sellers', {
  listingId: text('listing_id').primaryKey(), accountId: text('account_id').notNull(),
}, t => [index('idx_listing_sellers_account').on(t.accountId)]);
export const buyerFavorites = sqliteTable('buyer_favorites', {
  key: text('key').primaryKey(), accountId: text('account_id').notNull(), listingId: text('listing_id').notNull(),
}, t => [index('idx_buyer_favorites_account').on(t.accountId)]);
export const buyerEvents = sqliteTable('buyer_events', {
  id: text('id').primaryKey(), accountId: text('account_id').notNull(), listingId: text('listing_id'),
  kind: text('kind').notNull(), content: text('content').notNull(), createdAt: text('created_at').notNull(),
}, t => [index('idx_buyer_events_account_time').on(t.accountId, t.createdAt)]);
export const advisorChats = sqliteTable('advisor_chats', {
  id: integer('id').primaryKey({ autoIncrement: true }), accountId: text('account_id').notNull(),
  role: text('role').notNull(), content: text('content').notNull(), createdAt: text('created_at').notNull(),
}, t => [index('idx_advisor_chats_account').on(t.accountId, t.id)]);
export const buyerThreads = sqliteTable('buyer_threads', {
  id: text('id').primaryKey(), listingId: text('listing_id').notNull(),
  buyerId: text('buyer_id').notNull(), sellerId: text('seller_id').notNull(), createdAt: text('created_at').notNull(),
}, t => [uniqueIndex('idx_thread_listing_buyer').on(t.listingId, t.buyerId), index('idx_thread_seller').on(t.sellerId)]);
export const buyerMessages = sqliteTable('buyer_messages', {
  id: integer('id').primaryKey({ autoIncrement: true }), threadId: text('thread_id').notNull(),
  senderId: text('sender_id').notNull(), role: text('role').notNull(), content: text('content').notNull(),
  readAt: text('read_at'), createdAt: text('created_at').notNull(),
}, t => [index('idx_message_thread').on(t.threadId, t.id)]);
export const buyerOffers = sqliteTable('buyer_offers', {
  id: text('id').primaryKey(), threadId: text('thread_id').notNull(), price: real('price').notNull(),
  reason: text('reason').notNull(), status: text('status').notNull().default('pending'), counterPrice: real('counter_price'),
  createdAt: text('created_at').notNull(),
}, t => [index('idx_offer_thread').on(t.threadId), uniqueIndex('idx_offer_pending').on(t.threadId).where(sql`status = 'pending'`)]);
export const viewingSlots = sqliteTable('viewing_slots', {
  key: text('key').primaryKey(), listingId: text('listing_id').notNull(), date: text('date').notNull(), slot: text('slot').notNull(),
}, t => [index('idx_slots_listing').on(t.listingId)]);
export const buyerViewings = sqliteTable('buyer_viewings', {
  id: text('id').primaryKey(), threadId: text('thread_id').notNull(), listingId: text('listing_id'), date: text('date').notNull(), slot: text('slot').notNull(),
  note: text('note').notNull(), status: text('status').notNull().default('pending'), sellerNote: text('seller_note'),
  createdAt: text('created_at').notNull(),
}, t => [index('idx_viewing_thread').on(t.threadId), uniqueIndex('idx_viewing_active_slot').on(t.listingId, t.date, t.slot).where(sql`status IN ('pending', 'confirmed')`)]);
export const buyerDeals = sqliteTable('buyer_deals', {
  id: text('id').primaryKey(), threadId: text('thread_id').notNull(), listingId: text('listing_id').notNull(),
  price: real('price').notNull(), currentStep: integer('current_step').notNull().default(1), createdAt: text('created_at').notNull(),
}, t => [uniqueIndex('idx_deal_listing').on(t.listingId)]);
export const buyerDealSteps = sqliteTable('buyer_deal_steps', {
  key: text('key').primaryKey(), dealId: text('deal_id').notNull(), step: integer('step').notNull(),
  buyerConfirmed: integer('buyer_confirmed').notNull().default(0), sellerConfirmed: integer('seller_confirmed').notNull().default(0),
}, t => [index('idx_steps_deal').on(t.dealId)]);
export const legacyArchives = sqliteTable('legacy_archives', {
  accountId: text('account_id').primaryKey(), payload: text('payload').notNull(), importedAt: text('imported_at').notNull(),
});
