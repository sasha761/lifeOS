CREATE TABLE "goals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"domain_key" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"unit" text NOT NULL,
	"unit_label" text,
	"baseline" numeric NOT NULL,
	"target" numeric NOT NULL,
	"direction" text NOT NULL,
	"calculation_mode" text DEFAULT 'manual' NOT NULL,
	"metric_key" text,
	"status" text DEFAULT 'active' NOT NULL,
	"due_at" timestamp (3) with time zone,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "goals_domain_key_check" CHECK ("goals"."domain_key" IN ('languages', 'finance', 'work', 'projects', 'skills', 'health')),
	CONSTRAINT "goals_title_check" CHECK (char_length("goals"."title") BETWEEN 1 AND 200 AND btrim("goals"."title") <> ''),
	CONSTRAINT "goals_description_check" CHECK ("goals"."description" IS NULL OR (char_length("goals"."description") BETWEEN 1 AND 4000 AND btrim("goals"."description") <> '')),
	CONSTRAINT "goals_unit_check" CHECK ("goals"."unit" IN ('NOK', 'count', 'minutes', 'percent', 'custom')),
	CONSTRAINT "goals_unit_label_check" CHECK (CASE WHEN "goals"."unit" = 'custom' THEN "goals"."unit_label" IS NOT NULL AND char_length("goals"."unit_label") BETWEEN 1 AND 40 AND btrim("goals"."unit_label") <> '' ELSE "goals"."unit_label" IS NULL END),
	CONSTRAINT "goals_values_check" CHECK ("goals"."baseline" >= 0 AND "goals"."target" >= 0 AND "goals"."baseline" < power(10::numeric, 22) AND "goals"."target" < power(10::numeric, 22) AND "goals"."baseline" = trunc("goals"."baseline", 8) AND "goals"."target" = trunc("goals"."target", 8)),
	CONSTRAINT "goals_unit_values_check" CHECK (CASE "goals"."unit" WHEN 'NOK' THEN "goals"."baseline" = trunc("goals"."baseline", 2) AND "goals"."target" = trunc("goals"."target", 2) WHEN 'count' THEN "goals"."baseline" = trunc("goals"."baseline") AND "goals"."target" = trunc("goals"."target") WHEN 'percent' THEN "goals"."baseline" <= 100 AND "goals"."target" <= 100 ELSE true END),
	CONSTRAINT "goals_direction_check" CHECK (("goals"."direction" = 'increase' AND "goals"."target" > "goals"."baseline") OR ("goals"."direction" = 'decrease' AND "goals"."target" < "goals"."baseline")),
	CONSTRAINT "goals_manual_check" CHECK ("goals"."calculation_mode" = 'manual' AND "goals"."metric_key" IS NULL),
	CONSTRAINT "goals_status_check" CHECK ("goals"."status" IN ('active', 'archived')),
	CONSTRAINT "goals_due_at_check" CHECK ("goals"."due_at" IS NULL OR (isfinite("goals"."due_at") AND EXTRACT(YEAR FROM "goals"."due_at" AT TIME ZONE 'UTC') BETWEEN 1 AND 9999)),
	CONSTRAINT "goals_timestamps_check" CHECK (isfinite("goals"."created_at") AND isfinite("goals"."updated_at") AND EXTRACT(YEAR FROM "goals"."created_at" AT TIME ZONE 'UTC') BETWEEN 1 AND 9999 AND EXTRACT(YEAR FROM "goals"."updated_at" AT TIME ZONE 'UTC') BETWEEN 1 AND 9999)
);
--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "goals_user_domain_status_idx" ON "goals" USING btree ("user_id","domain_key","status");--> statement-breakpoint
CREATE INDEX "goals_user_status_due_idx" ON "goals" USING btree ("user_id","status","due_at","id");
