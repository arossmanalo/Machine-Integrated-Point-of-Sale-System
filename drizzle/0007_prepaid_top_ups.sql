ALTER TABLE `orders` ADD `prepaid_top_up_minutes` integer;--> statement-breakpoint
ALTER TABLE `orders` ADD `prepaid_top_up_loads` integer DEFAULT 0 NOT NULL;