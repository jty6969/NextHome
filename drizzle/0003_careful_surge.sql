CREATE TABLE `listing_sync_events` (
	`sequence` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`listing_id` text NOT NULL,
	`creator_account_id` text NOT NULL,
	`payload` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_sync_listing_id` ON `listing_sync_events` (`listing_id`);