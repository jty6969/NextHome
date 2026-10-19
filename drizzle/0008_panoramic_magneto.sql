CREATE TABLE `seller_message_receipts` (
	`account_id` text NOT NULL,
	`property_id` text NOT NULL,
	`request_id` text NOT NULL,
	`input_hash` text NOT NULL,
	`content` text NOT NULL,
	`saved` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_seller_message_request` ON `seller_message_receipts` (`account_id`,`property_id`,`request_id`);