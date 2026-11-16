CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text,
	"action" text NOT NULL,
	"entity_type" text,
	"entity_id" text,
	"ip" text,
	"user_agent" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "billing_occurrences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"subscription_id" uuid NOT NULL,
	"due_date" date NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" varchar(3) NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"paid_at" timestamp with time zone,
	"payment_id" uuid,
	"snoozed_until" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_occurrences_status_check" CHECK ("billing_occurrences"."status" in ('pending','paid','skipped','canceled')),
	CONSTRAINT "billing_occurrences_amount_check" CHECK ("billing_occurrences"."amount_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"color" text DEFAULT '#0f766e' NOT NULL,
	"icon" text DEFAULT 'tag' NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "delivery_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"provider" text,
	"status" text NOT NULL,
	"provider_message_id" text,
	"error" text,
	"attempted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "detection_suggestions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"import_id" uuid,
	"kind" text,
	"payload" jsonb NOT NULL,
	"confidence" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"dedupe_key" text NOT NULL,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "detection_suggestions_confidence_check" CHECK ("detection_suggestions"."confidence" between 0 and 100),
	CONSTRAINT "detection_suggestions_status_check" CHECK ("detection_suggestions"."status" in ('pending','accepted','rejected'))
);
--> statement-breakpoint
CREATE TABLE "devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"user_agent" text,
	"platform" text,
	"disabled_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_aliases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"address" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"source" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"raw_text" text,
	"raw_retention_until" timestamp with time zone,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "imports_source_check" CHECK ("imports"."source" in ('paste','email','upload','ocr','csv','api')),
	CONSTRAINT "imports_status_check" CHECK ("imports"."status" in ('pending','processed','failed','expired'))
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"kind" text DEFAULT 'reminder' NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"entity_type" text,
	"entity_id" text,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_methods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"label" text NOT NULL,
	"kind" text DEFAULT 'card' NOT NULL,
	"brand" text,
	"last4" varchar(4),
	"expiry_month" integer,
	"expiry_year" integer,
	"is_default" boolean DEFAULT false NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_methods_kind_check" CHECK ("payment_methods"."kind" in ('card','momo','bank','wallet','cash','other')),
	CONSTRAINT "payment_methods_last4_check" CHECK ("payment_methods"."last4" is null or "payment_methods"."last4" ~ '^[0-9]{4}$')
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"subscription_id" uuid,
	"occurrence_id" uuid,
	"amount_minor" bigint NOT NULL,
	"currency" varchar(3) NOT NULL,
	"paid_at" timestamp with time zone DEFAULT now() NOT NULL,
	"method" text,
	"reference" text,
	"source" text DEFAULT 'manual' NOT NULL,
	"notes" text,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_amount_check" CHECK ("payments"."amount_minor" >= 0),
	CONSTRAINT "payments_source_check" CHECK ("payments"."source" in ('manual','import','detection'))
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"user_id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"display_name" text,
	"timezone" text DEFAULT 'Africa/Accra' NOT NULL,
	"currency" varchar(3) DEFAULT 'GHS' NOT NULL,
	"locale" text DEFAULT 'en-GH' NOT NULL,
	"week_starts_on" integer DEFAULT 1 NOT NULL,
	"reminder_time" text DEFAULT '09:00' NOT NULL,
	"quiet_hours_start" text DEFAULT '21:00' NOT NULL,
	"quiet_hours_end" text DEFAULT '07:00' NOT NULL,
	"email_reminders" boolean DEFAULT true NOT NULL,
	"push_reminders" boolean DEFAULT false NOT NULL,
	"onboarded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "profiles_currency_check" CHECK ("profiles"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "profiles_week_start_check" CHECK ("profiles"."week_starts_on" between 0 and 1)
);
--> statement-breakpoint
CREATE TABLE "provider_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"provider" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"encrypted_tokens" text,
	"cursor" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "provider_connections_status_check" CHECK ("provider_connections"."status" in ('active','revoked','error'))
);
--> statement-breakpoint
CREATE TABLE "reminder_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"subscription_id" uuid,
	"occurrence_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"offset_days" integer NOT NULL,
	"fire_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"dedupe_key" text NOT NULL,
	"locked_at" timestamp with time zone,
	"last_error" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reminder_jobs_channel_check" CHECK ("reminder_jobs"."channel" in ('email','push','in_app')),
	CONSTRAINT "reminder_jobs_status_check" CHECK ("reminder_jobs"."status" in ('scheduled','processing','sent','failed','skipped','canceled')),
	CONSTRAINT "reminder_jobs_attempts_check" CHECK ("reminder_jobs"."attempts" >= 0)
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"vendor" text,
	"kind" text DEFAULT 'subscription' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" varchar(3) DEFAULT 'GHS' NOT NULL,
	"cycle" text DEFAULT 'monthly' NOT NULL,
	"custom_interval_days" integer,
	"anchor_date" date NOT NULL,
	"end_of_month_mode" boolean DEFAULT false NOT NULL,
	"trial_ends_at" date,
	"next_due_date" date,
	"category_id" uuid,
	"payment_method_id" uuid,
	"url" text,
	"notes" text,
	"reminder_offsets" jsonb,
	"reminder_channels" jsonb,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscriptions_amount_check" CHECK ("subscriptions"."amount_minor" >= 0),
	CONSTRAINT "subscriptions_currency_check" CHECK ("subscriptions"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "subscriptions_kind_check" CHECK ("subscriptions"."kind" in ('subscription','bill','trial','prepaid','installment')),
	CONSTRAINT "subscriptions_status_check" CHECK ("subscriptions"."status" in ('active','paused','cancelled')),
	CONSTRAINT "subscriptions_cycle_check" CHECK ("subscriptions"."cycle" in ('weekly','monthly','quarterly','semiannual','annual','custom_days')),
	CONSTRAINT "subscriptions_custom_interval_check" CHECK ("subscriptions"."cycle" <> 'custom_days' or ("subscriptions"."custom_interval_days" is not null and "subscriptions"."custom_interval_days" >= 1))
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"external_id" text NOT NULL,
	"payload_hash" text,
	"status" text DEFAULT 'received' NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "billing_occurrences" ADD CONSTRAINT "billing_occurrences_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_attempts" ADD CONSTRAINT "delivery_attempts_job_id_reminder_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."reminder_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "detection_suggestions" ADD CONSTRAINT "detection_suggestions_import_id_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."imports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_occurrence_id_billing_occurrences_id_fk" FOREIGN KEY ("occurrence_id") REFERENCES "public"."billing_occurrences"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminder_jobs" ADD CONSTRAINT "reminder_jobs_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminder_jobs" ADD CONSTRAINT "reminder_jobs_occurrence_id_billing_occurrences_id_fk" FOREIGN KEY ("occurrence_id") REFERENCES "public"."billing_occurrences"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_payment_method_id_payment_methods_id_fk" FOREIGN KEY ("payment_method_id") REFERENCES "public"."payment_methods"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_events_user_created_idx" ON "audit_events" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_events_action_idx" ON "audit_events" USING btree ("action");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_occurrences_subscription_due_uq" ON "billing_occurrences" USING btree ("subscription_id","due_date");--> statement-breakpoint
CREATE INDEX "billing_occurrences_user_due_idx" ON "billing_occurrences" USING btree ("user_id","due_date");--> statement-breakpoint
CREATE INDEX "billing_occurrences_user_status_idx" ON "billing_occurrences" USING btree ("user_id","status","due_date");--> statement-breakpoint
CREATE UNIQUE INDEX "categories_user_name_uq" ON "categories" USING btree ("user_id","name");--> statement-breakpoint
CREATE INDEX "categories_user_idx" ON "categories" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "delivery_attempts_job_idx" ON "delivery_attempts" USING btree ("job_id");--> statement-breakpoint
CREATE UNIQUE INDEX "detection_suggestions_dedupe_uq" ON "detection_suggestions" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "detection_suggestions_user_status_idx" ON "detection_suggestions" USING btree ("user_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "devices_endpoint_uq" ON "devices" USING btree ("endpoint");--> statement-breakpoint
CREATE INDEX "devices_user_idx" ON "devices" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "email_aliases_address_uq" ON "email_aliases" USING btree ("address");--> statement-breakpoint
CREATE INDEX "imports_user_created_idx" ON "imports" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "notifications_user_created_idx" ON "notifications" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "payment_methods_user_idx" ON "payment_methods" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "payments_user_paid_idx" ON "payments" USING btree ("user_id","paid_at");--> statement-breakpoint
CREATE INDEX "payments_subscription_idx" ON "payments" USING btree ("subscription_id");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_connections_user_provider_uq" ON "provider_connections" USING btree ("user_id","provider");--> statement-breakpoint
CREATE UNIQUE INDEX "reminder_jobs_dedupe_uq" ON "reminder_jobs" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "reminder_jobs_due_idx" ON "reminder_jobs" USING btree ("status","fire_at");--> statement-breakpoint
CREATE INDEX "reminder_jobs_user_idx" ON "reminder_jobs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "subscriptions_user_status_idx" ON "subscriptions" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "subscriptions_user_next_due_idx" ON "subscriptions" USING btree ("user_id","next_due_date");--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_events_provider_external_uq" ON "webhook_events" USING btree ("provider","external_id");--> statement-breakpoint
CREATE INDEX "webhook_events_received_idx" ON "webhook_events" USING btree ("received_at");