CREATE TABLE `seller_listing_drafts` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`property_id` text NOT NULL,
	`fields` text NOT NULL,
	`source_revision` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_private_listing_property` ON `seller_listing_drafts` (`account_id`,`property_id`);--> statement-breakpoint
ALTER TABLE `seller_properties` ADD `workflow` text DEFAULT '{}' NOT NULL;