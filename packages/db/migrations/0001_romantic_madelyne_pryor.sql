DROP INDEX "detection_suggestions_dedupe_uq";--> statement-breakpoint
ALTER TABLE "detection_suggestions" ADD COLUMN "accepted_subscription_id" uuid;--> statement-breakpoint
ALTER TABLE "email_aliases" ADD COLUMN "last_received_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "email_aliases" ADD COLUMN "revoked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "imports" ADD COLUMN "subject" text;--> statement-breakpoint
ALTER TABLE "imports" ADD COLUMN "from_address" text;--> statement-breakpoint
ALTER TABLE "imports" ADD COLUMN "message_id" text;--> statement-breakpoint
ALTER TABLE "imports" ADD COLUMN "error" text;--> statement-breakpoint
ALTER TABLE "imports" ADD COLUMN "metadata" jsonb;--> statement-breakpoint
ALTER TABLE "detection_suggestions" ADD CONSTRAINT "detection_suggestions_accepted_subscription_id_subscriptions_id_fk" FOREIGN KEY ("accepted_subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "detection_suggestions_user_dedupe_uq" ON "detection_suggestions" USING btree ("user_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "email_aliases_user_idx" ON "email_aliases" USING btree ("user_id");