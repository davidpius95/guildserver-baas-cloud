import { config } from "./config";

/** Pinned image versions for a tenant Supabase stack. */
export const IMAGES = {
  db: "supabase/postgres:17.6.1.136",
  supavisor: "supabase/supavisor:2.9.5",
  kong: "kong:3.9.1",
  auth: "supabase/gotrue:v2.189.0",
  rest: "postgrest/postgrest:v14.12",
  realtime: "supabase/realtime:v2.102.3",
  storage: "supabase/storage-api:v1.60.4",
  imgproxy: "darthsim/imgproxy:v3.30.1",
  meta: "supabase/postgres-meta:v0.96.6",
  functions: "supabase/edge-runtime:v1.74.0",
  studio: "supabase/studio:2026.06.03-sha-0bca601",
  analytics: "supabase/logflare:1.12.0",
  vector: "timberio/vector:0.34.1-alpine",
} as const;

export interface ProjectComposeConfig {
  projectSlug: string;
  dbName: string;
  dbUser: string;
  dbPassword: string;
  jwtSecret: string;
  anonKey: string;
  serviceRoleKey: string;
  apiExternalUrl: string;
  siteUrl: string;
  hostPortBase: number;
  ramMbLimit: number;
  vcpuLimit: number;
  smtpHost?: string;
  smtpPort?: number;
  smtpUser?: string;
  smtpPass?: string;
  walArchiveEnabled?: boolean;
  analyticsEnabled?: boolean;
}

/** Host-port offsets within a tenant's 10-port window. */
export const PORT_OFFSETS = {
  kongHttp: 0,
  kongHttps: 1,
  studio: 2,
  pooler: 3,
  db: 4,
  analytics: 5,
} as const;

const cpu = (fraction: number, vcpu: number) => (Math.max(0.1, fraction * vcpu)).toFixed(2);
const mem = (fraction: number, ramMb: number) => `${Math.max(64, Math.floor(fraction * ramMb))}M`;

function resources(cpuFrac: number, memFrac: number, cfg: ProjectComposeConfig): string {
  return `    deploy:
      resources:
        limits:
          cpus: "${cpu(cpuFrac, cfg.vcpuLimit)}"
          memory: ${mem(memFrac, cfg.ramMbLimit)}`;
}

/** Auto-tuned postgresql.conf. shared_buffers ~25% RAM, effective_cache_size ~75%. */
export function generatePostgresqlConf(ramMb: number, walArchiveEnabled = false): string {
  const sharedBuffersMb = Math.max(128, Math.floor(ramMb * 0.25));
  const effectiveCacheMb = Math.max(256, Math.floor(ramMb * 0.75));
  const maintenanceMb = Math.max(64, Math.floor(ramMb * 0.05));
  const walLines = walArchiveEnabled
    ? `wal_level = replica
archive_mode = on
archive_command = 'test ! -f /wal-archive/%f && cp %p /wal-archive/%f'
max_wal_senders = 3`
    : "";
  return `# Auto-generated for ${ramMb}MB RAM tenant
listen_addresses = '*'
shared_buffers = ${sharedBuffersMb}MB
effective_cache_size = ${effectiveCacheMb}MB
maintenance_work_mem = ${maintenanceMb}MB
work_mem = 8MB
max_connections = 100
${walLines}
`.replace(/\n{2,}/g, "\n");
}

/** Kong declarative config routing the tenant's public API surface. */
export function generateKongConfig(opts: { anonKey: string; serviceRoleKey: string }): string {
  return `_format_version: "3.0"
_transform: true

consumers:
  - username: anon
    keyauth_credentials:
      - key: ${opts.anonKey}
  - username: service_role
    keyauth_credentials:
      - key: ${opts.serviceRoleKey}

services:
  - name: auth-v1
    url: http://auth:9999/
    routes: [{ name: auth-v1, strip_path: true, paths: ["/auth/v1"] }]
    plugins: [{ name: cors }]
  - name: rest-v1
    url: http://rest:3000/
    routes: [{ name: rest-v1, strip_path: true, paths: ["/rest/v1"] }]
    plugins:
      - name: cors
      - name: key-auth
        config: { hide_credentials: true, key_names: ["apikey"] }
  - name: realtime-v1
    url: http://realtime:4000/socket/
    routes: [{ name: realtime-v1, strip_path: true, paths: ["/realtime/v1"] }]
    plugins: [{ name: cors }]
  - name: storage-v1
    url: http://storage:5000/
    routes: [{ name: storage-v1, strip_path: true, paths: ["/storage/v1"] }]
    plugins: [{ name: cors }]
  - name: meta
    url: http://meta:8080/
    routes: [{ name: meta, strip_path: true, paths: ["/pg"] }]
  - name: functions-v1
    url: http://functions:9000/
    routes: [{ name: functions-v1, strip_path: true, paths: ["/functions/v1"] }]
    plugins: [{ name: cors }]
`;
}

function analyticsServices(cfg: ProjectComposeConfig, name: (s: string) => string): string {
  if (!cfg.analyticsEnabled) return "";
  const analyticsPort = cfg.hostPortBase + PORT_OFFSETS.analytics;
  return `
  analytics:
    image: ${IMAGES.analytics}
    container_name: ${name("analytics")}
    restart: unless-stopped
    depends_on:
      db: { condition: service_healthy }
    environment:
      LOGFLARE_SINGLE_TENANT: "true"
      LOGFLARE_SUPABASE_MODE: "true"
      LOGFLARE_PRIVATE_ACCESS_TOKEN: ${cfg.serviceRoleKey}
      DB_HOSTNAME: db
      DB_PORT: 5432
      DB_USERNAME: ${cfg.dbUser}
      DB_PASSWORD: ${cfg.dbPassword}
      DB_DATABASE: ${cfg.dbName}
      DB_SCHEMA: _analytics
      LOGFLARE_NODE_HOST: 127.0.0.1
    ports:
      - "${analyticsPort}:4000"
    networks: [default]

  vector:
    image: ${IMAGES.vector}
    container_name: ${name("vector")}
    restart: unless-stopped
    depends_on:
      analytics: { condition: service_started }
    volumes:
      - ./vector.yml:/etc/vector/vector.yml:ro
      - /var/run/docker.sock:/var/run/docker.sock:ro
    command: --config /etc/vector/vector.yml
    networks: [default]
`;
}

/** Vector log-collector config, filtered to this stack's containers. */
export function generateVectorConfig(cfg: ProjectComposeConfig): string {
  const prefix = `baas-${cfg.projectSlug}-`;
  return `data_dir: /vector-data-dir
sources:
  docker_logs:
    type: docker_logs
    include_containers: ["${prefix}"]
sinks:
  logflare:
    type: http
    inputs: [docker_logs]
    uri: http://analytics:4000/api/logs?source_name=docker.${cfg.projectSlug}
    encoding: { codec: json }
    request:
      headers:
        x-api-key: ${cfg.serviceRoleKey}
`;
}

/** Generate the complete docker-compose.yml for a tenant stack. */
export function generateComposeYml(cfg: ProjectComposeConfig): string {
  const name = (svc: string) => `baas-${cfg.projectSlug}-${svc}`;
  const dbUrl = `postgres://${cfg.dbUser}:${cfg.dbPassword}@db:5432/${cfg.dbName}`;
  const kongHttp = cfg.hostPortBase + PORT_OFFSETS.kongHttp;
  const kongHttps = cfg.hostPortBase + PORT_OFFSETS.kongHttps;
  const studioPort = cfg.hostPortBase + PORT_OFFSETS.studio;
  const poolerPort = cfg.hostPortBase + PORT_OFFSETS.pooler;
  const walMount = cfg.walArchiveEnabled ? "\n      - ./wal-archive:/wal-archive" : "";
  const smtpHost = cfg.smtpHost ?? config.smtp.host ?? "";
  const smtpPort = cfg.smtpPort ?? config.smtp.port ?? 587;
  const smtpUser = cfg.smtpUser ?? config.smtp.user ?? "";
  const smtpPass = cfg.smtpPass ?? config.smtp.pass ?? "";
  const logflareEnabled = cfg.analyticsEnabled ? "true" : "false";

  return `name: baas-${cfg.projectSlug}

services:
  db:
    image: ${IMAGES.db}
    container_name: ${name("db")}
    restart: unless-stopped
    shm_size: 256mb
    environment:
      POSTGRES_USER: ${cfg.dbUser}
      POSTGRES_PASSWORD: ${cfg.dbPassword}
      POSTGRES_DB: ${cfg.dbName}
      JWT_SECRET: ${cfg.jwtSecret}
    volumes:
      - db-data:/var/lib/postgresql/data
      - ./postgresql.conf:/etc/postgresql/postgresql.conf:ro${walMount}
    command: ["postgres", "-c", "config_file=/etc/postgresql/postgresql.conf"]
    ports:
      - "${cfg.hostPortBase + PORT_OFFSETS.db}:5432"
    healthcheck:
      test: ["CMD", "pg_isready", "-U", "${cfg.dbUser}", "-d", "${cfg.dbName}"]
      interval: 5s
      timeout: 5s
      retries: 12
${resources(0.25, 0.4, cfg)}
    networks: [default]

  supavisor:
    image: ${IMAGES.supavisor}
    container_name: ${name("supavisor")}
    restart: unless-stopped
    depends_on:
      db: { condition: service_healthy }
    environment:
      DATABASE_URL: ${dbUrl}
      SECRET_KEY_BASE: ${cfg.jwtSecret}${cfg.jwtSecret}
      VAULT_ENC_KEY: ${cfg.dbPassword}${cfg.dbPassword}
      PORT: 4000
    ports:
      - "${poolerPort}:5432"
    networks: [default]

  kong:
    image: ${IMAGES.kong}
    container_name: ${name("kong")}
    restart: unless-stopped
    environment:
      KONG_DATABASE: "off"
      KONG_DECLARATIVE_CONFIG: /home/kong/kong.yml
      KONG_DNS_ORDER: LAST,A,CNAME
      KONG_PLUGINS: request-transformer,cors,key-auth,acl
    volumes:
      - ./kong.yml:/home/kong/kong.yml:ro
    ports:
      - "${kongHttp}:8000"
      - "${kongHttps}:8443"
${resources(0.1, 0.08, cfg)}
    networks: [default]

  auth:
    image: ${IMAGES.auth}
    container_name: ${name("auth")}
    restart: unless-stopped
    depends_on:
      db: { condition: service_healthy }
    environment:
      GOTRUE_API_HOST: 0.0.0.0
      GOTRUE_API_PORT: 9999
      API_EXTERNAL_URL: ${cfg.apiExternalUrl}
      GOTRUE_DB_DRIVER: postgres
      GOTRUE_DB_DATABASE_URL: ${dbUrl}
      GOTRUE_SITE_URL: ${cfg.siteUrl}
      GOTRUE_JWT_SECRET: ${cfg.jwtSecret}
      GOTRUE_JWT_EXP: 3600
      GOTRUE_JWT_DEFAULT_GROUP_NAME: authenticated
      GOTRUE_JWT_ADMIN_ROLES: service_role
      GOTRUE_JWT_AUD: authenticated
      GOTRUE_DISABLE_SIGNUP: "false"
      GOTRUE_MAILER_AUTOCONFIRM: "true"
      GOTRUE_SMTP_HOST: "${smtpHost}"
      GOTRUE_SMTP_PORT: "${smtpPort}"
      GOTRUE_SMTP_USER: "${smtpUser}"
      GOTRUE_SMTP_PASS: "${smtpPass}"
${resources(0.15, 0.2, cfg)}
    networks: [default]

  rest:
    image: ${IMAGES.rest}
    container_name: ${name("rest")}
    restart: unless-stopped
    depends_on:
      db: { condition: service_healthy }
    environment:
      PGRST_DB_URI: ${dbUrl}
      PGRST_DB_SCHEMAS: public,storage,graphql_public
      PGRST_DB_ANON_ROLE: anon
      PGRST_JWT_SECRET: ${cfg.jwtSecret}
      PGRST_DB_USE_LEGACY_GUCS: "false"
${resources(0.15, 0.15, cfg)}
    networks: [default]

  realtime:
    image: ${IMAGES.realtime}
    container_name: ${name("realtime")}
    restart: unless-stopped
    depends_on:
      db: { condition: service_healthy }
    environment:
      PORT: 4000
      DB_HOST: db
      DB_PORT: 5432
      DB_USER: ${cfg.dbUser}
      DB_PASSWORD: ${cfg.dbPassword}
      DB_NAME: ${cfg.dbName}
      DB_ENC_KEY: supabaserealtime
      API_JWT_SECRET: ${cfg.jwtSecret}
      SECRET_KEY_BASE: ${cfg.jwtSecret}${cfg.jwtSecret}
      ERL_AFLAGS: -proto_dist inet_tcp
      RLIMIT_NOFILE: "10000"
      APP_NAME: realtime
      SEED_SELF_HOST: "true"
${resources(0.1, 0.1, cfg)}
    networks: [default]

  storage:
    image: ${IMAGES.storage}
    container_name: ${name("storage")}
    restart: unless-stopped
    depends_on:
      db: { condition: service_healthy }
      rest: { condition: service_started }
      imgproxy: { condition: service_started }
    environment:
      ANON_KEY: ${cfg.anonKey}
      SERVICE_KEY: ${cfg.serviceRoleKey}
      POSTGREST_URL: http://rest:3000
      PGRST_JWT_SECRET: ${cfg.jwtSecret}
      DATABASE_URL: ${dbUrl}
      FILE_SIZE_LIMIT: 52428800
      STORAGE_BACKEND: file
      FILE_STORAGE_BACKEND_PATH: /var/lib/storage
      TENANT_ID: stub
      REGION: local
      GLOBAL_S3_BUCKET: stub
      ENABLE_IMAGE_TRANSFORMATION: "true"
      IMGPROXY_URL: http://imgproxy:8080
    volumes:
      - storage-data:/var/lib/storage
${resources(0.1, 0.1, cfg)}
    networks: [default]

  imgproxy:
    image: ${IMAGES.imgproxy}
    container_name: ${name("imgproxy")}
    restart: unless-stopped
    environment:
      IMGPROXY_BIND: ":8080"
      IMGPROXY_LOCAL_FILESYSTEM_ROOT: /
      IMGPROXY_USE_ETAG: "true"
      IMGPROXY_ENABLE_WEBP_DETECTION: "true"
    volumes:
      - storage-data:/var/lib/storage
    networks: [default]

  meta:
    image: ${IMAGES.meta}
    container_name: ${name("meta")}
    restart: unless-stopped
    depends_on:
      db: { condition: service_healthy }
    environment:
      PG_META_PORT: 8080
      PG_META_DB_HOST: db
      PG_META_DB_PORT: 5432
      PG_META_DB_NAME: ${cfg.dbName}
      PG_META_DB_USER: ${cfg.dbUser}
      PG_META_DB_PASSWORD: ${cfg.dbPassword}
    networks: [default]

  functions:
    image: ${IMAGES.functions}
    container_name: ${name("functions")}
    restart: unless-stopped
    depends_on:
      db: { condition: service_healthy }
    environment:
      JWT_SECRET: ${cfg.jwtSecret}
      SUPABASE_URL: http://kong:8000
      SUPABASE_ANON_KEY: ${cfg.anonKey}
      SUPABASE_SERVICE_ROLE_KEY: ${cfg.serviceRoleKey}
      SUPABASE_DB_URL: ${dbUrl}
    volumes:
      - functions-data:/home/deno/functions
    command: ["start", "--main-service", "/home/deno/functions/main"]
    networks: [default]

  studio:
    image: ${IMAGES.studio}
    container_name: ${name("studio")}
    restart: unless-stopped
    depends_on:
      meta: { condition: service_started }
    environment:
      STUDIO_PG_META_URL: http://meta:8080
      POSTGRES_PASSWORD: ${cfg.dbPassword}
      DEFAULT_ORGANIZATION_NAME: ${cfg.projectSlug}
      DEFAULT_PROJECT_NAME: ${cfg.projectSlug}
      SUPABASE_URL: http://kong:8000
      SUPABASE_PUBLIC_URL: ${cfg.apiExternalUrl}
      SUPABASE_ANON_KEY: ${cfg.anonKey}
      SUPABASE_SERVICE_KEY: ${cfg.serviceRoleKey}
      AUTH_JWT_SECRET: ${cfg.jwtSecret}
      NEXT_PUBLIC_ENABLE_LOGS: "${logflareEnabled}"
      LOGFLARE_URL: http://analytics:4000
    ports:
      - "${studioPort}:3000"
${resources(0.1, 0.12, cfg)}
    networks: [default]
${analyticsServices(cfg, name)}
volumes:
  db-data:
  storage-data:
  functions-data:

networks:
  default:
    name: baas-${cfg.projectSlug}
`;
}
