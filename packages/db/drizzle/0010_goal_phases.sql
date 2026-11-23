ALTER TABLE "activity_events" DROP CONSTRAINT "activity_events_before_fields_check";--> statement-breakpoint
ALTER TABLE "activity_events" DROP CONSTRAINT "activity_events_after_fields_check";--> statement-breakpoint
ALTER TABLE "goal_command_receipts" DROP CONSTRAINT "goal_command_receipts_operation_check";--> statement-breakpoint
ALTER TABLE "goal_command_receipts" DROP CONSTRAINT "goal_command_receipts_resource_check";--> statement-breakpoint
ALTER TABLE "goals" ALTER COLUMN "unit" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "goals" ALTER COLUMN "baseline" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "goals" ALTER COLUMN "target" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "goals" ALTER COLUMN "direction" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "goals" ADD COLUMN "kind" text DEFAULT 'numeric' NOT NULL;--> statement-breakpoint
ALTER TABLE "goals" ADD COLUMN "phase" text DEFAULT 'in_progress' NOT NULL;--> statement-breakpoint
ALTER TABLE "goals" ADD COLUMN "phase_changed_at" timestamp (3) with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "goals" ADD COLUMN "starts_at" timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_before_fields_check" CHECK (
    CASE WHEN "activity_events"."payload"->'before' = 'null'::jsonb THEN true
    WHEN jsonb_typeof("activity_events"."payload"->'before') = 'object' THEN
      ("activity_events"."payload"->'before') - (CASE WHEN "activity_events"."target_type" = 'goal' THEN ARRAY['unit', 'baseline', 'target', 'direction', 'status', 'due_at', 'kind', 'phase', 'starts_at'] ELSE ARRAY['value', 'measured_at', 'source'] END) = '{}'::jsonb
    ELSE false END);--> statement-breakpoint
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_after_fields_check" CHECK (
    CASE WHEN "activity_events"."payload"->'after' = 'null'::jsonb THEN true
    WHEN jsonb_typeof("activity_events"."payload"->'after') = 'object' THEN
      ("activity_events"."payload"->'after') - (CASE WHEN "activity_events"."target_type" = 'goal' THEN ARRAY['unit', 'baseline', 'target', 'direction', 'status', 'due_at', 'kind', 'phase', 'starts_at'] ELSE ARRAY['value', 'measured_at', 'source'] END) = '{}'::jsonb
    ELSE false END);--> statement-breakpoint
ALTER TABLE "goal_command_receipts" ADD CONSTRAINT "goal_command_receipts_operation_check" CHECK ("goal_command_receipts"."operation" IN ('create','update','archive','phase','measurement.create','measurement.update','measurement.delete'));--> statement-breakpoint
ALTER TABLE "goal_command_receipts" ADD CONSTRAINT "goal_command_receipts_resource_check" CHECK (("goal_command_receipts"."resource_type" = 'goal' AND ("goal_command_receipts"."target_id" IS NULL OR "goal_command_receipts"."target_id" = "goal_command_receipts"."goal_id") AND "goal_command_receipts"."operation" IN ('create','update','archive','phase')) OR ("goal_command_receipts"."resource_type" = 'measurement' AND "goal_command_receipts"."target_id" IS NOT NULL AND "goal_command_receipts"."operation" IN ('measurement.create','measurement.update','measurement.delete')));--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_kind_check" CHECK ("goals"."kind" IN ('numeric', 'unmeasured'));--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_kind_definition_check" CHECK (("goals"."kind" = 'numeric' AND "goals"."unit" IS NOT NULL AND "goals"."baseline" IS NOT NULL AND "goals"."target" IS NOT NULL AND "goals"."direction" IS NOT NULL) OR ("goals"."kind" = 'unmeasured' AND "goals"."unit" IS NULL AND "goals"."unit_label" IS NULL AND "goals"."baseline" IS NULL AND "goals"."target" IS NULL AND "goals"."direction" IS NULL));--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_phase_check" CHECK ("goals"."phase" IN ('planned', 'in_progress', 'paused', 'achieved') AND isfinite("goals"."phase_changed_at"));--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_starts_at_check" CHECK ("goals"."starts_at" IS NULL OR (isfinite("goals"."starts_at") AND EXTRACT(YEAR FROM "goals"."starts_at" AT TIME ZONE 'UTC') BETWEEN 1 AND 9999 AND ("goals"."due_at" IS NULL OR "goals"."starts_at" <= "goals"."due_at")));--> statement-breakpoint
-- LFS-225: an existing goal has been in progress since it was created (written by hand after drizzle-kit generate).
UPDATE "goals" SET "phase_changed_at" = "created_at";