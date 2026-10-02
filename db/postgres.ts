import "server-only";

import { Pool, type PoolClient, type QueryResultRow } from "pg";

const globalForPostgres = globalThis as typeof globalThis & { tutorPostgresPool?: Pool };

function connectionString() {
  const value = process.env.DATABASE_URL;
  if (!value) throw new Error("DATABASE_URL is not configured");
  return value;
}

export function getPostgresPool() {
  if (!globalForPostgres.tutorPostgresPool) {
    globalForPostgres.tutorPostgresPool = new Pool({
      connectionString: connectionString(),
      max: Number(process.env.DATABASE_POOL_MAX ?? 10),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      application_name: "tutor-platform-web",
    });
  }
  return globalForPostgres.tutorPostgresPool;
}

export async function queryPostgres<Row extends QueryResultRow>(text: string, values: unknown[] = []) {
  return getPostgresPool().query<Row>(text, values);
}

export async function withPostgresTransaction<T>(work: (client: PoolClient) => Promise<T>) {
  const client = await getPostgresPool().connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

