ALTER TABLE `inventory_items` ADD `is_add_on` integer DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE `inventory_items` SET `is_add_on` = 1 WHERE `add_on_price` > 0;
