ALTER TABLE `buyer_viewings` ADD `listing_id` text;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_viewing_active_slot` ON `buyer_viewings` (`listing_id`,`date`,`slot`) WHERE status IN ('pending', 'confirmed');--> statement-breakpoint
CREATE UNIQUE INDEX `idx_offer_pending` ON `buyer_offers` (`thread_id`) WHERE status = 'pending';