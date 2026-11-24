CREATE TABLE `machine_cycles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`machine_id` integer NOT NULL,
	`name` text NOT NULL,
	`pulses` integer NOT NULL,
	`minutes` integer NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`machine_id`) REFERENCES `machines`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `machine_cycles_machine` ON `machine_cycles` (`machine_id`);--> statement-breakpoint
ALTER TABLE `machines` ADD `assigned_cycle_id` integer;--> statement-breakpoint
INSERT INTO `machine_cycles` (`machine_id`, `name`, `pulses`, `minutes`, `enabled`, `sort_order`) SELECT `id`, 'Delicates', `cycle_delicates_pulses`, `cycle_delicates_minutes`, 1, 0 FROM `machines` WHERE `type` = 'WASHER';--> statement-breakpoint
INSERT INTO `machine_cycles` (`machine_id`, `name`, `pulses`, `minutes`, `enabled`, `sort_order`) SELECT `id`, 'Light', `cycle_light_pulses`, `cycle_light_minutes`, 1, 1 FROM `machines` WHERE `type` = 'WASHER';--> statement-breakpoint
INSERT INTO `machine_cycles` (`machine_id`, `name`, `pulses`, `minutes`, `enabled`, `sort_order`) SELECT `id`, 'Medium', `cycle_medium_pulses`, `cycle_medium_minutes`, 1, 2 FROM `machines` WHERE `type` = 'WASHER';--> statement-breakpoint
INSERT INTO `machine_cycles` (`machine_id`, `name`, `pulses`, `minutes`, `enabled`, `sort_order`) SELECT `id`, 'Heavy', `cycle_heavy_pulses`, `cycle_heavy_minutes`, 1, 3 FROM `machines` WHERE `type` = 'WASHER';--> statement-breakpoint
UPDATE `machines` SET `assigned_cycle_id` = (SELECT `machine_cycles`.`id` FROM `machine_cycles` WHERE `machine_cycles`.`machine_id` = `machines`.`id` AND upper(`machine_cycles`.`name`) = `machines`.`assigned_cycle`) WHERE `assigned_cycle` IS NOT NULL;--> statement-breakpoint
UPDATE `machine_unlocks` SET `cycle` = CASE `cycle` WHEN 'DELICATES' THEN 'Delicates' WHEN 'LIGHT' THEN 'Light' WHEN 'MEDIUM' THEN 'Medium' WHEN 'HEAVY' THEN 'Heavy' ELSE `cycle` END WHERE `cycle` IS NOT NULL;
