/**
 * Shared scheduler configuration derived from environment variables.
 * Centralised so every module reads the same values and defaults.
 */

export const config = {
  tenantDataDir: process.env.TENANT_DATA_DIR ?? "/opt/baas-tenants",
  backupDir: process.env.BAAS_BACKUP_DIR ?? "/opt/baas-backups",
  dockerNetwork: process.env.BAAS_DOCKER_NETWORK ?? "guildserver",
  baseDomain: process.env.BAAS_BASE_DOMAIN ?? "guildserver.io",
  fallbackDomain: process.env.BAAS_FALLBACK_DOMAIN ?? "guildserver.io",
  tls: (process.env.BAAS_TLS ?? "false") === "true",
  portRangeStart: Number(process.env.BAAS_TENANT_PORT_RANGE_START ?? 9000),
  portRangeEnd: Number(process.env.BAAS_TENANT_PORT_RANGE_END ?? 65000),
  smtp: {
    host: process.env.SMTP_HOST || undefined,
    port: process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : undefined,
    user: process.env.SMTP_USER || undefined,
    pass: process.env.SMTP_PASS || undefined,
  },
} as const;

/**
 * Host ports the platform itself occupies — a tenant window may never overlap these.
 * (API 4001, web 3001, platform Postgres 5434, Redis 6379, traefik dashboard 8080,
 * traefik web/websecure 80/443, PaaS Postgres/Redis 5432/5433/6380.)
 */
export const EXCLUDED_PORTS = new Set<number>([
  80, 443, 3000, 3001, 4000, 4001, 5432, 5433, 5434, 6379, 6380, 8080,
]);

/** Size of the contiguous host-port window reserved per tenant stack. */
export const PORT_WINDOW = 10;
