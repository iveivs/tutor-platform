import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");

const pool = new pg.Pool({
  connectionString,
  max: 1,
  application_name: "tutor-platform-migrations",
});

try {
  const client = await pool.connect();
  try {
    const lock = await client.query("select pg_try_advisory_lock($1) as locked", [821_774_031]);
    if (!lock.rows[0]?.locked) throw new Error("Another database migration is already running");
    try {
      await migrate(drizzle(client), { migrationsFolder: "drizzle-postgres" });
    } finally {
      await client.query("select pg_advisory_unlock($1)", [821_774_031]);
    }
  } finally {
    client.release();
  }
  console.log("PostgreSQL migrations are up to date.");
} finally {
  await pool.end();
}
