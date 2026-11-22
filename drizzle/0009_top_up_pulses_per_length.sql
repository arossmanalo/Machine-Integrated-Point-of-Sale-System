ALTER TABLE `machines` ADD `top_up_pulses_10` integer DEFAULT 2 NOT NULL;--> statement-breakpoint
ALTER TABLE `machines` ADD `top_up_pulses_15` integer DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE `machines` ADD `top_up_pulses_20` integer DEFAULT 4 NOT NULL;--> statement-breakpoint
UPDATE `machines` SET `top_up_pulses_10` = `top_up_pulse_count` * 2, `top_up_pulses_15` = `top_up_pulse_count` * 3, `top_up_pulses_20` = `top_up_pulse_count` * 4;
