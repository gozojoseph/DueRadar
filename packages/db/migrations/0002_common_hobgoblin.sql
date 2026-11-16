ALTER TABLE "webhook_events" ADD COLUMN "attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "webhook_events" ADD COLUMN "error" text;--> statement-breakpoint
ALTER TABLE "webhook_events" ADD COLUMN "metadata" jsonb;--> statement-breakpoint
ALTER TABLE "webhook_events" ADD COLUMN "processed_at" timestamp with time zone;