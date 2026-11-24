ALTER TABLE "activity_events" DROP CONSTRAINT "activity_events_before_fields_check";--> statement-breakpoint
ALTER TABLE "activity_events" DROP CONSTRAINT "activity_events_after_fields_check";--> statement-breakpoint
ALTER TABLE "goals" ADD COLUMN "measurement_mode" text DEFAULT 'current_value' NOT NULL;--> statement-breakpoint
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_before_fields_check" CHECK (
    CASE WHEN "activity_events"."payload"->'before' = 'null'::jsonb THEN true
    WHEN jsonb_typeof("activity_events"."payload"->'before') = 'object' THEN
      ("activity_events"."payload"->'before') - (CASE WHEN "activity_events"."target_type" = 'goal' THEN ARRAY['unit', 'baseline', 'target', 'direction', 'status', 'due_at', 'kind', 'phase', 'starts_at', 'measurement_mode'] ELSE ARRAY['value', 'measured_at', 'source', 'contribution_kind'] END) = '{}'::jsonb
    ELSE false END);--> statement-breakpoint
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_after_fields_check" CHECK (
    CASE WHEN "activity_events"."payload"->'after' = 'null'::jsonb THEN true
    WHEN jsonb_typeof("activity_events"."payload"->'after') = 'object' THEN
      ("activity_events"."payload"->'after') - (CASE WHEN "activity_events"."target_type" = 'goal' THEN ARRAY['unit', 'baseline', 'target', 'direction', 'status', 'due_at', 'kind', 'phase', 'starts_at', 'measurement_mode'] ELSE ARRAY['value', 'measured_at', 'source', 'contribution_kind'] END) = '{}'::jsonb
    ELSE false END);--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_measurement_mode_check" CHECK ("goals"."measurement_mode" = 'current_value' OR ("goals"."kind" = 'numeric' AND "goals"."measurement_mode" = 'contributions'));