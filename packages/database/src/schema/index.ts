import { relations } from "drizzle-orm";
import {
  boolean,
  decimal,
  index,
  inet,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

/* ────────────────────────────── Enums ────────────────────────────── */

export const baasProjectStatusEnum = pgEnum("baas_project_status", [
  "provisioning",
  "active",
  "paused",
  "error",
  "deleting",
]);

export const baasNodeRoleEnum = pgEnum("baas_node_role", ["edge", "compute", "storage"]);

export const baasNodeStatusEnum = pgEnum("baas_node_status", [
  "online",
  "offline",
  "maintenance",
  "error",
]);

export const backupStatusEnum = pgEnum("baas_backup_status", [
  "pending",
  "in_progress",
  "completed",
  "failed",
]);

// manual | automatic | pre_merge (safety snapshot before a branch merge)
// "base" is reserved for future PITR (pg_basebackup) work — not used in v1.
export const backupTypeEnum = pgEnum("baas_backup_type", [
  "manual",
  "automatic",
  "pre_merge",
  "base",
]);

export const domainStatusEnum = pgEnum("baas_domain_status", [
  "pending",
  "verifying",
  "active",
  "failed",
  "expired",
]);

export const portAllocStatusEnum = pgEnum("baas_port_alloc_status", [
  "reserved",
  "bound",
  "released",
]);

export const scalingModeEnum = pgEnum("baas_scaling_mode", ["manual", "auto"]);

export const scalingDirectionEnum = pgEnum("baas_scaling_direction", ["up", "down"]);

/* ────────────────────────────── users ────────────────────────────── */

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  name: varchar("name", { length: 255 }),
  password: text("password").notNull(),
  role: varchar("role", { length: 32 }).notNull().default("user"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ────────────────────────── organizations ────────────────────────── */

export const organizations = pgTable(
  "organizations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: varchar("name", { length: 255 }).notNull(),
    slug: varchar("slug", { length: 100 }).notNull().unique(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    product: varchar("product", { length: 32 }).notNull().default("baas"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("organizations_owner_idx").on(t.ownerId)],
);

/* ────────────────────────────── members ──────────────────────────── */

export const members = pgTable(
  "members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    role: varchar("role", { length: 32 }).notNull().default("member"), // owner | admin | member
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("members_user_org_idx").on(t.userId, t.organizationId),
    index("members_org_idx").on(t.organizationId),
  ],
);

/* ───────────────────────────── baas_nodes ────────────────────────── */
// Single-node v1: exactly one seeded "localhost" compute row.
// SSH fields intentionally omitted — re-added when real multi-node lands.

export const baasNodes = pgTable(
  "baas_nodes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: varchar("name", { length: 255 }).notNull(),
    hostname: varchar("hostname", { length: 255 }).notNull(),
    internalIp: inet("internal_ip"),
    externalIp: inet("external_ip"),
    role: baasNodeRoleEnum("role").notNull().default("compute"),
    status: baasNodeStatusEnum("status").notNull().default("online"),
    // capacity
    vcpuTotal: integer("vcpu_total").notNull().default(0),
    ramMbTotal: integer("ram_mb_total").notNull().default(0),
    storageGbTotal: integer("storage_gb_total").notNull().default(0),
    // live usage
    vcpuUsed: integer("vcpu_used").notNull().default(0),
    ramMbUsed: integer("ram_mb_used").notNull().default(0),
    storageGbUsed: integer("storage_gb_used").notNull().default(0),
    providerId: uuid("provider_id"),
    location: varchar("location", { length: 100 }),
    lastHeartbeat: timestamp("last_heartbeat", { withTimezone: true }),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("baas_nodes_status_idx").on(t.status), index("baas_nodes_role_idx").on(t.role)],
);

/* ──────────────────────────── baas_projects ──────────────────────── */

export const baasProjects = pgTable(
  "baas_projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: varchar("name", { length: 255 }).notNull(),
    slug: varchar("slug", { length: 100 }).notNull().unique(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    nodeId: uuid("node_id").references(() => baasNodes.id, { onDelete: "set null" }),

    // secrets — stored AES-256-GCM encrypted (see @guildserver/baas-scheduler crypto.ts)
    dbPassword: text("db_password"),
    jwtSecret: text("jwt_secret"),
    anonKey: text("anon_key"),
    serviceRoleKey: text("service_role_key"),

    // database connection
    dbHost: varchar("db_host", { length: 255 }),
    dbPort: integer("db_port"),
    dbName: varchar("db_name", { length: 100 }),
    dbUser: varchar("db_user", { length: 100 }),

    // endpoints
    apiUrl: text("api_url"),
    realtimeUrl: text("realtime_url"),
    storageUrl: text("storage_url"),
    studioUrl: text("studio_url"),

    // port allocation (10-port window base)
    hostPortBase: integer("host_port_base"),

    // resource limits
    vcpuLimit: decimal("vcpu_limit", { precision: 5, scale: 2 }),
    ramMbLimit: integer("ram_mb_limit"),
    storageGbLimit: integer("storage_gb_limit"),

    // status
    status: baasProjectStatusEnum("status").notNull().default("provisioning"),
    statusMessage: text("status_message"),

    // container tracking
    containerIds: jsonb("container_ids"),

    // backups
    backupEnabled: boolean("backup_enabled").notNull().default(true),
    backupRetentionDays: integer("backup_retention_days").notNull().default(7),

    // auto-pause
    idleTimeoutMinutes: integer("idle_timeout_minutes"),
    lastActivityAt: timestamp("last_activity_at", { withTimezone: true }),
    autoWakeEnabled: boolean("auto_wake_enabled").notNull().default(true),

    // WAL / PITR — reserved for a future phase (not built in v1)
    walArchiveEnabled: boolean("wal_archive_enabled").notNull().default(false),
    walArchivePath: text("wal_archive_path"),
    pitrEnabled: boolean("pitr_enabled").notNull().default(false),

    // branching
    parentProjectId: uuid("parent_project_id"),
    branchName: varchar("branch_name", { length: 100 }),
    branchType: varchar("branch_type", { length: 32 }), // preview | staging

    // scaling
    scalingMode: scalingModeEnum("scaling_mode").notNull().default("manual"),
    minVcpu: decimal("min_vcpu", { precision: 5, scale: 2 }),
    maxVcpu: decimal("max_vcpu", { precision: 5, scale: 2 }),
    minRamMb: integer("min_ram_mb"),
    maxRamMb: integer("max_ram_mb"),
    lastScaledAt: timestamp("last_scaled_at", { withTimezone: true }),

    // analytics
    analyticsEnabled: boolean("analytics_enabled").notNull().default(false),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("baas_projects_org_idx").on(t.organizationId),
    index("baas_projects_node_idx").on(t.nodeId),
    index("baas_projects_status_idx").on(t.status),
    index("baas_projects_parent_idx").on(t.parentProjectId),
  ],
);

/* ──────────────────────────── baas_backups ───────────────────────── */

export const baasBackups = pgTable(
  "baas_backups",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => baasProjects.id, { onDelete: "cascade" }),
    status: backupStatusEnum("status").notNull().default("pending"),
    backupType: backupTypeEnum("backup_type").notNull().default("manual"),
    sizeBytes: integer("size_bytes"),
    filePath: text("file_path"),
    walTargetTime: timestamp("wal_target_time", { withTimezone: true }),
    error: text("error"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("baas_backups_project_idx").on(t.projectId),
    index("baas_backups_status_idx").on(t.status),
  ],
);

/* ─────────────────────── baas_custom_hostnames ───────────────────── */

export const baasCustomHostnames = pgTable(
  "baas_custom_hostnames",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => baasProjects.id, { onDelete: "cascade" }),
    hostname: varchar("hostname", { length: 255 }).notNull().unique(),
    cfCustomHostnameId: varchar("cf_custom_hostname_id", { length: 255 }),
    cfOwnershipTxtName: text("cf_ownership_txt_name"),
    cfOwnershipTxtValue: text("cf_ownership_txt_value"),
    cfSslStatus: varchar("cf_ssl_status", { length: 64 }),
    status: domainStatusEnum("status").notNull().default("pending"),
    verified: boolean("verified").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("baas_hostnames_project_idx").on(t.projectId)],
);

/* ──────────────────────────── baas_metrics ───────────────────────── */

export const baasMetrics = pgTable(
  "baas_metrics",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => baasProjects.id, { onDelete: "cascade" }),
    collectedAt: timestamp("collected_at", { withTimezone: true }).notNull().defaultNow(),
    cpuPercent: decimal("cpu_percent", { precision: 6, scale: 2 }),
    ramMbUsed: integer("ram_mb_used"),
    storageGbUsed: decimal("storage_gb_used", { precision: 10, scale: 2 }),
    activeConnections: integer("active_connections"),
    dbSizeMb: decimal("db_size_mb", { precision: 12, scale: 2 }),
    txCommitted: integer("tx_committed"),
    txRolledBack: integer("tx_rolled_back"),
    metadata: jsonb("metadata"),
  },
  (t) => [
    index("baas_metrics_project_idx").on(t.projectId),
    index("baas_metrics_collected_idx").on(t.collectedAt),
    index("baas_metrics_project_collected_idx").on(t.projectId, t.collectedAt),
  ],
);

/* ────────────────────────── baas_scaling_events ──────────────────── */

export const baasScalingEvents = pgTable(
  "baas_scaling_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => baasProjects.id, { onDelete: "cascade" }),
    direction: scalingDirectionEnum("direction").notNull(),
    prevVcpu: decimal("prev_vcpu", { precision: 5, scale: 2 }),
    newVcpu: decimal("new_vcpu", { precision: 5, scale: 2 }),
    prevRamMb: integer("prev_ram_mb"),
    newRamMb: integer("new_ram_mb"),
    restarted: boolean("restarted").notNull().default(false),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("baas_scaling_events_project_idx").on(t.projectId)],
);

/* ──────────────────────── baas_port_allocations ──────────────────── */

export const baasPortAllocations = pgTable(
  "baas_port_allocations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    nodeId: uuid("node_id")
      .notNull()
      .references(() => baasNodes.id, { onDelete: "cascade" }),
    portBase: integer("port_base").notNull(),
    projectId: uuid("project_id").references(() => baasProjects.id, { onDelete: "set null" }),
    status: portAllocStatusEnum("status").notNull().default("reserved"),
    reservedAt: timestamp("reserved_at", { withTimezone: true }).notNull().defaultNow(),
    boundAt: timestamp("bound_at", { withTimezone: true }),
    releasedAt: timestamp("released_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("baas_port_alloc_node_port_idx").on(t.nodeId, t.portBase),
    index("baas_port_alloc_node_idx").on(t.nodeId),
    index("baas_port_alloc_status_idx").on(t.status),
  ],
);

/* ────────────────────────────── Relations ────────────────────────── */

export const usersRelations = relations(users, ({ many }) => ({
  ownedOrganizations: many(organizations),
  memberships: many(members),
}));

export const organizationsRelations = relations(organizations, ({ one, many }) => ({
  owner: one(users, { fields: [organizations.ownerId], references: [users.id] }),
  members: many(members),
  projects: many(baasProjects),
}));

export const membersRelations = relations(members, ({ one }) => ({
  user: one(users, { fields: [members.userId], references: [users.id] }),
  organization: one(organizations, {
    fields: [members.organizationId],
    references: [organizations.id],
  }),
}));

export const baasNodesRelations = relations(baasNodes, ({ many }) => ({
  projects: many(baasProjects),
  portAllocations: many(baasPortAllocations),
}));

export const baasProjectsRelations = relations(baasProjects, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [baasProjects.organizationId],
    references: [organizations.id],
  }),
  node: one(baasNodes, { fields: [baasProjects.nodeId], references: [baasNodes.id] }),
  parent: one(baasProjects, {
    fields: [baasProjects.parentProjectId],
    references: [baasProjects.id],
    relationName: "branches",
  }),
  branches: many(baasProjects, { relationName: "branches" }),
  backups: many(baasBackups),
  customHostnames: many(baasCustomHostnames),
  metrics: many(baasMetrics),
  scalingEvents: many(baasScalingEvents),
  portAllocations: many(baasPortAllocations),
}));

export const baasBackupsRelations = relations(baasBackups, ({ one }) => ({
  project: one(baasProjects, { fields: [baasBackups.projectId], references: [baasProjects.id] }),
}));

export const baasCustomHostnamesRelations = relations(baasCustomHostnames, ({ one }) => ({
  project: one(baasProjects, {
    fields: [baasCustomHostnames.projectId],
    references: [baasProjects.id],
  }),
}));

export const baasMetricsRelations = relations(baasMetrics, ({ one }) => ({
  project: one(baasProjects, { fields: [baasMetrics.projectId], references: [baasProjects.id] }),
}));

export const baasScalingEventsRelations = relations(baasScalingEvents, ({ one }) => ({
  project: one(baasProjects, {
    fields: [baasScalingEvents.projectId],
    references: [baasProjects.id],
  }),
}));

export const baasPortAllocationsRelations = relations(baasPortAllocations, ({ one }) => ({
  node: one(baasNodes, { fields: [baasPortAllocations.nodeId], references: [baasNodes.id] }),
  project: one(baasProjects, {
    fields: [baasPortAllocations.projectId],
    references: [baasProjects.id],
  }),
}));
