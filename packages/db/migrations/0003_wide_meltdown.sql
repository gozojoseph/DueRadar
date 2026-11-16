CREATE TABLE "billing_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"reference" varchar(100) NOT NULL,
	"interval" text NOT NULL,
	"amount_minor" integer NOT NULL,
	"currency" varchar(3) DEFAULT 'GHS' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"provider_transaction_id" text,
	"paid_at" timestamp with time zone,
	"access_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_transactions_interval_check" CHECK ("billing_transactions"."interval" in ('monthly','annual')),
	CONSTRAINT "billing_transactions_status_check" CHECK ("billing_transactions"."status" in ('pending','paid','failed')),
	CONSTRAINT "billing_transactions_amount_check" CHECK ("billing_transactions"."amount_minor" > 0),
	CONSTRAINT "billing_transactions_currency_check" CHECK ("billing_transactions"."currency" = 'GHS')
);
--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "plan_tier" text DEFAULT 'free' NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "plan_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "plan_grandfathered" boolean DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE "profiles"
SET "plan_tier" = 'plus',
    "plan_grandfathered" = true,
    "plan_expires_at" = NULL,
    "updated_at" = now();--> statement-breakpoint
CREATE UNIQUE INDEX "billing_transactions_reference_uq" ON "billing_transactions" USING btree ("reference");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_transactions_provider_id_uq" ON "billing_transactions" USING btree ("provider_transaction_id");--> statement-breakpoint
CREATE INDEX "billing_transactions_user_created_idx" ON "billing_transactions" USING btree ("user_id","created_at");--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_plan_tier_check" CHECK ("profiles"."plan_tier" in ('free','plus'));