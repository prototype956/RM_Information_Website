CREATE TABLE `attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`resource_id` text,
	`storage_key` text,
	`name` text,
	`mime` text,
	`size` integer,
	FOREIGN KEY (`resource_id`) REFERENCES `resources`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `cloud_auth_limits` (
	`key` text NOT NULL,
	`window` integer NOT NULL,
	`count` integer NOT NULL,
	PRIMARY KEY(`key`, `window`)
);
--> statement-breakpoint
CREATE TABLE `cloud_revision` (
	`id` integer PRIMARY KEY NOT NULL,
	`revision` integer NOT NULL,
	CONSTRAINT "cloud_singleton" CHECK(id=1)
);
--> statement-breakpoint
CREATE TABLE `favorites` (
	`user_id` text,
	`resource_id` text,
	PRIMARY KEY(`user_id`, `resource_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`resource_id`) REFERENCES `resources`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `invitations` (
	`id` text PRIMARY KEY NOT NULL,
	`token_hash` text,
	`created_by` text,
	`expires` integer,
	`used` integer DEFAULT 0
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_invitations_token_hash` ON `invitations` (`token_hash`);--> statement-breakpoint
CREATE TABLE `recent` (
	`user_id` text,
	`resource_id` text,
	`viewed_at` integer,
	PRIMARY KEY(`user_id`, `resource_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`resource_id`) REFERENCES `resources`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `resources` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text,
	`domain` text,
	`category` text,
	`tags` text,
	`kind` text,
	`url` text,
	`description` text,
	`owner_id` text,
	`created_at` integer,
	`updated_at` integer,
	`sample` integer DEFAULT 0,
	`hidden` integer DEFAULT 0,
	`category_id` text,
	`tag_ids` text DEFAULT '[]' NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `roadmap_progress` (
	`user_id` text NOT NULL,
	`roadmap_id` text NOT NULL,
	`states` text DEFAULT '{}' NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `roadmap_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`roadmap_id`) REFERENCES `roadmaps`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `roadmaps` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`draft` text NOT NULL,
	`published` text,
	`version` integer DEFAULT 1 NOT NULL,
	`hidden` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`published_at` integer,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `roadmap_owner` ON `roadmaps` (`owner_id`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`token` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`expires` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `taxonomy_aliases` (
	`kind` text,
	`parent_id` text,
	`name` text,
	`target_id` text,
	PRIMARY KEY(`kind`, `parent_id`, `name`)
);
--> statement-breakpoint
CREATE TABLE `taxonomy_meta` (
	`id` integer PRIMARY KEY NOT NULL,
	`revision` integer NOT NULL,
	CONSTRAINT "taxonomy_singleton" CHECK(id=1)
);
--> statement-breakpoint
CREATE TABLE `taxonomy_options` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`parent_id` text DEFAULT '' NOT NULL,
	`name` text NOT NULL,
	`normalized` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_taxonomy_options_kind_parent_id_normalized` ON `taxonomy_options` (`kind`,`parent_id`,`normalized`);--> statement-breakpoint
CREATE TABLE `taxonomy_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`parent_id` text DEFAULT '' NOT NULL,
	`parent_name` text DEFAULT '' NOT NULL,
	`name` text NOT NULL,
	`normalized` text NOT NULL,
	`reason` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`review_note` text DEFAULT '' NOT NULL,
	`reviewer_id` text,
	`option_id` text,
	`created_at` integer NOT NULL,
	`reviewed_at` integer,
	`version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reviewer_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `taxonomy_request_queue` ON `taxonomy_requests` (`status`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `taxonomy_request_pending` ON `taxonomy_requests` (`user_id`,`kind`,`parent_id`,`normalized`) WHERE status='pending';--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`password` text NOT NULL,
	`role` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_users_email` ON `users` (`email`);