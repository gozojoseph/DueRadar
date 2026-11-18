CREATE TABLE "app_settings" (
	"key" varchar(64) PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "billing_transactions_provider_id_uq";--> statement-breakpoint
ALTER TABLE "billing_transactions" ADD COLUMN "provider" varchar(32) DEFAULT 'paystack' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "billing_transactions_provider_id_uq" ON "billing_transactions" USING btree ("provider","provider_transaction_id");--> statement-breakpoint
ALTER TABLE "billing_transactions" ADD CONSTRAINT "billing_transactions_provider_check" CHECK ("billing_transactions"."provider" in ('paystack','yebeck'));