CREATE TABLE "onboarding_receipts" (
	"user_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_hash" text NOT NULL,
	"goals" integer NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "onboarding_receipts_pk" PRIMARY KEY("user_id","idempotency_key"),
	CONSTRAINT "onboarding_receipts_key_check" CHECK (char_length("onboarding_receipts"."idempotency_key") BETWEEN 1 AND 128 AND "onboarding_receipts"."idempotency_key" !~ '[^A-Za-z0-9._:-]'),
	CONSTRAINT "onboarding_receipts_hash_check" CHECK ("onboarding_receipts"."request_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "onboarding_receipts_goals_check" CHECK ("onboarding_receipts"."goals" >= 1),
	CONSTRAINT "onboarding_receipts_time_check" CHECK (isfinite("onboarding_receipts"."created_at"))
);
--> statement-breakpoint
CREATE TABLE "onboarding_state" (
	"user_id" text PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'not_started' NOT NULL,
	"choice" text,
	"answers" jsonb,
	"catalog_version" integer NOT NULL,
	"completed_at" timestamp (3) with time zone,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "onboarding_state_status_check" CHECK ("onboarding_state"."status" IN ('not_started', 'in_progress', 'completed', 'dismissed')),
	CONSTRAINT "onboarding_state_choice_check" CHECK ("onboarding_state"."choice" IS NULL OR "onboarding_state"."choice" IN ('example', 'wizard', 'blank')),
	CONSTRAINT "onboarding_state_answers_check" CHECK ("onboarding_state"."answers" IS NULL OR (jsonb_typeof("onboarding_state"."answers") = 'object' AND pg_column_size("onboarding_state"."answers") <= 65536)),
	CONSTRAINT "onboarding_state_version_check" CHECK ("onboarding_state"."catalog_version" >= 1),
	CONSTRAINT "onboarding_state_completed_check" CHECK ("onboarding_state"."status" <> 'completed' OR "onboarding_state"."completed_at" IS NOT NULL),
	CONSTRAINT "onboarding_state_time_check" CHECK (isfinite("onboarding_state"."updated_at") AND ("onboarding_state"."completed_at" IS NULL OR isfinite("onboarding_state"."completed_at")))
);
--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "focus_domains" text[];--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "checkin_rhythm" text;--> statement-breakpoint
ALTER TABLE "onboarding_receipts" ADD CONSTRAINT "onboarding_receipts_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_state" ADD CONSTRAINT "onboarding_state_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_focus_domains_check" CHECK ("user"."focus_domains" IS NULL OR (cardinality("user"."focus_domains") <= 6 AND "user"."focus_domains" <@ ARRAY['languages', 'finance', 'work', 'projects', 'skills', 'health']::text[]));--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_checkin_rhythm_check" CHECK ("user"."checkin_rhythm" IS NULL OR "user"."checkin_rhythm" IN ('daily', 'few_per_week', 'weekly', 'self'));