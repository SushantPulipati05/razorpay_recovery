import { Pool, QueryResult, QueryResultRow } from 'pg';

const connectionString =
  process.env.DATABASE_URL ||
  'postgresql://postgres:postgres@localhost:5432/razor_recover';

export const pool = new Pool({
  connectionString
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle PostgreSQL client (dashboard)', err);
});

export async function query<T extends QueryResultRow = any>(
  text: string,
  params?: any[]
): Promise<QueryResult<T>> {
  return pool.query<T>(text, params);
}
