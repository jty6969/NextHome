CREATE TABLE `assistant_drafts` (
	`account_id` text NOT NULL,
	`mode` text NOT NULL,
	`content` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_assistant_draft` ON `assistant_drafts` (`account_id`,`mode`);--> statement-breakpoint
CREATE TABLE `seller_chats` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`account_id` text NOT NULL,
	`property_id` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_seller_chats_property` ON `seller_chats` (`account_id`,`property_id`,`id`);--> statement-breakpoint
CREATE TABLE `seller_properties` (
	`account_id` text NOT NULL,
	`property_id` text NOT NULL,
	`fields` text DEFAULT '{}' NOT NULL,
	`pending` text DEFAULT '{}' NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_seller_property` ON `seller_properties` (`account_id`,`property_id`);