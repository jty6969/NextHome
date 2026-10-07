CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`password_hash` text NOT NULL,
	`role` text NOT NULL CHECK (`role` IN ('admin', 'user')),
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_username_unique` ON `accounts` (`username`);--> statement-breakpoint
CREATE TABLE `login_rate_limits` (
	`key` text PRIMARY KEY NOT NULL,
	`attempts` integer NOT NULL,
	`window_started_at` text NOT NULL,
	`blocked_until` text
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_sessions_account_id` ON `sessions` (`account_id`);--> statement-breakpoint
CREATE INDEX `idx_sessions_expires_at` ON `sessions` (`expires_at`);--> statement-breakpoint
ALTER TABLE `listings` ADD `unit_price_calculated` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `listings` ADD `elevator` text;--> statement-breakpoint
ALTER TABLE `listings` ADD `creator_account_id` text REFERENCES `accounts`(`id`);--> statement-breakpoint
ALTER TABLE `listings` ADD `creator_role` text CHECK (`creator_role` IS NULL OR `creator_role` IN ('admin', 'user'));
