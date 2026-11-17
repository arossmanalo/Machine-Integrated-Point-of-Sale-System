CREATE TABLE `customers` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`phone` text DEFAULT '' NOT NULL,
	`address` text DEFAULT '' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`loyalty_loads` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`archived_at` integer
);
--> statement-breakpoint
CREATE TABLE `expenses` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`category` text NOT NULL,
	`cost` integer NOT NULL,
	`incurred_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `inventory_items` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`current_stock` integer NOT NULL,
	`low_stock_threshold` integer DEFAULT 5 NOT NULL,
	`unit` text NOT NULL,
	`auto_consume` integer DEFAULT false NOT NULL,
	`add_on_price` integer DEFAULT 0 NOT NULL,
	`archived_at` integer
);
--> statement-breakpoint
CREATE TABLE `machine_unlocks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`at` integer NOT NULL,
	`machine_id` integer,
	`machine_name` text NOT NULL,
	`machine_type` text NOT NULL,
	`hardware_channel` integer NOT NULL,
	`order_id` text,
	`employee_user_id` text,
	`employee_name` text NOT NULL,
	`kind` text NOT NULL,
	`override_reason` text,
	`override_note` text,
	`result` text NOT NULL,
	`resolved_at` integer
);
--> statement-breakpoint
CREATE INDEX `unlocks_order` ON `machine_unlocks` (`order_id`);--> statement-breakpoint
CREATE INDEX `unlocks_at` ON `machine_unlocks` (`at`);--> statement-breakpoint
CREATE TABLE `machines` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`hardware_channel` integer NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `order_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`order_id` text NOT NULL,
	`inventory_item_id` text,
	`name` text NOT NULL,
	`quantity` integer NOT NULL,
	`unit_price` integer NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `orders` (
	`id` text PRIMARY KEY NOT NULL,
	`customer_id` text NOT NULL,
	`service` text NOT NULL,
	`placed_at` integer NOT NULL,
	`weight_kg` real NOT NULL,
	`load_count` integer NOT NULL,
	`promo_applied` integer DEFAULT false NOT NULL,
	`price_per_load` integer NOT NULL,
	`total` integer NOT NULL,
	`status` text NOT NULL,
	`initial_payment_method` text NOT NULL,
	`created_by_user_id` text,
	`created_by_name` text NOT NULL,
	`voided_at` integer,
	`voided_by_name` text,
	`void_reason` text,
	`legacy_note` text,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `orders_placed_at` ON `orders` (`placed_at`);--> statement-breakpoint
CREATE INDEX `orders_customer` ON `orders` (`customer_id`);--> statement-breakpoint
CREATE TABLE `payments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`order_id` text NOT NULL,
	`amount` integer NOT NULL,
	`channel` text NOT NULL,
	`gcash_reference` text,
	`cash_received` integer,
	`received_at` integer NOT NULL,
	`received_by_name` text NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `payments_order` ON `payments` (`order_id`);--> statement-breakpoint
CREATE INDEX `payments_received_at` ON `payments` (`received_at`);--> statement-breakpoint
CREATE TABLE `sequences` (
	`name` text PRIMARY KEY NOT NULL,
	`next` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`password_hash` text,
	`role` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_unique` ON `users` (lower("username"));