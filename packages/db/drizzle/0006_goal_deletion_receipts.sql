CREATE TABLE "goal_deletion_receipts" (
	"user_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_hash" text NOT NULL,
	"target_id" uuid NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "goal_deletion_receipts_pk" PRIMARY KEY("user_id","idempotency_key"),
	CONSTRAINT "goal_deletion_receipts_key_check" CHECK (char_length("goal_deletion_receipts"."idempotency_key") BETWEEN 1 AND 128 AND "goal_deletion_receipts"."idempotency_key" !~ '[^A-Za-z0-9._:-]'),
	CONSTRAINT "goal_deletion_receipts_hash_check" CHECK ("goal_deletion_receipts"."request_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "goal_deletion_receipts_time_check" CHECK (isfinite("goal_deletion_receipts"."created_at"))
);
--> statement-breakpoint
ALTER TABLE "goal_deletion_receipts" ADD CONSTRAINT "goal_deletion_receipts_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE cascade ON UPDATE no action;
