CREATE TABLE "telemetry_counters" (
	"day" text NOT NULL,
	"key" text NOT NULL,
	"n" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "telemetry_counters_day_key_pk" PRIMARY KEY("day","key")
);
