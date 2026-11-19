ALTER TABLE `machines` ADD `pulse_count` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `machines` ADD `pulse_on_ms` integer DEFAULT 500 NOT NULL;--> statement-breakpoint
ALTER TABLE `machines` ADD `pulse_off_ms` integer DEFAULT 500 NOT NULL;--> statement-breakpoint
ALTER TABLE `machines` ADD `assigned_order_id` text REFERENCES orders(id);--> statement-breakpoint
ALTER TABLE `machines` ADD `assigned_at` integer;--> statement-breakpoint
ALTER TABLE `machines` ADD `assigned_by_name` text;