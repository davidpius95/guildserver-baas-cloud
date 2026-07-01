CREATE TYPE "public"."baas_node_role" AS ENUM('edge', 'compute', 'storage');--> statement-breakpoint
CREATE TYPE "public"."baas_node_status" AS ENUM('online', 'offline', 'maintenance', 'error');--> statement-breakpoint
CREATE TYPE "public"."baas_project_status" AS ENUM('provisioning', 'active', 'paused', 'error', 'deleting');--> statement-breakpoint
CREATE TYPE "public"."baas_backup_status" AS ENUM('pending', 'in_progress', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."baas_backup_type" AS ENUM('manual', 'automatic', 'pre_merge', 'base');--> statement-breakpoint
CREATE TYPE "public"."baas_domain_status" AS ENUM('pending', 'verifying', 'active', 'failed', 'expired');--> statement-breakpoint
CREATE TYPE "public"."baas_port_alloc_status" AS ENUM('reserved', 'bound', 'released');--> statement-breakpoint
CREATE TYPE "public"."baas_scaling_direction" AS ENUM('up', 'down');--> statement-breakpoint
CREATE TYPE "public"."baas_scaling_mode" AS ENUM('manual', 'auto');--> statement-breakpoint
CREATE TABLE "baas_backups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"status" "baas_backup_status" DEFAULT 'pending' NOT NULL,
	"backup_type" "baas_backup_type" DEFAULT 'manual' NOT NULL,
	"size_bytes" integer,
	"file_path" text,
	"wal_target_time" timestamp with time zone,
	"error" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "baas_custom_hostnames" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"hostname" varchar(255) NOT NULL,
	"cf_custom_hostname_id" varchar(255),
	"cf_ownership_txt_name" text,
	"cf_ownership_txt_value" text,
	"cf_ssl_status" varchar(64),
	"status" "baas_domain_status" DEFAULT 'pending' NOT NULL,
	"verified" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "baas_custom_hostnames_hostname_unique" UNIQUE("hostname")
);
--> statement-breakpoint
CREATE TABLE "baas_metrics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"collected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cpu_percent" numeric(6, 2),
	"ram_mb_used" integer,
	"storage_gb_used" numeric(10, 2),
	"active_connections" integer,
	"db_size_mb" numeric(12, 2),
	"tx_committed" integer,
	"tx_rolled_back" integer,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "baas_nodes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"hostname" varchar(255) NOT NULL,
	"internal_ip" "inet",
	"external_ip" "inet",
	"role" "baas_node_role" DEFAULT 'compute' NOT NULL,
	"status" "baas_node_status" DEFAULT 'online' NOT NULL,
	"vcpu_total" integer DEFAULT 0 NOT NULL,
	"ram_mb_total" integer DEFAULT 0 NOT NULL,
	"storage_gb_total" integer DEFAULT 0 NOT NULL,
	"vcpu_used" integer DEFAULT 0 NOT NULL,
	"ram_mb_used" integer DEFAULT 0 NOT NULL,
	"storage_gb_used" integer DEFAULT 0 NOT NULL,
	"provider_id" uuid,
	"location" varchar(100),
	"last_heartbeat" timestamp with time zone,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "baas_port_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"node_id" uuid NOT NULL,
	"port_base" integer NOT NULL,
	"project_id" uuid,
	"status" "baas_port_alloc_status" DEFAULT 'reserved' NOT NULL,
	"reserved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"bound_at" timestamp with time zone,
	"released_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "baas_projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"slug" varchar(100) NOT NULL,
	"organization_id" uuid NOT NULL,
	"node_id" uuid,
	"db_password" text,
	"jwt_secret" text,
	"anon_key" text,
	"service_role_key" text,
	"db_host" varchar(255),
	"db_port" integer,
	"db_name" varchar(100),
	"db_user" varchar(100),
	"api_url" text,
	"realtime_url" text,
	"storage_url" text,
	"studio_url" text,
	"host_port_base" integer,
	"vcpu_limit" numeric(5, 2),
	"ram_mb_limit" integer,
	"storage_gb_limit" integer,
	"status" "baas_project_status" DEFAULT 'provisioning' NOT NULL,
	"status_message" text,
	"container_ids" jsonb,
	"backup_enabled" boolean DEFAULT true NOT NULL,
	"backup_retention_days" integer DEFAULT 7 NOT NULL,
	"idle_timeout_minutes" integer,
	"last_activity_at" timestamp with time zone,
	"auto_wake_enabled" boolean DEFAULT true NOT NULL,
	"wal_archive_enabled" boolean DEFAULT false NOT NULL,
	"wal_archive_path" text,
	"pitr_enabled" boolean DEFAULT false NOT NULL,
	"parent_project_id" uuid,
	"branch_name" varchar(100),
	"branch_type" varchar(32),
	"scaling_mode" "baas_scaling_mode" DEFAULT 'manual' NOT NULL,
	"min_vcpu" numeric(5, 2),
	"max_vcpu" numeric(5, 2),
	"min_ram_mb" integer,
	"max_ram_mb" integer,
	"last_scaled_at" timestamp with time zone,
	"analytics_enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "baas_projects_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "baas_scaling_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"direction" "baas_scaling_direction" NOT NULL,
	"prev_vcpu" numeric(5, 2),
	"new_vcpu" numeric(5, 2),
	"prev_ram_mb" integer,
	"new_ram_mb" integer,
	"restarted" boolean DEFAULT false NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"role" varchar(32) DEFAULT 'member' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"slug" varchar(100) NOT NULL,
	"owner_id" uuid NOT NULL,
	"product" varchar(32) DEFAULT 'baas' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organizations_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(255) NOT NULL,
	"name" varchar(255),
	"password" text NOT NULL,
	"role" varchar(32) DEFAULT 'user' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "baas_backups" ADD CONSTRAINT "baas_backups_project_id_baas_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."baas_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "baas_custom_hostnames" ADD CONSTRAINT "baas_custom_hostnames_project_id_baas_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."baas_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "baas_metrics" ADD CONSTRAINT "baas_metrics_project_id_baas_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."baas_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "baas_port_allocations" ADD CONSTRAINT "baas_port_allocations_node_id_baas_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."baas_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "baas_port_allocations" ADD CONSTRAINT "baas_port_allocations_project_id_baas_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."baas_projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "baas_projects" ADD CONSTRAINT "baas_projects_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "baas_projects" ADD CONSTRAINT "baas_projects_node_id_baas_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."baas_nodes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "baas_scaling_events" ADD CONSTRAINT "baas_scaling_events_project_id_baas_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."baas_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "baas_backups_project_idx" ON "baas_backups" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "baas_backups_status_idx" ON "baas_backups" USING btree ("status");--> statement-breakpoint
CREATE INDEX "baas_hostnames_project_idx" ON "baas_custom_hostnames" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "baas_metrics_project_idx" ON "baas_metrics" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "baas_metrics_collected_idx" ON "baas_metrics" USING btree ("collected_at");--> statement-breakpoint
CREATE INDEX "baas_metrics_project_collected_idx" ON "baas_metrics" USING btree ("project_id","collected_at");--> statement-breakpoint
CREATE INDEX "baas_nodes_status_idx" ON "baas_nodes" USING btree ("status");--> statement-breakpoint
CREATE INDEX "baas_nodes_role_idx" ON "baas_nodes" USING btree ("role");--> statement-breakpoint
CREATE UNIQUE INDEX "baas_port_alloc_node_port_idx" ON "baas_port_allocations" USING btree ("node_id","port_base");--> statement-breakpoint
CREATE INDEX "baas_port_alloc_node_idx" ON "baas_port_allocations" USING btree ("node_id");--> statement-breakpoint
CREATE INDEX "baas_port_alloc_status_idx" ON "baas_port_allocations" USING btree ("status");--> statement-breakpoint
CREATE INDEX "baas_projects_org_idx" ON "baas_projects" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "baas_projects_node_idx" ON "baas_projects" USING btree ("node_id");--> statement-breakpoint
CREATE INDEX "baas_projects_status_idx" ON "baas_projects" USING btree ("status");--> statement-breakpoint
CREATE INDEX "baas_projects_parent_idx" ON "baas_projects" USING btree ("parent_project_id");--> statement-breakpoint
CREATE INDEX "baas_scaling_events_project_idx" ON "baas_scaling_events" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "members_user_org_idx" ON "members" USING btree ("user_id","organization_id");--> statement-breakpoint
CREATE INDEX "members_org_idx" ON "members" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "organizations_owner_idx" ON "organizations" USING btree ("owner_id");