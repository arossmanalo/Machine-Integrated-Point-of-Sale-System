ALTER TABLE `machine_unlocks` ADD `cycle` text;--> statement-breakpoint
ALTER TABLE `machines` ADD `cycle_delicates_pulses` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `machines` ADD `cycle_delicates_minutes` integer DEFAULT 40 NOT NULL;--> statement-breakpoint
ALTER TABLE `machines` ADD `cycle_light_pulses` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `machines` ADD `cycle_light_minutes` integer DEFAULT 40 NOT NULL;--> statement-breakpoint
ALTER TABLE `machines` ADD `cycle_medium_pulses` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `machines` ADD `cycle_medium_minutes` integer DEFAULT 40 NOT NULL;--> statement-breakpoint
ALTER TABLE `machines` ADD `cycle_heavy_pulses` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `machines` ADD `cycle_heavy_minutes` integer DEFAULT 40 NOT NULL;--> statement-breakpoint
ALTER TABLE `machines` ADD `assigned_cycle` text;--> statement-breakpoint
UPDATE `machines` SET `cycle_delicates_pulses` = `pulse_count`, `cycle_light_pulses` = `pulse_count`, `cycle_medium_pulses` = `pulse_count`, `cycle_heavy_pulses` = `pulse_count`, `cycle_delicates_minutes` = `run_minutes`, `cycle_light_minutes` = `run_minutes`, `cycle_medium_minutes` = `run_minutes`, `cycle_heavy_minutes` = `run_minutes`;
