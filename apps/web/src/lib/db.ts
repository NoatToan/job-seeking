import "server-only";
import postgres from "postgres";

// One small pool per server instance; the shared Postgres has a limited connection budget.
const globalForDb = globalThis as unknown as { sql?: postgres.Sql };

export function db(): postgres.Sql {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
  globalForDb.sql ??= postgres(process.env.DATABASE_URL, { max: 3, idle_timeout: 20 });
  return globalForDb.sql;
}
