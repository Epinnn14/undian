CREATE TYPE "public"."undian_status" AS ENUM('draft', 'locked', 'finished');--> statement-breakpoint
CREATE TABLE "draws" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"undian_id" uuid NOT NULL,
	"prize_id" uuid NOT NULL,
	"slot" integer NOT NULL,
	"commitment" text NOT NULL,
	"seed" text NOT NULL,
	"public_entropy" text,
	"ticket_id" uuid,
	"drawn_at" timestamp with time zone,
	CONSTRAINT "draw_slot_per_undian" UNIQUE("undian_id","slot"),
	CONSTRAINT "ticket_wins_once" UNIQUE("ticket_id")
);
--> statement-breakpoint
CREATE TABLE "participants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"undian_id" uuid NOT NULL,
	"name" text NOT NULL,
	"contact" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "participant_name_per_undian" UNIQUE("undian_id","name")
);
--> statement-breakpoint
CREATE TABLE "prizes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"undian_id" uuid NOT NULL,
	"name" text NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "prize_position_per_undian" UNIQUE("undian_id","position"),
	CONSTRAINT "prize_quantity_positive" CHECK ("prizes"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "tickets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"undian_id" uuid NOT NULL,
	"participant_id" uuid NOT NULL,
	"code" text NOT NULL,
	CONSTRAINT "ticket_code_per_undian" UNIQUE("undian_id","code")
);
--> statement-breakpoint
CREATE TABLE "undian" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"allow_multiple_wins" boolean DEFAULT false NOT NULL,
	"ticket_prefix" text DEFAULT 'T' NOT NULL,
	"status" "undian_status" DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "draws" ADD CONSTRAINT "draws_undian_id_undian_id_fk" FOREIGN KEY ("undian_id") REFERENCES "public"."undian"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draws" ADD CONSTRAINT "draws_prize_id_prizes_id_fk" FOREIGN KEY ("prize_id") REFERENCES "public"."prizes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draws" ADD CONSTRAINT "draws_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "participants" ADD CONSTRAINT "participants_undian_id_undian_id_fk" FOREIGN KEY ("undian_id") REFERENCES "public"."undian"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prizes" ADD CONSTRAINT "prizes_undian_id_undian_id_fk" FOREIGN KEY ("undian_id") REFERENCES "public"."undian"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_undian_id_undian_id_fk" FOREIGN KEY ("undian_id") REFERENCES "public"."undian"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_participant_id_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."participants"("id") ON DELETE cascade ON UPDATE no action;