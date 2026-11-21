ALTER TABLE `orders` ADD `qr_token` text DEFAULT '' NOT NULL;--> statement-breakpoint
UPDATE `orders` SET `qr_token` = lower(hex(randomblob(16))) WHERE `qr_token` = '';--> statement-breakpoint
CREATE UNIQUE INDEX `orders_qr_token` ON `orders` (`qr_token`);