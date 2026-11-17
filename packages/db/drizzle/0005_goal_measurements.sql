CREATE TABLE "goal_measurements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"goal_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"unit" text NOT NULL,
	"value" numeric NOT NULL,
	"measured_at" timestamp (3) with time zone NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"note" text,
	"created_at" timestamp (3) with time zone DEFAULT clock_timestamp() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "goal_measurements_value_check" CHECK ("goal_measurements"."value" >= 0 AND "goal_measurements"."value" < power(10::numeric, 22) AND "goal_measurements"."value" = trunc("goal_measurements"."value", 8)),
	CONSTRAINT "goal_measurements_unit_value_check" CHECK (CASE "goal_measurements"."unit" WHEN 'NOK' THEN "goal_measurements"."value" = trunc("goal_measurements"."value",2) WHEN 'count' THEN "goal_measurements"."value" = trunc("goal_measurements"."value") WHEN 'percent' THEN "goal_measurements"."value" <= 100 ELSE true END),
	CONSTRAINT "goal_measurements_source_check" CHECK ("goal_measurements"."source" = 'manual'),
	CONSTRAINT "goal_measurements_note_check" CHECK ("goal_measurements"."note" IS NULL OR (char_length("goal_measurements"."note") BETWEEN 1 AND 1000 AND btrim("goal_measurements"."note") <> '')),
	CONSTRAINT "goal_measurements_time_check" CHECK (isfinite("goal_measurements"."measured_at") AND EXTRACT(YEAR FROM "goal_measurements"."measured_at" AT TIME ZONE 'UTC') BETWEEN 1 AND 9999 AND "goal_measurements"."measured_at" <= clock_timestamp() + 300000 * interval '1 millisecond' AND isfinite("goal_measurements"."created_at") AND isfinite("goal_measurements"."updated_at"))
);
--> statement-breakpoint
ALTER TABLE "goal_command_receipts" DROP CONSTRAINT "goal_command_receipts_operation_check";--> statement-breakpoint
ALTER TABLE "goal_command_receipts" ADD COLUMN "resource_type" text DEFAULT 'goal' NOT NULL;--> statement-breakpoint
ALTER TABLE "goal_command_receipts" ADD COLUMN "target_id" uuid;--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_owner_id_unit_unique" UNIQUE("user_id","id","unit");--> statement-breakpoint
ALTER TABLE "goal_measurements" ADD CONSTRAINT "goal_measurements_owned_unit_fk" FOREIGN KEY ("user_id","goal_id","unit") REFERENCES "goals"("user_id","id","unit") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "goal_measurements_current_idx" ON "goal_measurements" USING btree ("user_id","goal_id","measured_at","created_at","id");--> statement-breakpoint
ALTER TABLE "goal_command_receipts" ADD CONSTRAINT "goal_command_receipts_resource_check" CHECK (("goal_command_receipts"."resource_type" = 'goal' AND ("goal_command_receipts"."target_id" IS NULL OR "goal_command_receipts"."target_id" = "goal_command_receipts"."goal_id") AND "goal_command_receipts"."operation" IN ('create','update','archive')) OR ("goal_command_receipts"."resource_type" = 'measurement' AND "goal_command_receipts"."target_id" IS NOT NULL AND "goal_command_receipts"."operation" IN ('measurement.create','measurement.update','measurement.delete')));--> statement-breakpoint
ALTER TABLE "goal_command_receipts" ADD CONSTRAINT "goal_command_receipts_operation_check" CHECK ("goal_command_receipts"."operation" IN ('create','update','archive','measurement.create','measurement.update','measurement.delete'));
