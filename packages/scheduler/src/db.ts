/**
 * Central DB access for the scheduler: the shared client, all schema tables,
 * and the drizzle-orm query operators used across modules.
 */
import { db as _db } from "@guildserver/baas-db";
export { db } from "@guildserver/baas-db";

/** The db client OR a transaction handle — accepted by helpers that run in either. */
export type DbOrTx = typeof _db | Parameters<Parameters<typeof _db.transaction>[0]>[0];
export {
  users,
  organizations,
  members,
  baasNodes,
  baasProjects,
  baasBackups,
  baasCustomHostnames,
  baasMetrics,
  baasScalingEvents,
  baasPortAllocations,
} from "@guildserver/baas-db";

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
