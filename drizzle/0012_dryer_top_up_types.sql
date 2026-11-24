CREATE TABLE `dryer_top_ups` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`machine_id` integer NOT NULL,
	`name` text NOT NULL,
	`minutes` integer NOT NULL,
	`pulses` integer NOT NULL,
	`price` integer NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`machine_id`) REFERENCES `machines`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `dryer_top_ups_machine` ON `dryer_top_ups` (`machine_id`);--> statement-breakpoint
INSERT INTO `dryer_top_ups` (`machine_id`, `name`, `minutes`, `pulses`, `price`, `enabled`, `sort_order`) SELECT `id`, '5 min', 5, `top_up_pulse_count`, `top_up_price`, `top_up_price` > 0, 0 FROM `machines` WHERE `type` = 'DRYER';--> statement-breakpoint
INSERT INTO `dryer_top_ups` (`machine_id`, `name`, `minutes`, `pulses`, `price`, `enabled`, `sort_order`) SELECT `id`, '10 min', 10, `top_up_pulses_10`, `top_up_price_10`, `top_up_price_10` > 0, 1 FROM `machines` WHERE `type` = 'DRYER';--> statement-breakpoint
INSERT INTO `dryer_top_ups` (`machine_id`, `name`, `minutes`, `pulses`, `price`, `enabled`, `sort_order`) SELECT `id`, '15 min', 15, `top_up_pulses_15`, `top_up_price_15`, `top_up_price_15` > 0, 2 FROM `machines` WHERE `type` = 'DRYER';--> statement-breakpoint
INSERT INTO `dryer_top_ups` (`machine_id`, `name`, `minutes`, `pulses`, `price`, `enabled`, `sort_order`) SELECT `id`, '20 min', 20, `top_up_pulses_20`, `top_up_price_20`, `top_up_price_20` > 0, 3 FROM `machines` WHERE `type` = 'DRYER';--> statement-breakpoint
INSERT OR REPLACE INTO `settings` (`key`, `value`) SELECT 'shopTopUps', json_array(json_object('minutes', 5, 'price', json_extract(`value`, '$.topUpPrice')), json_object('minutes', 10, 'price', json_extract(`value`, '$.topUpPrice10')), json_object('minutes', 15, 'price', json_extract(`value`, '$.topUpPrice15')), json_object('minutes', 20, 'price', json_extract(`value`, '$.topUpPrice20'))) FROM `settings` WHERE `key` = 'orderTopUpPrices';
