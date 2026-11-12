CREATE TABLE `findings` (
	`id` text PRIMARY KEY NOT NULL,
	`scan_id` text NOT NULL,
	`fingerprint` text NOT NULL,
	`dimension` text NOT NULL,
	`severity` text NOT NULL,
	`severity_rank` integer NOT NULL,
	`rule_id` text NOT NULL,
	`file` text NOT NULL,
	`start_line` integer,
	`message` text NOT NULL,
	`data` text NOT NULL,
	FOREIGN KEY (`scan_id`) REFERENCES `scans`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `findings_scan_order_idx` ON `findings` (`scan_id`,`severity_rank`,`file`,`start_line`);--> statement-breakpoint
CREATE INDEX `findings_scan_fingerprint_idx` ON `findings` (`scan_id`,`fingerprint`);--> statement-breakpoint
CREATE INDEX `findings_scan_dimension_idx` ON `findings` (`scan_id`,`dimension`);--> statement-breakpoint
CREATE TABLE `scans` (
	`id` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`root` text NOT NULL,
	`started_at` text NOT NULL,
	`finished_at` text,
	`score` real,
	`grade` text,
	`gate_passed` integer,
	`error` text,
	`data` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `scans_started_at_idx` ON `scans` (`started_at`);