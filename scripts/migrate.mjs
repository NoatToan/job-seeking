// Applies db/migrations/*.sql in order, once each (tracked in schema_migrations).
// Runs in the Vercel build and locally: `pnpm db:migrate` (reads DATABASE_URL, or the repo's .env.local).
import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const localEnv = path.join(root, ".env.local");
if (!process.env.DATABASE_URL && existsSync(localEnv)) process.loadEnvFile(localEnv);

if (!process.env.DATABASE_URL) {
  console.log("migrate: DATABASE_URL not set, skipping");
  process.exit(0);
}

const sql = postgres(process.env.DATABASE_URL, { max: 1, onnotice: () => {} });
try {
  await sql`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`;
  const dir = path.join(root, "db", "migrations");
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  const done = new Set((await sql`SELECT name FROM schema_migrations`).map((r) => r.name));
  for (const file of files) {
    if (done.has(file)) continue;
    const body = await readFile(path.join(dir, file), "utf8");
    await sql.begin(async (tx) => {
      await tx.unsafe(body);
      await tx`INSERT INTO schema_migrations (name) VALUES (${file})`;
    });
    console.log(`migrate: applied ${file}`);
  }
  console.log("migrate: up to date");
} finally {
  await sql.end();
}
