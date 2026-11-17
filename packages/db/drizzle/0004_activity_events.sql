CREATE TABLE "activity_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"domain_key" text NOT NULL,
	"goal_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"source" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" uuid NOT NULL,
	"idempotency_key" text,
	"schema_version" integer DEFAULT 1 NOT NULL,
	"occurred_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "activity_events_type_check" CHECK ("activity_events"."event_type" IN ('goal.created', 'goal.updated', 'goal.archived', 'goal_measurement.created', 'goal_measurement.updated', 'goal_measurement.deleted')),
	CONSTRAINT "activity_events_source_check" CHECK ("activity_events"."source" IN ('manual', 'web', 'telegram', 'import', 'ai_proposed')),
	CONSTRAINT "activity_events_target_check" CHECK (CASE WHEN "activity_events"."event_type" LIKE 'goal.%' THEN "activity_events"."target_type" = 'goal' AND "activity_events"."target_id" = "activity_events"."goal_id" ELSE "activity_events"."target_type" = 'goal_measurement' END),
	CONSTRAINT "activity_events_key_check" CHECK ("activity_events"."idempotency_key" IS NULL OR (char_length("activity_events"."idempotency_key") BETWEEN 1 AND 128 AND "activity_events"."idempotency_key" !~ '[^A-Za-z0-9._:-]')),
	CONSTRAINT "activity_events_version_check" CHECK ("activity_events"."schema_version" = 1),
	CONSTRAINT "activity_events_time_check" CHECK (isfinite("activity_events"."occurred_at") AND isfinite("activity_events"."created_at")),
	CONSTRAINT "activity_events_payload_check" CHECK (jsonb_typeof("activity_events"."payload") = 'object' AND pg_column_size("activity_events"."payload") <= 16384 AND "activity_events"."payload" ? 'before' AND "activity_events"."payload" ? 'after' AND "activity_events"."payload" - ARRAY['before','after','changed_fields'] = '{}'::jsonb),
	CONSTRAINT "activity_events_before_fields_check" CHECK (
    CASE WHEN "activity_events"."payload"->'before' = 'null'::jsonb THEN true
    WHEN jsonb_typeof("activity_events"."payload"->'before') = 'object' THEN
      ("activity_events"."payload"->'before') - (CASE WHEN "activity_events"."target_type" = 'goal' THEN ARRAY['unit', 'baseline', 'target', 'direction', 'status', 'due_at'] ELSE ARRAY['value', 'measured_at', 'source'] END) = '{}'::jsonb
    ELSE false END),
	CONSTRAINT "activity_events_after_fields_check" CHECK (
    CASE WHEN "activity_events"."payload"->'after' = 'null'::jsonb THEN true
    WHEN jsonb_typeof("activity_events"."payload"->'after') = 'object' THEN
      ("activity_events"."payload"->'after') - (CASE WHEN "activity_events"."target_type" = 'goal' THEN ARRAY['unit', 'baseline', 'target', 'direction', 'status', 'due_at'] ELSE ARRAY['value', 'measured_at', 'source'] END) = '{}'::jsonb
    ELSE false END)
);
--> statement-breakpoint
CREATE TABLE "goal_command_receipts" (
	"user_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_hash" text NOT NULL,
	"operation" text NOT NULL,
	"source" text NOT NULL,
	"goal_id" uuid NOT NULL,
	"domain_key" text NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "goal_command_receipts_pk" PRIMARY KEY("user_id","idempotency_key"),
	CONSTRAINT "goal_command_receipts_key_check" CHECK (char_length("goal_command_receipts"."idempotency_key") BETWEEN 1 AND 128 AND "goal_command_receipts"."idempotency_key" !~ '[^A-Za-z0-9._:-]'),
	CONSTRAINT "goal_command_receipts_hash_check" CHECK ("goal_command_receipts"."request_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "goal_command_receipts_operation_check" CHECK ("goal_command_receipts"."operation" IN ('create','update','archive')),
	CONSTRAINT "goal_command_receipts_source_check" CHECK ("goal_command_receipts"."source" IN ('manual','web')),
	CONSTRAINT "goal_command_receipts_time_check" CHECK (isfinite("goal_command_receipts"."created_at"))
);
--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_owner_domain_id_unique" UNIQUE("user_id","domain_key","id");--> statement-breakpoint
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_owned_goal_fk" FOREIGN KEY ("user_id","domain_key","goal_id") REFERENCES "goals"("user_id","domain_key","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_command_receipts" ADD CONSTRAINT "goal_command_receipts_owned_goal_fk" FOREIGN KEY ("user_id","domain_key","goal_id") REFERENCES "goals"("user_id","domain_key","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "activity_events_user_key_unique" ON "activity_events" USING btree ("user_id","idempotency_key") WHERE "activity_events"."idempotency_key" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "activity_events_user_domain_time_idx" ON "activity_events" USING btree ("user_id","domain_key","occurred_at","id");--> statement-breakpoint
CREATE INDEX "activity_events_user_goal_time_idx" ON "activity_events" USING btree ("user_id","goal_id","occurred_at","id");
