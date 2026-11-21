ALTER TABLE `machine_unlocks` ADD `charge` integer;--> statement-breakpoint
ALTER TABLE `machines` ADD `run_minutes` integer DEFAULT 40 NOT NULL;--> statement-breakpoint
ALTER TABLE `machines` ADD `top_up_pulse_count` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `machines` ADD `top_up_price` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `machines` ADD `run_order_id` text REFERENCES orders(id);--> statement-breakpoint
ALTER TABLE `machines` ADD `run_ends_at` integer;