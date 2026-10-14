import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { env } from './env';

export const pool = new Pool({ connectionString: env.DATABASE_URL, connectionTimeoutMillis: 2000 });
// An idle client erroring (e.g. DB restart) is emitted here; unhandled, it crashes the process.
pool.on('error', () => {});
export const db = drizzle(pool);
