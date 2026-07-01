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

// Re-export the drizzle query operators so consumers import from one place.
export {
  and,
  asc,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  ne,
  or,
  sql,
} from "drizzle-orm";

export type Database = typeof db;
