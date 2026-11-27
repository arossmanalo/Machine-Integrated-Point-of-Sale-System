ALTER TABLE `machine_unlocks` ADD `charge_item_id` integer;--> statement-breakpoint
ALTER TABLE `machine_unlocks` ADD `start_log_id` integer;--> statement-breakpoint
ALTER TABLE `machines` ADD `signal_seen` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `machines` ADD `signal_wait_until` integer;--> statement-breakpoint
ALTER TABLE `machines` ADD `signal_wait_log_id` integer;