CREATE TABLE "mock_response_overrides" (
	"mock_id" uuid NOT NULL,
	"method" text NOT NULL,
	"path" text NOT NULL,
	"status_code" smallint NOT NULL,
	"body" text NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mock_response_overrides_mock_id_method_path_status_code_pk" PRIMARY KEY("mock_id","method","path","status_code")
);
--> statement-breakpoint
ALTER TABLE "mock_response_overrides" ADD CONSTRAINT "mock_response_overrides_mock_id_mocks_id_fk" FOREIGN KEY ("mock_id") REFERENCES "public"."mocks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mock_response_overrides" ADD CONSTRAINT "mock_response_overrides_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;