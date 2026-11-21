CREATE TABLE "starter_pack_receipts" (
	"user_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_hash" text NOT NULL,
	"operation" text NOT NULL,
	"goals" integer NOT NULL,
	"measurements" integer NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "starter_pack_receipts_pk" PRIMARY KEY("user_id","idempotency_key"),
	CONSTRAINT "starter_pack_receipts_key_check" CHECK (char_length("starter_pack_receipts"."idempotency_key") BETWEEN 1 AND 128 AND "starter_pack_receipts"."idempotency_key" !~ '[^A-Za-z0-9._:-]'),
	CONSTRAINT "starter_pack_receipts_hash_check" CHECK ("starter_pack_receipts"."request_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "starter_pack_receipts_operation_check" CHECK ("starter_pack_receipts"."operation" IN ('starter_pack.apply', 'starter_pack.remove')),
	CONSTRAINT "starter_pack_receipts_counts_check" CHECK ("starter_pack_receipts"."goals" >= 0 AND "starter_pack_receipts"."measurements" >= 0),
	CONSTRAINT "starter_pack_receipts_time_check" CHECK (isfinite("starter_pack_receipts"."created_at"))
);
--> statement-breakpoint
ALTER TABLE "activity_events" DROP CONSTRAINT "activity_events_source_check";--> statement-breakpoint
ALTER TABLE "goal_measurements" DROP CONSTRAINT "goal_measurements_unit_value_check";--> statement-breakpoint
ALTER TABLE "goal_measurements" DROP CONSTRAINT "goal_measurements_source_check";--> statement-breakpoint
ALTER TABLE "goals" DROP CONSTRAINT "goals_unit_check";--> statement-breakpoint
ALTER TABLE "goals" DROP CONSTRAINT "goals_unit_values_check";--> statement-breakpoint
ALTER TABLE "goals" ADD COLUMN "origin" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "starter_pack_receipts" ADD CONSTRAINT "starter_pack_receipts_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_source_check" CHECK ("activity_events"."source" IN ('manual', 'web', 'telegram', 'import', 'ai_proposed', 'starter'));--> statement-breakpoint
ALTER TABLE "goal_measurements" ADD CONSTRAINT "goal_measurements_unit_value_check" CHECK (CASE WHEN "goal_measurements"."unit" IN ('NOK', 'USD') THEN "goal_measurements"."value" = trunc("goal_measurements"."value",2) WHEN "goal_measurements"."unit" = 'count' THEN "goal_measurements"."value" = trunc("goal_measurements"."value") WHEN "goal_measurements"."unit" = 'percent' THEN "goal_measurements"."value" <= 100 ELSE true END);--> statement-breakpoint
ALTER TABLE "goal_measurements" ADD CONSTRAINT "goal_measurements_source_check" CHECK ("goal_measurements"."source" IN ('manual', 'example'));--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_origin_check" CHECK ("goals"."origin" IN ('manual', 'starter', 'onboarding'));--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_unit_check" CHECK ("goals"."unit" IN ('NOK', 'USD', 'count', 'minutes', 'percent', 'custom'));--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_unit_values_check" CHECK (CASE WHEN "goals"."unit" IN ('NOK', 'USD') THEN "goals"."baseline" = trunc("goals"."baseline", 2) AND "goals"."target" = trunc("goals"."target", 2) WHEN "goals"."unit" = 'count' THEN "goals"."baseline" = trunc("goals"."baseline") AND "goals"."target" = trunc("goals"."target") WHEN "goals"."unit" = 'percent' THEN "goals"."baseline" <= 100 AND "goals"."target" <= 100 ELSE true END);