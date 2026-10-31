import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import pg from "pg";

export function createDatabase(databaseUrl) {
  // A pool reuses a limited number of connections across requests.
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    max: 10,
    connectionTimeoutMillis: 2000,
    idleTimeoutMillis: 30000,
    statement_timeout: 2000,
    query_timeout: 3000
  });
  pool.on("error", () => {
    console.error("An idle database connection failed");
  });
  const db = drizzle(pool);

  function checkDatabase() {
    return db.execute(sql`SELECT 1`);
  }

  return { pool, db, checkDatabase };
}
