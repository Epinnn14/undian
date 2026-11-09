CREATE TYPE "public"."frequency" AS ENUM('weekly', 'monthly');--> statement-breakpoint
CREATE TYPE "public"."group_status" AS ENUM('open', 'running', 'finished');--> statement-breakpoint
CREATE TYPE "public"."round_status" AS ENUM('collecting', 'drawn');--> statement-breakpoint
CREATE TABLE "contributions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"round_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"amount" integer NOT NULL,
	"paid_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "one_contribution_per_round" UNIQUE("round_id","member_id")
);
--> statement-breakpoint
CREATE TABLE "groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"contribution" integer NOT NULL,
	"frequency" "frequency" NOT NULL,
	"admin_fee_pct" numeric(5, 2) DEFAULT 0 NOT NULL,
	"status" "group_status" DEFAULT 'open' NOT NULL,
	"start_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contribution_positive" CHECK ("groups"."contribution" > 0),
	CONSTRAINT "fee_range" CHECK ("groups"."admin_fee_pct" >= 0 AND "groups"."admin_fee_pct" <= 20)
);
--> statement-breakpoint
CREATE TABLE "members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"name" text NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "member_name_per_group" UNIQUE("group_id","name")
);
--> statement-breakpoint
CREATE TABLE "rounds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"due_date" date NOT NULL,
	"status" "round_status" DEFAULT 'collecting' NOT NULL,
	"commitment" text NOT NULL,
	"seed" text NOT NULL,
	"public_entropy" text,
	"winner_id" uuid,
	"payout" integer,
	"fee" integer,
	"drawn_at" timestamp with time zone,
	CONSTRAINT "round_number_per_group" UNIQUE("group_id","number")
);
--> statement-breakpoint
ALTER TABLE "contributions" ADD CONSTRAINT "contributions_round_id_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."rounds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contributions" ADD CONSTRAINT "contributions_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rounds" ADD CONSTRAINT "rounds_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rounds" ADD CONSTRAINT "rounds_winner_id_members_id_fk" FOREIGN KEY ("winner_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;