-- Test-only DDL. __SCHEMA__ is replaced with a validated, freshly reserved namespace.
-- Deliberately absent from src/schema and application Drizzle migrations.
CREATE TABLE "__SCHEMA__"."foundation_test_operations" (
  "id" uuid PRIMARY KEY NOT NULL,
  "idempotency_key" text UNIQUE NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "payload" jsonb NOT NULL,
  "queue_name" text NOT NULL,
  "job_id" uuid UNIQUE NOT NULL,
  "processed_at" timestamp with time zone,
  "effect_count" integer DEFAULT 0 NOT NULL,
  CONSTRAINT "foundation_test_effect_consistent" CHECK (
    ("processed_at" IS NULL AND "effect_count" = 0)
    OR ("processed_at" IS NOT NULL AND "effect_count" = 1)
  )
);
