CREATE TABLE `listings` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_name` text NOT NULL,
	`contact_phone` text NOT NULL,
	`address` text NOT NULL,
	`community` text,
	`building` text,
	`unit` text,
	`area_sqm` real,
	`bedrooms` integer,
	`living_rooms` integer,
	`bathrooms` integer,
	`floor_level` integer,
	`floor_total` integer,
	`orientation` text,
	`decoration` text,
	`total_price_wan` real,
	`unit_price_wan_per_sqm` real,
	`listed_date` text,
	`created_at` text NOT NULL,
	`submission_source` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_listings_created_at` ON `listings` (`created_at`);
--> statement-breakpoint
PRAGMA optimize;
