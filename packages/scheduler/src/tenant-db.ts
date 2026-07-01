import postgres from "postgres";

/**
 * Manage per-tenant databases inside the shared platform Postgres.
 * Uses the admin DATABASE_URL; connects to the default `postgres` db for
 * CREATE/DROP DATABASE (which cannot run inside the target db or a transaction).
 */

function adminUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  return url;
}

/** Build a connection URL to a specific database on the same server. */
function urlForDb(dbName: string): string {
  const u = new URL(adminUrl());
  u.pathname = `/${dbName}`;
  return u.toString();
}

// Identifiers are validated (slug-derived) but we still quote defensively.
function quoteIdent(name: string): string {
  if (!/^[a-zA-Z0-9_]+$/.test(name)) {
    throw new Error(`Unsafe SQL identifier: ${name}`);
  }
  return `"${name}"`;
}

export async function createTenantDatabase(
  dbName: string,
  dbUser: string,
  dbPassword: string,
): Promise<void> {
  const admin = postgres(adminUrl(), { max: 1 });
  try {
    const dbIdent = quoteIdent(dbName);
    const userIdent = quoteIdent(dbUser);

    // Role first (idempotent-ish: ignore "already exists").
    await admin.unsafe(
      `DO $$ BEGIN
         IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${dbUser}') THEN
           CREATE ROLE ${userIdent} LOGIN PASSWORD '${dbPassword.replace(/'/g, "''")}';
         END IF;
       END $$;`,
    );

    // CREATE DATABASE can't run in a transaction block — run standalone.
    const exists = await admin`SELECT 1 FROM pg_database WHERE datname = ${dbName}`;
    if (exists.length === 0) {
      await admin.unsafe(`CREATE DATABASE ${dbIdent} OWNER ${userIdent}`);
    }
    await admin.unsafe(`GRANT ALL PRIVILEGES ON DATABASE ${dbIdent} TO ${userIdent}`);
  } finally {
    await admin.end();
  }

  // Grant default privileges to the Supabase roles inside the new database.
  const tenant = postgres(urlForDb(dbName), { max: 1 });
  try {
    await tenant.unsafe(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
      END $$;
    `);
    await tenant.unsafe(`GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;`);
    await tenant.unsafe(`
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
    `);
  } finally {
    await tenant.end();
  }
}

export async function dropTenantDatabase(dbName: string, dbUser: string): Promise<void> {
  const admin = postgres(adminUrl(), { max: 1 });
  try {
    const dbIdent = quoteIdent(dbName);
    const userIdent = quoteIdent(dbUser);

    // Terminate active connections to the target database.
    await admin`
      SELECT pg_terminate_backend(pid) FROM pg_stat_activity
      WHERE datname = ${dbName} AND pid <> pg_backend_pid()
    `;
    await admin.unsafe(`DROP DATABASE IF EXISTS ${dbIdent}`);
    await admin.unsafe(`DROP ROLE IF EXISTS ${userIdent}`);
  } finally {
    await admin.end();
  }
}
