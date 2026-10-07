CREATE TABLE `advisor_accounts` (
	`account_id` text PRIMARY KEY NOT NULL,
	`display_name` text,
	`seller` integer DEFAULT 0 NOT NULL,
	`profile` text DEFAULT '{}' NOT NULL,
	`requirements` text DEFAULT '{}' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `advisor_chats` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`account_id` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_advisor_chats_account` ON `advisor_chats` (`account_id`,`id`);--> statement-breakpoint
CREATE TABLE `buyer_deal_steps` (
	`key` text PRIMARY KEY NOT NULL,
	`deal_id` text NOT NULL,
	`step` integer NOT NULL,
	`buyer_confirmed` integer DEFAULT 0 NOT NULL,
	`seller_confirmed` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_steps_deal` ON `buyer_deal_steps` (`deal_id`);--> statement-breakpoint
CREATE TABLE `buyer_deals` (
	`id` text PRIMARY KEY NOT NULL,
	`thread_id` text NOT NULL,
	`listing_id` text NOT NULL,
	`price` real NOT NULL,
	`current_step` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_deal_listing` ON `buyer_deals` (`listing_id`);--> statement-breakpoint
CREATE TABLE `buyer_events` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`listing_id` text,
	`kind` text NOT NULL,
	`content` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_buyer_events_account_time` ON `buyer_events` (`account_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `buyer_favorites` (
	`key` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`listing_id` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_buyer_favorites_account` ON `buyer_favorites` (`account_id`);--> statement-breakpoint
CREATE TABLE `buyer_messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`thread_id` text NOT NULL,
	`sender_id` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`read_at` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_message_thread` ON `buyer_messages` (`thread_id`,`id`);--> statement-breakpoint
CREATE TABLE `buyer_offers` (
	`id` text PRIMARY KEY NOT NULL,
	`thread_id` text NOT NULL,
	`price` real NOT NULL,
	`reason` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`counter_price` real,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_offer_thread` ON `buyer_offers` (`thread_id`);--> statement-breakpoint
CREATE TABLE `buyer_threads` (
	`id` text PRIMARY KEY NOT NULL,
	`listing_id` text NOT NULL,
	`buyer_id` text NOT NULL,
	`seller_id` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_thread_listing_buyer` ON `buyer_threads` (`listing_id`,`buyer_id`);--> statement-breakpoint
CREATE INDEX `idx_thread_seller` ON `buyer_threads` (`seller_id`);--> statement-breakpoint
CREATE TABLE `buyer_viewings` (
	`id` text PRIMARY KEY NOT NULL,
	`thread_id` text NOT NULL,
	`date` text NOT NULL,
	`slot` text NOT NULL,
	`note` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`seller_note` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_viewing_thread` ON `buyer_viewings` (`thread_id`);--> statement-breakpoint
CREATE TABLE `legacy_archives` (
	`account_id` text PRIMARY KEY NOT NULL,
	`payload` text NOT NULL,
	`imported_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `listing_sellers` (
	`listing_id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_listing_sellers_account` ON `listing_sellers` (`account_id`);--> statement-breakpoint
CREATE TABLE `viewing_slots` (
	`key` text PRIMARY KEY NOT NULL,
	`listing_id` text NOT NULL,
	`date` text NOT NULL,
	`slot` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_slots_listing` ON `viewing_slots` (`listing_id`);