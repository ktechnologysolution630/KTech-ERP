CREATE TABLE "vehicle_positions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_id" uuid NOT NULL,
	"trip_id" uuid,
	"lat" double precision NOT NULL,
	"lng" double precision NOT NULL,
	"accuracy_m" integer,
	"speed_kmh" double precision,
	"recorded_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source" text DEFAULT 'PHONE' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vehicle_profiles" (
	"asset_id" uuid PRIMARY KEY NOT NULL,
	"plate_no" text DEFAULT '' NOT NULL,
	"odometer_km" numeric(10, 1),
	"service_every_km" integer,
	"last_service_km" numeric(10, 1),
	"bookable" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vehicle_trip_expenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trip_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"liters" numeric(8, 2),
	"paid_on" date NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vehicle_trips" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text NOT NULL,
	"asset_id" uuid NOT NULL,
	"requested_by" uuid NOT NULL,
	"driver_id" uuid NOT NULL,
	"project_id" uuid,
	"purpose" text NOT NULL,
	"destination" text DEFAULT '' NOT NULL,
	"planned_start" timestamp with time zone NOT NULL,
	"planned_end" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'REQUESTED' NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text DEFAULT '' NOT NULL,
	"started_at" timestamp with time zone,
	"start_odometer_km" numeric(10, 1),
	"start_fuel" integer,
	"start_note" text DEFAULT '' NOT NULL,
	"ended_at" timestamp with time zone,
	"end_odometer_km" numeric(10, 1),
	"end_fuel" integer,
	"end_note" text DEFAULT '' NOT NULL,
	"damage" text DEFAULT '' NOT NULL,
	"last_lat" double precision,
	"last_lng" double precision,
	"last_accuracy_m" integer,
	"last_speed_kmh" double precision,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "vehicle_positions" ADD CONSTRAINT "vehicle_positions_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_positions" ADD CONSTRAINT "vehicle_positions_trip_id_vehicle_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."vehicle_trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_profiles" ADD CONSTRAINT "vehicle_profiles_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_trip_expenses" ADD CONSTRAINT "vehicle_trip_expenses_trip_id_vehicle_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."vehicle_trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_trip_expenses" ADD CONSTRAINT "vehicle_trip_expenses_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_trips" ADD CONSTRAINT "vehicle_trips_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_trips" ADD CONSTRAINT "vehicle_trips_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_trips" ADD CONSTRAINT "vehicle_trips_driver_id_users_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_trips" ADD CONSTRAINT "vehicle_trips_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_trips" ADD CONSTRAINT "vehicle_trips_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "vehicle_positions_trip_idx" ON "vehicle_positions" USING btree ("trip_id","recorded_at");--> statement-breakpoint
CREATE INDEX "vehicle_positions_asset_idx" ON "vehicle_positions" USING btree ("asset_id","recorded_at");--> statement-breakpoint
CREATE INDEX "vehicle_trip_expenses_trip_idx" ON "vehicle_trip_expenses" USING btree ("trip_id");--> statement-breakpoint
CREATE UNIQUE INDEX "vehicle_trips_number_idx" ON "vehicle_trips" USING btree ("number");--> statement-breakpoint
CREATE INDEX "vehicle_trips_asset_idx" ON "vehicle_trips" USING btree ("asset_id","planned_start");--> statement-breakpoint
CREATE INDEX "vehicle_trips_status_idx" ON "vehicle_trips" USING btree ("status");