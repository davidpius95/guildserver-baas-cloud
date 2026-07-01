import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is not set");
}

// Reuse a single connection pool across the process.
const client = postgres(connectionString, { max: 10 });

export const db = drizzle(client, { schema });
export { schema };
export * from "./schema";

export type Database = typeof db;
