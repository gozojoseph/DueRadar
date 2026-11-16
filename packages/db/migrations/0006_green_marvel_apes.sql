CREATE TABLE "provider_oauth_states" (
	"state_hash" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"provider" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "provider_oauth_states_user_provider_idx" ON "provider_oauth_states" USING btree ("user_id","provider");--> statement-breakpoint
CREATE INDEX "provider_oauth_states_expiry_idx" ON "provider_oauth_states" USING btree ("expires_at");